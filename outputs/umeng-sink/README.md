# umeng-sink —— 友盟上报数据的自建接收端

按 [umeng-analysis/ios-protocol.md](../../umeng-analysis/ios-protocol.md) 与
[h5-protocol.md](../../umeng-analysis/h5-protocol.md) 还原出的线协议，保留自建 H5 APM 接收端与历史看板聚合。
目前 CLI 默认将看板接到测试环境 ELK：H5 数据通过 iOS 上报到 ELK，看板不使用本地归档。
原接收端和本地/SLS 聚合仅保留为历史功能（显式设置 `UMENG_SINK_DASHBOARD_SOURCE=local` 才启用）。

默认本地模式只用 Node 内置模块；启用 SLS 官方适配器时，服务端另外安装 `@alicloud/log`（见下方配置）。

## 快速开始

以下命令只启动服务；查看测试环境看板前，请先按文末“ELK 只读查询”配置地址和凭据。

```bash
cd outputs/umeng-sink
node src/cli.js --port 8787 --data-dir ./data
# 或
UMENG_SINK_PORT=8787 UMENG_SINK_DATA_DIR=./data npm start
```

| 参数 | 环境变量 | 默认值 |
| --- | --- | --- |
| `--port` | `UMENG_SINK_PORT` | `8787` |
| `--host` | `UMENG_SINK_HOST` | `127.0.0.1`（对外暴露用 `0.0.0.0`） |
| `--data-dir` | `UMENG_SINK_DATA_DIR` | `./data` |
| `--base-path` | `UMENG_SINK_BASE_PATH` | 无（如 `/umeng`，用于挂在网关子路径下） |
| `--quiet` | `UMENG_SINK_QUIET=1` | 打印每次请求 |

服务启动后打开：<http://127.0.0.1:8787/>（等价路径 `/__sink/dashboard`）。

看板为**零依赖单页应用**，用户感知页面采用与友盟 APM 相近的区域布局，不复刻友盟品牌、视觉资产或前端代码。当前包含：

- 用户感知：FP、FCP、TTI、1 秒快开比、2 秒快开比、5 秒慢开比、趋势、样本分布与页面指标；
- 加载性能：unload、redirect、appcache、DNS、TCP、SSL、TTFB、传输、DOM、ready、load、total 等 Navigation Timing 阶段；
- 慢加载：按 `total`（缺失时回退 `load`）与可切换阈值统计慢加载次数、慢加载率、受影响页面/用户；用户数仅按超阈值样本的 uid 去重；
- 总览：PV / UV / 会话 / JS 错误 / API 成功率与 24 小时趋势；
- 页面列表：按页面路径折叠查询参数后统计 PV、UV、错误、API 与耗时；
- API 监控：按接口路径统计请求数、失败数、成功率、平均耗时、P50 / P95；
- 错误分析：按全部已读取事件计算错误趋势、受影响访客、独立问题数、类型/阶段/原因/资源/HTTP 状态码与页面分布、高频问题和每个问题的受影响访客数；最近 200 条展示消息、位置及堆栈。未上报的错误维度标为“未上报”；时间按浏览器本地时区显示，服务端仍按 UTC 查询。这里只统计已有的页面错误，不把它等同于友盟卡顿事件或官网私有指标。
- 性能采样：FCP、FID、页面加载的样本数与分位数。

上述三个页面参考了友盟 APM `u-apm/3.1.13` 页面分析前端静态资源的指标、分组和表格列；REA 静态分析证据 ID 为 `ev_0557221ae56230b86d603bc2db6a25e0d70dd9dfe2c4dc60638de6a5e02ada66`（REA 分析目录 SHA-256 `27d3c884473ff763e66a4078852922cc9847c3537f31b1e66bfe3a27943d310f`；其中 `18.chunk.js` SHA-256 `fee812059446af5d79ebce4897e1af36e4f84593046b16bf1a8769a042b866b8`）。静态前端只能证明页面字段和接口用法，无法证明官方服务端的计算口径；本项目使用独立实现，未复制官方代码或视觉资产。快慢开样本分档（≤2 秒、2–5 秒、>5 秒）为本地定义，不保证与官方口径一致。缺失的 FP、FCP、TTI 或阶段数据保持空白，不补造数值。

用户感知的整体指标与指标列表各有独立的平均值、P50、P90、P95 切换；点击六张指标卡会同时切换趋势和有来源的维度 TOP5 指标。各维度的时长只聚合自身关联的 `perf` 测量值，比例仅由该维度带 `total`/`load` 的样本计算，缺失保持“—”；`perf_fcp` 不混入这些维度的 `perf` 样本。列表支持 Host/页面搜索、10 条分页和 CSV 导出；筛选仅影响列表，不重算整体指标。时间选择目前为单个 UTC 归档日，不支持官网的跨日范围或其他未采集条件。加载性能支持平均值、P50、P90、P95 口径切换。H5 自带的屏幕尺寸、视口、release 与 environment 若存在会进入维度分布；iOS 应用版本来自独立 Reporter 上下文。
iOS 上下文通过 `contextId == H5 uid` 精确关联后，可补齐机型、操作系统、App 版本、网络类型、运营商与地域；
当天只有一个 iOS 上下文时可回退套用该上下文。无上下文时仅使用 H5 自带网络类型，其余维度保持“暂无数据”，不做推测填充。

