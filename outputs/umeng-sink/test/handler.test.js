import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import { deflateSync } from "node:zlib";

import { buildEnvelope, buildSuccessResponse } from "../src/envelope.js";
import { createRequestHandler } from "../src/handler.js";

const GOLDEN_ENVELOPE = Buffer.from(
  "0b00010000000456312e310b0002000000183639346130323538383536306533343837323064656632610b000300000020376337656635653336663262363765376332353936666563333439336630386608000400000007080005694602580800060000007b0b000700000070789c1d8cc10a84300c44ff25e70af6b0baebafc82241831b5c2b985494d27f37f532306f7893e04738d10e5d824da003b67410579eac0887a55212ade668203bc080ff4b799422e0a87cd010a5f8de011d14d4963ec1a3e3790eb26e0bd963e1be6d1aff79bdeb3a7f73be01fac628780b00080000002065356535653565356535653565356535653565356535653565356535653565350b000900000020323839343566383966343137613333326665633461383662313365303237383808000a0000000100",
  "hex",
);

const GOLDEN_H5_BODY = [
  "2.0.10|694a02588560e348720def2a|sid-abc123|u-1001|-|paid|1.2.0|prod|AX1234567890",
  "|^|",
  "pv|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pv-1|1|390x844|390x844|Y|1766195800123|0|$|Y|Y|Y|N",
].join("");

/**
 * Drives the router in-process: no socket is bound, so these tests do not depend
 * on a sandbox that permits `listen`. `scripts/e2e-verify.mjs` covers the real
 * socket path.
 */
async function withHandler(run) {
  const dataDir = await mkdtemp(join(tmpdir(), "umeng-sink-"));
  const { handle, store } = createRequestHandler({ dataDir, quiet: true });
  try {
    return await run({ handle, store, dataDir });
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

function post(handle, url, body, headers = {}) {
  return handle({ method: "POST", url, headers, body });
}

async function readArchive(store, dataDir, channel) {
  await store.flush();
  const day = new Date().toISOString().slice(0, 10);
  const text = await readFile(
    join(dataDir, `${channel}-${day}.ndjson`),
    "utf8",
  );
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("iOS /unify_logs accepts an envelope and answers with the thrift success struct", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const response = await post(handle, "/unify_logs", GOLDEN_ENVELOPE, {
      "content-type": "application/thrift",
      "msg-type": "envelope/json",
      "x-umeng-sdk": "1",
      "sm-imp": "1",
      "x-umeng-utc": "1766195800123",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, buildSuccessResponse());

    const events = await readArchive(store, dataDir, "ios-analytics");
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "ios-analytics");
    assert.equal(events[0].headers.umengUtc, "1766195800123");
    assert.equal(events[0].envelope.address, "694a02588560e348720def2a");
    assert.equal(events[0].entity.json.header.umid, "sink-test-guid");
    assert.equal(events[0].integrity.signatureMatches, true);
    assert.equal(events[0].errors.length, 0);
  });
});
test("iOS /unify_logs still answers 200 for undecodable bytes but records the failure", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const response = await post(
      handle,
      "/unify_logs",
      Buffer.from("not thrift"),
    );
    assert.equal(response.status, 200);
    const events = await readArchive(store, dataDir, "ios-analytics");
    assert.equal(events.length, 1);
    assert.ok(events[0].errors.length > 0);
    assert.equal(events[0].rawBody.encoding, "base64");
  });
});
test("browser endpoints answer CORS preflight and actual cross-origin reports", async () => {
  await withHandler(async ({ handle }) => {
    const preflight = await handle({
      method: "OPTIONS",
      url: "/apm_web_logs?a=pid&ver=1",
      headers: {
        origin: "http://10.16.110.118:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["Access-Control-Allow-Origin"], "*");
    assert.equal(
      preflight.headers["Access-Control-Allow-Methods"],
      "GET, POST, OPTIONS",
    );

    const report = await post(
      handle,
      "/apm_web_logs?a=pid&ver=1",
      GOLDEN_H5_BODY,
      {
        origin: "http://10.16.110.118:5173",
        "content-type": "text/plain",
      },
    );
    assert.equal(report.status, 200);
    assert.equal(report.headers["Access-Control-Allow-Origin"], "*");
  });
});

test("H5 /apm_web_logs parses the body and answers 200", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const response = await post(
      handle,
      "/apm_web_logs?a=694a02588560e348720def2a&ver=1",
      GOLDEN_H5_BODY,
      { "content-type": "text/plain" },
    );

    assert.equal(response.status, 200);

    const events = await readArchive(store, dataDir, "h5-logs");
    assert.equal(events.length, 1);
    assert.equal(events[0].parsed.header.pid, "694a02588560e348720def2a");
    assert.equal(events[0].parsed.logCount, 1);
    assert.equal(events[0].parsed.logs[0].log.enable_error, "Y");
    assert.equal(events[0].query.ver, "1");
  });
});

