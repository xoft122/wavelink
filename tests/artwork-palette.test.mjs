import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

async function importTypeScript(relativeUrl) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const palette = await importTypeScript(
  "../src/services/artworkPalette.ts",
);

function pixels(width, height, colorAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha = 255] = colorAt(x, y);
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
    }
  }
  return data;
}

function solidPixels(width, height, red, green, blue, alpha = 255) {
  return pixels(width, height, () => [red, green, blue, alpha]);
}

function hexToOklab(hex) {
  const byte = (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const linear = (value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const red = linear(byte(1));
  const green = linear(byte(3));
  const blue = linear(byte(5));
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
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

test("transparent and malformed pixel buffers use the exact neutral fallback", () => {
  assert.deepEqual(
    palette.extractArtworkPalette(
      solidPixels(4, 4, 255, 0, 0, 0),
      4,
      4,
    ),
    palette.FALLBACK_ARTWORK_PALETTE,
  );
  assert.deepEqual(
    palette.extractArtworkPalette(new Uint8ClampedArray(3), 1, 1),
    palette.FALLBACK_ARTWORK_PALETTE,
  );
  assert.deepEqual(palette.FALLBACK_ARTWORK_PALETTE, {
    raw: "#535353",
    dark: "#2A2A2A",
    light: "#B3B3B3",
  });
});

test("the 55 percent alpha threshold is inclusive at the first representable byte", () => {
  const below = palette.extractArtworkPalette(
    solidPixels(1, 1, 255, 0, 0, 140),
    1,
    1,
  );
  const included = palette.extractArtworkPalette(
    solidPixels(1, 1, 255, 0, 0, 141),
    1,
    1,
  );
  assert.deepEqual(below, palette.FALLBACK_ARTWORK_PALETTE);
  assert.equal(included.raw, "#FF0000");
});

test("uniform one-cluster artwork stays deterministic without empty-cluster NaNs", () => {
  const red = solidPixels(128, 128, 255, 0, 0);
  const first = palette.extractArtworkPalette(red, 128, 128);
  const second = palette.extractArtworkPalette(red, 128, 128);
  assert.deepEqual(first, second);
  assert.equal(first.raw, "#FF0000");
  assert.match(first.dark, /^#[0-9A-F]{6}$/);
  assert.match(first.light, /^#[0-9A-F]{6}$/);
});

test("two-color artwork is deterministic and a sub-1.2-percent bright speck cannot hijack gray", () => {
  const twoColor = pixels(128, 128, (x) =>
    x < 64 ? [255, 72, 0, 255] : [0, 94, 255, 255],
  );
  assert.deepEqual(
    palette.extractArtworkPalette(twoColor, 128, 128),
    palette.extractArtworkPalette(twoColor, 128, 128),
  );

  const mostlyGray = pixels(100, 100, (x, y) =>
    y === 0 && x < 100 ? [255, 0, 0, 255] : [128, 128, 128, 255],
  );
  assert.equal(
    palette.extractArtworkPalette(mostlyGray, 100, 100).raw,
    "#808080",
  );
});

test("derived dark and light colors obey the documented OKLab lightness bands", () => {
  for (const [red, green, blue] of [
    [255, 0, 0],
    [0, 120, 255],
    [28, 205, 96],
    [128, 128, 128],
  ]) {
    const result = palette.extractArtworkPalette(
      solidPixels(32, 32, red, green, blue),
      32,
      32,
    );
    const dark = hexToOklab(result.dark);
    const light = hexToOklab(result.light);
    // One 8-bit sRGB quantization step can move reconstructed OKLab slightly.
    assert.ok(dark.L >= 0.26 && dark.L <= 0.41, result.dark);
    assert.ok(light.L >= 0.75 && light.L <= 0.84, result.light);
    for (const value of [dark.L, dark.a, dark.b, light.L, light.a, light.b]) {
      assert.ok(Number.isFinite(value));
    }
  }
});

test("browser loader fetches the supplied URL, centrally crops, downsizes, and disposes", async () => {
  const calls = [];
  const drawCalls = [];
  let disposed = 0;
  const red = solidPixels(128, 128, 255, 0, 0);
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage(...args) {
      drawCalls.push(args);
    },
    getImageData() {
      return { data: red };
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind, options) {
      assert.equal(kind, "2d");
      assert.deepEqual(options, { willReadFrequently: true });
      return context;
    },
  };
  const source = {};
  const result = await palette.loadArtworkPalette(
    "https://cors-proxy.spicetify.app/https://i1.sndcdn.com/art.jpg",
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(
          new Blob([new Uint8Array([1, 2, 3])], {
            type: "image/jpeg",
          }),
          {
            status: 200,
            headers: {
              "content-type": "image/jpeg",
              "content-length": "3",
            },
          },
        );
      },
      decodeImage: async () => ({
        source,
        width: 400,
        height: 200,
        dispose() {
          disposed += 1;
        },
      }),
      canvasFactory: () => canvas,
    },
  );

  assert.equal(result.raw, "#FF0000");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.cache, "force-cache");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  assert.equal(canvas.width, 128);
  assert.equal(canvas.height, 128);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.equal(context.imageSmoothingQuality, "high");
  assert.deepEqual(drawCalls, [
    [source, 100, 0, 200, 200, 0, 0, 128, 128],
  ]);
  assert.equal(disposed, 1);
});

test("browser loader fails closed for invalid responses and canvas security errors", async () => {
  let fetchCalls = 0;
  assert.deepEqual(
    await palette.loadArtworkPalette("javascript:alert(1)", {
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("must not fetch");
      },
    }),
    palette.FALLBACK_ARTWORK_PALETTE,
  );
  assert.equal(fetchCalls, 0);

  assert.deepEqual(
    await palette.loadArtworkPalette("https://example.test/not-image", {
      fetchImpl: async () =>
        new Response("not an image", {
          headers: { "content-type": "text/plain" },
        }),
    }),
    palette.FALLBACK_ARTWORK_PALETTE,
  );

  let disposed = 0;
  assert.deepEqual(
    await palette.loadArtworkPalette("https://example.test/image", {
      fetchImpl: async () =>
        new Response(
          new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
          { headers: { "content-type": "image/jpeg" } },
        ),
      decodeImage: async () => ({
        source: {},
        width: 100,
        height: 100,
        dispose() {
          disposed += 1;
        },
      }),
      canvasFactory: () => ({
        getContext: () => ({
          drawImage() {},
          getImageData() {
            throw new DOMException("Tainted", "SecurityError");
          },
        }),
      }),
    }),
    palette.FALLBACK_ARTWORK_PALETTE,
  );
  assert.equal(disposed, 1);
});