用户感知页面另设两个**互不混入 perf 样本**的真实 iOS 维度分布：按匹配 H5 PV uid 去重的上下文，以及按 contextId 去重的全部 Reporter 上下文。历史 perf 与当日新 iOS 上下文不匹配时，性能样本维度仍显示空值；运营商未采集时也保持空。

看板默认读取最新有归档的 UTC 日期，也可以在用户感知筛选区的日期选择器切换。页面可见时每 15 秒自动刷新，重新显示时立即刷新；“样本量”只计 `perf` 性能事件，不随 PV、API、错误或 iOS 快照增长。顶部会分别显示 PV、性能样本和 iOS 快照，并提示最近一次性能采样时间。修改接收端 JS 后需重启 Node 服务，再刷新浏览器标签页。数据 API 为
`GET /__sink/api/dashboard?date=YYYY-MM-DD&slowThresholdMs=5000`；缺省慢加载阈值为 5000 ms，日期无效返回 400，慢加载阈值允许 100-20000 ms。图片兜底通道目前只作为原始证据归档，
不计入上述指标，避免与主上报/beacon 重复计数。

调试端点：

```bash
curl -s localhost:8787/__sink/health                    # {"ok":true,...,"dataDir":...}
curl -s localhost:8787/__sink/stats                     # 各 channel 计数与首末时间
curl -s 'localhost:8787/__sink/events?limit=20&channel=h5-logs'   # 最近记录（环缓冲，上限 500）
curl -s 'localhost:8787/__sink/api/dashboard?date=2026-10-15'     # 看板聚合 JSON
```

## 端点契约

| 端点 | 来源 | 响应 | 必须如此的原因 |
| --- | --- | --- | --- |
| `POST /unify_logs` | iOS UMCommon 分析埋点 | `200` + `application/thrift` + Thrift struct 字段 1 = int32 `1`（8 字节 `08 00 01 00 00 00 01 00`） | 客户端只在 **200 且 resp_code == 1** 时才算上传成功 |
| `POST /zcfg`、`POST /heartbeat` | iOS 配置/心跳 | 同上 | 同上 |
| `POST /apm_logs` | iOS UMAPM 性能日志 | `200` + `{"code":0,"msg":"ok"}` | — |
| `POST /upload`、`/api/crashsdk/validate`、`/api/crashsdk/logcollect` | iOS UMAPM 崩溃日志 | `200` + `{"code":0,"msg":"ok"}` | — |
| `GET /apm_cc` | iOS U-APM 云控 | `200` + `{}` | 空云控包：客户端回退本地默认，不下调采样率 |
| `POST /apm_web_logs` | H5 主上报通道 | `200` + `text/plain` | **只能 200**：405 会被客户端封禁 10 分钟、406 封禁 1 年、419 记为解密失败 |
| `POST /apm_web_ping` | H5 `sendBeacon` 通道 | 同上 | 同上 |
| `GET /apm_web_img.gif` | H5 图片兜底埋点 | `200` + 1×1 GIF | 否则图片加载失败 |
| `GET /apm_cc_web` | H5 云控 | `200` + `{}` | 同上 |
| `GET /`、`GET /__sink/dashboard` | 自建 H5 看板 | `200` + HTML | 本项目自有端点 |
| `GET /__sink/api/dashboard?date=YYYY-MM-DD` | 看板聚合 API | `200` + JSON；日期无效 `400` | 本项目自有端点 |
| `POST /__sink/api/ios-context` | iOS 进程级上下文副本 | `200` + JSON；JSON/`contextId` 无效返回 `400` | 本项目自有端点；用于关联并补齐 H5 维度，不承载、不重定向官方 iOS SDK 原生上报 |
| `POST /apm_img_upload` | H5 白屏截图 | `200` | 同上 |
| 其他 | — | `404` 并记入 `unknown` channel | 便于发现遗漏端点 |

Body 上限 16 MiB（超出 413，且不会先缓冲进内存）；单条原始报文归档上限 512 KiB（超出只截断归档副本，解析仍按完整 body 进行）。

## 接入方式

### iOS

原生友盟链路保持不变：不要设置 `AXXUmengSampledConfiguration.domain`，官方 iOS SDK 继续向友盟域名上报启动、崩溃、卡顿、内存、OOM、网络等数据。

如需补齐 H5 看板维度，另起 `AXXUmengContextReporter`：

```objc
[[AXXUmengContextReporter sharedReporter]
    startWithSinkURL:[NSURL URLWithString:@"http://10.16.110.118:8787"]
           projectId:@"gslearnwhat"];
```

该 reporter 会：

1. 为当前进程生成一次 `contextId`；
2. 通过 `POST /__sink/api/ios-context` 上报机型、系统、App 版本、屏幕、网络、运营商与地域，并附带独立的原生运行快照（进程常驻内存、内存警告累计数、网络变化、Reporter 运行时间、上报触发原因）；
3. 在调试摇一摇入口给 H5 URL 追加 `axx_ap_context=<contextId>`，H5 SDK 将其作为 `uid`；
4. 不 Hook、不拦截、不复制官方 iOS SDK 请求，也不改变其官方上报地址。

