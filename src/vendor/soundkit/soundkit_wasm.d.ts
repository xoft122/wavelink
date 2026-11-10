/* tslint:disable */
/* eslint-disable */

export class Decoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Final EOF/drain call. The decoder should not be reused after this.
     */
    flush(): Array<any>;
    constructor();
    static newAuto(): Decoder;
    static newRawLinear16(sample_rate: number, channels: number): Decoder;
    static newRawLinear32(sample_rate: number, channels: number): Decoder;
    static newWithFormat(format: string): Decoder;
    /**
     * Push arbitrary encoded bytes and receive all PCM frames currently available.
     *
     * This method drains decoder output after each push. Use `flush()` once at EOF
     * to force final container/codec drain.
     */
    push(bytes: Uint8Array): Array<any>;
}

export class WasmAacDeboxer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Final drain call. The deboxer should not be reused after this.
     */
    flush(): Array<any>;
    constructor();
    static newAuto(): WasmAacDeboxer;
    static newWithFormat(format: string): WasmAacDeboxer;
    /**
     * Push arbitrary MP4/M4A bytes and receive AAC config/packet events.
     *
     * Packet events contain ADTS AAC frames in `data` and the original MP4
     * access unit in `rawData`.
     */
    push(bytes: Uint8Array): Array<any>;
}

export class WasmAacLcDecoder {
    free(): void;
    [Symbol.dispose](): void;
    decodeInterleaved(access_unit: Uint8Array): Float32Array;
    decodeInterleavedInto(access_unit: Uint8Array, output: Float32Array): number;
    decodePlanar(access_unit: Uint8Array): Array<any>;
    constructor(audio_specific_config: Uint8Array);
    readonly channels: number;
    readonly framesPerAccessUnit: number;
    readonly sampleRate: number;
}

/**
 * Incremental AIFF PCM writer. The final frame count makes the first
 * emitted header exact. AIFF holds integer PCM; float input is rounded to
 * the chosen width.
 */
export class WasmAiffEncoder {
    free(): void;
    [Symbol.dispose](): void;
    encodePlanarF32(planar: Float32Array, frames_per_channel: number): Uint8Array;
    encodePlanarI16(planar: Int16Array, frames_per_channel: number): Uint8Array;
    encodePlanarI24(planar: Int32Array, frames_per_channel: number): Uint8Array;
    encodePlanarI32(planar: Int32Array, frames_per_channel: number): Uint8Array;
    finish(): void;
    header(): Uint8Array;
    constructor(sample_rate: number, channels: number, sample_format: string, total_frames: number);
    readonly framesWritten: number;
    readonly totalFrames: number;
}

/**
 * Bounded ALAC access-unit decoder for seekable MP4 and CAF adapters.
 */
export class WasmAlacPacketDecoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decode exactly one container-demuxed ALAC packet.
     */
    decode(packet: Uint8Array): any;
    constructor(magic_cookie: Uint8Array);
    readonly bitDepth: number;
    readonly channels: number;
    readonly maximumPcmSamples: number;
    readonly sampleRate: number;
}

export class WasmAudioContentCipher {
    free(): void;
    [Symbol.dispose](): void;
    constructor(key: Uint8Array);
    open(expected_key_epoch: number, envelope: Uint8Array, authenticated_data: Uint8Array): Uint8Array;
    seal(key_epoch: number, nonce: Uint8Array, plaintext: Uint8Array, authenticated_data: Uint8Array): Uint8Array;
}

/**
 * Opens the endpoint-specific envelope that transports an audio content key.
 *
 * The wrapping key comes from P-256 ECDH and HKDF-SHA256. The caller supplies
 * the canonical key-exchange context as additional authenticated data.
 */
export class WasmAudioContentKeyUnwrapper {
    free(): void;
    [Symbol.dispose](): void;
    constructor(key: Uint8Array);
    open(nonce: Uint8Array, ciphertext: Uint8Array, authenticated_data: Uint8Array): Uint8Array;
    seal(nonce: Uint8Array, plaintext: Uint8Array, authenticated_data: Uint8Array): Uint8Array;
}

export class WasmAudioTrackDemuxer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Final drain call. The demuxer should not be reused after this.
     */
    flush(): Array<any>;
    constructor();
    static newAuto(): WasmAudioTrackDemuxer;
    static newWithFormat(format: string): WasmAudioTrackDemuxer;
    /**
     * Push arbitrary container bytes and receive audio-track config/packet events.
     */
    push(bytes: Uint8Array): Array<any>;
}

/**
 * Seekable, Rust-validated CAF ALAC packet index.
 */
