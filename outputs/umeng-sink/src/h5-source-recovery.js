import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping';

const ARTIFACT_ID = /^[a-f0-9-]{36}$/;
const ASSET_PATH = /^assets\/[A-Za-z0-9_.-]+\.js$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_MANIFEST = 256 * 1024;
const MAX_ASSET = 32 * 1024 * 1024;

const unavailable = (reason) => ({ status: 'unavailable', reason });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readPrivateFile(root, relative, limit) {
  // Archives are server-controlled, but do not follow symlinks in an archive supplied by CI.
  let directory = root;
  for (const component of relative.split('/').slice(0, -1)) {
    directory = path.join(directory, component);
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('invalid archive directory');
  }
  const file = path.join(root, relative);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('invalid archive file');
  return fs.readFile(file);
}

function publicAssetUrl(base, script) {
  if (typeof base !== 'string' || !base.endsWith('/')) return null;
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return `${url.href}${script}`;
  } catch { return null; }
}

function vuePath(source) {
  let clean = source.split('?', 1)[0];
  try { clean = decodeURIComponent(clean); } catch { return null; }
  if (!clean.endsWith('.vue')) return null;
  const match = /(?:^|\/)(src|packages)\/[^?#]*\.vue$/.exec(clean);
  return match ? match[0].replace(/^\//, '') : null;
}

function position(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 10000000;
}

export async function recoverH5VueSource({ h5Release, sourceFile, line, column, errorType }, archiveDir) {
  if (!archiveDir) return unavailable('archive_not_configured');
  if (errorType === 'resource_error') return unavailable('resource_has_no_code_position');
  if (!ARTIFACT_ID.test(h5Release ?? '')) return unavailable('release_missing');
  if (!position(line) || !position(column) || typeof sourceFile !== 'string' || sourceFile.length > 2048) {
    return unavailable('position_missing');
  }
  let scriptUrl;
  try {
    const url = new URL(sourceFile);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return unavailable('script_not_in_archive');
    scriptUrl = `${url.origin}${url.pathname}`;
  } catch { return unavailable('script_not_in_archive'); }

  try {
    const root = path.join(path.resolve(archiveDir), h5Release);
    const manifest = JSON.parse((await readPrivateFile(root, 'manifest.json', MAX_MANIFEST)).toString('utf8'));
    if (manifest.schema !== 'axx-h5-artifacts-v1' || manifest.artifactId !== h5Release ||
        !Array.isArray(manifest.assets) || manifest.assets.length > 1000) return unavailable('archive_invalid');
    const asset = manifest.assets.find((item) => ASSET_PATH.test(item?.script) &&
      publicAssetUrl(manifest.base, item.script) === scriptUrl);
    if (!asset) return unavailable('script_not_in_archive');
    if (asset.map !== `${asset.script}.map` || !DIGEST.test(asset.scriptSha256 ?? '') ||
        !DIGEST.test(asset.mapSha256 ?? '')) return unavailable('archive_invalid');
    const [scriptBytes, mapBytes] = await Promise.all([
      readPrivateFile(root, asset.script, MAX_ASSET),
      readPrivateFile(root, asset.map, MAX_ASSET),
    ]);
    if (digest(scriptBytes) !== asset.scriptSha256 || digest(mapBytes) !== asset.mapSha256) {
      return unavailable('archive_digest_mismatch');
    }
    const generatedLine = scriptBytes.toString('utf8').split('\n')[line - 1];
    if (generatedLine == null || column > generatedLine.length + 1) return unavailable('position_out_of_bounds');
    const rawMap = JSON.parse(mapBytes.toString('utf8'));
    if (rawMap.version !== 3 || !Array.isArray(rawMap.sources) || !Array.isArray(rawMap.sourcesContent) ||
        typeof rawMap.mappings !== 'string') return unavailable('archive_invalid');
    const map = new TraceMap(rawMap);
    // Browser columns start at 1; source-map columns start at 0. The nearest preceding
    // mapping segment can be approximate, so never claim a character-exact location.
    const original = originalPositionFor(map, { line, column: column - 1 });
    const file = original.source && vuePath(original.source);
    if (!file || !position(original.line) || !Number.isSafeInteger(original.column) || original.column < 0) {
      return unavailable('vue_mapping_missing');
    }
    const content = sourceContentFor(map, original.source);
    if (typeof content !== 'string') return unavailable('vue_source_missing');
    const lines = content.split(/\r?\n/);
    if (original.line > lines.length) return unavailable('vue_mapping_missing');
    const startLine = Math.max(1, original.line - 3);
    const endLine = Math.min(lines.length, original.line + 3);
    return { status: 'restored', file, line: original.line, column: original.column + 1,
      startLine, lines: lines.slice(startLine - 1, endLine).map((text) => text.slice(0, 300)),
      h5Release, sourceFile: scriptUrl, generatedLine: line, generatedColumn: column,
      precision: 'source_map_segment' };
  } catch {
    return unavailable('archive_unavailable');
  }
}

function sourcePathFromUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.pathname;
  } catch { return null; }
}

function sourceTarget(value) {
  const pathname = sourcePathFromUrl(value);
  return pathname ? vuePath(pathname) : null;
}