当前 App 仅在 **Debug 构建且用户已同意隐私协议** 后启动 Reporter；`context upload started` 在启动时即应出现，不需要等到摇一摇。若没有日志，检查真机运行包及 Xcode 控制台过滤器。Reporter 可在 iOS 14+ 的 MetricKit 回调收到延迟的崩溃/卡顿诊断**计数摘要**，只显示最新收到的诊断期，不加总可能重复送达的摘要；它不是友盟 SDK 原始报告，不能据此推断 OOM。官方 SDK 的完整崩溃、卡顿、OOM 记录仍仅在友盟官方平台查看，不得用进程内存或上次异常退出推断其值。看板“总览 → iOS 独立运行快照”单独展示已收到的原生快照，不混入 H5 性能统计。

### H5

`@umengfe/apm` 的 `dsn` 是公开配置项（`init({ dsn })` → `te()`）：

```js
await initAXXUmengSampled({
  salt: 'bx-app-h5.axx.umeng.v1',
  rates: { api: 1, pv: 1, error: 1, perf: 1, perf_fcp: 1, perf_fid: 1, blank: 1 },
  config: {
    dsn: 'http://127.0.0.1:8787',          // ← 指到自建接收端
    pkgList: ['com.student.learnwhat'],
    logLevel: 3
  }
});
```

⚠️ 仅改 dsn **不足以**让数据上来：官方 SDK 的客户端采样闸门会先把数据丢掉。
必须同时按 [h5-protocol.md §4](../../umeng-analysis/h5-protocol.md) 修正采样配置
（`sampleConfig.enable = true`、`sampleRate = 100`、三条 `rules` 均 100），
并保证原生桥给出的 `sampleResult !== "N"`、`sample >= 100`。

## 归档格式

每个 channel 每天一个文件：`<data-dir>/<channel>-YYYY-MM-DD.ndjson`，一行一个 JSON 文档，
坏行不会影响相邻证据，可直接 `jq` 或按行 `readline` 消费。

| channel | 内容 |
| --- | --- |
| `ios-analytics` | `/unify_logs`：Thrift 信封完整解码结果（保留兼容；当前 iOS 原生链路仍直发友盟） |
| `ios-config` | `/zcfg`、`/heartbeat`（保留兼容） |
| `ios-apm-logs` / `ios-apm-crash` / `ios-apm-config` | UMAPM `/apm_logs` / 崩溃 / 云控（保留兼容） |
| `ios-context` | iOS 进程级上下文副本，用于 H5 维度关联 |
| `h5-logs` / `h5-beacon` / `h5-image-ping` / `h5-remote-config` / `h5-screenshot` | H5 各通道 |
| `unknown` | 未匹配路径 |

`ios-analytics` 记录结构（其余 channel 为 `receivedAt`、`channel`、`method`、`url`、`headers` 加各自字段）：

```jsonc
{
  "receivedAt": "2026-10-15T06:00:00.000Z",
  "channel": "ios-analytics",
  "method": "POST",
  "url": "/unify_logs",
  "headers": { "contentType": "application/thrift", "msgType": "envelope/json",
               "umengSdk": "1", "smImp": "1", "umengUtc": "1766195800000", "userAgent": "..." },
  "bytes": 312,
  "envelope": { "version": "V1.1", "address": "<appkey>", "signature": "...", "serialNum": 7,
                "tsSecs": 1766195800, "length": 123, "guid": "...", "checksum": "...", "codex": 1,
                "unknownFieldIds": [] },
  "errors": [],
  "integrity": { "entityBytes": 112, "declaredLength": 123, "signatureExpected": "...",
                 "signatureMatches": true, "checksumExpected": "...", "checksumMatches": true,
                 "declaredLengthMatches": true },
  "entity": { "ok": true, "error": null, "json": { "header": { "...": "..." } } },
  "rawBody": { "encoding": "base64", "bytes": 312, "truncated": false, "data": "..." }
}
```

`integrity` 为 `null` 表示「无法评估」（缺字段），不是「校验失败」；
`entityText` 只在 entity 能解压但**不是** JSON 时出现。

`ios-context` 记录结构：

```jsonc
{
  "receivedAt": "2026-10-15T06:00:00.000Z",
  "channel": "ios-context",
  "context": {
    "schema": "ios-context-v1",
    "projectId": "gslearnwhat",
    "contextId": "00000000-0000-0000-0000-000000000000",
    "capturedAt": "2026-10-15T06:00:00.000Z",
    "device": { "model": "iPhone", "modelIdentifier": "iPhone12,8", "os": "iOS", "osVersion": "18.2" },
    "app": { "version": "1.2.3", "build": "123", "bundleIdentifier": "com.student.learnwhat" },
    "screen": { "width": 390, "height": 844, "scale": 3, "pixelWidth": 1170, "pixelHeight": 2532 },
    "network": { "type": "wifi", "carrier": "China Mobile" },
    "region": { "country": "CN", "language": "zh", "timezone": "Asia/Shanghai" }
  }
}
```