export class WasmCafAlacIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Validate, decode, priming/remainder trim, and encode one CAF packet.
     * Only the indexed packet bytes cross the WASM boundary.
     */
    encodeAlacSample(index: number, source_bytes: Uint8Array, encoder: WasmStreamingLibraryEncoder): any;
    constructor(description: Uint8Array, magic_cookie: Uint8Array, packet_table: Uint8Array, data_payload_offset: number, data_payload_size: number);
    /**
     * Validate exactly one packet range before codec decode.
     */
    packet(index: number, source_bytes: Uint8Array): Uint8Array;
    sample(index: number): object;
    readonly bitDepth: number;
    readonly channels: number;
    readonly magicCookie: Uint8Array;
    readonly packetCount: number;
    readonly sampleRate: number;
    readonly validFrames: any;
}

/**
 * Seekable, Rust-validated CAF audio sample index.
 */
export class WasmCafAudioIndex {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    config(): any;
    static fromFile(bytes: Uint8Array): WasmCafAudioIndex;
    packet(index: number, source_bytes: Uint8Array): any;
    sample(index: number): object;
    readonly sampleCount: number;
}

/**
 * Incremental Core Audio Format linear-PCM writer. The final frame count
 * makes the first emitted header exact.
 */
export class WasmCafEncoder {
    free(): void;
    [Symbol.dispose](): void;
    encodePlanarF32(planar: Float32Array, frames_per_channel: number): Uint8Array;
    encodePlanarI16(planar: Int16Array, frames_per_channel: number): Uint8Array;
    encodePlanarI24(planar: Int32Array, frames_per_channel: number): Uint8Array;
    encodePlanarI32(planar: Int32Array, frames_per_channel: number): Uint8Array;
    finish(): void;
    header(): Uint8Array;
    constructor(sample_rate: number, channels: number, sample_format: string, total_frames: number);
    readonly framesWritten: number;
    readonly totalFrames: number;
}

/**
 * Format-detecting decode, normalization, and hashing in one bounded session.
 */
export class WasmCanonicalPcmDecoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drain decoder and normalizer tails and finalize the source identity.
     */
    finish(): any;
    constructor();
    static newAuto(): WasmCanonicalPcmDecoder;
    static newRawLinear16(sample_rate: number, channels: number): WasmCanonicalPcmDecoder;
    static newWithFormat(format: string): WasmCanonicalPcmDecoder;
    /**
     * Decode one bounded source byte range.
     */
    push(bytes: Uint8Array): any;
}

export class WasmFlacEncoder {
    free(): void;
    [Symbol.dispose](): void;
    encodePlanarF32(planar: Float32Array, frames_per_channel: number): Uint8Array;
    /**
     * Signal EOF and drain the final FLAC packet.
     * The encoder can buffer a short final block until this call.
     */
    finish(): Uint8Array;
    constructor(sample_rate: number, channels: number, bits_per_sample: number, frame_size: number, compression_level: number);
    reset(): void;
    /**
     * Return the current STREAMINFO metadata block. After finish() this
     * contains the final sample count and PCM MD5.
     */
    streamHeader(): Uint8Array;
}

/**
 * Persistent raw-FLAC packet decoder for low-latency transports.
 *
 * Each call consumes one raw FLAC frame and returns one interleaved PCM
 * block. The decoder and its PCM allocation are reused across calls.
 */
export class WasmFlacFrameDecoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decode a packet already copied into `inputPacketView`.
     */
    decodeBuffered(packet_length: number): number;
    /**
     * Decode exactly one raw FLAC frame into interleaved PCM.
     */
    decodeInterleavedI32(packet: Uint8Array): Int32Array;
    /**
     * Decode one packet and return an ephemeral zero-copy PCM view.
     *
     * The view must be consumed before another call into WebAssembly that can
     * grow memory, and its samples are overwritten by the next decode call.
     * Use `decodeInterleavedI32` when the returned PCM must be retained.
     */
    decodeInterleavedI32View(packet: Uint8Array): Int32Array;
    /**
     * Return the persistent decoded PCM output buffer.
     *
     * Its samples are overwritten by the next decode call. Reacquire the view
     * after any unrelated call that can grow WebAssembly memory.
     */
    decodedPcmView(): Int32Array;
    /**
     * Return the reusable encoded-packet input buffer.
     *
     * Copy one packet into this view, then call `decodeBuffered` with its byte
     * length. Reacquire the view after any unrelated call that can grow
     * WebAssembly memory.
     */
    inputPacketView(): Uint8Array;
    constructor(sample_rate: number, channels: number, bits_per_sample: number, frame_size: number);
    reset(): void;
    setVerifyChecksums(enabled: boolean): void;
    readonly packetCapacity: number;
    readonly sampleCount: number;
}

/**
 * Persistent raw-FLAC packet encoder for low-latency transports.
 *
 * Each call consumes exactly one configured PCM block and returns one raw
 * FLAC frame. The encoder and its packet allocation are reused across calls.
 */