function normalizedScriptUrl(value) {
  const pathname = sourcePathFromUrl(value);
  if (!pathname) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${pathname}`;
  } catch { return null; }
}

function sourceContext(content, line, column = 1) {
  if (typeof content !== 'string' || !position(line)) return null;
  const lines = content.split(/\r?\n/);
  if (line > lines.length) return null;
  const startLine = Math.max(1, line - 3);
  const endLine = Math.min(lines.length, line + 3);
  return {
    line,
    column: position(column) ? column : 1,
    startLine,
    lines: lines.slice(startLine - 1, endLine).map((text) => text.slice(0, 300)),
  };
}

async function artifactDirectories(archiveDir) {
  const root = path.resolve(archiveDir);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ARTIFACT_ID.test(entry.name)) continue;
    try {
      const manifestPath = path.join(root, entry.name, 'manifest.json');
      const stat = await fs.lstat(manifestPath);
      if (!stat.isFile() || stat.size > MAX_MANIFEST) continue;
      const manifest = JSON.parse((await fs.readFile(manifestPath)).toString('utf8'));
      if (manifest.schema !== 'axx-h5-artifacts-v1' || manifest.artifactId !== entry.name ||
          typeof manifest.base !== 'string' || !Array.isArray(manifest.assets) || manifest.assets.length > 1000) continue;
      artifacts.push({ root: path.join(root, entry.name), manifest, modifiedAt: stat.mtimeMs });
    } catch { /* Ignore incomplete or concurrently written artifacts. */ }
  }
  return artifacts.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

function validAsset(asset) {
  return ASSET_PATH.test(asset?.script ?? '') && asset.map === `${asset.script}.map` &&
    DIGEST.test(asset.scriptSha256 ?? '') && DIGEST.test(asset.mapSha256 ?? '');
}

async function readVerifiedMap(artifact, asset) {
  if (!validAsset(asset)) return null;
  try {
    const [scriptBytes, mapBytes] = await Promise.all([
      readPrivateFile(artifact.root, asset.script, MAX_ASSET),
      readPrivateFile(artifact.root, asset.map, MAX_ASSET),
    ]);
    if (digest(scriptBytes) !== asset.scriptSha256 || digest(mapBytes) !== asset.mapSha256) return null;
    const rawMap = JSON.parse(mapBytes.toString('utf8'));
    if (rawMap.version !== 3 || !Array.isArray(rawMap.sources) || !Array.isArray(rawMap.sourcesContent) ||
        typeof rawMap.mappings !== 'string') return null;
    return { rawMap, scriptBytes };
  } catch { return null; }
}

/**
 * Restores a Vue source location from the local private archive without using
 * h5Release/codeSnippet from the client log and without fetching the running H5.
 */
export async function recoverLocalH5VueSource({ sourceFile, line, column, errorType }, archiveDir) {
  if (!archiveDir) return unavailable('archive_not_configured');
  if (errorType === 'resource_error') return unavailable('resource_has_no_code_position');
  if (!position(line) || (column != null && !position(column)) || typeof sourceFile !== 'string') {
    return unavailable('position_missing');
  }
  const target = sourceTarget(sourceFile);
  const scriptUrl = normalizedScriptUrl(sourceFile);
  if (!target && !scriptUrl) return unavailable('source_not_vue');

  try {
    const artifacts = await artifactDirectories(archiveDir);
    for (const artifact of artifacts) {
      for (const asset of artifact.manifest.assets) {
        const isExactScript = scriptUrl && publicAssetUrl(artifact.manifest.base, asset.script) === scriptUrl;
        if (!target && !isExactScript) continue;
        const loaded = await readVerifiedMap(artifact, asset);
        if (!loaded) continue;
        const map = new TraceMap(loaded.rawMap);
        let source;
        let originalLine = line;
        let originalColumn = column ?? 1;
        let mapping = 'local_source_map_vue_position';
        let precision = 'vue_source_line';
        if (target) {
          source = loaded.rawMap.sources.find((candidate) => vuePath(candidate) === target);
        } else {
          const sourceLine = loaded.scriptBytes.toString('utf8').split('\n')[line - 1];
          if (sourceLine == null || (column ?? 1) > sourceLine.length + 1) return unavailable('position_out_of_bounds');
          const original = originalPositionFor(map, { line, column: (column ?? 1) - 1 });
          source = original.source && vuePath(original.source);
          originalLine = original.line;
          originalColumn = Number.isSafeInteger(original.column) ? original.column + 1 : 1;
          mapping = 'local_source_map_segment';
          precision = 'source_map_segment';
        }
        if (!source || !position(originalLine)) continue;
        const content = sourceContentFor(map, target ? source : (loaded.rawMap.sources.find((candidate) => vuePath(candidate) === source)));
        const context = sourceContext(content, originalLine, originalColumn);
        if (!context) return unavailable('vue_mapping_missing');
        return {
          status: 'restored',
          file: target ?? source,
          ...context,
          mapping,
          precision,
          archiveArtifact: artifact.manifest.artifactId,
          generatedFile: sourceFile,
          generatedLine: line,
          generatedColumn: column ?? 1,
        };
      }
    }
    return unavailable('source_not_found');
  } catch {
    return unavailable('archive_unavailable');
  }
}
