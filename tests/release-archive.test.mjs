import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const archivePath = process.env.WAVELINK_RELEASE_ZIP
  ? path.resolve(process.env.WAVELINK_RELEASE_ZIP)
  : null;

const INCLUDED_DIRECTORIES = [
  ".github",
  "scripts",
  "src",
  "tests",
];
const EXCLUDED_PROJECT_FILES = new Set([
  "tests/bridge.test.mjs",
]);
const INCLUDED_ROOT_FILES = [
  ".gitignore",
  "icon.svg",
  "LICENSE",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "tsconfig.json",
];
const REQUIRED_DIST_FILES = [
  "dist/extension.js",
  "dist/index.js",
  "dist/manifest.json",
  "dist/style.css",
];

async function walkFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolute, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZip(buffer) {
  const minimumEocdLength = 22;
  const maximumCommentLength = 0xffff;
  let eocd = -1;
  for (
    let offset = buffer.length - minimumEocdLength;
    offset >= Math.max(0, buffer.length - minimumEocdLength - maximumCommentLength);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert.notEqual(eocd, -1, "ZIP end-of-central-directory record is missing");

  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  assert.equal(diskNumber, 0, "multi-disk ZIP files are not supported");
  assert.equal(centralDisk, 0, "central directory must be on the first disk");
  assert.equal(entriesOnDisk, entryCount, "central-directory entry count is inconsistent");
  assert.ok(
    centralOffset + centralSize <= eocd,
    "central directory points outside the ZIP payload",
  );

  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(
      buffer.readUInt32LE(offset),
      0x02014b50,
      `central-directory entry ${index} is malformed`,
    );
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString(flags & 0x0800 ? "utf8" : "latin1")
      .replaceAll("\\", "/");
    assert.ok(!(flags & 0x0001), `${name} must not be encrypted`);
    assert.ok(!entries.has(name), `duplicate ZIP entry: ${name}`);
    entries.set(name, {
      compressedSize,
      expectedCrc,
      flags,
      localOffset,
      method,
      uncompressedSize,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, centralOffset + centralSize);

  const extract = (name) => {
    const entry = entries.get(name);
    assert.ok(entry, `missing ZIP entry: ${name}`);
    assert.equal(
      buffer.readUInt32LE(entry.localOffset),
      0x04034b50,
      `local header is malformed: ${name}`,
    );
    const localNameLength = buffer.readUInt16LE(entry.localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(entry.localOffset + 28);
    const dataOffset =
      entry.localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(
      dataOffset,
      dataOffset + entry.compressedSize,
    );
    let content;
    if (entry.method === 0) content = Buffer.from(compressed);
    else if (entry.method === 8) content = inflateRawSync(compressed);
    else assert.fail(`unsupported ZIP compression method ${entry.method}: ${name}`);
    assert.equal(content.length, entry.uncompressedSize, `size mismatch: ${name}`);
    assert.equal(crc32(content), entry.expectedCrc, `CRC mismatch: ${name}`);
    return content;
  };

  return { entries, extract };
}

test(
  "the full GitHub release ZIP contains the build, source, and release metadata",
  { skip: archivePath ? false : "set WAVELINK_RELEASE_ZIP to validate a release" },
  async () => {
    const expectedRoot = `WaveLink-v${packageJson.version}`;
    assert.equal(
      path.basename(archivePath),
      `${expectedRoot}.zip`,
      "release filename must match package.json",
    );

    const zip = readZip(await readFile(archivePath));
    const fileEntries = [...zip.entries.keys()].filter(
      (entry) => !entry.endsWith("/"),
    );
    assert.ok(fileEntries.length > 0, "release ZIP must not be empty");
    for (const entry of fileEntries) {
      assert.ok(
        entry.startsWith(`${expectedRoot}/`),
        `every file must live under ${expectedRoot}/: ${entry}`,
      );
      const relative = entry.slice(expectedRoot.length + 1);
      assert.ok(relative && !relative.startsWith("/") && !relative.includes("../"));
      assert.doesNotMatch(
        relative,
        /(^|\/)(?:node_modules|bridge|\.git|\.tmp-[^/]*)(?:\/|$)|(^|\/)\.env[^/]*$|\.js\.map$|\.log$|\.(?:zip|sha256)$/,
        `development/runtime artifact leaked into release: ${relative}`,
      );
    }

    const expectedFiles = new Set(INCLUDED_ROOT_FILES);
    for (const directory of INCLUDED_DIRECTORIES) {
      for (const file of await walkFiles(path.join(projectRoot, directory))) {
        const projectFile = `${directory}/${file}`;
        if (!EXCLUDED_PROJECT_FILES.has(projectFile)) {
          expectedFiles.add(projectFile);
        }
      }
    }
    for (const file of REQUIRED_DIST_FILES) expectedFiles.add(file);

    const archivedFiles = new Set(
      fileEntries.map((entry) => entry.slice(expectedRoot.length + 1)),
    );
    assert.deepEqual(
      [...archivedFiles].sort(),
      [...expectedFiles].sort(),
      "the full GitHub ZIP must contain every project/source file and only the four compiled dist files",
    );

    const archivedPackage = JSON.parse(
      zip.extract(`${expectedRoot}/package.json`).toString("utf8"),
    );
    const archivedLock = JSON.parse(
      zip.extract(`${expectedRoot}/package-lock.json`).toString("utf8"),
    );
    assert.equal(archivedPackage.version, packageJson.version);
    assert.equal(archivedLock.version, packageJson.version);
    assert.equal(archivedLock.packages?.[""]?.version, packageJson.version);

    const versionSource = zip
      .extract(`${expectedRoot}/src/version.ts`)
      .toString("utf8");
    assert.match(
      versionSource,
      new RegExp(`WAVELINK_VERSION\\s*=\\s*["']${packageJson.version.replaceAll(".", "\\.")}["']`),
    );
    const readme = zip.extract(`${expectedRoot}/README.md`).toString("utf8");
    assert.match(readme, new RegExp(`Version ${packageJson.version.replaceAll(".", "\\.")}`));
    assert.match(readme, new RegExp(`WaveLink-v${packageJson.version.replaceAll(".", "\\.")}`));

    for (const file of REQUIRED_DIST_FILES) {
      const content = zip.extract(`${expectedRoot}/${file}`);
      assert.ok(content.length > 0, `${file} must be a non-empty compiled artifact`);
    }
    assert.doesNotThrow(() =>
      JSON.parse(
        zip.extract(`${expectedRoot}/dist/manifest.json`).toString("utf8"),
      ),
    );
  },
);
