import { TraceMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping';

const MAX_MODULE_BYTES = 3 * 1024 * 1024;
const MAX_MAP_BYTES = 3 * 1024 * 1024;
const MAX_MODULES = 4;
const VUE_PATH = /^\/src\/(?:[a-zA-Z0-9_@.-]+\/)*[a-zA-Z0-9_@.-]+\.vue$/;
const unavailable = (reason) => ({ status: 'unavailable', reason });

function position(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 10000000;
}

export function viteDevOrigin(value) {
  if (typeof value !== 'string') throw new Error('Vite dev origin must be an HTTP origin');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.href !== `${url.origin}/`) {
    throw new Error('Vite dev origin must be an HTTP origin without path or credentials');
  }
  return url.origin;
}

function modulePath(file, origin) {
  if (typeof file !== 'string' || file.length > 1024) return null;
  try {
    const url = new URL(file);
    if (url.origin !== origin || url.search || url.hash || url.username || url.password ||
        !VUE_PATH.test(url.pathname)) return null;
    return url.pathname;
  } catch { return null; }
}

async function boundedText(response, limit) {
  if (!response.ok || !/^(?:application|text)\/javascript\b/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('not a JavaScript module');
  }
  if (Number(response.headers.get('content-length')) > limit) throw new Error('module too large');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('module too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function loadModule(origin, pathname, fetchModule) {
  const response = await fetchModule(origin + pathname, {
    redirect: 'error', signal: AbortSignal.timeout(2000), headers: { Accept: 'application/javascript' },
  });
  if (response.url && response.url !== origin + pathname) throw new Error('module URL changed');
  const script = await boundedText(response, MAX_MODULE_BYTES);
  const match = /\/\/[#@] sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)\s*$/m.exec(script);
  if (!match || match[1].length > Math.ceil(MAX_MAP_BYTES * 4 / 3) + 4) throw new Error('inline map missing');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_MAP_BYTES) throw new Error('map too large');
  const raw = JSON.parse(bytes.toString('utf8'));
  if (raw.version !== 3 || !Array.isArray(raw.sources) || !Array.isArray(raw.sourcesContent) ||
      typeof raw.mappings !== 'string' || raw.sources.length > 100 || raw.sources.length !== raw.sourcesContent.length) {
    throw new Error('invalid inline map');
  }
  return { script, map: new TraceMap(raw) };
}

export async function recoverViteDevError(error, origin, module, { fetchModule = fetch } = {}) {
  if (error?.name === 'resource_error') return unavailable('resource_has_no_code_position');
  const pathname = modulePath(error?.file, origin);
  if (!pathname || !position(error?.line) || !position(error?.column)) return unavailable('dev_position_unavailable');
  try {
    const loaded = module ?? await loadModule(origin, pathname, fetchModule);
    const generated = loaded.script.split('\n')[error.line - 1];
    if (!generated || error.column > generated.length + 1) return unavailable('dev_module_changed');
    const original = originalPositionFor(loaded.map, { line: error.line, column: error.column - 1 });
    const source = original.source?.split('?', 1)[0];
    if (!source || !source.endsWith(pathname) || !position(original.line) ||
        !Number.isSafeInteger(original.column) || original.column < 0) return unavailable('vue_mapping_missing');
    const content = sourceContentFor(loaded.map, original.source);
    const lines = content?.split(/\r?\n/);
    if (!lines || original.line > lines.length) return unavailable('vue_source_missing');
    const startLine = Math.max(1, original.line - 2);
    return { status: 'restored', file: pathname.slice(1), line: original.line, column: original.column + 1,
      startLine, lines: lines.slice(startLine - 1, original.line + 2).map((line) => line.slice(0, 240)),
      mapping: 'current_vite_dev_module', generatedFile: error.file, generatedLine: error.line,
      generatedColumn: error.column };
  } catch { return unavailable('dev_module_unavailable'); }
}

export async function enrichViteDevErrors(errors, origin, { fetchModule = fetch } = {}) {
  const modules = new Map();
  await Promise.all(errors.map(async (error) => {
    const pathname = modulePath(error.file, origin);
    if (!pathname || error.name === 'resource_error' || !position(error.line) || !position(error.column)) return;
    if (!modules.has(pathname)) {
      if (modules.size >= MAX_MODULES) return;
      modules.set(pathname, loadModule(origin, pathname, fetchModule).catch(() => null));
    }
    const module = await modules.get(pathname);
    error.devSource = module ? await recoverViteDevError(error, origin, module) : unavailable('dev_module_unavailable');
  }));
}