test("H5 beacon and image ping are captured separately", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const beacon = await post(
      handle,
      "/apm_web_ping?a=pid&ver=1",
      GOLDEN_H5_BODY,
    );
    assert.equal(beacon.status, 200);

    const image = await handle({
      method: "GET",
      url: "/apm_web_img.gif?a=pid&ver=1&i=abc",
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers["Content-Type"], "image/gif");
    assert.equal(image.body.byteLength > 0, true);

    assert.equal((await readArchive(store, dataDir, "h5-beacon")).length, 1);
    assert.equal(
      (await readArchive(store, dataDir, "h5-image-ping")).length,
      1,
    );
  });
});

test("config and APM endpoints stay permissive so clients do not back off", async () => {
  await withHandler(async ({ handle }) => {
    for (const path of ["/zcfg", "/heartbeat"]) {
      const response = await post(handle, path, Buffer.from("x"));
      assert.equal(response.status, 200, path);
      assert.deepEqual(response.body, buildSuccessResponse());
    }

    const cc = await handle({
      method: "GET",
      url: "/apm_cc_web?app=pid&os=web&um_sdk_ver=2.0.10",
    });
    assert.equal(cc.status, 200);
    assert.deepEqual(JSON.parse(cc.body.toString("utf8")), {});

    const apmCc = await handle({
      method: "GET",
      url: "/apm_cc?os=iOS&app=pid",
    });
    assert.equal(apmCc.status, 200);

    const apmLogs = await post(
      handle,
      "/apm_logs?type=nativeh5perf&seq=1",
      Buffer.from("payload"),
    );
    assert.equal(apmLogs.status, 200);
    assert.deepEqual(JSON.parse(apmLogs.body.toString("utf8")), {
      code: 0,
      msg: "ok",
    });

    for (const path of [
      "/upload",
      "/api/crashsdk/validate",
      "/api/crashsdk/logcollect",
    ]) {
      const response = await post(handle, path, Buffer.from("payload"));
      assert.equal(response.status, 200, path);
    }
  });
});

test("a deployment basePath is stripped before routing", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "umeng-sink-prefix-"));
  const { handle, store } = createRequestHandler({
    dataDir,
    quiet: true,
    basePath: "/umeng",
  });
  try {
    const response = await post(handle, "/umeng/unify_logs", GOLDEN_ENVELOPE);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, buildSuccessResponse());

    // Paths outside the prefix are still routed, so a misconfigured client is
    // recorded rather than silently dropped.
    const unprefixed = await post(handle, "/unify_logs", GOLDEN_ENVELOPE);
    assert.equal(unprefixed.status, 200);

    const dashboard = await handle({
      method: "GET",
      url: "/umeng/__sink/dashboard",
    });
    assert.equal(dashboard.status, 200);
    assert.match(
      dashboard.body.toString("utf8"),
      /window\.__SINK_BASE_PATH__ = "\/umeng"/,
    );
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("debug endpoints expose health, stats and recent events", async () => {
  await withHandler(async ({ handle }) => {
    await post(handle, "/unify_logs", GOLDEN_ENVELOPE);

    const health = JSON.parse(
      (await handle({ method: "GET", url: "/__sink/health" })).body.toString(
        "utf8",
      ),
    );
    assert.equal(health.ok, true);

    const stats = JSON.parse(
      (await handle({ method: "GET", url: "/__sink/stats" })).body.toString(
        "utf8",
      ),
    );
    assert.equal(
      stats.channels.find((entry) => entry.channel === "ios-analytics").count,
      1,
    );

    const events = JSON.parse(
      (
        await handle({
          method: "GET",
          url: "/__sink/events?limit=1&channel=ios-analytics",
        })
      ).body.toString("utf8"),
    );
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].channel, "ios-analytics");
  });
});

