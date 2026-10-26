# Evidence and boundaries

Analysis target: `@umengfe/apm@2.0.11`.

## Observations

- REA Evidence ID: `ev_ab2100826cb4e422b7cb0d6bc1f558a96459d35c98b70cc47c2813ac32540a45`.
- npm tarball SHA-256: `a56f201932055713e666c746096d32b63ef6ace50126b39070b871bf20c90050`.
- REA analyzed the extracted package directory SHA-256 `711b5efa980512373b909ae525d8ac291446a9bb286ddf5cfbd16bc2e0a4e8d2`.
- Public exports observed in `preview/src/index.d.ts`: `init`, `captureException`, `sendAPILog`, `setUserConfig`, `client`.
- Public `initParams` observed in `preview/src/config.d.ts` include `pid`, `dsn`, `pageFilter`, `errorFilter`, `apiFilter`, `hookFetch`, `hookXHR`, `enableCatchJSError`, `enablePerformance`, `enableFID`, `enableBlankScreen`, `enableRemoteConfig`, and `sampleConfig`.
- Sampling type keys observed in `preview/src/sampling.d.ts`: `api`, `pv`, `error`, `perf`, `perf_fcp`, `perf_fid`, `blank`.
- Real-bundle execution (`umeng-sink/scripts/h5-gate-check.mjs`, official
  `uapm.esm.js` SHA-256 `d2e1298c882e00d3a98e7e1415d6358c7f1ff5bc3d210d189992d17d5f17256c`):
  - the previous adapter config (`sample: 1`, `sampleConfig: { enable: false, sampleRate: 1 }`)
    delivered 0 of 3 records (all dropped client-side as "数据未被采样");
  - a fully opened `sampleConfig` delivered pv+api via POST and error via beacon;
  - with a native bridge reporting `sampleResult: "Y"` and `sample: 100`, the
    non-perf batch produced **0 HTTP requests and 0 bridge calls** even though
    the SDK logged "数据采集成功";
  - with the fixed adapter plus a hostile bridge (`sampleResult: "N"`), the
    adapter removed the bridge globals and delivered all records over HTTP.

## Inferences and design choices

- The adapter opens every official sampling gate (0-100 scale, global plus the
  three `rules` entries) and applies its own feature-level policy. This is an
  integration design choice, not a claim about every internal SDK code path.
- `disableNativeBridge` defaults to true because 2.0.11's bridge path only
  forwards batches starting with `perf|`; api/error/pv batches are silently
  dropped after a success log.
- FNV-1a bucketing is an adapter implementation choice chosen for deterministic, dependency-free browser behavior.
- Event-level gating is exact for the manually wrapped `captureException` and `sendAPILog` calls.

## Unknowns and limitations

- The public type definition does not expose an independent FCP initialization switch, so `perf_fcp` is retained as policy but cannot currently be guaranteed independently of `perf`.
- The public `pageFilter` rule receives page and data arguments, but the public typings do not define the complete log-data shape. PV runtime gating is therefore best effort and falls open for unidentified log shapes to avoid overblocking unrelated features.
- The gate check executes the official bundle in a browser shim and feeds the
  receiver's router directly; it does not cover a real WKWebView with the
  UMAPM 2.0.7 native bridge injected by the app. That combination still needs
  on-device verification.
- This package intentionally contains no decompiled Umeng source and no reproduced private protocol payload.
