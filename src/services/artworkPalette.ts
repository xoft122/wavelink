export interface ArtworkPalette {
  readonly raw: string;
  readonly dark: string;
  readonly light: string;
}

export const FALLBACK_ARTWORK_PALETTE: ArtworkPalette = Object.freeze({
  raw: "#535353",
  dark: "#2A2A2A",
  light: "#B3B3B3",
});

const ANALYSIS_SIZE = 128;
const DEFAULT_MAX_BLOB_BYTES = 12 * 1024 * 1024;
const DEFAULT_CACHE_ENTRIES = 128;
const DEFAULT_FAILURE_TTL_MS = 60_000;
const LOAD_FAILED = Symbol("wavelinkArtworkPaletteLoadFailed");

type InternalArtworkPalette = ArtworkPalette & {
  readonly [LOAD_FAILED]?: true;
};

interface LabColor {
  L: number;
  a: number;
  b: number;
}

interface ScoredCluster extends LabColor {
  C: number;
  h: number;
  population: number;
  relativePopulation: number;
  centerPresence: number;
  separation: number;
  penalty: number;
  spotifyScore: number;
  dominantScore: number;
}

export interface DecodedArtworkImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

export interface ArtworkPaletteLoadOptions {
  fetchImpl?: typeof fetch;
  decodeImage?: (blob: Blob) => Promise<DecodedArtworkImage>;
  canvasFactory?: () => HTMLCanvasElement;
  signal?: AbortSignal;
  maxBlobBytes?: number;
}

export interface ArtworkPaletteCacheOptions {
  maxEntries?: number;
  failureTtlMs?: number;
  now?: () => number;
}

