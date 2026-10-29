import { promises as fs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  TraceMap,
  originalPositionFor,
  sourceContentFor,
} from "@jridgewell/trace-mapping";

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const MAX_ENTRIES = 4000;
const MAX_MAP_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

const unavailable = (reason) => ({ status: "unavailable", reason });

export class SourceMapUploadError extends Error {
  constructor(message, code = "INVALID_SOURCE_MAP_UPLOAD") {
    super(message);
    this.name = "SourceMapUploadError";
    this.code = code;
    this.statusCode = 400;
  }
}

function normalizedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
    return null;
  const clean = value.replaceAll("\\", "/");
  if (clean.startsWith("/") || /^[A-Za-z]:\//.test(clean)) return null;
  const parts = clean.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22)
    throw new SourceMapUploadError("ZIP central directory is missing");
  const start = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD) return offset;
  }
  throw new SourceMapUploadError("ZIP central directory is missing");
}

function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entries > MAX_ENTRIES ||
    entries === 0xffffffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize > buffer.length
  ) {
    throw new SourceMapUploadError(
      "ZIP uses an unsupported or invalid central directory",
    );
  }
  const result = [];
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== ZIP_CENTRAL
    ) {
      throw new SourceMapUploadError("ZIP central directory entry is invalid");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      end > buffer.length ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    )
      throw new SourceMapUploadError("ZIP64 archives are not supported");
    const name = normalizedPath(
      buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
    );
    if (!name) throw new SourceMapUploadError("ZIP contains an unsafe path");
    result.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize)
    throw new SourceMapUploadError("ZIP central directory size is invalid");
  return result;
}

function unzipEntry(buffer, entry) {
  if (entry.flags & 0x1)
    throw new SourceMapUploadError("Encrypted ZIP entries are not supported");
  if (
    entry.uncompressedSize > MAX_TOTAL_UNCOMPRESSED_BYTES ||
    entry.compressedSize > buffer.length
  ) {
    throw new SourceMapUploadError("ZIP entry is too large");
  }
  const local = entry.localOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== ZIP_LOCAL) {
    throw new SourceMapUploadError("ZIP local entry is invalid");
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length)
    throw new SourceMapUploadError("ZIP entry data is truncated");
  const compressed = buffer.subarray(start, end);
  let result;
  if (entry.method === 0) result = Buffer.from(compressed);
  else if (entry.method === 8) {
    try {
      result = inflateRawSync(compressed, {
        maxOutputLength: entry.uncompressedSize,
      });
    } catch {
      throw new SourceMapUploadError("ZIP deflate entry is invalid");
    }
  } else
    throw new SourceMapUploadError("ZIP compression method is not supported");
  if (result.length !== entry.uncompressedSize)
    throw new SourceMapUploadError("ZIP entry size is invalid");
  return result;
}

function mapScriptCandidates(entryName, rawMap) {
  const candidates = new Set();
  if (entryName.endsWith(".js.map")) candidates.add(entryName.slice(0, -4));
  if (typeof rawMap.file === "string") {
    const file = normalizedPath(rawMap.file);
    if (file && file.endsWith(".js")) candidates.add(file);
  }
  return [...candidates];
}

function validSourceMap(rawMap) {
  return (
    rawMap &&
    typeof rawMap === "object" &&
    !Array.isArray(rawMap) &&
    rawMap.version === 3 &&
    Array.isArray(rawMap.sources) &&
    rawMap.sources.every((source) => typeof source === "string") &&
    typeof rawMap.mappings === "string" &&
    (!("sourcesContent" in rawMap) ||
      rawMap.sourcesContent == null ||
      Array.isArray(rawMap.sourcesContent))
  );
}

function parseSourceMaps(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0 ||
    buffer.length > MAX_UPLOAD_BYTES
  ) {
    throw new SourceMapUploadError(
      `ZIP must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`,
      "SOURCE_MAP_UPLOAD_TOO_LARGE",
    );
  }
  const entries = readZipEntries(buffer);
  const maps = [];
  let totalUncompressed = 0;
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES)
      throw new SourceMapUploadError("ZIP expands beyond the allowed size");
    if (!entry.name.endsWith(".map")) continue;
    if (entry.uncompressedSize > MAX_MAP_BYTES)
      throw new SourceMapUploadError("A source map is too large");
    const bytes = unzipEntry(buffer, entry);
    let rawMap;
    try {
      rawMap = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new SourceMapUploadError(
        `Source map is not valid JSON: ${entry.name}`,
      );
    }
    if (!validSourceMap(rawMap))
      throw new SourceMapUploadError(`Invalid source map: ${entry.name}`);
    let traceMap;
    try {
      traceMap = new TraceMap(rawMap);
    } catch {
      throw new SourceMapUploadError(
        `Source map mappings are invalid: ${entry.name}`,
      );
    }
    maps.push({
      entryName: entry.name,
      rawMap,
      traceMap,
      scripts: mapScriptCandidates(entry.name, rawMap),
      hasSourcesContent:
        Array.isArray(rawMap.sourcesContent) &&
        rawMap.sourcesContent.some((value) => typeof value === "string"),
    });
  }
  if (maps.length === 0)
    throw new SourceMapUploadError("ZIP does not contain any valid source map");
  return maps;
}