test("unknown paths are recorded and answered 404", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const response = await post(
      handle,
      "/definitely-not-umeng",
      Buffer.from("x"),
    );
    assert.equal(response.status, 404);
    assert.equal((await readArchive(store, dataDir, "unknown")).length, 1);
  });
});

test("dashboard endpoints return the aggregate API and dependency-free HTML", async () => {
  await withHandler(async ({ handle, store }) => {
    const body = [
      "2.0.10|694a02588560e348720def2a|sid-abc123|u-1001|-|paid|1.2.0|prod|AX1234567890",
      "|^|",
      "pv|https%3A%2F%2Fm.gsx.com%2Fhome%3Ffrom%3Dpush|1|100|pv-1|1|390x844|390x844|Y|1766195800123|0|$|Y|Y|Y|N",
      ",api|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pv-1|1|390x844|390x844|Y|1766195800200|0|$|https%3A%2F%2Fapi.gsx.com%2Flist|GET|120|200|fetch|-|-|-",
      ",error|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pv-1|1|390x844|390x844|Y|1766195800300|0|$|TypeError|boom|at%20home.js%3A1%3A2|home.js|1|2",
      ",perf_fcp|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pv-1|1|390x844|390x844|Y|1766195800400|0|$|800",
    ].join("");
    await post(handle, "/apm_web_logs?a=694a02588560e348720def2a&ver=1", body, {
      "content-type": "text/plain",
    });
    await store.flush();

    const api = await handle({ method: "GET", url: "/__sink/api/dashboard" });
    assert.equal(api.status, 200);
    const payload = JSON.parse(api.body.toString("utf8"));
    assert.equal(payload.overview.pageViews, 1);
    assert.equal(payload.overview.apiRequests, 1);
    assert.equal(payload.overview.errors, 1);
    assert.equal(payload.performance.fcp.p50, 800);
    assert.equal(payload.pages[0].page, "https://m.gsx.com/home");

    const now = new Date();
    const from = new Date(now.getTime() - 3600000).toISOString();
    const ranged = await handle({
      method: "GET",
      url:
        "/__sink/api/dashboard?from=" +
        encodeURIComponent(from) +
        "&to=" +
        encodeURIComponent(now.toISOString()),
    });
    assert.equal(ranged.status, 200);
    assert.equal(
      JSON.parse(ranged.body.toString("utf8")).range.timeField,
      "receivedAt",
    );
    const clientRanged = await handle({
      method: "GET",
      url:
        "/__sink/api/dashboard?from=" +
        encodeURIComponent(from) +
        "&to=" +
        encodeURIComponent(now.toISOString()) +
        "&timeField=clientAt",
    });
    assert.equal(clientRanged.status, 200);
    const clientData = JSON.parse(clientRanged.body);
    assert.equal(clientData.range.timeField, "clientAt");
    assert.equal(clientData.overview.pageViews, 0); // golden ctime is outside this window
    const invalidTimeField = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?timeField=unknown",
    });
    assert.equal(invalidTimeField.status, 400);
    assert.match(JSON.parse(invalidTimeField.body).error, /timeField/);
    const filtered = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?dim.sdkVersion=2.0.10",
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual(JSON.parse(filtered.body).userPerception.activeFilters, {
      sdkVersion: "2.0.10",
    });
    const pageFiltered = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?pageFilter=%2Fhome&pageHost=m.gsx.com",
    });
    assert.equal(pageFiltered.status, 200);
    const pageFilteredPayload = JSON.parse(pageFiltered.body.toString("utf8"));
    assert.deepEqual(pageFilteredPayload.userPerception.activePageFilter, {
      pageFilter: "/home",
      pageHost: "m.gsx.com",
    });
    assert.equal(pageFilteredPayload.overview.pageViews, 1);
    assert.equal(pageFilteredPayload.overview.apiRequests, 1);
    assert.equal(pageFilteredPayload.overview.errors, 1);
    const invalidPageFilter = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?pageFilter=" + "x".repeat(129),
    });
    assert.equal(invalidPageFilter.status, 400);
    assert.match(JSON.parse(invalidPageFilter.body).error, /page filter/);
    const invalidDimension = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?dim.unknown=value",
    });
    assert.equal(invalidDimension.status, 400);
    const invalidEmpty = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?dim.deviceModel=",
    });
    assert.equal(invalidEmpty.status, 400);
    const invalidRange = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?from=" + encodeURIComponent(from),
    });
    assert.equal(invalidRange.status, 400);

    const root = await handle({ method: "GET", url: "/" });
    assert.equal(root.status, 200);
    assert.equal(root.headers["Content-Type"], "text/html; charset=utf-8");
    assert.match(root.body.toString("utf8"), /H5 性能分析接收台/);
    assert.match(root.body.toString("utf8"), /用户感知/);
    assert.match(root.body.toString("utf8"), /慢加载/);
    assert.doesNotMatch(
      root.body.toString("utf8"),
      /data-section="loadingPerformance"/,
    );
    assert.doesNotMatch(
      root.body.toString("utf8"),
      /data-section="pages"|data-section="performance"/,
    );
    assert.match(root.body.toString("utf8"), /window\.__SINK_BASE_PATH__ = ""/);

    const dashboard = await handle({ method: "GET", url: "/__sink/dashboard" });
    assert.equal(dashboard.status, 200);
    const dashboardHtml = dashboard.body.toString("utf8");
    assert.match(dashboardHtml, /样本量仅计算收到的 perf 事件，不等于 PV/);
    assert.match(dashboardHtml, /id="metric-availability"/);
    assert.match(dashboardHtml, /横线代表无实测值，不是页面刷新清空/);
    assert.match(dashboardHtml, /data\.overview\.logTypes\.perf \|\| 0/);
    assert.doesNotMatch(dashboardHtml, /iOS 上下文维度（独立于性能样本）/);
    assert.doesNotMatch(dashboardHtml, /id="pv-context-dimensions"/);
    assert.doesNotMatch(dashboardHtml, /id="native-context-dimensions"/);
    assert.match(dashboardHtml, /错误分布/);
    assert.doesNotMatch(
      dashboardHtml,
      /<h3>错误列表<\/h3>|id="error-issue-rows"/,
    );
    assert.match(dashboardHtml, /<h3>最近错误<\/h3>/);
    assert.match(dashboardHtml, /id="error-dimensions"/);
    assert.doesNotMatch(dashboardHtml, /card\('最近错误'|card\('原因未上报'/);
    assert.match(
      dashboardHtml,
      /\.dist-row\{grid-template-columns:minmax\(0,1fr\) auto;gap:12px;margin:7px 0;padding:10px 12px;background:#eef5ff\}/,
    );
    assert.match(
      dashboardHtml,
      /#userPerception \.dimension-panel\{min-height:0;padding:15px;border:1px solid #e9edf3\}/,
    );
    assert.match(
      dashboardHtml,
      /\.perception-samples \.dist-row\{grid-template-columns:90px minmax\(0,1fr\) 100px;gap:8px;margin:16px 0;padding:0;background:transparent\}/,
    );
    assert.match(
      dashboardHtml,
      /\.metric-dim-row\{grid-template-columns:minmax\(0,1fr\) auto;gap:4px 12px;margin:4px 0;padding:6px 12px;background:#eef5ff\}/,
    );

    const thresholded = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?date=2026-01-01&slowThresholdMs=1500",
    });
    assert.equal(thresholded.status, 200);
    assert.equal(
      JSON.parse(thresholded.body.toString("utf8")).slowLoading.thresholdMs,
      1500,
    );

    const invalid = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?date=2026-02-30",
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(JSON.parse(invalid.body.toString("utf8")), {
      error: "date must be YYYY-MM-DD",
    });

    const invalidThreshold = await handle({
      method: "GET",
      url: "/__sink/api/dashboard?slowThresholdMs=20",
    });
    assert.equal(invalidThreshold.status, 400);
    assert.match(
      JSON.parse(invalidThreshold.body.toString("utf8")).error,
      /slowThresholdMs/,
    );
  });
});

