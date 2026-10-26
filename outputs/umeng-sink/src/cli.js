#!/usr/bin/env node
/**
 * umeng-sink CLI.
 *
 * Environment:
 *   UMENG_SINK_PORT      listening port (default 8787)
 *   UMENG_SINK_HOST      bind address (default 127.0.0.1; use 0.0.0.0 to expose)
 *   UMENG_SINK_DATA_DIR  NDJSON archive directory (default ./data)
 *   UMENG_SINK_BASE_PATH optional path prefix, e.g. /umeng
 *   UMENG_SINK_QUIET     set to 1 to silence request logging
 */

import { createSinkServer } from './server.js';
import { createAliyunSlsClient } from './aliyun-sls-client.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElasticsearchClient } from './elastic-search-client.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=');
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined && value !== undefined && !value.startsWith('--')) index += 1;
    args[key] = value === undefined ? true : value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    [
      'Usage: umeng-sink [--port N] [--host ADDR] [--data-dir DIR] [--base-path PREFIX] [--quiet]',
      '',
      'Receives Umeng iOS (/unify_logs) and H5 (@umengfe/apm) report traffic.',
      'Debug endpoints: GET /__sink/health, /__sink/stats, /__sink/events?limit=50, /__sink/api/elk/status, /__sink/api/elk/search',
      ''
    ].join('\n')
  );
  process.exit(0);
}

// Trusted server-side module only. Absence of configuration leaves SLS disabled.
// Never load credentials from an iOS/H5 client or bundle them with either SDK.
const slsAdapter = process.env.UMENG_SINK_SLS_ADAPTER_MODULE;
let slsClient = slsAdapter ? await (async () => {
  const module = await import(pathToFileURL(resolve(slsAdapter)).href);
  if (typeof module.createSlsClient !== 'function') throw new TypeError('SLS adapter must export createSlsClient()');
  return module.createSlsClient();
})() : null;
const elkBaseUrl = process.env.UMENG_SINK_ELK_BASE_URL;
const elkCommonOptions = {
  baseUrl: elkBaseUrl,
  username: process.env.UMENG_SINK_ELK_USERNAME,
  password: process.env.UMENG_SINK_ELK_PASSWORD,
  apiKey: process.env.UMENG_SINK_ELK_API_KEY,
  timeoutMs: Number.parseInt(process.env.UMENG_SINK_ELK_TIMEOUT_MS ?? '8000', 10),
};
const elkClients = elkBaseUrl ? {
  test: createElasticsearchClient({
    ...elkCommonOptions,
    indexPattern: process.env.UMENG_SINK_ELK_INDEX_PATTERN ?? 'log-fe-*-gsl_test',
  }),
  online: createElasticsearchClient({
    ...elkCommonOptions,
    indexPattern: process.env.UMENG_SINK_ELK_ONLINE_INDEX_PATTERN ?? 'log-fe*gsl_fe_v2*',
  }),
} : {};

const slsSettings = ['UMENG_SINK_SLS_ENDPOINT', 'UMENG_SINK_SLS_PROJECT',
  'UMENG_SINK_SLS_LOGSTORE', 'UMENG_SINK_SLS_CREDENTIALS_MODULE'];
if (slsSettings.some((key) => process.env[key])) {
  if (slsClient || !slsSettings.every((key) => process.env[key])) {
    throw new Error('choose either an SLS adapter module or all four server-side SLS settings');
  }
  const module = await import(pathToFileURL(resolve(process.env.UMENG_SINK_SLS_CREDENTIALS_MODULE)).href);
  if (typeof module.createCredentialsProvider !== 'function') throw new TypeError('SLS credentials module must export createCredentialsProvider()');
  slsClient = await createAliyunSlsClient({
    endpoint: process.env.UMENG_SINK_SLS_ENDPOINT, project: process.env.UMENG_SINK_SLS_PROJECT,
    logstore: process.env.UMENG_SINK_SLS_LOGSTORE, credentialsProvider: await module.createCredentialsProvider(),
  });
}

const sink = createSinkServer({
  slsClient,
  elkClient: elkClients.test ?? null,
  elkClients,
  sourceArchiveDir: process.env.UMENG_SINK_H5_ARCHIVE_DIR,
  sourceAuthToken: process.env.UMENG_SINK_SOURCE_AUTH_TOKEN,
  dashboardSource: process.env.UMENG_SINK_DASHBOARD_SOURCE ?? 'elk',
  elkAppName: process.env.UMENG_SINK_ELK_APP_NAME ?? '学什么',
  port: Number.parseInt(args.port ?? process.env.UMENG_SINK_PORT ?? '8787', 10),
  host: args.host ?? process.env.UMENG_SINK_HOST ?? '127.0.0.1',
  dataDir: args['data-dir'] ?? process.env.UMENG_SINK_DATA_DIR ?? './data',
  basePath: args['base-path'] ?? process.env.UMENG_SINK_BASE_PATH ?? '',
  quiet: Boolean(args.quiet) || process.env.UMENG_SINK_QUIET === '1',
});

const address = await sink.listen();
process.stdout.write(`umeng-sink listening on http://${address.address}:${address.port} (archive: ${sink.store.dataDir})\n`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    sink.close().then(() => process.exit(0));
  });
}
