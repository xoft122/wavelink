import initSoundKit, {
  WasmAacLcDecoder,
  WasmAudioTrackDemuxer,
} from "../vendor/soundkit/soundkit_wasm.js";
import {
  SOUNDKIT_WASM_GZIP_BASE64,
  SOUNDKIT_WASM_SIZE,
} from "../vendor/soundkit/soundkit_wasm_payload.js";
import { soundCloudMediaProxyUrl } from "./directSoundcloud";

const MANIFEST_LIMIT_BYTES = 2 * 1024 * 1024;
const INIT_SEGMENT_LIMIT_BYTES = 2 * 1024 * 1024;
const MEDIA_SEGMENT_LIMIT_BYTES = 12 * 1024 * 1024;
const MAX_SEGMENTS = 10_000;
const MAX_TRACK_DURATION_SECONDS = 24 * 60 * 60;
const PREFETCH_SEGMENTS = 4;
const MAX_DECODED_SEGMENTS = 8;

/** A typed rendition failure, distinct from networking, cancellation and autoplay. */
export class SoftwareAacDecodeError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message :
      typeof cause === "string" ? cause : "The AAC bitstream could not be decoded.";
    super(`AAC decoding failed: ${detail.trim().slice(0, 240)}`);
    this.name = "SoftwareAacDecodeError";
  }
}

function decodeAacOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (cause) {
    throw new SoftwareAacDecodeError(cause);
  }
}

export interface SoftwareAacSegment {
  index: number;
  url: string;
  start: number;
  duration: number;
}

export interface SoftwareAacManifest {
  initUrl: string;
  duration: number;
  segments: SoftwareAacSegment[];
}

interface DecodedSegment {
  index: number;
  start: number;
  duration: number;
  buffer: AudioBuffer;
}

interface ScheduledSegment {
  generation: number;
  node: AudioBufferSourceNode;
}

interface AacConfigEvent {
  type: "config";
  codec: string;
  codecPrivate?: Uint8Array;
  sampleRate?: number;
  channels?: number;
}

interface AacPacketEvent {
  type: "packet";
  codec: string;
  rawData?: Uint8Array;
}

type DemuxEvent = AacConfigEvent | AacPacketEvent | Record<string, unknown>;

export interface SoftwareAacPlaybackOptions {
  mediaElement: HTMLAudioElement;
  audioContext: AudioContext;
  sourceUrl: string;
  durationHint?: number;
  onFatalError: (message: string) => void;
}

export interface SoftwareAacSegmentSchedule {
  when: number;
  offset: number;
}

let soundKitReady: Promise<void> | null = null;

