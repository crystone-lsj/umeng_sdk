# Evidence and boundaries

## Artifact identity

Analysis was limited to locally preserved official package artifacts and their public headers. No decompiled implementation was copied into this adapter.

| Component | Version | ZIP SHA-256 | Evidence ID |
| --- | ---: | --- | --- |
| UMCommon | 7.6.4 | `06c7949c6f08ec6aad2f8f5e6e406848403306f1a9fbe67657738c63b2de608f` | `ev_8a42801c5a9db2dd19644f0b4ff8157b7851dd3a654ae5267638c3f2e5c75fc5` |
| UMDevice | 3.6.0 | `d2cda7bec252a5a425cbf079589147854ca56afaa007adcc2c25f7ed8cbde04c` | `ev_c3fd768c1ece8219e29765e4fea3173e37a1c9093798a5e70042d7b9acc87bfd` |
| UMAPM | 2.0.7 | `1bb7c91ef7f08135b17808ecfbed2bd13d8aa20c4a861b62c1b6cf260321fed2` | `ev_118358c8c17885669e1e9ffbf08354540144f2b9f7fb6b8692dc799a1d8e1374` |

## Observed public APIs

From `UMConfigure.h`: `initWithAppkey:channel:`, `setLogEnabled:`, `setEncryptEnabled:`, `setAnalyticsEnabled:`, `setDomain:`, `enablePi:`, `setASAEnabled:`, and `setSKANEnabled:`.

From `MobClick.h`: custom event variants, paired duration events, manual page duration APIs, profile sign-in/sign-off, and user profile APIs.

From `UMAPMConfig.h`: `crashAndBlockMonitorEnable`, `launchMonitorEnable`, `memMonitorEnable`, `oomMonitorEnable`, `networkEnable`, `javaScriptBridgeEnable`, `pageMonitorEnable`, `logCollectEnable`, and block-heartbeat parameters.

From `UMCrashConfigure.h`: `setAPMConfig:`, `setAppVersion:buildVersion:`, `enableNetworkForProtocol:`, `reportExceptionWithName:reason:stackTrace:`, and `addCustomInfoKey:value:`. The observed stack-trace parameter is a nonnull `NSArray *`.

From `UMAPMCustomLog.h`, `UMLaunch.h`, and `UMPage.h`: custom log levels, launch phases, and native page begin/end APIs.

## Inference and implementation boundary

- The deterministic FNV-1a sampler is an adapter design choice, not an observed友盟内部实现。
- “只有 crash 和 block 都分桶命中才打开共用原生开关”是保守适配层策略，用于避免未采样功能被官方共用开关带开。
- Static header inspection does not establish real-device upload behavior, server acceptance, dashboard aggregation, or production crash/block rates.

## Unknowns

- Runtime behavior after calling public setters is not established by static evidence alone.
- Whether manual `reportExceptionWithName:...` is accepted when the shared native crash/block switch is disabled requires a real-provider test.
- Actual reported sampling ratios can differ from nominal rates because crash and other low-frequency events are naturally uneven; verification should count completed dashboard events over a fixed cohort.