test("built envelopes from this package are accepted end to end", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const raw = Buffer.from('{"x":1}', "utf8");
    const entity = deflateSync(raw, { level: -1 });
    const signature = createHash("md5").update(entity).digest("hex");
    const guid = "b".repeat(32);
    const checksum = createHash("md5")
      .update(`${signature}1${1766195800}${raw.length}${guid}`)
      .digest("hex");
    const buffer = buildEnvelope({
      version: "V1.1",
      address: "appkey",
      signature,
      serialNum: 1,
      tsSecs: 1766195800,
      length: raw.length,
      entity,
      guid,
      checksum,
      codex: 1,
    });

    const response = await post(handle, "/unify_logs", buffer);
    assert.equal(response.status, 200);
    const events = await readArchive(store, dataDir, "ios-analytics");
    assert.deepEqual(events[0].entity.json, { x: 1 });
    assert.equal(events[0].integrity.checksumMatches, true);
  });
});

test("iOS context endpoint archives valid context documents and rejects malformed ones", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const context = {
      schema: "ios-context-v1",
      projectId: "gslearnwhat",
      contextId: "context-0001",
      device: {
        model: "iPhone",
        modelIdentifier: "iPhone12,8",
        os: "iOS",
        osVersion: "18.2",
      },
      app: { version: "1.2.3", build: "123" },
      network: { type: "wifi", carrier: "China Mobile" },
      region: { country: "CN", timezone: "Asia/Shanghai" },
    };
    const response = await post(
      handle,
      "/__sink/api/ios-context",
      JSON.stringify(context),
      {
        "content-type": "application/json",
      },
    );
    assert.equal(response.status, 200);
    const responseBody = JSON.parse(response.body.toString("utf8"));
    assert.equal(responseBody.ok, true);
    assert.equal(responseBody.contextId, context.contextId);
    assert.equal(typeof responseBody.receivedAt, "string");

    const events = await readArchive(store, dataDir, "ios-context");
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "ios-context");
    assert.deepEqual(events[0].context, context);

    const malformed = await post(
      handle,
      "/__sink/api/ios-context",
      Buffer.from("{"),
      {
        "content-type": "application/json",
      },
    );
    assert.equal(malformed.status, 400);
    assert.equal(
      JSON.parse(malformed.body.toString("utf8")).error,
      "body must be a JSON object",
    );

    const missingId = await post(
      handle,
      "/__sink/api/ios-context",
      JSON.stringify({ schema: "ios-context-v1" }),
      {
        "content-type": "application/json",
      },
    );
    assert.equal(missingId.status, 400);
    assert.equal(
      JSON.parse(missingId.body.toString("utf8")).error,
      "contextId must contain at least 8 characters",
    );
    assert.equal((await readArchive(store, dataDir, "ios-context")).length, 1);
  });
});