看板按 `context.contextId == H5 header.uid` 精确关联；只有一个上下文时才回退。地域当前来自设备 locale/timezone，不是 IP 归属地。

## 验证

```bash
cd outputs/umeng-sink
node --test                     # 61 个单元测试（路由、看板聚合、信封、H5 解码、分帧、归档），无需监听端口
node scripts/e2e-verify.mjs     # 31 项端到端检查（沙箱外运行）（含真实 socket 看板 API），需要绑定本地回环端口
```

`scripts/e2e-verify.mjs` 会真起 socket，覆盖：iOS 成功响应字节、自建信封往返（含签名/校验和/解压）、
H5 双 schema 解析、beacon 与图片通道分流、调试端点。沙箱环境下 `listen()` 会被拒绝
（`EPERM`），需在沙箱外运行。

## 已知边界

- 【推导】iOS 侧 `verifyResponseData:` / H5 侧 405/406/419 的行为来自二进制与 dist 反汇编，
  未与真实友盟服务端行为对照过。
- 【未知】`entity` 的加密路径（`codex != 1`、UMConfigure `setEncryptEnabled:YES`）未实现；
  若开启加密，本服务只归档原始字节，`entity` 无法解压。
- 【未知】H5 `enableScreenCrypt` 的截图分片上传（`apm_img_upload` 的多段 POST）只按整包归档。
- 【未知】`/apm_cc`、`/apm_cc_web` 返回空对象会让客户端使用本地默认配置；如果将来需要下发
  自定义采样率，需要在服务端按云控协议生成 `actions`。
- 【推导】看板的“会话/访客”分别使用 H5 报文中的 `sid` / `uid` 去重；API 成功率把数值型
  `rc` 为 2xx 视为成功。`h5-image-ping` 未纳入聚合，只保留原始证据。
- 【未知】同一日志若同时经主通道与 beacon 重试，当前归档没有幂等 ID，看板会按两条采样计数。

## 内嵌 H5 Navigation Timing 回退（自建，不是友盟官方 perf）

当页面 URL 带合法的 32 位 `axx_ap_context` 时，H5 在 `loadEventEnd` 可用后向
`POST /__sink/api/h5-navigation` 发送一次真实 Navigation Timing。自建端按
`h5-navigation-YYYY-MM-DD.ndjson` 独立归档，标记 `source: embedded-navigation-timing`，
在看板中计为一个 `perf` 加载样本，但不计为 PV；iOS 上下文仍按相同 UID 精确关联。
此内嵌导航禁用友盟 H5 SDK 的 `enablePerformance` 避免相同导航重复统计；普通浏览器页面继续沿用原 SDK。
FP/FCP 仅在浏览器实际给出 Paint Timing 时记录，TTI 未采集则保持空白；没有真实
`loadEventEnd` 时不产生回退样本。页面地址上报时去除查询参数和片段。
Legacy `PerformanceTiming` 中可选阶段起点为 0 表示未提供，例如 HTTP 页面没有 SSL 握手；
H5 适配器不会把 0 当作时间戳相减，避免生成超过接收端上限的伪造耗时。
原生 iOS SDK 的官方上报链路不受影响。

## 用户感知时间范围（2026-10-16）

官网登录页可见“过去1小时 / 过去48小时 / 今天 / 最近七天 / 更多（最近30/60/90天）”。
本地看板使用浏览器本地时区计算“今天”及最近 N 个自然日（包含今天），1 小时和 48 小时采用滚动窗口；向 API 传 UTC ISO `from`、`to`，按接收端 `receivedAt` 使用半开区间 `[from,to)` 过滤并跨 UTC 归档日聚合。每次切换都重新获取所有汇总与明细；自动刷新会重算相对窗口。UTC 5 分钟/小时/日趋势桶不会把跨日同一小时合并。单日归档查询继续用 `date=YYYY-MM-DD`，两种查询不可混用。区间最多容纳 90 个本地自然日（后端放宽至 91 个实际经过日以兼容夏令时，禁止任意更长请求）。缺失性能事件不拿 PV 补足。

**与官网的边界：** 下方新章节现已提供基于实际 `ctime` 的可选客户端发生时间视图、24 小时有界跨窗精确关联和本地同长窗口前周期对比。它们均非友盟服务端口径的复刻；官方私有采样、去重、分位和样本分桶仍未得到服务端证实，旧归档中没有的字段保持空白。REA 静态分析证据 `ev_0557221ae56230b86d603bc2db6a25e0d70dd9dfe2c4dc60638de6a5e02ada66` 来自官网前端脚本 `18.chunk.js`（SHA-256 `fee812059446af5d79ebce4897e1af36e4f84593046b16bf1a8769a042b866b8`），只佐证脚本结构；菜单文本由实际登录页面观察，不代表已验证官方后端逻辑。

## 客户端发生时间、跨窗关联与原生副本（2026-10-16）