function sourcePath(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function scriptMatches(map, pathname) {
  const path = pathname.replace(/^\/+/, "");
  return map.scripts.some(
    (script) =>
      script === path ||
      script.endsWith("/" + path) ||
      path.endsWith("/" + script) ||
      path.split("/").at(-1) === script.split("/").at(-1),
  );
}

function position(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 10000000;
}

function vuePath(source) {
  if (typeof source !== "string") return null;
  let clean = source.split("?", 1)[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    return null;
  }
  if (!clean.endsWith(".vue")) return null;
  const match = /(?:^|\/)(src|packages)\/[^?#]*\.vue$/.exec(clean);
  return match ? match[0].replace(/^\//, "") : null;
}

function context(content, line, column) {
  if (typeof content !== "string" || !position(line)) return null;
  const lines = content.split(/\r?\n/);
  if (line > lines.length) return null;
  const startLine = Math.max(1, line - 3);
  const endLine = Math.min(lines.length, line + 3);
  return {
    line,
    column: position(column) ? column : 1,
    startLine,
    lines: lines
      .slice(startLine - 1, endLine)
      .map((text) => text.slice(0, 300)),
  };
}

export function recoverUploadedH5VueSource(
  { sourceFile, line, column, errorType },
  index,
) {
  if (!index) return unavailable("source_map_not_uploaded");
  if (errorType === "resource_error")
    return unavailable("resource_has_no_code_position");
  if (
    !position(line) ||
    (column != null && !position(column)) ||
    typeof sourceFile !== "string"
  )
    return unavailable("position_missing");
  const pathname = sourcePath(sourceFile);
  if (!pathname) return unavailable("source_not_script");
  const map = index.maps.find((candidate) =>
    scriptMatches(candidate, pathname),
  );
  if (!map) return unavailable("source_map_not_found");
  const original = originalPositionFor(map.traceMap, {
    line,
    column: (column ?? 1) - 1,
  });
  const file = vuePath(original.source);
  if (
    !file ||
    !position(original.line) ||
    !Number.isSafeInteger(original.column) ||
    original.column < 0
  ) {
    return unavailable("vue_mapping_missing");
  }
  const content = sourceContentFor(map.traceMap, original.source);
  const restored = context(content, original.line, original.column + 1);
  if (!restored) return unavailable("vue_source_missing");
  return {
    status: "restored",
    file,
    ...restored,
    mapping: "uploaded_source_map_segment",
    precision: "source_map_segment",
    generatedFile: sourceFile,
    generatedLine: line,
    generatedColumn: column ?? 1,
    sourceMapFile: map.entryName,
  };
}

export class SourceMapStore {
  constructor({ dataDir, maxUploadBytes = MAX_UPLOAD_BYTES } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, "source-maps", "current.zip");
    this.maxUploadBytes = maxUploadBytes;
    this.index = null;
    this.meta = null;
    this.ready = this.load();
  }

  async load() {
    try {
      const [bytes, stat] = await Promise.all([
        fs.readFile(this.file),
        fs.stat(this.file),
      ]);
      this.index = { maps: parseSourceMaps(bytes) };
      this.meta = {
        bytes: bytes.length,
        uploadedAt: stat.mtime.toISOString(),
        fileName: "current.zip",
      };
    } catch (error) {
      if (error?.code !== "ENOENT") this.index = null;
    }
  }

  async upload(bytes, fileName = "source-maps.zip") {
    await this.ready;
    if (bytes.length > this.maxUploadBytes)
      throw new SourceMapUploadError(
        "ZIP upload exceeds the configured limit",
        "SOURCE_MAP_UPLOAD_TOO_LARGE",
      );
    const maps = parseSourceMaps(bytes);
    const directory = path.dirname(this.file);
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    this.index = { maps };
    this.meta = {
      bytes: bytes.length,
      uploadedAt: new Date().toISOString(),
      fileName: String(fileName).slice(0, 200),
    };
    return this.status();
  }

  async recover(input) {
    await this.ready;
    return recoverUploadedH5VueSource(input, this.index);
  }

  async status() {
    await this.ready;
    if (!this.index || !this.meta)
      return { uploaded: false, maps: 0, mappedFiles: 0 };
    return {
      uploaded: true,
      ...this.meta,
      maps: this.index.maps.length,
      mappedFiles: this.index.maps.filter((map) => map.hasSourcesContent)
        .length,
    };
  }
}

export { MAX_UPLOAD_BYTES };
