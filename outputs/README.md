# Umeng compatible outputs

| Target | Output | Verification | Runtime dependency |
| --- | --- | --- | --- |
| H5 JS SDK | [`axx-umeng-compatible-h5/`](axx-umeng-compatible-h5) | `cd axx-umeng-compatible-h5 && npm run test`：8/8 passed | `@umengfe/apm@2.0.11` |
| iOS SDK | [`axx-umeng-compatible-ios/`](axx-umeng-compatible-ios) | `axx-umeng-compatible-ios/scripts/syntax-check.sh`：passed; podspec parse：passed | UMCommon 7.6.4, UMDevice 3.6.0, UMAPM 2.0.7 |
| 交付版 H5 / iOS 适配层 | [`axx-umeng-delivery/`](axx-umeng-delivery) | H5 `node --test` 8/8；iOS `bash scripts/syntax-check.sh` | 同上 |
| 自建接收端 + H5 看板 | [`umeng-sink/`](umeng-sink) | `node --test` 49/49；`node scripts/e2e-verify.mjs` 31/31（需可监听本地端口） | 零运行时依赖（Node 内置模块） |
| 真实官方 H5 bundle 网关验证 | [`umeng-sink/scripts/h5-gate-check.mjs`](umeng-sink/scripts/h5-gate-check.mjs) | `node scripts/h5-gate-check.mjs --sdk <官方 uapm.esm.js>`：7/7 scenarios matched expectations（不监听端口） | `@umengfe/apm@2.0.11` 官方 dist |

两个目录只包含本地适配器源码、配置说明和验证脚本，不包含友盟 SDK 二进制、安装包或反编译代码。原始证据和官方包摘要保留在 [`../umeng-analysis/`](../umeng-analysis)。

实现边界：这些是官方 SDK 的采样适配层，不是重写友盟私有协议的替代 SDK。H5 的 FCP 独立开关和 iOS crash/block 共用开关的限制见各自 `CONFIG.md` 与 `EVIDENCE.md`。