function decodeBase64Bytes(value: string): Uint8Array<ArrayBuffer> {
  if (!value) throw new Error("The bundled AAC decoder payload is missing.");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function bundledSoundKitWasm(): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Spotify does not support the bundled AAC decoder format.");
  }
  const compressed = decodeBase64Bytes(SOUNDKIT_WASM_GZIP_BASE64);
  const stream = new Blob([compressed.buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const bytes = await new Response(stream).arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (
    bytes.byteLength !== SOUNDKIT_WASM_SIZE ||
    header.length !== 4 ||
    header[0] !== 0x00 ||
    header[1] !== 0x61 ||
    header[2] !== 0x73 ||
    header[3] !== 0x6d
  ) {
    throw new Error("The bundled AAC decoder payload is invalid.");
  }
  return bytes;
}

async function ensureSoundKit(): Promise<void> {
  if (soundKitReady) return soundKitReady;
  soundKitReady = (async () => {
    const bytes = await bundledSoundKitWasm();
    await initSoundKit({ module_or_path: bytes });
  })().catch((cause) => {
    soundKitReady = null;
    throw cause;
  });
  return soundKitReady;
}

function parseQuotedAttribute(value: string, name: string): string | null {
  const matcher = new RegExp(
    `(?:^|,)\\s*${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^,]*))`,
    "i",
  );
  const match = matcher.exec(value);
  if (!match) return null;
  if (match[1] !== undefined) {
    return match[1].replace(/\\(["\\])/g, "$1").trim();
  }
  return String(match[2] ?? "").trim();
}

function resolvePlaylistUrl(value: string, playlistUrl: string): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("The SoundCloud HLS playlist contains an invalid URL.");
  }
  const resolved = new URL(value, playlistUrl);
  // The proxy helper is also our canonical SoundCloud CDN allowlist. Calling
  // it here validates every nested URL before any request can leave WaveLink.
  soundCloudMediaProxyUrl(resolved);
  return resolved.toString();
}

/** Parse the finite AAC/fMP4 media playlist currently returned by SoundCloud. */
export function parseSoftwareAacManifest(
  manifestText: string,
  playlistUrl: string,
): SoftwareAacManifest {
  if (new TextEncoder().encode(manifestText).byteLength > MANIFEST_LIMIT_BYTES) {
    throw new Error("The SoundCloud HLS playlist is too large.");
  }
  const lines = manifestText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (lines[0] !== "#EXTM3U") {
    throw new Error("SoundCloud returned an invalid HLS playlist.");
  }
  if (!lines.includes("#EXT-X-ENDLIST")) {
    throw new Error("WaveLink currently requires a finite SoundCloud stream.");
  }
  if (lines.some((line) => line.startsWith("#EXT-X-KEY:"))) {
    throw new Error("Encrypted SoundCloud HLS is not supported.");
  }

  let initUrl: string | null = null;
  let pendingDuration: number | null = null;
  let totalDuration = 0;
  const segments: SoftwareAacSegment[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#EXT-X-MAP:")) {
      if (parseQuotedAttribute(line.slice("#EXT-X-MAP:".length), "BYTERANGE")) {
        throw new Error("Byte-range HLS init segments are not supported.");
      }
      const uri = parseQuotedAttribute(line.slice("#EXT-X-MAP:".length), "URI");
      if (!uri) throw new Error("The SoundCloud HLS init segment is missing.");
      const nextInitUrl = resolvePlaylistUrl(uri, playlistUrl);
      if (initUrl && initUrl !== nextInitUrl) {
        throw new Error("Changing HLS init segments are not supported.");
      }
      initUrl = nextInitUrl;
      continue;
    }
    if (
      line.startsWith("#EXT-X-BYTERANGE:") ||
      line === "#EXT-X-GAP" ||
      line === "#EXT-X-DISCONTINUITY"
    ) {
      throw new Error("This SoundCloud HLS layout is not supported.");
    }
    if (line.startsWith("#EXTINF:")) {
      const rawDuration = line.slice("#EXTINF:".length).split(",", 1)[0];
      const duration = Number(rawDuration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
        throw new Error("The SoundCloud HLS segment duration is invalid.");
      }
      pendingDuration = duration;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (pendingDuration === null) {
      throw new Error("The SoundCloud HLS segment has no duration.");
    }
    if (segments.length >= MAX_SEGMENTS) {
      throw new Error("The SoundCloud HLS playlist has too many segments.");
    }
    const duration = pendingDuration;
    segments.push({
      index: segments.length,
      url: resolvePlaylistUrl(line, playlistUrl),
      start: totalDuration,
      duration,
    });
    totalDuration += duration;
    pendingDuration = null;
    if (totalDuration > MAX_TRACK_DURATION_SECONDS) {
      throw new Error("The SoundCloud HLS stream is too long.");
    }
  }

  if (!initUrl || segments.length === 0 || pendingDuration !== null) {
    throw new Error("The SoundCloud HLS playlist is incomplete.");
  }
  return { initUrl, duration: totalDuration, segments };
}

/** Map a media segment onto the AudioContext clock without double-seeking. */
export function calculateSoftwareAacSegmentSchedule(
  contextTime: number,
  anchorContextTime: number,
  anchorPosition: number,
  segmentStart: number,
  bufferDuration: number,
): SoftwareAacSegmentSchedule {
  const nominalWhen =
    anchorContextTime + segmentStart - anchorPosition;
  const when = Math.max(contextTime + 0.01, nominalWhen);
  const offset = Math.min(
    Math.max(0, bufferDuration - 0.001),
    Math.max(0, when - nominalWhen),
  );
  return { when, offset };
}

async function fetchBoundedBytes(
  url: string,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(soundCloudMediaProxyUrl(url), {
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (!response.ok) {
    throw new Error(`SoundCloud media request failed (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error("A SoundCloud media segment is too large.");
  }
  let bytes: Uint8Array;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          throw new Error("A SoundCloud media segment is too large.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.byteLength === 0 || bytes.byteLength > limit) {
    throw new Error("A SoundCloud media segment has an invalid size.");
  }
  return bytes;
}

async function fetchManifest(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<SoftwareAacManifest> {
  const bytes = await fetchBoundedBytes(
    sourceUrl,
    MANIFEST_LIMIT_BYTES,
    signal,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseSoftwareAacManifest(text, sourceUrl);
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function mediaErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message || "The bundled AAC decoder could not continue playback.";
}

export class SoftwareAacPlayback {
  readonly sourceUrl: string;
  readonly duration: number;
  readonly readyState = 4;
  readonly playbackRate = 1;
  error: MediaError | null = null;

  private readonly mediaElement: HTMLAudioElement;
  private readonly manifest: SoftwareAacManifest;
  private readonly initBytes: Uint8Array;
  private readonly context: AudioContext;
  private readonly gain: GainNode;
  private readonly abortController = new AbortController();
  private readonly onFatalError: (message: string) => void;
  private readonly decoded = new Map<number, DecodedSegment>();
  private readonly decoding = new Map<number, Promise<DecodedSegment>>();
  private readonly scheduled = new Map<number, ScheduledSegment>();

  private positionSeconds = 0;
  private anchorPositionSeconds = 0;
  private anchorContextSeconds = 0;
  private playbackGeneration = 0;
  private operationGeneration = 0;
  private timer: number | null = null;
  private destroyed = false;
  private buffering = false;
  private fatalReported = false;
  private _paused = true;
  private _ended = false;

  private constructor(
    options: SoftwareAacPlaybackOptions,
    manifest: SoftwareAacManifest,
    initBytes: Uint8Array,
    context: AudioContext,
  ) {
    this.mediaElement = options.mediaElement;
    this.sourceUrl = options.sourceUrl;
    this.manifest = manifest;
    this.duration =
      manifest.duration > 0
        ? manifest.duration
        : Math.max(0, Number(options.durationHint) || 0);
    this.initBytes = initBytes;
    this.context = context;
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.onFatalError = options.onFatalError;
    this.syncGain();
  }

  static async create(
    options: SoftwareAacPlaybackOptions,
  ): Promise<SoftwareAacPlayback> {
    const controller = new AbortController();
    try {
      const [manifest] = await Promise.all([
        fetchManifest(options.sourceUrl, controller.signal),
        ensureSoundKit(),
      ]);
      const initBytes = await fetchBoundedBytes(
        manifest.initUrl,
        INIT_SEGMENT_LIMIT_BYTES,
        controller.signal,
      );
      const playback = new SoftwareAacPlayback(
        options,
        manifest,
        initBytes,
        options.audioContext,
      );
      try {
        await playback.ensureDecoded(0);
        return playback;
      } catch (cause) {
        playback.destroy();
        throw cause;
      }
    } finally {
      controller.abort();
    }
  }

  get paused(): boolean {
    return this._paused;
  }

  get ended(): boolean {
    return this._ended;
  }

  get currentTime(): number {
    if (this._paused || this.buffering || this.destroyed) {
      return this.positionSeconds;
    }
    const elapsed = Math.max(0, this.context.currentTime - this.anchorContextSeconds);
    return Math.min(
      this.duration,
      Math.max(0, this.anchorPositionSeconds + elapsed),
    );
  }

  set currentTime(value: number) {
    void this.seekTo(value);
  }

  notifyReady(): void {
    if (this.destroyed) return;
    this.mediaElement.dispatchEvent(new Event("loadedmetadata"));
    this.mediaElement.dispatchEvent(new Event("durationchange"));
    this.mediaElement.dispatchEvent(new Event("canplay"));
    void this.prefetchAround(0, this.operationGeneration);
  }

  syncGain(): void {
    if (this.destroyed) return;
    const value = this.mediaElement.muted ? 0 : this.mediaElement.volume;
    this.gain.gain.setValueAtTime(
      Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1,
      this.context.currentTime,
    );
  }

  async play(): Promise<void> {
    if (this.destroyed) throw new DOMException("Playback was aborted.", "AbortError");
    if (!this._paused && !this.buffering) return;
    if (this._ended || this.positionSeconds >= this.duration) {
      this.positionSeconds = 0;
      this._ended = false;
    }
    const operation = ++this.operationGeneration;
    const index = this.segmentIndexForTime(this.positionSeconds);
    // resume() is deliberately started before decode: when play() was called
    // by a user gesture this preserves Chrome's Web Audio activation even if
    // fetching/decoding the segment takes longer than that gesture task.
    const resume =
      this.context.state === "running"
        ? Promise.resolve()
        : this.context.resume();
    await Promise.all([this.ensureDecoded(index), resume]);
    if (this.destroyed || operation !== this.operationGeneration) {
      throw new DOMException("Playback was superseded.", "AbortError");
    }
    if (this.context.state !== "running") {
      throw new DOMException(
        "Spotify requires another Play click before Web Audio can start.",
        "NotAllowedError",
      );
    }
    this._paused = false;
    this.buffering = false;
    this.anchorPositionSeconds = this.positionSeconds;
    this.anchorContextSeconds = this.context.currentTime + 0.035;
    this.scheduleAvailable();
    this.startTimer();
    this.mediaElement.dispatchEvent(new Event("play"));
    this.mediaElement.dispatchEvent(new Event("playing"));
    void this.prefetchAround(index, operation);
  }

  pause(): void {
    if (this.destroyed) return;
    // Invalidate a play() that is still awaiting decode/context.resume even
    // though the externally visible state is still paused at that moment.
    this.operationGeneration += 1;
    if (this._paused && !this.buffering) return;
    this.positionSeconds = this.currentTime;
    this._paused = true;
    this.buffering = false;
    this.stopScheduled();
    this.stopTimer();
    this.mediaElement.dispatchEvent(new Event("pause"));
    this.mediaElement.dispatchEvent(new Event("timeupdate"));
  }

  async seekTo(value: number): Promise<void> {
    if (this.destroyed || !Number.isFinite(value)) return;
    const target = Math.max(0, Math.min(this.duration, value));
    const shouldResume = !this._paused;
    const operation = ++this.operationGeneration;
    this.positionSeconds = target;
    this._ended = false;
    this.buffering = false;
    this.stopScheduled();
    this.mediaElement.dispatchEvent(new Event("seeking"));
    this.mediaElement.dispatchEvent(new Event("timeupdate"));
    if (target >= this.duration) {
      this._ended = true;
      this._paused = true;
      this.stopTimer();
      this.mediaElement.dispatchEvent(new Event("seeked"));
      if (shouldResume) {
        this.mediaElement.dispatchEvent(new Event("pause"));
        this.mediaElement.dispatchEvent(new Event("ended"));
      }
      return;
    }
    this.buffering = shouldResume;
    try {
      const index = this.segmentIndexForTime(target);
      const resume =
        shouldResume && this.context.state !== "running"
          ? this.context.resume()
          : Promise.resolve();
      await Promise.all([this.ensureDecoded(index), resume]);
      if (this.destroyed || operation !== this.operationGeneration) return;
      this.mediaElement.dispatchEvent(new Event("seeked"));
      if (shouldResume && !this._ended) {
        if (this.context.state !== "running") {
          throw new DOMException(
            "Spotify requires another Play click before Web Audio can start.",
            "NotAllowedError",
          );
        }
        this.buffering = false;
        this.anchorPositionSeconds = target;
        this.anchorContextSeconds = this.context.currentTime + 0.035;
        this.scheduleAvailable();
        this.startTimer();
        void this.prefetchAround(index, operation);
      } else {
        this.buffering = false;
      }
    } catch (cause) {
      if (!isAbortError(cause)) this.reportFatal(cause);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    const wasPlaying = !this._paused;
    this.positionSeconds = this.currentTime;
    this.destroyed = true;
    this._paused = true;
    this.operationGeneration += 1;
    this.abortController.abort();
    this.stopScheduled();
    this.stopTimer();
    this.decoded.clear();
    this.decoding.clear();
    try {
      this.gain.disconnect();
    } catch {}
    if (wasPlaying) this.mediaElement.dispatchEvent(new Event("pause"));
  }

  private startTimer(): void {
    if (this.timer !== null || this.destroyed) return;
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.destroyed || this._paused || this.buffering) return;
    const position = this.currentTime;
    this.mediaElement.dispatchEvent(new Event("timeupdate"));
    if (position >= this.duration - 0.025) {
      this.finishPlayback();
      return;
    }
    const index = this.segmentIndexForTime(position);
    this.scheduleAvailable();
    void this.prefetchAround(index, this.operationGeneration);
  }

  private finishPlayback(): void {
    if (this.destroyed || this._ended) return;
    this.positionSeconds = this.duration;
    this._paused = true;
    this._ended = true;
    this.buffering = false;
    this.operationGeneration += 1;
    this.stopScheduled();
    this.stopTimer();
    this.mediaElement.dispatchEvent(new Event("timeupdate"));
    this.mediaElement.dispatchEvent(new Event("pause"));
    this.mediaElement.dispatchEvent(new Event("ended"));
  }

  private segmentIndexForTime(seconds: number): number {
    const segments = this.manifest.segments;
    let low = 0;
    let high = segments.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const segment = segments[middle];
      if (seconds < segment.start) {
        high = middle - 1;
      } else if (seconds >= segment.start + segment.duration) {
        low = middle + 1;
      } else {
        return middle;
      }
    }
    return Math.max(0, Math.min(segments.length - 1, low));
  }

  private scheduleAvailable(): void {
    if (this.destroyed || this._paused || this.buffering) return;
    const position = this.currentTime;
    const first = this.segmentIndexForTime(position);
    const generation = this.playbackGeneration;
    for (
      let index = first;
      index < this.manifest.segments.length && index < first + PREFETCH_SEGMENTS;
      index += 1
    ) {
      if (this.scheduled.has(index)) continue;
      const decoded = this.decoded.get(index);
      if (!decoded) break;
      const { when, offset } = calculateSoftwareAacSegmentSchedule(
        this.context.currentTime,
        this.anchorContextSeconds,
        this.anchorPositionSeconds,
        decoded.start,
        decoded.buffer.duration,
      );
      const playable = decoded.buffer.duration - offset;
      if (!(playable > 0.001)) continue;
      const node = this.context.createBufferSource();
      node.buffer = decoded.buffer;
      node.connect(this.gain);
      node.onended = () => {
        const active = this.scheduled.get(index);
        if (active?.node === node) this.scheduled.delete(index);
        if (
          generation === this.playbackGeneration &&
          index === this.manifest.segments.length - 1 &&
          !this._paused &&
          !this.destroyed
        ) {
          this.finishPlayback();
          return;
        }
        // A later segment may have finished decoding while this node was
        // playing but before the surrounding prefetch batch completed.
        this.scheduleAvailable();
        if (
          generation === this.playbackGeneration &&
          !this._paused &&
          !this.destroyed &&
          !this.scheduled.has(index + 1)
        ) {
          const next = this.manifest.segments[index + 1];
          if (next) this.enterBuffering(next.index);
        }
      };
      node.start(when, offset);
      this.scheduled.set(index, { generation, node });
    }
  }

  private stopScheduled(): void {
    this.playbackGeneration += 1;
    for (const { node } of this.scheduled.values()) {
      node.onended = null;
      try {
        node.stop();
      } catch {}
      try {
        node.disconnect();
      } catch {}
    }
    this.scheduled.clear();
  }

  private enterBuffering(index: number): void {
    if (this.destroyed || this._paused || this.buffering) return;
    const segment = this.manifest.segments[index];
    if (!segment) return;
    this.positionSeconds = segment.start;
    this.buffering = true;
    this.stopTimer();
    this.mediaElement.dispatchEvent(new Event("timeupdate"));
    this.mediaElement.dispatchEvent(new Event("waiting"));
    void this.prefetchAround(index, this.operationGeneration);
  }

  private resumeFromBuffering(): void {
    if (this.destroyed || this._paused || !this.buffering) return;
    const index = this.segmentIndexForTime(this.positionSeconds);
    if (!this.decoded.has(index)) return;
    this.buffering = false;
    this.anchorPositionSeconds = this.positionSeconds;
    this.anchorContextSeconds = this.context.currentTime + 0.035;
    this.scheduleAvailable();
    this.startTimer();
    this.mediaElement.dispatchEvent(new Event("playing"));
  }

  private async prefetchAround(
    index: number,
    operation: number,
  ): Promise<void> {
    const promises: Promise<DecodedSegment>[] = [];
    for (
      let next = index;
      next < this.manifest.segments.length && next < index + PREFETCH_SEGMENTS;
      next += 1
    ) {
      promises.push(
        this.ensureDecoded(next).then((decoded) => {
          if (
            !this.destroyed &&
            operation === this.operationGeneration
          ) {
            // Do not wait for the slowest item in the prefetch window before
            // scheduling an already decoded immediate successor.
            if (this.buffering) this.resumeFromBuffering();
            else this.scheduleAvailable();
          }
          return decoded;
        }),
      );
    }
    try {
      await Promise.all(promises);
      if (this.destroyed || operation !== this.operationGeneration) return;
      this.evictDecoded(this.segmentIndexForTime(this.currentTime));
      if (this.buffering) this.resumeFromBuffering();
      else this.scheduleAvailable();
    } catch (cause) {
      if (
        operation === this.operationGeneration &&
        !isAbortError(cause)
      ) {
        this.reportFatal(cause);
      }
    }
  }

  private evictDecoded(currentIndex: number): void {
    if (this.decoded.size <= MAX_DECODED_SEGMENTS) return;
    const candidates = Array.from(this.decoded.keys())
      .filter((index) => !this.scheduled.has(index))
      .sort(
        (left, right) =>
          Math.abs(right - currentIndex) - Math.abs(left - currentIndex),
      );
    while (this.decoded.size > MAX_DECODED_SEGMENTS && candidates.length) {
      const candidate = candidates.shift();
      if (candidate !== undefined) this.decoded.delete(candidate);
    }
  }

  private ensureDecoded(index: number): Promise<DecodedSegment> {
    const cached = this.decoded.get(index);
    if (cached) return Promise.resolve(cached);
    const pending = this.decoding.get(index);
    if (pending) return pending;
    const task = this.decodeSegment(index)
      .then((decoded) => {
        if (!this.destroyed) this.decoded.set(index, decoded);
        return decoded;
      })
      .finally(() => {
        if (this.decoding.get(index) === task) this.decoding.delete(index);
      });
    this.decoding.set(index, task);
    return task;
  }

  private async decodeSegment(index: number): Promise<DecodedSegment> {
    const segment = this.manifest.segments[index];
    if (!segment) throw new Error("The requested HLS segment does not exist.");
    const bytes = await fetchBoundedBytes(
      segment.url,
      MEDIA_SEGMENT_LIMIT_BYTES,
      this.abortController.signal,
    );
    if (this.destroyed) throw new DOMException("Playback was aborted.", "AbortError");

    const demuxer = WasmAudioTrackDemuxer.newWithFormat("fmp4");
    let decoder: WasmAacLcDecoder | null = null;
    const pcmFrames: Float32Array[] = [];
    let sampleRate = 0;
    let channels = 0;
    let totalInterleavedSamples = 0;

    const consume = (events: DemuxEvent[]) => {
      for (const event of events) {
        if (event.type === "config" && event.codec === "aac") {
          const codecPrivate = event.codecPrivate;
          if (!(codecPrivate instanceof Uint8Array) || codecPrivate.length === 0) {
            throw new Error("The AAC stream has no decoder configuration.");
          }
          decoder ??= decodeAacOperation(() => new WasmAacLcDecoder(codecPrivate));
          sampleRate = decoder.sampleRate;
          channels = decoder.channels;
          continue;
        }
        if (event.type !== "packet" || event.codec !== "aac") continue;
        if (!decoder) throw new Error("AAC media arrived before its configuration.");
        const rawData = event.rawData;
        if (!(rawData instanceof Uint8Array) || rawData.length === 0) {
          throw new Error("The AAC stream contains an empty media packet.");
        }
        const activeDecoder = decoder;
        const pcm = decodeAacOperation(() => activeDecoder.decodeInterleaved(rawData));
        if (pcm.length === 0) continue;
        pcmFrames.push(pcm);
        totalInterleavedSamples += pcm.length;
      }
    };

    try {
      consume(demuxer.push(this.initBytes) as DemuxEvent[]);
      consume(demuxer.push(bytes) as DemuxEvent[]);
      consume(demuxer.flush() as DemuxEvent[]);
      if (
        !decoder ||
        !(sampleRate > 0) ||
        !(channels > 0) ||
        totalInterleavedSamples < channels
      ) {
        throw new Error("The AAC segment produced no audio.");
      }
      const frameCount = Math.floor(totalInterleavedSamples / channels);
      const buffer = this.context.createBuffer(channels, frameCount, sampleRate);
      const channelData = Array.from(
        { length: channels },
        (_, channel) => buffer.getChannelData(channel),
      );
      let frameOffset = 0;
      for (const pcm of pcmFrames) {
        const packetFrames = Math.floor(pcm.length / channels);
        for (let frame = 0; frame < packetFrames; frame += 1) {
          const sourceOffset = frame * channels;
          for (let channel = 0; channel < channels; channel += 1) {
            channelData[channel][frameOffset + frame] = pcm[sourceOffset + channel];
          }
        }
        frameOffset += packetFrames;
      }
      return {
        index,
        start: segment.start,
        duration: buffer.duration,
        buffer,
      };
    } finally {
      const activeDecoder = decoder as WasmAacLcDecoder | null;
      activeDecoder?.free();
      demuxer.free();
    }
  }

  private reportFatal(cause: unknown): void {
    if (this.destroyed || this.fatalReported || isAbortError(cause)) return;
    this.fatalReported = true;
    this.error = null;
    this.onFatalError(mediaErrorMessage(cause));
  }
}

function mediaPropertyDescriptor(
  key: keyof HTMLMediaElement,
): PropertyDescriptor | undefined {
  let prototype: object | null = HTMLMediaElement.prototype;
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor) return descriptor;
    prototype = Object.getPrototypeOf(prototype);
  }
  return undefined;
}

/**
 * Keep the real HTMLAudioElement for native MP3/HLS and Linux MPRIS, while
 * exposing the software backend through the same media properties already
 * consumed by the mature WaveLink UI and transport integration.
 */
export function installSoftwareAacMediaFacade(
  mediaElement: HTMLAudioElement,
  currentPlayback: () => SoftwareAacPlayback | null,
): void {
  const nativePlay = mediaElement.play.bind(mediaElement);
  const nativePause = mediaElement.pause.bind(mediaElement);
  Object.defineProperty(mediaElement, "play", {
    configurable: true,
    value: () => currentPlayback()?.play() ?? nativePlay(),
  });
  Object.defineProperty(mediaElement, "pause", {
    configurable: true,
    value: () => {
      const playback = currentPlayback();
      if (playback) playback.pause();
      else nativePause();
    },
  });

  const bridge = <K extends keyof HTMLMediaElement>(
    key: K,
    softwareGet: (playback: SoftwareAacPlayback) => HTMLMediaElement[K],
    softwareSet?: (
      playback: SoftwareAacPlayback,
      value: HTMLMediaElement[K],
    ) => void,
  ) => {
    const native = mediaPropertyDescriptor(key);
    if (!native?.get) return;
    Object.defineProperty(mediaElement, key, {
      configurable: true,
      enumerable: native.enumerable ?? true,
      get: () => {
        const playback = currentPlayback();
        return playback ? softwareGet(playback) : native.get?.call(mediaElement);
      },
      set:
        softwareSet || native.set
          ? (value: HTMLMediaElement[K]) => {
              const playback = currentPlayback();
              if (playback && softwareSet) softwareSet(playback, value);
              else native.set?.call(mediaElement, value);
            }
          : undefined,
    });
  };

  bridge("currentTime", (playback) => playback.currentTime, (playback, value) => {
    playback.currentTime = Number(value);
  });
  bridge("duration", (playback) => playback.duration);
  bridge("paused", (playback) => playback.paused);
  bridge("ended", (playback) => playback.ended);
  bridge("readyState", (playback) => playback.readyState);
  bridge("currentSrc", (playback) => playback.sourceUrl);
  bridge("error", (playback) => playback.error);
  bridge("playbackRate", (playback) => playback.playbackRate);
}