export class WasmFlacFrameEncoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Encode `inputPcmView` and return an ephemeral zero-copy packet view.
     */
    encodeBufferedView(): Uint8Array;
    /**
     * Encode exactly one interleaved PCM block into one raw FLAC frame.
     */
    encodeInterleavedI32(interleaved: Int32Array): Uint8Array;
    /**
     * Encode one block and return an ephemeral zero-copy view of the packet.
     *
     * The view must be consumed before another call into WebAssembly that can
     * grow memory, and its bytes are overwritten by the next encode call. Use
     * `encodeInterleavedI32` when the returned packet must be retained.
     */
    encodeInterleavedI32View(interleaved: Int32Array): Uint8Array;
    /**
     * Return the reusable PCM input block for the buffer-reusing API.
     *
     * Fill this view, then call `encodeBufferedView`. WebAssembly memory growth
     * invalidates the view, so reacquire it after calling unrelated Wasm APIs
     * that can allocate.
     */
    inputPcmView(): Int32Array;
    constructor(sample_rate: number, channels: number, bits_per_sample: number, frame_size: number, compression_level: number);
    reset(): void;
    readonly sampleCount: number;
}

/**
 * A library import that reads its source itself.
 *
 * Every other way in makes the caller decide how a file should be read,
 * and that decision is not the caller's to make: whether a source can be
 * pushed from the front or has to be indexed first is a property of the
 * container, which is exactly what this crate knows and JavaScript does
 * not. A QuickTime file keeps its sample table at the end, so streaming it
 * never reaches the table; feeding the table early moves every offset it
 * records. Both mistakes are avoidable only from in here.
 *
 * So the caller hands over a way to read bytes and nothing else. `read` is
 * called as `read(offset, length)` and returns those bytes — in a worker,
 * an OPFS sync access handle answers that directly. Rust detects the
 * container, seeks where it must, and drives the samples.
 */
export class WasmLibraryImport {
    free(): void;
    [Symbol.dispose](): void;
    constructor(read: Function, size: number, preserve_lossless: boolean);
    /**
     * Pumps one bounded unit and returns the same batch `push` returns.
     */
    process(maximum_bytes: number): any;
    /**
     * True once every byte the programme needs has been read.
     */
    readonly drained: boolean;
    /**
     * How far through the source this is, from zero to one.
     *
     * The encoder only knows a frame count once it has decoded far enough
     * to have one, and an indexed source knows its position from the
     * start — so the honest number comes from here rather than from the
     * caller guessing at bytes it did not choose to read.
     */
    readonly progress: number;
    /**
     * What the source turned out to be: `sequential` or `mp4`.
     */
    readonly shape: string;
    /**
     * Whether the supplied audio codec is lossless, independently of the
     * FLAC preservation copy requested by the caller.
     */
    readonly sourceLossless: boolean;
}

/**
 * Streaming Rust fragmented-MP4/CMAF audio-and-video demuxer.
 */
export class WasmMp4MediaDemuxer {
    free(): void;
    [Symbol.dispose](): void;
    flush(): Array<any>;
    constructor();
    pcmTrim(track_id: number, presentation_time: number, packet_duration: number, decoded_frames: number): any;
    push(bytes: Uint8Array): Array<any>;
}

/**
 * Seekable, Rust-validated MOV/MP4 audio-and-video sample index.
 */
export class WasmMp4MediaIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Validate, decode, edit-list trim, and encode one indexed AAC-LC sample.
     */
    encodeAacLcSample(index: number, source_bytes: Uint8Array, encoder: WasmStreamingLibraryEncoder): any;
    /**
     * Validate, decode, edit-list trim, and encode one indexed ALAC sample.
     * JavaScript transports only the requested container byte range; PCM
     * remains within Rust throughout the operation.
     */
    encodeAlacSample(index: number, source_bytes: Uint8Array, encoder: WasmStreamingLibraryEncoder): any;
    /**
     * Conformance helper for small complete files. Large browser imports
     * should locate and read only `moov`, then call the constructor.
     */
    static fromFile(bytes: Uint8Array): WasmMp4MediaIndex;
    /**
     * Construct from the payload bytes inside a `moov` box. This is the
     * production path for seekable browser files and native file handles.
     */
    constructor(moov_payload: Uint8Array);
    /**
     * Validate and normalize exactly one indexed source range.
     */
    packet(index: number, source_bytes: Uint8Array): object;
    /**
     * Return the Rust-owned slice of decoded PCM that belongs to the edited
     * programme. `null` means the whole packet is codec preroll or padding.
     */
    pcmTrim(index: number, decoded_frames: number): any;
    sample(index: number): object;
    tracks(): Array<any>;
    readonly sampleCount: number;
}

/**
 * Streaming Rust MXF KLV demuxer that emits both picture and sound essence.
 */
