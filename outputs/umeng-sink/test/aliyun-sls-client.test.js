import assert from 'node:assert/strict';
import test from 'node:test';
import { createAliyunSlsClient } from '../src/aliyun-sls-client.js';

class FakeSDK {
  constructor(config) { this.config = config; FakeSDK.current = this; this.pages = []; }
  async postLogStoreLogs(...args) { this.write = args; return {}; }
  async getLogs(...args) { this.reads ??= []; this.reads.push(args); return this.pages.shift() ?? []; }
}
async function setup() {
  return createAliyunSlsClient({ endpoint: 'cn-test.log.aliyuncs.com', project: 'project-test',
    logstore: 'logstore-test', credentialsProvider: { async getCredentials() { return {}; } }, Client: FakeSDK });
}
test('official SDK writer uses server-only provider and stores only the projected payload', async () => {
  const client = await setup();
  const event = { channel: 'ios-context', mirrorId: 'mirror-id', receivedAt: '2026-10-16T10:00:00.000Z', context: { contextId: 'id' } };
  await client.put(event);
  assert.equal(FakeSDK.current.config.endpoint, 'https://cn-test.log.aliyuncs.com');
  assert.equal(FakeSDK.current.config.accessKeyId, undefined);
  const [project, store, group] = FakeSDK.current.write;
  assert.equal(project, 'project-test');
  assert.equal(store, 'logstore-test');
  assert.deepEqual(JSON.parse(group.logs[0].content.payload), event);
  assert.equal(group.logs[0].timestamp, 1792144800);
});
test('official SDK reader paginates one UTC day and does not treat a full last page as complete', async () => {
  const client = await setup();
  const log = { payload: JSON.stringify({ channel: 'h5-navigation', mirrorId: '1', receivedAt: '2026-10-16T00:00:01.000Z' }) };
  FakeSDK.current.pages = [Array.from({ length: 100 }, () => log), [log]];
  const answer = await client.readDay('h5-navigation', '2026-10-16');
  assert.equal(answer.complete, true);
  assert.equal(answer.events.length, 101);
  assert.deepEqual(FakeSDK.current.reads.map((args) => args[4].offset), [0, 100]);
  assert.equal(FakeSDK.current.reads[0][2].toISOString(), '2026-10-16T00:00:00.000Z');
  assert.equal(FakeSDK.current.reads[0][3].toISOString(), '2026-10-17T00:00:00.000Z');
  FakeSDK.current.pages = [Array.from({ length: 50 }, () => log)];
  const bounded = await client.readDay('h5-navigation', '2026-10-16', { limit: 50 });
  assert.equal(bounded.complete, false);
});
test('unexpected pages and partial configuration fail closed', async () => {
  await assert.rejects(() => createAliyunSlsClient({ endpoint: 'bad / value', project: 'p', logstore: 'l',
    credentialsProvider: { async getCredentials() {} }, Client: FakeSDK }));
  const client = await setup();
  FakeSDK.current.pages = [{ progress: 'Partial', logs: [] }];
  await assert.rejects(() => client.readDay('h5-logs', '2026-10-16'), /incomplete/);
});
