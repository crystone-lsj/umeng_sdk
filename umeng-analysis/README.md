# Umeng analysis and compatible outputs

## Run REA

This repository pins Node.js in `.nvmrc`. From a shell with the pinned Node first on PATH:

```bash
node scripts/rea.mjs --help
```

The completed static analysis evidence is retained under `evidence/`. Final integration outputs are deliberately separate from raw evidence:

- H5 sampled adapter: [../outputs/axx-umeng-compatible-h5](../outputs/axx-umeng-compatible-h5)
- iOS sampled adapter: [../outputs/axx-umeng-compatible-ios](../outputs/axx-umeng-compatible-ios)
- delivery adapters for the two real apps: [../outputs/axx-umeng-delivery](../outputs/axx-umeng-delivery)
- self-hosted receiver: [../outputs/umeng-sink](../outputs/umeng-sink)

Protocol write-ups:

- H5: [h5-protocol.md](h5-protocol.md) — why the old adapter dropped 100% of records client-side,
  why a native UAPM bridge silently drops non-perf batches, and the verified fix.
- iOS: [ios-protocol.md](ios-protocol.md)

Root-cause summary: the H5 adapter injected `sampleConfig:{enable:false,sampleRate:1}` (official
`sampleRate` is 0–100), so nothing left the WebView; the self-hosted receiver also needs
`dsn` (H5) and `AXXUmengSampledConfiguration.domain` (iOS) to be set.

Verification summary:

```bash
cd outputs/axx-umeng-compatible-h5 && npm run test
cd ../.. && outputs/axx-umeng-compatible-ios/scripts/syntax-check.sh
cd outputs/umeng-sink && node --test
node scripts/e2e-verify.mjs                       # needs local listen permission
node scripts/h5-gate-check.mjs --sdk <官方 uapm.esm.js>
```

Do not copy official SDK archives, framework binaries, or decompiled code into the output folders. Those outputs contain local adapter code only and depend on official packages at integration time.