export class WasmMxfMediaDemuxer {
    free(): void;
    [Symbol.dispose](): void;
    flush(): Array<any>;
    constructor();
    push(bytes: Uint8Array): Array<any>;
}

export class WasmOpusDeboxer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Final drain call. The deboxer should not be reused after this.
     */
    flush(): Array<any>;
    constructor();
    static newAuto(): WasmOpusDeboxer;
    static newWithFormat(format: string): WasmOpusDeboxer;
    /**
     * Push arbitrary container bytes and receive Opus config/packet events.
     *
     * Packet events contain encoded Opus packet bytes suitable for a JS Opus
     * decoder. Config events carry channel/sample-rate/pre-skip metadata.
     */
    push(bytes: Uint8Array): Array<any>;
}

export class WasmOpusDecodeResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly decodedSize: number;
    readonly output: Int16Array;
}

export class WasmOpusDecoder {
    free(): void;
    [Symbol.dispose](): void;
    dec_frame(packet: Uint8Array): WasmOpusDecodeResult;
    dec_frame_reuse(packet: Uint8Array): number;
    destroy(): void;
    /**
     * Uses the allocation-light CELT decoder for SoundKit-owned cache
     * streams. It rejects SILK or hybrid packets.
     */
    static forSoundKitStream(channels: number, sample_rate: number, frame_size: number): WasmOpusDecoder;
    constructor(channels: number, sample_rate: number, frame_size: number);
    readonly decodedSize: number;
    readonly outputLen: number;
    readonly outputPtr: number;
}

export class WasmOpusEncoder {
    free(): void;
    [Symbol.dispose](): void;
    encodeInterleavedI16(interleaved: Int16Array): Uint8Array;
    constructor(sample_rate: number, channels: number, bitrate: number, frame_size: number);
    reset(): void;
}

/**
 * One-pass encoder for the library import fast path.
 *
 * A 48 kHz stereo PCM16 WAV is already in the geometry used by the library's
 * Opus cache. Keeping the WAV parser and both encoders together means each
 * bounded input chunk is parsed once and immediately fans out to Opus and,
 * for lossless imports, FLAC. No decoded PCM crosses into JavaScript and no
 * seekable Float32 working copy has to be completed before encoding starts.
 */
export class WasmPcm16WaveLibraryEncoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drain the last partial Opus/FLAC blocks. No complete PCM is retained.
     */
    finish(): any;
    constructor(preserve_lossless: boolean);
    /**
     * Parse and encode one bounded WAV byte range.
     */
    push(bytes: Uint8Array): any;
}

/**
 * Bounded incremental SHA-256 for browser streams that are not otherwise
 * passing through a SoundKit import encoder.
 */
export class WasmSha256 {
    free(): void;
    [Symbol.dispose](): void;
    finish(): string;
    constructor();
    update(bytes: Uint8Array): void;
}

export class WasmSoundKitFrameDecoder {
    free(): void;
    [Symbol.dispose](): void;
    bufferedBytes(): number;
    clearKey(): void;
    finish(): void;
    constructor();
    static newUnencrypted(): WasmSoundKitFrameDecoder;
    static newWithDecimalKey(key: string): WasmSoundKitFrameDecoder;
    static newWithKeyBytes(key: Uint8Array): WasmSoundKitFrameDecoder;
    push(bytes: Uint8Array): Array<any>;
    reset(): void;
    setDecimalKey(key: string): void;
    setKeyBytes(key: Uint8Array): void;
}

/**
 * A stored SoundKit v2 stream, decoded back to interleaved 16-bit PCM.
 *
 * The browser could already write one of these — the library encoder puts
 * a track down as framed Opus, and a lossless import as framed FLAC beside
 * it — but nothing could read one back, so a page that wanted a waveform
 * or a transport had to deframe and then decode packet by packet, and
 * arrive at its own answer for how a 24-bit frame becomes 16.
 *
 * `SoundKitV2Decoder` already answers all of that in one place, including
 * the width reduction. This is that decoder, reachable.
 */
export class WasmSoundKitV2Decoder {
    free(): void;
    [Symbol.dispose](): void;
    bufferedBytes(): number;
    finish(): void;
    constructor();
    /**
     * Feeds the next slice of the stream and takes whatever it completes.
     *
     * The stream may be cut anywhere; a frame split across two calls is
     * held until the rest of it arrives. Returns interleaved samples,
     * empty when the slice completed no frame.
     */
    push(bytes: Uint8Array): Int16Array;
    /**
     * Decode interleaved float32 PCM without an intermediate PCM16 conversion.
     */
    pushFloat(bytes: Uint8Array): Float32Array;
    reset(): void;
    readonly channels: number;
    /**
     * The rate and channel count the last frame declared.
     */
    readonly sampleRate: number;
}