test("session cache deduplicates pending loads and retains successful palettes", async () => {
  const cache = new palette.ArtworkPaletteCache();
  let resolve;
  let calls = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const factory = () => {
    calls += 1;
    return pending;
  };
  const first = cache.load("https://i1.sndcdn.com/a.jpg", factory);
  const second = cache.load("https://i1.sndcdn.com/a.jpg", factory);
  assert.strictEqual(first, second);
  assert.equal(calls, 0, "factory begins in a microtask");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(cache.pendingSize, 1);
  resolve({ raw: "#112233", dark: "#101010", light: "#EEEEEE" });
  assert.deepEqual(await first, {
    raw: "#112233",
    dark: "#101010",
    light: "#EEEEEE",
  });
  assert.equal(cache.pendingSize, 0);
  assert.equal(cache.size, 1);
  await cache.load("https://i1.sndcdn.com/a.jpg", async () => {
    calls += 1;
    throw new Error("must remain cached");
  });
  assert.equal(calls, 1);
});

test("session cache is true LRU and retries loader failures after their TTL", async () => {
  let now = 0;
  const cache = new palette.ArtworkPaletteCache({
    maxEntries: 2,
    failureTtlMs: 100,
    now: () => now,
  });
  const calls = new Map();
  const success = (key, raw) => async () => {
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return { raw, dark: "#222222", light: "#DDDDDD" };
  };
  await cache.load("a", success("a", "#AA0000"));
  await cache.load("b", success("b", "#00BB00"));
  await cache.load("a", success("a", "#AA0000")); // touch a
  await cache.load("c", success("c", "#0000CC")); // evict b
  await cache.load("b", success("b", "#00BB00"));
  assert.equal(calls.get("a"), 1);
  assert.equal(calls.get("b"), 2);
  assert.equal(calls.get("c"), 1);

  let failedCalls = 0;
  const fail = () => {
    failedCalls += 1;
    return palette.loadArtworkPalette("invalid:");
  };
  await cache.load("failure", fail);
  now = 99;
  await cache.load("failure", fail);
  assert.equal(failedCalls, 1);
  now = 100;
  await cache.load("failure", fail);
  assert.equal(failedCalls, 2);
});

test("a legitimate transparent-image fallback is cached as a success", async () => {
  let now = 0;
  let calls = 0;
  const cache = new palette.ArtworkPaletteCache({
    failureTtlMs: 5,
    now: () => now,
  });
  const legitimateFallback = palette.extractArtworkPalette(
    solidPixels(1, 1, 0, 0, 0, 0),
    1,
    1,
  );
  const factory = async () => {
    calls += 1;
    return legitimateFallback;
  };
  await cache.load("transparent", factory);
  now = 10_000;
  await cache.load("transparent", factory);
  assert.equal(calls, 1);
});

test("clearing the cache prevents an old in-flight result from repopulating it", async () => {
  const cache = new palette.ArtworkPaletteCache();
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const oldLoad = cache.load("same", () => pending);
  await Promise.resolve();
  cache.clear();
  resolve({ raw: "#010101", dark: "#020202", light: "#030303" });
  await oldLoad;
  assert.equal(cache.size, 0);

  let calls = 0;
  await cache.load("same", async () => {
    calls += 1;
    return { raw: "#111111", dark: "#222222", light: "#EEEEEE" };
  });
  assert.equal(calls, 1);
  assert.equal(cache.size, 1);
});