test("embedded navigation archives observed load timing and joins matching iOS context", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const uid = "A".repeat(32);
    const context = {
      schema: "ios-context-v1",
      contextId: uid,
      device: { model: "iPhone", os: "iOS", osVersion: "18" },
    };
    assert.equal(
      (await post(handle, "/__sink/api/ios-context", JSON.stringify(context)))
        .status,
      200,
    );
    const report = {
      schema: "h5-navigation-v1",
      uid,
      page: "http://10.16.110.118:5173/bx-app-h5/learningIndex",
      viewport: "390x844",
      metrics: { total: 1328.5, firstbyte: 250.1, dns: 0 },
    };
    const preflight = await handle({
      method: "OPTIONS",
      url: "/__sink/api/h5-navigation",
      body: Buffer.alloc(0),
    });
    assert.equal(preflight.status, 204);
    const response = await post(
      handle,
      "/__sink/api/h5-navigation",
      JSON.stringify(report),
      { "content-type": "application/json" },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
    const events = await readArchive(store, dataDir, "h5-navigation");
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "embedded-navigation-timing");
    assert.equal(events[0].parsed.header.uid, uid);
    assert.equal(events[0].parsed.logs[0].log.total, 1329);
    assert.equal(events[0].parsed.logs[0].log.fcp, undefined);
    assert.equal(events[0].parsed.logs[0].common.ctime, undefined);
    assert.equal(events[0].clientAt, null);
    const dashboard = await handle({
      method: "GET",
      url: "/__sink/api/dashboard",
    });
    assert.equal(dashboard.status, 200);
    const aggregate = JSON.parse(dashboard.body);
    assert.equal(aggregate.userPerception.navigationFallbackSamples, 1);
    assert.equal(aggregate.userPerception.contextCoverage.exact, 1);
    assert.equal(aggregate.overview.pageViews, 0);
    assert.equal(aggregate.performance.pageLoad.count, 1);
    assert.equal(aggregate.userPerception.pages[0].sampleCount, 1);
    assert.equal(aggregate.performance.fcp.count, 0);
    const timed = await post(
      handle,
      "/__sink/api/h5-navigation",
      JSON.stringify({ ...report, clientAt: Date.now() - 1000 }),
    );
    assert.equal(timed.status, 200);
    const windowEnd = new Date(Date.now() + 1000).toISOString();
    const windowStart = new Date(Date.now() - 60000).toISOString();
    const timedView = await handle({
      method: "GET",
      url:
        "/__sink/api/dashboard?from=" +
        encodeURIComponent(windowStart) +
        "&to=" +
        encodeURIComponent(windowEnd) +
        "&timeField=clientAt",
    });
    assert.equal(JSON.parse(timedView.body).performance.pageLoad.count, 1);
    assert.equal(
      JSON.parse(timedView.body).clientTimeCoverage.missingOrSkewed,
      1,
    );
    assert.equal(
      (
        await post(
          handle,
          "/__sink/api/h5-navigation",
          JSON.stringify({ ...report, clientAt: "yesterday" }),
        )
      ).status,
      400,
    );
  });
});