/**
 * Bounded, format-detecting library import pipeline.
 *
 * Encoded source bytes enter Rust once. SoundKit decodes them incrementally,
 * normalizes each PCM block to the library's 48 kHz stereo geometry, and
 * immediately emits indexed SoundKit-v2 Opus and optional FLAC packets. PCM
 * never crosses the WASM boundary and no complete decoded source is retained.
 */
export class WasmStreamingLibraryEncoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drain decoder, resampler, and codec tails without retaining complete
     * PCM in either Rust or JavaScript.
     */
    finish(): any;
    constructor(preserve_lossless: boolean);
    /**
     * Open the bounded output pipeline for seekable AAC-LC container samples.
     */
    static newAacLc(audio_specific_config: Uint8Array, preserve_lossless: boolean): WasmStreamingLibraryEncoder;
    /**
     * Open the same bounded output pipeline for a seekable ALAC container.
     * The adapter supplies Rust-validated packet ranges; decoded PCM remains
     * inside this object and feeds the shared Opus/FLAC encoders directly.
     */
    static newAlac(magic_cookie: Uint8Array, preserve_lossless: boolean): WasmStreamingLibraryEncoder;
    /**
     * Decode and encode one bounded source byte range.
     */
    push(bytes: Uint8Array): any;
    /**
     * Decode one indexed AAC-LC access unit and encode its selected frames.
     */
    pushAacLcPacket(packet: Uint8Array, source_frame_start: number, frame_count: number): any;
    /**
     * Decode one indexed ALAC access unit and encode only its Rust-selected
     * presentation-frame slice.
     */
    pushAlacPacket(packet: Uint8Array, source_frame_start: number, frame_count: number): any;
    /**
     * Hash a bounded source range without decoding it. Seekable container
     * adapters use this while scanning metadata and packet ranges once.
     */
    updateSourceBytes(bytes: Uint8Array): void;
}

/**
 * Pure-Rust video access-unit decoder shared by browser and native imports.
 */
export class WasmVideoDecoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decode one complete codec access unit. Non-finite timestamps mean
     * unknown and avoid JavaScript BigInt conversion at this boundary.
     */
    decode(access_unit: Uint8Array, pts: number, duration: number): Array<any>;
    /**
     * Decode a complete Annex-B elementary stream. This is intended for
     * import validation; normal playback should use access-unit decoding.
     */
    decodeStream(stream: Uint8Array): Array<any>;
    flush(): Array<any>;
    constructor(codec: string);
}

/**
 * Incremental RIFF/RF64 PCM writer. The final frame count makes the first
 * emitted header exact, so browser streams never need a complete WAV buffer.
 */
export class WasmWavEncoder {
    free(): void;
    [Symbol.dispose](): void;
    encodePlanarF32(planar: Float32Array, frames_per_channel: number): Uint8Array;
    encodePlanarI16(planar: Int16Array, frames_per_channel: number): Uint8Array;
    encodePlanarI32(planar: Int32Array, frames_per_channel: number): Uint8Array;
    finish(): void;
    header(): Uint8Array;
    constructor(sample_rate: number, channels: number, sample_format: string, total_frames: number);
    readonly framesWritten: number;
    readonly isRf64: boolean;
    readonly totalFrames: number;
}

/**
 * Streaming Rust WebM demuxer that emits both video and audio tracks.
 */
export class WasmWebmMediaDemuxer {
    free(): void;
    [Symbol.dispose](): void;
    flush(): Array<any>;
    constructor();
    push(bytes: Uint8Array): Array<any>;
}

export function buildAudioGroupAssociatedData(session_context: string, transport_session_id: string, config_generation: number, epoch_id: string, pts_samples: string, sample_rate: number, frame_count: number, group_count: number, group_id: number, group_index: number, channel_start: number, channel_count: number, payload_kind: number, sample_format: number, flags: number): Uint8Array;

export function buildSoundKitFrameHeaderV2(encoding: number, payload_size: number, sample_size: number, sample_rate: number, channels: number, bits_per_sample: number, pts: number): Uint8Array;

export function buildSoundKitFrameV2(encoding: number, payload: Uint8Array, sample_size: number, sample_rate: number, channels: number, bits_per_sample: number, pts: number): Uint8Array;

/**
 * Inspect one CAF chunk header without reading its payload.
 */
export function inspectCafChunk(header: Uint8Array, absolute_offset: number, file_size: number): object;

/**
 * Inspect one top-level MOV/MP4 box without reading its payload.
 *
 * JavaScript owns only range I/O. Rust owns box sizes, extended sizes, EOF
 * bounds, and the resulting source offsets.
 */
export function inspectMp4TopLevelBox(header: Uint8Array, absolute_offset: number, file_size: number): object;

/**
 * Validate a CAF file header without reading the source payload.
 */
