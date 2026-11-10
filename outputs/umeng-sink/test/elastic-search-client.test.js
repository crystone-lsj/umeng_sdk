import assert from "node:assert/strict";
import test from "node:test";
import {
  buildElkSearchBody,
  createElasticsearchClient,
  projectElkSource,
} from "../src/elastic-search-client.js";
import { createRequestHandler } from "../src/handler.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("builds a bounded read-only search over the configured index pattern", () => {
  const body = buildElkSearchBody({
    from: "2026-10-19T02:08:56.188Z",
    to: "2026-10-19T03:08:56.188Z",
    an: "学什么",
    ev: "networkAbsoluteRequestSuccess",
    limit: 5000,
  });
  assert.equal(body.size, 1000);
  assert.deepEqual(body.sort[0], {
    timestamp: { order: "desc", unmapped_type: "date" },
  });
  assert.equal(body.query.bool.filter.length, 3);
  assert.deepEqual(body.query.bool.filter[1], {
    match_phrase: { AN: "学什么" },
  });
});

test("uses server-side auth and does not expose it in diagnostics", async () => {
  const calls = [];
  const client = createElasticsearchClient({
    baseUrl: "https://es.example.test",
    indexPattern: "log-fe*gsl_fe_v2*",
    username: "kibana_reader",
    password: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ took: 2, hits: { total: { value: 0 }, hits: [] } });
    },
  });
  await client.status();
  assert.match(calls[0].init.headers.authorization, /^Basic /);
  assert.equal(client.describe().indexPattern, "log-fe*gsl_fe_v2*");
  assert.equal(JSON.stringify(client.describe()).includes("secret"), false);
});

test("projects ELK source fields and removes direct identifiers and URL queries", () => {
  const source = projectElkSource({
    USERID: "business-user",
    PHONE: "secret",
    UNAME: "secret",
    u_ip: "secret",
    DI: "secret",
    AN: "学什么",
    EV: "h5Error",
    url: "https://example.test/path?token=secret",
    DTL: JSON.stringify({
      route: "/path",
      USERID: "business-user",
      nested: { USERID: "business-user", keep: true },
    }),
  });
  assert.deepEqual(source, {
    AN: "学什么",
    EV: "h5Error",
    url: "https://example.test/path",
    DTL: JSON.stringify({ route: "/path", nested: { keep: true } }),
  });
  assert.equal(
    projectElkSource({ DTL: '{"USERID":"business-user",' }).DTL,
    undefined,
  );
  assert.equal(projectElkSource({ DTL: "opaque-value" }).DTL, "opaque-value");
});

test("serves ELK status and bounded search through the receiver without exposing credentials", async () => {
  const elkClient = {
    indexPattern: "log-fe*gsl_fe_v2*",
    describe: () => ({
      configured: true,
      indexPattern: "log-fe*gsl_fe_v2*",
      timeoutMs: 8000,
    }),
    async status() {
      return {
        ok: true,
        indexPattern: this.indexPattern,
        total: { value: 1 },
        tookMs: 3,
      };
    },
    async fieldCaps() {
      return { fields: { EV: { keyword: {} } } };
    },
    async search() {
      return {
        took: 3,
        hits: {
          total: { value: 1 },
          hits: [
            {
              _id: "1",
              _index: "log-fe-2026.10.19-gsl_fe_v2",
              sort: [1],
              _source: {
                AN: "学什么",
                EV: "h5Error",
                PHONE: "secret",
                USERID: "business-user",
                DTL: JSON.stringify({ USERID: "business-user", route: "/x" }),
              },
            },
          ],
        },
      };
    },
    logError() {},
  };
  const { handle, store } = createRequestHandler({
    dataDir: "/tmp/umeng-elk-client-test",
    elkClient,
    quiet: true,
  });
  try {
    const status = await handle({
      method: "GET",
      url: "/__sink/api/elk/status",
    });
    assert.equal(status.status, 200);
    const search = await handle({
      method: "GET",
      url: "/__sink/api/elk/search?AN=%E5%AD%A6%E4%BB%80%E4%B9%88&limit=20",
    });
    assert.equal(search.status, 200);
    const body = JSON.parse(search.body);
    assert.equal(body.total, 1);
    assert.equal(body.hits[0].source.PHONE, undefined);
    assert.equal(body.hits[0].source.USERID, undefined);
    assert.equal(JSON.parse(body.hits[0].source.DTL).USERID, undefined);
    assert.equal(body.hits[0].source.AN, "学什么");
  } finally {
    await store.close();
  }
});

test("requests USERID in the bounded scan source whitelist", async () => {
  const requests = [];
  const client = createElasticsearchClient({
    baseUrl: "https://es.invalid",
    indexPattern: "log-fe-*-gsl_test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return response({
        hits: { total: { value: 0, relation: "eq" }, hits: [] },
      });
    },
  });
  await client.scanWindow({
    from: "2026-10-19T02:00:00.000Z",
    to: "2026-10-19T03:00:00.000Z",
    an: "学什么",
    mod: "h5PageAnalysis",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]._source.includes("USERID"), true);
  assert.equal(requests[0]._source.includes("DTL"), true);
});

test("rejects concurrent split reads whose leaf totals exceed the record limit", async () => {
  let calls = 0;
  const client = createElasticsearchClient({
    baseUrl: "https://es.invalid",
    indexPattern: "log-fe-*-gsl_test",
    scanConcurrency: 2,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const start = Date.parse(body.query.bool.filter[0].range.timestamp.gte);
      const end = Date.parse(body.query.bool.filter[0].range.timestamp.lt);
      const isSplit = end - start > 500;
      const total = isSplit ? 1500 : 800;
      const hits = Array.from({ length: isSplit ? 1000 : total }, () => ({
        _source: { EV: "xsm.H5PageLoad", timestamp: start },
      }));
      return response({
        hits: { total: { value: total, relation: "eq" }, hits },
      });
    },
  });

  await assert.rejects(
    client.scanWindow({
      from: new Date(0).toISOString(),
      to: new Date(1000).toISOString(),
      an: "学什么",
      maxRecords: 1500,
    }),
    /ELK_TOO_MANY_RECORDS/,
  );
  assert.equal(calls, 3);
});