时间筛选可切换 `timeField=receivedAt`（默认）或 `timeField=clientAt`。后者对 H5 线协议中逐条日志的 `common.ctime`，及新版独立 `h5-navigation` 回退的 `clientAt`（浏览器观测到的 load 完成时刻，Unix 毫秒）过滤并绘制趋势；需为安全整数且与接收时间相差不超过 24 小时。缺失、时间单位错误或偏差更大的日志不进入客户端时间视图，`clientTimeCoverage` 明示排除量。旧版导航回退归档没有该时刻，绝不把当年服务端伪造的 `ctime` 当作客户端时间。未做时钟校准，不等同友盟后台的“客户端发生时间”实现。

iOS 上下文最多回看当前查询窗口开始前 24 小时的归档，必须与 H5 `uid` 和 Reporter `contextId` 精确匹配；对带服务端时间的上下文还要求该快照接收时间不晚于 H5 记录且相差不超过 24 小时。窗口外上下文仅用于维度关联，**不计入本窗口的 iOS 快照/事件数量**，通过 `native.lookbackContexts` 单独显示。旧无时间戳归档只可在同一归档日内按既有兼容逻辑关联；不能跨日推定。单上下文回退仍是单独标识的推断来源，不能当作精确关联。原生指标卡分别显示 Reporter 的启动、前台、后台、网络变化和内存警告快照；iOS 14+ 且有系统延迟交付时，还会展示 MetricKit 最近诊断期的崩溃/卡顿计数（不是实时事件，不能跨重复交付求和）。这些都不是对友盟私有 APM 崩溃/卡顿/OOM 数据的拦截或镜像。

区间查询的“前一周期”取紧邻之前的**相同长度**窗口，以本地同样的采样集合和分位/快开算法重新聚合；无有效性能样本时显示“—”，而非 0。此对比**不是友盟私有服务端算法**。本地 H5 归档只反映实际已收到的样本，不施加友盟官方采样配置，也无法倒推出官方未上传的数据。官方原生 SDK 仍沿用原域名和配置；独立 Reporter 在 iOS 工程目前只于 `DEBUG` 启动，使用固定开发内网地址。发布到其他网络或 Release 前需单独配置可达且鉴权的第一方接收端。

证据与局限：`umeng-analysis/evidence/h5/rea-analysis.json`（REA Evidence `ev_ab2100826cb4e422b7cb0d6bc1f558a96459d35c98b70cc47c2813ac32540a45`）及 `umeng-analysis/h5-protocol.md` 的官方 H5 `ctime`/`sampling` 字段分析、`umeng-analysis/ios-protocol.md` 的原生二进制端点与封装分析；本次尝试用当前 REA CLI 重跑 H5 JS 静态分析时，其 macOS 进程所有权 helper 编译失败，故不把本次失败分析当作新增证据。官方服务端的采样、比较窗口与分桶算法仍未知；无权直接从官方二进制推断服务端口径。

### 用户感知维度筛选（本地实现）

`GET /__sink/api/dashboard` 接受 `dim.appVersion`、`dim.deviceModel`、`dim.osVersion`、`dim.carrier`、`dim.channel`、`dim.networkType`、`dim.region`、`dim.bundleIdentifier`、`dim.sdkVersion`；多个维度取交集，空值、未知键、超过 128 字符的值返回 400。API 的 `userPerception.filterOptions` 来自当前时间范围内、未筛选的真实 H5 `perf` 事件；无来源维度列表为空。`activeFilters` 回显当前条件。每个维度按钮提供“全部 XX”、本时间范围已收到的候选值和本地下拉搜索；当前按每个维度单选，多个维度之间取交集（官网 UI 的多选复选框样式不代表已复刻其服务端多选口径）。选择后重新请求聚合 API；筛选维度、时间范围、单日和客户端时间写入当前看板 URL 查询参数，整页刷新可恢复条件并重新从归档计算数据，保留页面 hash。没有收到的旧事件不会因刷新而生成。已选项在切换时间范围后暂无样本时仍保留并标明；“重置全部”清除维度和页面列表过滤，不改变时间范围及客户端时间设置。

版本来自精确关联的 iOS `app.version`，未关联时允许 H5 `release`；机型、系统、运营商、地域、App 包名只使用精确关联的 iOS Reporter 上下文；网络类型来自精确关联的 iOS 上下文或 H5 `ct` 字段。SDK 版本是 H5 JS 上报头或日志的 `js_ver`，**不是** iOS 官方 SDK 的版本。当前 H5 协议和 Reporter 没有可验证的渠道字段，因此“全部渠道”没有候选值。过滤只重算收到的性能事件及性能页面/趋势/慢加载结果；PV、运营总览及独立原生快照不随性能条件变化。前一周期使用相同的性能过滤条件；不可将未关联上下文或无来源值当成匹配。官网筛选口径未由此实现推断。

### 维度筛选后 FP/FCP/TTI 为“—”

看板现将当前筛选结果的 `perf` 样本数、FP/FCP/TTI 各自有效样本数、三个里程碑全部缺失的样本数，以及其中来自内嵌导航回退的数量显示在指标卡下方。`—` 是无实测值，不是浏览器刷新丢失：内嵌导航回退可观测 `total` 等加载时长，但不能从 WebView 导航时间推导首次绘制、首次内容绘制或可交互时刻。选择机型、系统、App 版本等 iOS 上下文维度时，只保留精确关联样本；未关联的 H5 性能样本不借用原生维度补齐。