export function validateCafFileHeader(header: Uint8Array, file_size: number): void;

/**
 * Return the current WebAssembly linear-memory size in bytes.
 */
export function wasmMemoryBytes(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_decoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmaacdeboxer_free: (a: number, b: number) => void;
    readonly __wbg_wasmaaclcdecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmaiffencoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmalacpacketdecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmaudiocontentcipher_free: (a: number, b: number) => void;
    readonly __wbg_wasmaudiocontentkeyunwrapper_free: (a: number, b: number) => void;
    readonly __wbg_wasmaudiotrackdemuxer_free: (a: number, b: number) => void;
    readonly __wbg_wasmcafalacindex_free: (a: number, b: number) => void;
    readonly __wbg_wasmcafaudioindex_free: (a: number, b: number) => void;
    readonly __wbg_wasmcanonicalpcmdecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmflacencoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmflacframedecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmflacframeencoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmlibraryimport_free: (a: number, b: number) => void;
    readonly __wbg_wasmmp4mediademuxer_free: (a: number, b: number) => void;
    readonly __wbg_wasmmp4mediaindex_free: (a: number, b: number) => void;
    readonly __wbg_wasmmxfmediademuxer_free: (a: number, b: number) => void;
    readonly __wbg_wasmopusdeboxer_free: (a: number, b: number) => void;
    readonly __wbg_wasmopusdecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmopusdecoderesult_free: (a: number, b: number) => void;
    readonly __wbg_wasmopusencoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmpcm16wavelibraryencoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmsha256_free: (a: number, b: number) => void;
    readonly __wbg_wasmsoundkitframedecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmsoundkitv2decoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmstreaminglibraryencoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmvideodecoder_free: (a: number, b: number) => void;
    readonly __wbg_wasmwebmmediademuxer_free: (a: number, b: number) => void;
    readonly buildAudioGroupAssociatedData: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number) => [number, number, number];
    readonly buildSoundKitFrameHeaderV2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly buildSoundKitFrameV2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly decoder_flush: (a: number) => [number, number, number];
    readonly decoder_new: () => number;
    readonly decoder_newRawLinear16: (a: number, b: number) => [number, number, number];
    readonly decoder_newRawLinear32: (a: number, b: number) => [number, number, number];
    readonly decoder_newWithFormat: (a: number, b: number) => [number, number, number];
    readonly decoder_push: (a: number, b: number, c: number) => [number, number, number];
    readonly inspectCafChunk: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly inspectMp4TopLevelBox: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly validateCafFileHeader: (a: number, b: number, c: number) => [number, number];
    readonly wasmMemoryBytes: () => number;
    readonly wasmaacdeboxer_flush: (a: number) => [number, number, number];
    readonly wasmaacdeboxer_new: () => number;
    readonly wasmaacdeboxer_newWithFormat: (a: number, b: number) => [number, number, number];
    readonly wasmaacdeboxer_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmaaclcdecoder_channels: (a: number) => number;
    readonly wasmaaclcdecoder_decodeInterleaved: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmaaclcdecoder_decodeInterleavedInto: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly wasmaaclcdecoder_decodePlanar: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmaaclcdecoder_framesPerAccessUnit: (a: number) => number;
    readonly wasmaaclcdecoder_new: (a: number, b: number) => [number, number, number];
    readonly wasmaaclcdecoder_sampleRate: (a: number) => number;
    readonly wasmaiffencoder_encodePlanarF32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmaiffencoder_encodePlanarI16: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmaiffencoder_encodePlanarI24: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmaiffencoder_encodePlanarI32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmaiffencoder_finish: (a: number) => [number, number];
    readonly wasmaiffencoder_framesWritten: (a: number) => number;
    readonly wasmaiffencoder_header: (a: number) => any;
    readonly wasmaiffencoder_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmaiffencoder_totalFrames: (a: number) => number;
    readonly wasmalacpacketdecoder_bitDepth: (a: number) => number;
    readonly wasmalacpacketdecoder_channels: (a: number) => number;
    readonly wasmalacpacketdecoder_decode: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmalacpacketdecoder_maximumPcmSamples: (a: number) => number;
    readonly wasmalacpacketdecoder_new: (a: number, b: number) => [number, number, number];
    readonly wasmalacpacketdecoder_sampleRate: (a: number) => number;
    readonly wasmaudiocontentcipher_new: (a: number, b: number) => [number, number, number];
    readonly wasmaudiocontentcipher_open: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly wasmaudiocontentcipher_seal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly wasmaudiocontentkeyunwrapper_new: (a: number, b: number) => [number, number, number];
    readonly wasmaudiocontentkeyunwrapper_open: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly wasmaudiocontentkeyunwrapper_seal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly wasmaudiotrackdemuxer_flush: (a: number) => [number, number, number];
    readonly wasmaudiotrackdemuxer_new: () => number;
    readonly wasmaudiotrackdemuxer_newWithFormat: (a: number, b: number) => [number, number, number];
    readonly wasmaudiotrackdemuxer_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmcafalacindex_bitDepth: (a: number) => number;
    readonly wasmcafalacindex_channels: (a: number) => number;
    readonly wasmcafalacindex_encodeAlacSample: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmcafalacindex_magicCookie: (a: number) => any;
    readonly wasmcafalacindex_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly wasmcafalacindex_packet: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmcafalacindex_packetCount: (a: number) => number;
    readonly wasmcafalacindex_sample: (a: number, b: number) => [number, number, number];
    readonly wasmcafalacindex_sampleRate: (a: number) => number;
    readonly wasmcafalacindex_validFrames: (a: number) => [number, number, number];
    readonly wasmcafaudioindex_config: (a: number) => [number, number, number];
    readonly wasmcafaudioindex_fromFile: (a: number, b: number) => [number, number, number];
    readonly wasmcafaudioindex_packet: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmcafaudioindex_sample: (a: number, b: number) => [number, number, number];
    readonly wasmcafaudioindex_sampleCount: (a: number) => number;
    readonly wasmcafencoder_encodePlanarF32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmcafencoder_encodePlanarI16: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmcafencoder_encodePlanarI24: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmcafencoder_encodePlanarI32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmcafencoder_finish: (a: number) => [number, number];
    readonly wasmcafencoder_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmcanonicalpcmdecoder_finish: (a: number) => [number, number, number];
    readonly wasmcanonicalpcmdecoder_new: () => number;
    readonly wasmcanonicalpcmdecoder_newRawLinear16: (a: number, b: number) => [number, number, number];
    readonly wasmcanonicalpcmdecoder_newWithFormat: (a: number, b: number) => [number, number, number];
    readonly wasmcanonicalpcmdecoder_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmflacencoder_encodePlanarF32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmflacencoder_finish: (a: number) => [number, number, number];
    readonly wasmflacencoder_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmflacencoder_reset: (a: number) => [number, number];
    readonly wasmflacencoder_streamHeader: (a: number) => any;
    readonly wasmflacframedecoder_decodeBuffered: (a: number, b: number) => [number, number, number];
    readonly wasmflacframedecoder_decodeInterleavedI32: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmflacframedecoder_decodeInterleavedI32View: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmflacframedecoder_decodedPcmView: (a: number) => any;
    readonly wasmflacframedecoder_inputPacketView: (a: number) => any;
    readonly wasmflacframedecoder_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmflacframedecoder_packetCapacity: (a: number) => number;
    readonly wasmflacframedecoder_reset: (a: number) => [number, number];
    readonly wasmflacframedecoder_sampleCount: (a: number) => number;
    readonly wasmflacframedecoder_setVerifyChecksums: (a: number, b: number) => void;
    readonly wasmflacframeencoder_encodeBufferedView: (a: number) => [number, number, number];
    readonly wasmflacframeencoder_encodeInterleavedI32: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmflacframeencoder_encodeInterleavedI32View: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmflacframeencoder_inputPcmView: (a: number) => any;
    readonly wasmflacframeencoder_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmflacframeencoder_reset: (a: number) => void;
    readonly wasmflacframeencoder_sampleCount: (a: number) => number;
    readonly wasmlibraryimport_drained: (a: number) => number;
    readonly wasmlibraryimport_new: (a: any, b: number, c: number) => [number, number, number];
    readonly wasmlibraryimport_process: (a: number, b: number) => [number, number, number];
    readonly wasmlibraryimport_progress: (a: number) => number;
    readonly wasmlibraryimport_shape: (a: number) => [number, number];
    readonly wasmlibraryimport_sourceLossless: (a: number) => number;
    readonly wasmmp4mediademuxer_flush: (a: number) => [number, number, number];
    readonly wasmmp4mediademuxer_new: () => number;
    readonly wasmmp4mediademuxer_pcmTrim: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmmp4mediademuxer_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmmp4mediaindex_encodeAacLcSample: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmmp4mediaindex_encodeAlacSample: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmmp4mediaindex_fromFile: (a: number, b: number) => [number, number, number];
    readonly wasmmp4mediaindex_new: (a: number, b: number) => [number, number, number];
    readonly wasmmp4mediaindex_packet: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmmp4mediaindex_pcmTrim: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmmp4mediaindex_sample: (a: number, b: number) => [number, number, number];
    readonly wasmmp4mediaindex_sampleCount: (a: number) => number;
    readonly wasmmp4mediaindex_tracks: (a: number) => [number, number, number];
    readonly wasmmxfmediademuxer_flush: (a: number) => [number, number, number];
    readonly wasmmxfmediademuxer_new: () => number;
    readonly wasmmxfmediademuxer_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusdeboxer_flush: (a: number) => [number, number, number];
    readonly wasmopusdeboxer_new: () => number;
    readonly wasmopusdeboxer_newWithFormat: (a: number, b: number) => [number, number, number];
    readonly wasmopusdeboxer_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusdecoder_dec_frame: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusdecoder_dec_frame_reuse: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusdecoder_decodedSize: (a: number) => number;
    readonly wasmopusdecoder_destroy: (a: number) => void;
    readonly wasmopusdecoder_forSoundKitStream: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusdecoder_new: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusdecoder_outputLen: (a: number) => number;
    readonly wasmopusdecoder_outputPtr: (a: number) => number;
    readonly wasmopusdecoderesult_decodedSize: (a: number) => number;
    readonly wasmopusdecoderesult_output: (a: number) => [number, number];
    readonly wasmopusencoder_encodeInterleavedI16: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmopusencoder_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmopusencoder_reset: (a: number) => [number, number];
    readonly wasmpcm16wavelibraryencoder_finish: (a: number) => [number, number, number];
    readonly wasmpcm16wavelibraryencoder_new: (a: number) => number;
    readonly wasmpcm16wavelibraryencoder_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmsha256_finish: (a: number) => [number, number, number, number];
    readonly wasmsha256_new: () => number;
    readonly wasmsha256_update: (a: number, b: number, c: number) => [number, number];
    readonly wasmsoundkitframedecoder_bufferedBytes: (a: number) => number;
    readonly wasmsoundkitframedecoder_clearKey: (a: number) => void;
    readonly wasmsoundkitframedecoder_finish: (a: number) => [number, number];
    readonly wasmsoundkitframedecoder_new: () => number;
    readonly wasmsoundkitframedecoder_newWithDecimalKey: (a: number, b: number) => [number, number, number];
    readonly wasmsoundkitframedecoder_newWithKeyBytes: (a: number, b: number) => [number, number, number];
    readonly wasmsoundkitframedecoder_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmsoundkitframedecoder_reset: (a: number) => void;
    readonly wasmsoundkitframedecoder_setDecimalKey: (a: number, b: number, c: number) => [number, number];
    readonly wasmsoundkitframedecoder_setKeyBytes: (a: number, b: number, c: number) => [number, number];
    readonly wasmsoundkitv2decoder_bufferedBytes: (a: number) => number;
    readonly wasmsoundkitv2decoder_channels: (a: number) => number;
    readonly wasmsoundkitv2decoder_finish: (a: number) => [number, number];
    readonly wasmsoundkitv2decoder_new: () => number;
    readonly wasmsoundkitv2decoder_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmsoundkitv2decoder_pushFloat: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmsoundkitv2decoder_reset: (a: number) => void;
    readonly wasmsoundkitv2decoder_sampleRate: (a: number) => number;
    readonly wasmstreaminglibraryencoder_finish: (a: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_new: (a: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_newAacLc: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_newAlac: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_pushAacLcPacket: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_pushAlacPacket: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmstreaminglibraryencoder_updateSourceBytes: (a: number, b: number, c: number) => [number, number];
    readonly wasmvideodecoder_decode: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmvideodecoder_decodeStream: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmvideodecoder_flush: (a: number) => [number, number, number];
    readonly wasmvideodecoder_new: (a: number, b: number) => [number, number, number];
    readonly wasmwavencoder_encodePlanarF32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmwavencoder_encodePlanarI16: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmwavencoder_encodePlanarI32: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmwavencoder_finish: (a: number) => [number, number];
    readonly wasmwavencoder_isRf64: (a: number) => number;
    readonly wasmwavencoder_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmwebmmediademuxer_flush: (a: number) => [number, number, number];
    readonly wasmwebmmediademuxer_new: () => number;
    readonly wasmwebmmediademuxer_push: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmaacdeboxer_newAuto: () => number;
    readonly wasmaudiotrackdemuxer_newAuto: () => number;
    readonly wasmopusdeboxer_newAuto: () => number;
    readonly wasmcafencoder_framesWritten: (a: number) => number;
    readonly wasmcafencoder_totalFrames: (a: number) => number;
    readonly wasmwavencoder_framesWritten: (a: number) => number;
    readonly wasmwavencoder_totalFrames: (a: number) => number;
    readonly decoder_newAuto: () => number;
    readonly wasmsoundkitframedecoder_newUnencrypted: () => number;
    readonly wasmcanonicalpcmdecoder_newAuto: () => number;
    readonly wasmcafencoder_header: (a: number) => any;
    readonly __wbg_wasmcafencoder_free: (a: number, b: number) => void;
    readonly wasmwavencoder_header: (a: number) => any;
    readonly __wbg_wasmwavencoder_free: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
