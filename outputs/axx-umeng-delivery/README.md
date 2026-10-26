# AXX 友盟兼容 SDK 交付目录

这一目录是「AXX 前缀」自研采样网关 SDK 的交付产物，以及它接入两个真实业务项目时
所留下的改动说明。AXX 建在友盟官方 SDK 的**公共 API** 之上：官方组件仍是传输与
统计后端，AXX 负责逐功能采样决策、屏蔽官方全局采样开关、关闭远端采样配置。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `ios/` | iOS 端 SDK 源码（CocoaPods 本地 pod `AXXUmengSampled` 1.0.0）、`CONFIG.md`、`EVIDENCE.md`、`scripts/syntax-check.sh` |
| `ios/build/libAXXUmengSampled.a` | 真机 Debug 构建产出的静态库（arm64） |
| `h5/` | H5 端 SDK 源码 `axx-umeng-h5-sampled` 1.0.0（`src/` + `dist/axx-umeng-sampled.esm.js`）、`CONFIG.md`、`EVIDENCE.md`、单元测试 |
| `apply-integration.py` | 把 AXX SDK 复制进目标工程并改写初始化入口的幂等脚本 |

两个 SDK 都不包含友盟反编译代码、也不包含友盟二进制；官方包摘要与分析证据保留在
`/Users/mac/REA/rea/umeng-analysis/`。

## 采样率模型

所有功能默认 `1.0`（全量采集），可在运行时按功能独立调整，两端语义一致：

- iOS：`AXXUmengSampledConfiguration.samplingRates`，13 个 feature key（`AXXSampledFeatureEvent`、
  `PageView`、`Crash`、`Block`、`Launch`、`Memory`、`OOM`、`Network`、`H5Bridge`、`PageMonitor`、
  `LogCollect`、`CustomLog`、`UserProfile`）。分桶用 FNV-1a + salt，同一设备/主体决策稳定。
- H5：`initAXXUmengSampled({ salt, rates, config })`，7 个 key（`api`、`pv`、`error`、`perf`、
  `perf_fcp`、`perf_fid`、`blank`）。

两端都会**强制覆盖**官方 SDK 自己的采样开关，避免双重采样：

- H5：`sampleConfig` 全开（全局与 `api` / `error` / `perf` 三条规则均为
  `{ enable: true, sampleRate: 100 }`，官方 `sampleRate` 是 0–100 量纲），
  `enableRemoteConfig: false`，并在 `init()` 前移除原生 `UAPM_JSBridge` /
  `UAPM_JSB_CONFIG` 探测变量，避免 2.0.11 的桥路径丢弃非 perf 批次。
- iOS：官方初始化仍由 AXX 调用，采样决策在 AXX 内完成，远端采样配置不生效。

超范围或非法 rate 一律 fail closed 到 `0`；布尔值归一化为 `1` / `0`。

## 验证

```bash
# H5 SDK 单元测试：8/8 passed
cd h5 && node --test

# 真实官方 bundle 网关验证：7/7 scenarios matched expectations
cd ../umeng-sink && node scripts/h5-gate-check.mjs --sdk <官方 uapm.esm.js 路径>

# iOS SDK 语法检查（对照官方 7.6.4 头文件；仓库内可用下方 UMCOMMON_/UMAPM_ 覆盖路径）
cd ios && bash scripts/syntax-check.sh
```

目标工程侧的构建验证见 `/Users/mac/REA/rea/outputs/integration-gslearnwhat-bx-app-h5/README.md`。