2026-10-16 本地归档排查：最近七天共 24 个 `perf`，其中 7 个精确关联 iOS 的导航回退样本没有 FP/FCP/TTI；其余 17 个 H5 beacon 样本有 FP/TTI（其中 11 个有 FCP），但它们的 H5 UID 均未与 iOS Reporter 上下文匹配。筛选 `deviceModel=iPhone` 得到 7 个回退样本、三个指标均 0 个有效值；`networkType=4g` 和 `sdkVersion=2.0.10` 则仍能筛到 17 个有 FP/TTI 的样本。因此并非“选择任何选项”都会让指标消失；若要机型等维度下显示 FP/FCP/TTI，需要未来实际采集可与同一 iOS context ID 关联的 H5 绘制指标，不能用别人的指标推算。修改服务端源码后须重启当前 8787 Node 进程才能加载新版页面和 API。

### 自建接收端的关联身份（兼容旧事件）

`/__sink/api/ios-context` 要求 `contextId`（8–256 字符），可选
`projectId`、`appId`、`environment`、`sessionId`、`navigationId`；
`/__sink/api/h5-navigation` 仍要求旧协议中的 32 位 `uid`，也接受以上可选字段，
但显式 `contextId` 必须等于 `uid`。可选字段存在时必须是非空、有限长度的安全标识；
非法值返回 400，不写入归档。iOS 原始上下文保留可选字段；H5 归档仅保存
校验后的字段、解析后性能数据，不保存附加的未校验 JSON 原文。

旧版事件继续接收：没有上报的字段保持缺失，不从页面 URL、`uid`、接收时间
或固定项目名推断。现有 H5 项目 `projectId` 和 iOS 项目 `projectId` 并不相同；本次不更改看板
原先基于 `uid/contextId` 的关联方式，尚不能据此宣称跨项目数据隔离。
旧版缺少项目字段的事件仍保持未知归属。
`receivedAt` 仍是接收时间，不能视为客户端发生时间。

## 可选 SLS 镜像（服务端）

接收端现已具备独立的本地 + SLS 镜像边界；**默认仍只用本地 NDJSON**。配置仅放服务端，
不是在 iOS/H5 SDK 内配置 SLS 凭证。程序化接入时传入
`createSinkServer({ slsClient })`（或 `createRequestHandler({ slsClient })`）；CLI 可设置
`UMENG_SINK_SLS_ADAPTER_MODULE=/absolute/path/to/server-sls-adapter.mjs`，该服务端模块导出
`createSlsClient()`。未配置时 `storage.source=local`。在确认 SLS Endpoint、Project、Logstore、
RAM 角色及最小写/查权限前，**没有真实云端连接、不能声称已成功双写**。

服务端适配器契约：

```js
export function createSlsClient() {
  return {
    // event 是经过 allowlist 的仪表盘投影，含 mirrorId；认证由服务端 RAM/凭据链完成。
    async put(event, { signal }) { /* 官方 SLS SDK: 写到指定 Project/Logstore */ },
    // 使用 receivedAt UTC 天范围、channel 精确匹配；读完所有页后才可标 complete=true。
    async readDay(channel, utcDay, { limit, signal }) {
      return { events: [], complete: true }; // events 必须返回原封不动的镜像事件
    },
  };
}
```

**仅示意接口，不能原样部署**：假成功写入/假完整查询会触发本地完整性回退；
使用实际 SDK 时必须落实权限、全量分页、超时、日志组索引和时间边界，验证真实写/查。
本地 NDJSON 会先归档，镜像异步入队；失败不影响客户端响应。
看板读 SLS 前按日期与渠道逐项核对本地 `mirrorId`、行数和允许字段的内容，
覆盖包含前一周期和 iOS 上下文回看；任何写入漏失、查询未完成、历史未镜像、超时或字段不一致，
**整次查询回退本地**，响应 JSON 的 `storage.source`/`storage.reason` 说明来源。
`/__sink/stats` 的 `slsMirror` 可观察成功、待处理、失败和满队列次数（进程内计数，不等于 SLS 端持久化审计）。
SLS 镜像排除原始 body、请求头、查询串、错误堆栈与未审查的原生诊断；非看板渠道（如 iOS 原生
崩溃/网络日志）目前只镜像事件通道、时间及已验证的计数字段等元信息，**不是原始事件全文的双写**。
看板从 SLS 读取时这些字段
按隐私策略缺失，不应解释为从未发生错误。当前 SLS 写入失败在本地保留记录和失败计数，
**自动回补/幂等重试、真实云端连通验收和历史数据迁移仍需在确认 SLS 环境后单独完成**；
不得手工把含原始数据的 NDJSON 直接导入 SLS。看板读取侧是只读的，不会自动触发回补写入。

### 官方 Node SDK 服务端接入（配置齐备后）

已加入官方 `@alicloud/log` 服务端适配器和依赖锁文件（**没有执行 npm 发布**）。
安装接收端依赖后，用服务端环境变量开启，不使用 iOS/H5 项目里遗留的 AccessKey：

