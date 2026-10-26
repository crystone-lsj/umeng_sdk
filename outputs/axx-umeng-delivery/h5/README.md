# Umeng H5 sampled adapter

这是一个针对官方 `@umengfe/apm@2.0.11` 的采样接入适配器。它保留友盟 H5 APM 的公共监控入口，
把官方 SDK 的全部采样闸门打开（官方 `sampleRate` 为 0–100 量纲），改由适配器提供可运行时调整的
逐功能采样策略；同时在初始化前移除原生 `UAPM_JSBridge` / `UAPM_JSB_CONFIG`，避免 2.0.11 桥路径
丢弃非 perf 批次。

本包不复制、不分发友盟反编译代码，也不实现未公开的服务端协议；运行时仍依赖官方 npm 包。

## 安装

```bash
npm install @umengfe/apm@2.0.11
# 将本目录作为本地包或直接复制到项目中
```

## 快速接入

```js
import { initAXXUmengSampled } from './axx-umeng-compatible-h5/src/index.js';

const umeng = await initAXXUmengSampled({
  salt: 'your-stable-app-salt',
  rates: {
    pv: 0.2,
    api: 0.1,
    error: 1,
    perf: 0.05,
    perf_fcp: 0.05,
    perf_fid: 0.1,
    blank: 0.02
  },
        config: {
          pid: 'your-umeng-pid',
          dsn: 'your-umeng-dsn',
          environment: 'production',
          release: '1.0.0',
          blankConfig: {
            blank_target: 'body',
            blank_timeout: 3000,
            X: 0.9,
            Y: 0.9
          },
          xhrConfig: { enableReqBody: false },
          fetchConfig: { enableReqBody: false }
        }
});

umeng.setSamplingRates({
  pv: 0.35,
  api: 0.25,
  error: 1
});
```

如果不希望适配器自己 `import('@umengfe/apm')`，也可以先拿到官方模块：

```js
import * as apm from '@umengfe/apm';
import { createAXXUmengSampledAdapter } from './axx-umeng-compatible-h5/src/index.js';

const adapter = createAXXUmengSampledAdapter({ sdk: apm, rates: { api: 0.2 } });
adapter.init({ pid: 'your-umeng-pid' });
```

`@umengfe/apm` 的公共类型将 `blankConfig`、`xhrConfig`、`fetchConfig` 声明为非可选字段。生产接入时请按官方文档提供这些字段。

已包装的手动 API：

- `captureException(error, { force })`
- `sendApiLog(args, { force })`

`force: true` 用于关键错误或关键 API 的强制上报，绕过采样但不会改变当前采样率。

## 上报到自建接收端

```js
config: {
  pid: 'your-umeng-pid',
  dsn: 'https://your-sink.example.com'   // 见 outputs/umeng-sink
}
```

适配器会自动注入正确的 `sampleConfig` 并禁用原生桥；只需把 `dsn` 指向自建接收端。

## 采样语义

| 功能 | 官方入口 | 采样时机 | 运行时改率效果 |
| --- | --- | --- | --- |
| API | `hookFetch` / `hookXHR` / `sendAPILog` | 请求/事件级 | 后续事件生效 |
| PV | `pageFilter` | 页面/事件级（best effort） | 后续事件生效 |
| JS error | `enableCatchJSError` / `captureException` | 错误/事件级 | 后续错误生效 |
| Performance | `enablePerformance` | SDK 初始化会话级 | 下一次 `init()` 生效 |
| FID | `enableFID` | SDK 初始化会话级 | 下一次 `init()` 生效 |
| Blank screen | `enableBlankScreen` | SDK 初始化会话级 | 下一次 `init()` 生效 |

稳定性采样使用 FNV-1a 哈希分桶。同一个功能、主体和 `salt` 在同一浏览器中的决定稳定；不同功能之间独立。`salt` 不要使用用户隐私数据。

## 运行测试

```bash
npm run test
```

测试只使用 Node.js 内置 `node:test`，不需要安装依赖。
