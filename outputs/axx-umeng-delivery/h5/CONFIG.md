# Configuration

## Sampling rates

| Key | Default | Boundary | Runtime behavior |
| --- | ---: | --- | --- |
| `api` | `1` | `0..1` | 后续 API 事件生效 |
| `pv` | `1` | `0..1` | 后续可识别 PV 事件生效 |
| `error` | `1` | `0..1` | 后续 JS 错误生效 |
| `perf` | `1` | `0..1` | 下一次 `init()` 生效 |
| `perf_fcp` | `1` | `0..1` | 策略会保留；官方公共初始化参数未暴露独立 FCP 开关，运行时未知 |
| `perf_fid` | `1` | `0..1` | 下一次 `init()` 生效 |
| `blank` | `1` | `0..1` | 下一次 `init()` 生效 |

布尔值会转换为 `1` / `0`。超过边界的数字会被截断到 `0..1`；非法值 fail closed 为 `0`。

## Options

- `salt`: 稳定分桶盐值。更改盐值会重新分配设备/主体桶。
- `rates` / `samplingRates`: 初始采样率。
- `moduleId`: 默认 `"@umengfe/apm"`，仅在未显式传 `sdk` 时用于动态导入。
- `sdk`: 已导入的官方模块，适合测试、打包器特殊配置或 CSP 限制动态导入的页面。
- `config`: 完整透传给 `@umengfe/apm.init()` 的配置。

适配器强制覆盖以下三项，避免双重采样：

```js
{
  sampleConfig: {
    enable: true,
    sampleRate: 100,             // 官方量纲是 0–100，不是 0–1
    rules: {
      api:   { enable: true, sampleRate: 100 },
      error: { enable: true, sampleRate: 100 },
      perf:  { enable: true, sampleRate: 100 }
    }
  },
  enableRemoteConfig: false
}
```

用户传入的 `pageFilter`、`errorFilter`、`apiFilter` 仍然先生效；通过后才会进入采样网关。
传入的 `sample` 会被丢弃：官方 SDK 只从原生桥读取它，不读 `init()` 配置。

## 原生桥

`init({ disableNativeBridge })` 默认 `true`。适配器会在调用官方 `init()` 之前删除
`window.UAPM_JSB_CONFIG` 与 `window.UAPM_JSBridge`，原因：

1. 官方 2.0.11 的批次级闸门会把 `sampleResult === "N"` 或 `pkgList` 不匹配的整批数据丢掉；
2. 即使闸门放行，`On()` 也只会把以 `perf|` 开头的批次转发给原生桥，`api` / `error` / `pv`
   批次会打印「数据采集成功」但**不会发送到任何通道**。

删除探测变量后，SDK 回到 HTTP `dsn` 通道，直接上报到自建接收端。确需保留桥时显式传
`disableNativeBridge: false`，此时必须自行保证原生侧 `sampleResult !== "N"` 且只期待 perf 数据。