```bash
cd outputs/umeng-sink
npm ci
UMENG_SINK_SLS_ENDPOINT='cn-xxx.log.aliyuncs.com' \
UMENG_SINK_SLS_PROJECT='your-project' \
UMENG_SINK_SLS_LOGSTORE='your-dedicated-logstore' \
UMENG_SINK_SLS_CREDENTIALS_MODULE='/absolute/path/to/server-credentials.mjs' \
node src/cli.js --port 8799 --data-dir /path/to/your/archive
```

服务端的 `server-credentials.mjs` 需要导出 `async createCredentialsProvider()`，
返回具备 **async `getCredentials()`** 方法的对象；在服务器侧从 RAM 角色/临时凭据机制读取
`accessKeyId`、`accessKeySecret` 和可选 `securityToken`，实现缓存和轮换。
此文件和凭据不得提交至仓库，不得注入客户端 SDK。使用专用 Logstore 并配置 `*` 全文查询索引；
给角色分配对应 Logstore 的最小写/查权限。服务端仅写经过白名单投影的 `payload`；
查询按 UTC 天分页读取，超时、不完整、索引延迟等均回退本地。
历史 NDJSON 未回填时看板将继续使用本地数据，此结果是预期的安全回退。
目前仅使用模拟 SDK 通过本地契约测试，**尚未以实际 SLS 实例验证写入、索引与分页**。

## ELK 只读查询（服务端）

看板不读取 Kibana 浏览器页面，也不使用 Data View ID 作为查询地址。服务端使用
Elasticsearch 的 `_search` 和 `_field_caps` 接口读取 Kibana Data View 对应的索引模式。
测试环境示例索引模式为 `log-fe-*-gsl_test`；Kibana Data View ID
仅用于 Kibana UI 元数据，不能当作索引名称。

配置仅放在启动接收端的服务端环境中，不能写入 H5、iOS 或前端代码：

```bash
export UMENG_SINK_ELK_BASE_URL='http://39.107.27.10:9200'
export UMENG_SINK_ELK_INDEX_PATTERN='log-fe-*-gsl_test'
# 看板的“线上环境 ELK”选项使用此固定索引模式；不设置时仍使用该默认值。
export UMENG_SINK_ELK_ONLINE_INDEX_PATTERN='log-fe*gsl_fe_v2*'
export UMENG_SINK_ELK_APP_NAME='学什么'
export UMENG_SINK_ELK_USERNAME='<账号>'
read -rs 'UMENG_SINK_ELK_PASSWORD?ELK 密码: '
export UMENG_SINK_ELK_PASSWORD
printf '\n'
# CLI 默认仅用 ELK 看板；没有 ELK 地址时返回 503，不会用本地归档代替。
node src/cli.js --port 8787 --data-dir ./data
```

启动后可在本机验证：

```bash
curl -sS http://127.0.0.1:8787/__sink/api/elk/status
curl -sS 'http://127.0.0.1:8787/__sink/api/elk/search?AN=%E5%AD%A6%E4%BB%80%E4%B9%88&from=2026-10-19T02:08:56.188Z&to=2026-10-19T03:08:56.188Z&limit=20'
# 调试接口默认查询测试环境，也可以显式选择线上环境。
curl -sS 'http://127.0.0.1:8787/__sink/api/elk/status?environment=online'
```

看板顶层筛选支持日志字段 `AN`（应用名）、`AV`（App 版本）、`OT`（系统类型）、
`OV`（系统版本）、`EV`（事件类型），以及精确输入的 `UNAME`（用户姓名）和
`PHONE`（手机号）；所有页面共用筛选结果。ELK 模式默认应用名为“学什么”，
可在应用名菜单选择候选项或手动输入。菜单候选值不包含姓名与手机号；
这两项不会写入看板 URL，看板通过 `POST /__sink/api/dashboard`
的表单请求体传送筛选条件。原 `GET` 接口保留兼容，身份字段不能放入
GET URL，以免出现在访问日志或浏览器历史中。索引模式默认保持
`log-fe-*-gsl_test`；应用名列表使用 `AN.keyword` 聚合，如果索引没有
该可聚合字段，仍可手动输入应用名筛选。

看板聚合 `MOD=h5PageAnalysis` 下的 `xsm.H5PageLoad`、`xsm.H5PageError`、
`xsm.H5ApiRequest` 和 `xsm.H5NativeContext`，其中 `xsm.H5PageLoad` 同时承载
页面加载及官方 APM 的 FP/FCP/FID 记录；不兼容历史
`EV=xsm.H5PageAnalysis`；探针、诊断和 APM 原始日志不计入页面分析。
加载事件记为“已观测加载”，不是完整 PV；UV 仅按已上报的 contextId 去重，
不是跨安装的长期用户标识。`page_error` 单独计数，不叠加 `apm_error`；
API 请求和 FCP/FID 仅统计对应的事件类型，导航 ID 相同且已有加载 FCP 时不重复统计 FCP。
原生快照可与相同 contextId 的 H5 页面关联；未取得的阶段和不可用的 TTI 不以 0 代替。
`DTL` 是 JSON 字符串时可回退读取其中已明确映射的字段，不解码或上传 Base64。
看板右上角的数据来源选择器只允许“测试环境 ELK”和“线上环境 ELK”两个固定选项；
切换后整页聚合会重新查询对应索引，默认仍是测试环境。服务端只接受
`elkEnvironment=test|online`，不会把前端传入的字符串当作索引模式。
ELK 返回错误、没有配置或单次查询超过 20000 条时看板返回 502/503，**不会回退本地数据**；
可缩小时间范围继续查看。原始搜索接口只返回字段白名单内的 `_source`，
但可能包含错误消息或 `DTL`，不得将此本地调试服务直接暴露公网。