test("embedded navigation rejects malformed or fabricated timing without creating samples", async () => {
  await withHandler(async ({ handle, store }) => {
    const valid = {
      schema: "h5-navigation-v1",
      uid: "A".repeat(32),
      page: "http://local.test/page",
      metrics: { total: 123 },
    };
    const invalid = [
      "{",
      "[]",
      { ...valid, uid: "not-a-uuid" },
      { ...valid, page: "file:///private/page" },
      { ...valid, metrics: {} },
      { ...valid, metrics: { total: 0 } },
      { ...valid, metrics: { total: -1 } },
      { ...valid, metrics: { total: "123" } },
      { ...valid, metrics: { total: 123, fcp: "999" } },
      { ...valid, metrics: { total: 123, fcp: 600001 } },
    ];
    for (const value of invalid) {
      const result = await post(
        handle,
        "/__sink/api/h5-navigation",
        typeof value === "string" ? value : JSON.stringify(value),
      );
      assert.equal(result.status, 400, JSON.stringify(value));
    }
    assert.equal(store.recent({ channel: "h5-navigation" }).length, 0);
  });
});

test("removed navigation diagnostic route returns 404 without a perf sample", async () => {
  await withHandler(async ({ handle, store }) => {
    const response = await post(
      handle,
      "/__sink/api/h5-navigation-diagnostic",
      "{}",
    );
    assert.equal(response.status, 404);
    assert.equal(store.recent({ channel: "h5-navigation" }).length, 0);
  });
});