interface ArtworkPaletteCacheEntry {
  palette: ArtworkPalette;
  failed: boolean;
  expiresAt: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function freezePalette(
  raw: string,
  dark: string,
  light: string,
): ArtworkPalette {
  return Object.freeze({ raw, dark, light });
}

function failedFallback(): InternalArtworkPalette {
  const fallback: Record<PropertyKey, unknown> = {
    ...FALLBACK_ARTWORK_PALETTE,
  };
  Object.defineProperty(fallback, LOAD_FAILED, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(fallback) as unknown as InternalArtworkPalette;
}

function loadFailed(palette: ArtworkPalette): boolean {
  return (palette as InternalArtworkPalette)[LOAD_FAILED] === true;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function srgbToOklab(red: number, green: number, blue: number): LabColor {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    L:
      0.2104542553 * lRoot +
      0.793617785 * mRoot -
      0.0040720468 * sRoot,
    a:
      1.9779984951 * lRoot -
      2.428592205 * mRoot +
      0.4505937099 * sRoot,
    b:
      0.0259040371 * lRoot +
      0.7827717662 * mRoot -
      0.808675766 * sRoot,
  };
}

function oklabToLinearSrgb(color: LabColor): [number, number, number] {
  const lRoot =
    color.L + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const mRoot =
    color.L - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const sRoot =
    color.L - 0.0894841775 * color.a - 1.291485548 * color.b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function byteHex(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function oklabToHex(color: LabColor): string {
  const [linearRed, linearGreen, linearBlue] = oklabToLinearSrgb(color);
  return `#${byteHex(linearToSrgb(linearRed))}${byteHex(
    linearToSrgb(linearGreen),
  )}${byteHex(linearToSrgb(linearBlue))}`;
}

function labDistanceSquared(left: LabColor, right: LabColor): number {
  const deltaL = left.L - right.L;
  const deltaA = left.a - right.a;
  const deltaB = left.b - right.b;
  return deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function gaussian(value: number, target: number, sigma: number): number {
  const z = (value - target) / sigma;
  return Math.exp(-0.5 * z * z);
}

function lchToLab(L: number, C: number, h: number): LabColor {
  return {
    L,
    a: C * Math.cos(h),
    b: C * Math.sin(h),
  };
}

function inSrgbGamut(color: LabColor): boolean {
  const channels = oklabToLinearSrgb(color);
  return channels.every(
    (channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1,
  );
}

function gamutMappedHex(L: number, targetChroma: number, h: number): string {
  let low = 0;
  let high = Math.max(0, targetChroma);
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const testChroma = (low + high) / 2;
    if (inSrgbGamut(lchToLab(L, testChroma, h))) {
      low = testChroma;
    } else {
      high = testChroma;
    }
  }
  return oklabToHex(lchToLab(L, low, h));
}

/**
 * Extract the Spotify-like palette from already-decoded RGBA pixels.
 * Browser callers should normally use `loadArtworkPalette`, which performs
 * the specified central crop and 128x128 downscale before calling this helper.
 */
export function extractArtworkPalette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ArtworkPalette {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length < width * height * 4
  ) {
    return FALLBACK_ARTWORK_PALETTE;
  }

  const maximumPixels = width * height;
  const lightness = new Float64Array(maximumPixels);
  const axisA = new Float64Array(maximumPixels);
  const axisB = new Float64Array(maximumPixels);
  const weights = new Float64Array(maximumPixels);
  const centralities = new Float64Array(maximumPixels);
  const coarseColors = new Set<number>();
  let pixelCount = 0;
  let totalWeight = 0;
  let globalL = 0;
  let globalA = 0;
  let globalB = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = rgba[offset + 3] / 255;
      if (alpha < 0.55) continue;

      const redByte = rgba[offset];
      const greenByte = rgba[offset + 1];
      const blueByte = rgba[offset + 2];
      const nx = (x + 0.5) / width;
      const ny = (y + 0.5) / height;
      const distanceFromCenter = Math.min(
        1,
        Math.hypot(nx - 0.5, ny - 0.5) / 0.7071,
      );
      const centerWeight = 1.08 - 0.16 * distanceFromCenter;
      const edge = Math.min(nx, ny, 1 - nx, 1 - ny);
      const edgeWeight = edge < 0.035 ? 0.86 : 1;
      const pixelWeight = alpha * centerWeight * edgeWeight;
      const lab = srgbToOklab(
        redByte / 255,
        greenByte / 255,
        blueByte / 255,
      );

      lightness[pixelCount] = lab.L;
      axisA[pixelCount] = lab.a;
      axisB[pixelCount] = lab.b;
      weights[pixelCount] = pixelWeight;
      centralities[pixelCount] = Math.max(0, 1 - distanceFromCenter);
      coarseColors.add(
        ((redByte >> 4) << 8) |
          ((greenByte >> 4) << 4) |
          (blueByte >> 4),
      );
      totalWeight += pixelWeight;
      globalL += lab.L * pixelWeight;
      globalA += lab.a * pixelWeight;
      globalB += lab.b * pixelWeight;
      pixelCount += 1;
    }
  }

  if (pixelCount === 0 || !(totalWeight > 0)) {
    return FALLBACK_ARTWORK_PALETTE;
  }

  const globalAverage: LabColor = {
    L: globalL / totalWeight,
    a: globalA / totalWeight,
    b: globalB / totalWeight,
  };
  const targetClusterCount = Math.min(
    12,
    Math.max(3, coarseColors.size),
  );
  const centers: LabColor[] = [];
  let firstCenterIndex = 0;
  let firstCenterScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pixelCount; index += 1) {
    const chroma = Math.hypot(axisA[index], axisB[index]);
    const score =
      weights[index] * (0.75 + 0.25 * Math.min(chroma / 0.18, 1));
    if (score > firstCenterScore) {
      firstCenterScore = score;
      firstCenterIndex = index;
    }
  }
  centers.push({
    L: lightness[firstCenterIndex],
    a: axisA[firstCenterIndex],
    b: axisB[firstCenterIndex],
  });

  while (centers.length < targetClusterCount) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const pixel = {
        L: lightness[index],
        a: axisA[index],
        b: axisB[index],
      };
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const center of centers) {
        nearestDistance = Math.min(
          nearestDistance,
          labDistanceSquared(pixel, center),
        );
      }
      const score = nearestDistance * weights[index];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    // Uniform and low-diversity images can request at least three clusters,
    // but duplicate centers only create empty clusters and eventual NaNs.
    if (bestIndex < 0 || bestScore <= Number.EPSILON) break;
    centers.push({
      L: lightness[bestIndex],
      a: axisA[bestIndex],
      b: axisB[bestIndex],
    });
  }

  const assignments = new Int16Array(pixelCount);
  assignments.fill(-1);
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const sumWeight = new Float64Array(centers.length);
    const sumL = new Float64Array(centers.length);
    const sumA = new Float64Array(centers.length);
    const sumB = new Float64Array(centers.length);
    let changed = false;

    for (let index = 0; index < pixelCount; index += 1) {
      const pixel = {
        L: lightness[index],
        a: axisA[index],
        b: axisB[index],
      };
      let nearestIndex = 0;
      let nearestDistance = labDistanceSquared(pixel, centers[0]);
      for (
        let centerIndex = 1;
        centerIndex < centers.length;
        centerIndex += 1
      ) {
        const distance = labDistanceSquared(pixel, centers[centerIndex]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = centerIndex;
        }
      }
      if (assignments[index] !== nearestIndex) {
        assignments[index] = nearestIndex;
        changed = true;
      }
      const weight = weights[index];
      sumWeight[nearestIndex] += weight;
      sumL[nearestIndex] += lightness[index] * weight;
      sumA[nearestIndex] += axisA[index] * weight;
      sumB[nearestIndex] += axisB[index] * weight;
    }

    for (let index = 0; index < centers.length; index += 1) {
      if (!(sumWeight[index] > 0)) continue;
      centers[index] = {
        L: sumL[index] / sumWeight[index],
        a: sumA[index] / sumWeight[index],
        b: sumB[index] / sumWeight[index],
      };
    }
    if (iteration >= 2 && !changed) break;
  }

  // Reassign once against the final centers so all reported cluster metrics
  // correspond to the same final partition.
  const clusterWeights = new Float64Array(centers.length);
  const clusterL = new Float64Array(centers.length);
  const clusterA = new Float64Array(centers.length);
  const clusterB = new Float64Array(centers.length);
  const clusterCentrality = new Float64Array(centers.length);
  for (let index = 0; index < pixelCount; index += 1) {
    const pixel = {
      L: lightness[index],
      a: axisA[index],
      b: axisB[index],
    };
    let nearestIndex = 0;
    let nearestDistance = labDistanceSquared(pixel, centers[0]);
    for (
      let centerIndex = 1;
      centerIndex < centers.length;
      centerIndex += 1
    ) {
      const distance = labDistanceSquared(pixel, centers[centerIndex]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = centerIndex;
      }
    }
    const weight = weights[index];
    clusterWeights[nearestIndex] += weight;
    clusterL[nearestIndex] += lightness[index] * weight;
    clusterA[nearestIndex] += axisA[index] * weight;
    clusterB[nearestIndex] += axisB[index] * weight;
    clusterCentrality[nearestIndex] += weight * centralities[index];
  }

  let largestClusterWeight = 0;
  for (const weight of clusterWeights) {
    largestClusterWeight = Math.max(largestClusterWeight, weight);
  }
  const clusters: ScoredCluster[] = [];
  for (let index = 0; index < centers.length; index += 1) {
    const clusterWeight = clusterWeights[index];
    if (!(clusterWeight > 0)) continue;
    const cluster: LabColor = {
      L: clusterL[index] / clusterWeight,
      a: clusterA[index] / clusterWeight,
      b: clusterB[index] / clusterWeight,
    };
    const C = Math.hypot(cluster.a, cluster.b);
    const h = Math.atan2(cluster.b, cluster.a);
    const population = clusterWeight / totalWeight;
    const relativePopulation = clusterWeight / largestClusterWeight;
    const centerPresence = clusterCentrality[index] / clusterWeight;
    const separation = clamp(
      Math.sqrt(labDistanceSquared(cluster, globalAverage)) / 0.24,
      0,
      1,
    );
    const chromaScore = smoothstep(0.018, 0.17, C);
    const darkFit = gaussian(cluster.L, 0.43, 0.32);
    const dominance =
      0.58 * Math.sqrt(relativePopulation) +
      0.42 * Math.sqrt(population);
    let penalty = 0;
    if (cluster.L < 0.07) penalty += (0.07 - cluster.L) * 5.5;
    if (cluster.L > 0.94) penalty += (cluster.L - 0.94) * 5;
    if (population < 0.008) penalty += (0.008 - population) * 8;
    if (C < 0.018 && relativePopulation < 0.42) penalty += 0.08;

    clusters.push({
      ...cluster,
      C,
      h,
      population,
      relativePopulation,
      centerPresence,
      separation,
      penalty,
      spotifyScore:
        0.5 * chromaScore +
        0.22 * darkFit +
        0.2 * dominance +
        0.05 * centerPresence +
        0.03 * separation -
        penalty,
      dominantScore:
        0.62 * Math.sqrt(relativePopulation) +
        0.14 * chromaScore +
        0.12 * gaussian(cluster.L, 0.5, 0.42) +
        0.08 * centerPresence +
        0.04 * separation -
        penalty * 0.45,
    });
  }

  if (clusters.length === 0) return FALLBACK_ARTWORK_PALETTE;
  let dominant = clusters[0];
  let strongestColorful: ScoredCluster | null = null;
  for (const cluster of clusters) {
    if (cluster.dominantScore > dominant.dominantScore) {
      dominant = cluster;
    }
    if (
      cluster.C >= 0.035 &&
      cluster.population >= 0.012 &&
      (!strongestColorful ||
        cluster.spotifyScore > strongestColorful.spotifyScore)
    ) {
      strongestColorful = cluster;
    }
  }

  let selected = dominant;
  if (strongestColorful) {
    const requiredMargin =
      strongestColorful.population < 0.035 ? 0.1 : 0.025;
    if (
      strongestColorful.spotifyScore >=
      dominant.spotifyScore + requiredMargin
    ) {
      selected = strongestColorful;
    } else if (dominant.C < 0.025) {
      selected = strongestColorful;
    }
  }

  const raw = oklabToHex(selected);
  const darkL = clamp(
    0.31 + (selected.L - 0.5) * 0.16,
    0.265,
    0.405,
  );
  const darkC = Math.min(selected.C * 0.88, 0.18);
  const lightL =
    selected.L > 0.78
      ? selected.L
      : clamp(0.78 + (selected.L - 0.5) * 0.1, 0.755, 0.835);
  const lightC = Math.min(selected.C * 0.62, 0.115);

  return freezePalette(
    raw,
    gamutMappedHex(darkL, darkC, selected.h),
    gamutMappedHex(lightL, lightC, selected.h),
  );
}