当前测试环境提供的 Elasticsearch 地址是 HTTP。Basic Auth 在 HTTP 上没有传输层保护：
使用账号前应确认在受信任网络内，或通过管理员提供的 HTTPS 入口/安全隧道访问。

### H5 原始 Vue 错误还原

此功能默认关闭。将 `bx-app-h5` 每次发布的**完整私有归档**（JS、map、manifest）
按原始 `<artifactId>/` 目录持久保存，在服务端配置
`UMENG_SINK_H5_ARCHIVE_DIR` 为这些目录的共同父目录，并设置至少 32 字符的
`UMENG_SINK_SOURCE_AUTH_TOKEN`。归档不能放在 Web 静态目录，也不要把令牌放在
H5/iOS 包、看板 HTML、URL 或版本库中。仅在受控内网或 HTTPS 后访问该接口。

`POST /__sink/api/h5-source` 使用 `Authorization: Bearer <令牌>` 和
`Content-Type: application/json`；JSON 请求示例：

```json
{"h5Release":"abd65d92-a09d-4d99-b9c7-c1cd86f23a63","sourceFile":"https://q-fe.aixuexi.com/operation-system/bx-app-h5/assets/page-abc.js","line":42,"column":7,"errorType":"js_exception"}
```

服务按产物标识和**完整脚本地址**精确命中历史清单，校验历史 JS 与 map 的
SHA-256，再以浏览器 1 起始行列号映射到 `.vue`；仅返回文件名、原始行列和
最多前后各 3 行、单行至多 300 字符的代码。map 的位置按最近映射段还原，
因此返回 `precision=source_map_segment`，不保证字符级精确。缺失产物标识、
脚本未命中、摘要不符、资源错误无代码行、map 不含 Vue 映射等情况返回
`{"status":"unavailable","reason":"..."}`，绝不下载当前线上文件替代历史产物。
原始 Vue 不会进入常规看板聚合结果；调用者须对可查看源码的用户单独授权，
不要将令牌直接下发给未受信任的浏览器。此步骤提供服务端还原接口，
**尚未将代码片段接入看板可视化**。

### 本地 Vite 开发错误还原验证

以下是独立于上述生产归档的**开发环境验证**。真机访问同一台电脑正在运行的
Vite 服务时，日志里的 `sourceFile` 是 `http://<局域网 IP>:5173/src/.../index.vue`；
启动看板前显式设置 `UMENG_SINK_VITE_DEV_ORIGIN` 为真机实际访问的开发服务
**origin**（例如 `http://10.16.110.107:5173`，没有尾部路径），并保留
`--host 127.0.0.1`。ELK 的配置仍按上一节填写，索引仍为 `log-fe-*-gsl_test`。

```bash
export UMENG_SINK_VITE_DEV_ORIGIN='http://10.16.110.107:5173'
node src/cli.js --port 8787 --host 127.0.0.1 --data-dir ./data
```

在**这台电脑**打开 `http://127.0.0.1:8787/`，选择报错所在日期和“错误分析”，
展开最近错误。服务端只从配置的 Vite origin 读取 `/src/` 下的 `.vue` 模块及其
内嵌 source map，不从日志中的 URL 任意访问网络；日志无需 `h5Release` 或
`codeSnippet`，H5→iOS 桥也不传输源码。页面同时显示日志的原始生成位置和
映射后的 Vue 位置、附近五行代码。资源加载错误没有 JS 执行行号，不会出现
Vue 代码位置。只有本机回环连接、合法 localhost Host 和同源浏览器请求才可
访问启用后的看板及聚合 API，该接口不再返回跨域许可；不要在代理后暴露本功能。

**映射是当前运行的 Vite 开发模块，不是之前 `npm run build` 产出的 map。**
旧日志与当前 Vite 模块若不是同一份，结果可能错配；看板会标明这一限制，
不能当作可审计的历史精准定位。开发服务停掉或没有内嵌 map 时显示“未提供”，
不会回退到另一版本的构建归档。完成验证后取消该环境变量并重启看板即可关闭。

生产环境如果未在 H5 构建时配置 `VITE_AXX_TELEMETRY_ENDPOINT` 以实际产生携带
`h5Release` 的错误日志，或 CI 未持久保存并提供对应归档，历史错误仍无法还原。

注意：仅知道 `kibana_reader` 有索引只读权限还不足以让本机连接。部署环境还必须提供
Elasticsearch 查询地址和对应认证方式。`https://axx-kibana.aixuexi.com/app/discover`
是 Kibana UI 地址，不应直接填入 `UMENG_SINK_ELK_BASE_URL`；如果管理员只提供 Kibana
入口而未提供 Elasticsearch endpoint，需要由管理员提供一个允许该账号使用的只读代理或
Elasticsearch 地址。