test("new identities are archived; legacy identities remain absent", async () => {
  await withHandler(async ({ handle, store, dataDir }) => {
    const uid = "C".repeat(32);
    const scope = {
      projectId: "learn-project",
      appId: "com.example.learn",
      environment: "test",
      sessionId: "D".repeat(32),
      navigationId: "E".repeat(32),
    };
    const ios = { schema: "ios-context-v1", contextId: uid, ...scope };
    const report = {
      schema: "h5-navigation-v1",
      uid,
      page: "https://example.org/learn",
      metrics: { total: 100 },
      ...scope,
      contextId: uid,
    };
    assert.equal(
      (await post(handle, "/__sink/api/ios-context", JSON.stringify(ios)))
        .status,
      200,
    );
    assert.equal(
      (await post(handle, "/__sink/api/h5-navigation", JSON.stringify(report)))
        .status,
      200,
    );
    const [iosEvent] = await readArchive(store, dataDir, "ios-context");
    const [h5Event] = await readArchive(store, dataDir, "h5-navigation");
    for (const key of [
      "projectId",
      "appId",
      "environment",
      "sessionId",
      "navigationId",
    ]) {
      assert.equal(iosEvent.context[key], scope[key]);
      assert.equal(h5Event[key], scope[key]);
    }
    assert.equal(h5Event.contextId, uid);
    assert.equal(h5Event.parsed.header.pid, scope.projectId);
    assert.equal(h5Event.parsed.header.sid, scope.sessionId);
    const legacy = {
      schema: "h5-navigation-v1",
      uid: "F".repeat(32),
      page: report.page,
      metrics: report.metrics,
    };
    assert.equal(
      (await post(handle, "/__sink/api/h5-navigation", JSON.stringify(legacy)))
        .status,
      200,
    );
    assert.equal(
      (
        await post(
          handle,
          "/__sink/api/ios-context",
          JSON.stringify({
            schema: "ios-context-v1",
            contextId: legacy.uid,
          }),
        )
      ).status,
      200,
    );
    const archivedH5 = await readArchive(store, dataDir, "h5-navigation");
    const archivedIOS = await readArchive(store, dataDir, "ios-context");
    for (const field of [
      "projectId",
      "appId",
      "environment",
      "contextId",
      "sessionId",
      "navigationId",
    ]) {
      assert.equal(Object.hasOwn(archivedH5[1], field), false, field);
      if (field !== "contextId")
        assert.equal(
          Object.hasOwn(archivedIOS[1].context, field),
          false,
          field,
        );
    }
    assert.equal(Object.hasOwn(archivedH5[1].parsed.header, "pid"), false);
    assert.equal(Object.hasOwn(archivedH5[1].parsed.header, "sid"), false);
  });
});

test("invalid optional identities are rejected before archiving", async () => {
  await withHandler(async ({ handle, store }) => {
    const uid = "C".repeat(32);
    const report = {
      schema: "h5-navigation-v1",
      uid,
      page: "https://example.org/learn",
      metrics: { total: 100 },
    };
    const ios = { schema: "ios-context-v1", contextId: uid };
    for (const field of [
      "projectId",
      "appId",
      "environment",
      "sessionId",
      "navigationId",
    ]) {
      for (const bad of [null, "", 12, "bad /scope", "x".repeat(257)]) {
        assert.equal(
          (
            await post(
              handle,
              "/__sink/api/h5-navigation",
              JSON.stringify({ ...report, [field]: bad }),
            )
          ).status,
          400,
          field,
        );
        assert.equal(
          (
            await post(
              handle,
              "/__sink/api/ios-context",
              JSON.stringify({ ...ios, [field]: bad }),
            )
          ).status,
          400,
          field,
        );
      }
    }
    assert.equal(
      (
        await post(
          handle,
          "/__sink/api/h5-navigation",
          JSON.stringify({ ...report, contextId: "D".repeat(32) }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          handle,
          "/__sink/api/h5-navigation",
          JSON.stringify({ ...report, contextId: null }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          handle,
          "/__sink/api/ios-context",
          JSON.stringify({ ...ios, contextId: "invalid\ncontext" }),
        )
      ).status,
      400,
    );
    assert.equal(store.recent({ channel: "h5-navigation" }).length, 0);
    assert.equal(store.recent({ channel: "ios-context" }).length, 0);
  });
});