async function defaultDecodeImage(blob: Blob): Promise<DecodedArtworkImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new Error("No browser image decoder is available.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = document.createElement("img");
  image.decoding = "async";
  try {
    if (typeof image.decode === "function") {
      image.src = objectUrl;
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener(
          "error",
          () => reject(new Error("Could not decode artwork.")),
          { once: true },
        );
        image.src = objectUrl;
      });
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function defaultCanvasFactory(): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error("No browser canvas is available.");
  }
  return document.createElement("canvas");
}

function validFetchUrl(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_384) {
    throw new Error("Invalid artwork fetch URL.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Blocked artwork fetch URL.");
  }
  return url.toString();
}

/**
 * Fetch and decode a CORS-readable artwork URL, centrally crop it, downscale
 * it to 128x128, and return a palette. The caller supplies the fetch URL so it
 * can use WaveLink's already-validated Spicetify CORS relay URL.
 */
export async function loadArtworkPalette(
  fetchUrl: string,
  options: ArtworkPaletteLoadOptions = {},
): Promise<ArtworkPalette> {
  let decoded: DecodedArtworkImage | null = null;
  try {
    const target = validFetchUrl(fetchUrl);
    const fetchImpl =
      options.fetchImpl ??
      (typeof fetch === "function"
        ? ((input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, init))
        : null);
    if (!fetchImpl) throw new Error("Fetch is unavailable.");
    const maximumBytes = Math.max(
      1,
      Math.min(
        Number.isFinite(options.maxBlobBytes)
          ? Number(options.maxBlobBytes)
          : DEFAULT_MAX_BLOB_BYTES,
        64 * 1024 * 1024,
      ),
    );
    const response = await fetchImpl(target, {
      method: "GET",
      credentials: "omit",
      cache: "force-cache",
      referrerPolicy: "no-referrer",
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Artwork request failed: ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maximumBytes
    ) {
      throw new Error("Artwork response is too large.");
    }
    const declaredType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (declaredType && !declaredType.startsWith("image/")) {
      throw new Error("Artwork response is not an image.");
    }
    const blob = await response.blob();
    if (blob.size < 1 || blob.size > maximumBytes) {
      throw new Error("Artwork response has an invalid size.");
    }

    decoded = await (options.decodeImage ?? defaultDecodeImage)(blob);
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
      throw new Error("Artwork has invalid dimensions.");
    }
    const canvas = (options.canvasFactory ?? defaultCanvasFactory)();
    canvas.width = ANALYSIS_SIZE;
    canvas.height = ANALYSIS_SIZE;
    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("Could not create an artwork canvas.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const sourceSize = Math.min(decoded.width, decoded.height);
    const sourceX = (decoded.width - sourceSize) / 2;
    const sourceY = (decoded.height - sourceSize) / 2;
    context.drawImage(
      decoded.source,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      ANALYSIS_SIZE,
      ANALYSIS_SIZE,
    );
    const imageData = context.getImageData(
      0,
      0,
      ANALYSIS_SIZE,
      ANALYSIS_SIZE,
    );
    return extractArtworkPalette(
      imageData.data,
      ANALYSIS_SIZE,
      ANALYSIS_SIZE,
    );
  } catch {
    return failedFallback();
  } finally {
    try {
      decoded?.dispose();
    } catch {
      // Decoding cleanup must not change the palette result.
    }
  }
}

function canonicalCacheKey(value: string): string {
  const trimmed = String(value ?? "").trim();
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

/**
 * Session-only LRU with in-flight request deduplication. Successful palettes
 * live for the session; failed loader fallbacks are retried after a short TTL.
 */
export class ArtworkPaletteCache {
  private readonly maxEntries: number;
  private readonly failureTtlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, ArtworkPaletteCacheEntry>();
  private readonly pending = new Map<string, Promise<ArtworkPalette>>();
  private generation = 0;

  constructor(options: ArtworkPaletteCacheOptions = {}) {
    this.maxEntries = Math.max(
      1,
      Math.floor(options.maxEntries ?? DEFAULT_CACHE_ENTRIES),
    );
    this.failureTtlMs = Math.max(
      0,
      Math.floor(options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS),
    );
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get pendingSize(): number {
    return this.pending.size;
  }

  load(
    key: string,
    factory: () => Promise<ArtworkPalette>,
  ): Promise<ArtworkPalette> {
    const canonicalKey = canonicalCacheKey(key);
    const now = this.safeNow();
    const cached = this.entries.get(canonicalKey);
    if (cached) {
      if (!cached.failed || now < cached.expiresAt) {
        this.entries.delete(canonicalKey);
        this.entries.set(canonicalKey, cached);
        return Promise.resolve(cached.palette);
      }
      this.entries.delete(canonicalKey);
    }

    const active = this.pending.get(canonicalKey);
    if (active) return active;

    const generation = this.generation;
    let request: Promise<ArtworkPalette>;
    request = Promise.resolve()
      .then(factory)
      .catch(() => failedFallback())
      .then((palette) => {
        const normalized =
          palette &&
          typeof palette.raw === "string" &&
          typeof palette.dark === "string" &&
          typeof palette.light === "string"
            ? palette
            : failedFallback();
        if (generation === this.generation) {
          const failed = loadFailed(normalized);
          this.entries.delete(canonicalKey);
          this.entries.set(canonicalKey, {
            palette: normalized,
            failed,
            expiresAt: failed
              ? this.safeNow() + this.failureTtlMs
              : Number.POSITIVE_INFINITY,
          });
          this.evict();
        }
        return normalized;
      })
      .finally(() => {
        if (this.pending.get(canonicalKey) === request) {
          this.pending.delete(canonicalKey);
        }
      });
    this.pending.set(canonicalKey, request);
    return request;
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.pending.clear();
  }

  private safeNow(): number {
    const value = this.now();
    return Number.isFinite(value) ? value : Date.now();
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
