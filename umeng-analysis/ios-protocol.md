# iOS 端协议（UMCommon 7.6.4 / UMDevice 3.6.0 / UMAPM 2.0.7）

证据：

- `evidence/ios/extracted/UMCommon_7.6.4/…/UMCommon.xcframework/ios-arm64/UMCommon.framework/UMCommon`
  —— 下文 `strings #N` 指该二进制的字符串序号。
- `evidence/ios/objects/` 中的 Mach-O 反汇编注记（`UMEnvelope.o`、`UMEnvelopeBuild.o`、`UMNetworkWork`、`UMBuildPayload.o` 等）。
- 目标工程侧集成点：[`../outputs/axx-umeng-delivery/ios`](../outputs/axx-umeng-delivery/ios) 与业务工程
  `apps/gslearnwhat/GSLearnwhat/…/AppDelegate+UMeng.m`、`ThirdPodspec/AXXUmengSampled/`。

分类标签：【观测】= 二进制/源码级事实；【推导】= 由观测按实现语义推出；【推断】= 未取证但合理的解释；【未知】= 证据不足。

## 1. 端点

【观测】`strings #3085–#3096`：

```text
https://ulogs.umeng.com/unify_logs
https://ulogs.umengcloud.com/unify_logs
https://%@/unify_logs
/zcfg            https://ulogs.umeng.com/zcfg        https://ulogs.umengcloud.com/zcfg
/heartbeat       https://ulogs.umeng.com/heartbeat   https://ulogs.umengcloud.com/heartbeat
```

主/备两个域名成对出现（`ulogs.umeng.com` / `ulogs.umengcloud.com`），自定义域名模板为 `https://%@/unify_logs`。

【观测】U-APM 侧另有独立端点（UMAPM 2.0.7 二进制字符串）：

| 用途 | 端点 |
| --- | --- |
| 崩溃/性能日志 | `https://errnewlog.umeng.com/upload`、`https://errnewlogos.umeng.com/upload` |
| 云控 | `/apm_cc`（`WPKAPIClient`：`https://%@` + query `os,app,ver,sver,ud,tm,cver,um_sdk_ver,sign,seq,type,de`） |
| APM 日志 | `/apm_logs`（POST multipart，字段名 `file`，header `Wpk-header`） |
| 集成校验 | `/api/crashsdk/validate`、`/api/crashsdk/logcollect` |

## 2. 请求契约（分析埋点 `/unify_logs`）

【观测】`strings #3105`、`#3119–#3124`：请求头

```text
Content-Type: application/thrift
Msg-Type: envelope/json
X-Umeng-Sdk: 1
SM-IMP: 1
X-Umeng-UTC: <毫秒时间戳>
```

【观测】方法为 POST，body 即 `postDataToServer:withFile:` 读入文件的**原始字节**
（`dataWithContentsOfFile:` → `setHTTPBody:`，**不做 base64**）。

## 3. `UMEnvelope` Thrift 结构

【观测】`umeng_envelope.o` `-[UMEnvelope write:]` 的 `writeFieldBegin` 顺序（0x1138..0x1374）：

| 字段号 | 名称 | 类型 | 内容 |
| --- | --- | --- | --- |
| 1 | `version` | STRING | `"V1.1"`（`strings #3543`） |
| 2 | `address` | STRING | appkey |
| 3 | `signature` | STRING | `md5(entity 压缩后字节)` 的十六进制 |
| 4 | `serial_num` | I32 | 递增序号 |
| 5 | `ts_secs` | I32 | 秒级时间戳 |
| 6 | `length` | I32 | **压缩前** entity 的 UTF-8 字节长度 |
| 7 | `entity` | BINARY | zlib 流（见下） |
| 8 | `guid` | STRING | 设备 guid |
| 9 | `checksum` | STRING | 见下 |
| 10 | `codex` | I32 | 未加密路径为 `1`（`strings #3544 "codex"`） |

【推导】`entity` 是 **zlib 流（RFC1950，含 2 字节头与 Adler-32 尾）**，不是 gzip、也不是 raw deflate：
`+[UMUtils deflatedData:]` → `deflatedDataPrefixedWith:level:source:` → libz `compress2`。
解码用 `zlib.inflate`（Node：`zlib.inflateSync`）。

【观测】`checksum` 的格式串为 `%@%d%d%d%@`（`strings #3545`），因此
`checksum = lowercase hex md5("<signature><serial_num><ts_secs><length><guid>")`。`%@` 依次是
`signature` 与 `guid`，三个 `%d` 依次是 `serial_num`、`ts_secs`、`length`。

【推导】`signature` 覆盖的是**压缩后**的 entity 字节；`length` 记录的是**压缩前**长度。

## 4. 成功响应契约（自建接收端必须满足）

【观测】`UMBuildPayload.o verifyResponseData:` @0x19fc 与 `UMNetworkWork` @0xfc8：
客户端判定「上传成功」的条件是 **HTTP 200** 且响应体是 Thrift struct、**字段 1 为 I32 且等于 1**。
其字节序列固定为：

```text
08 00 01 00 00 00 01 00
```

【推导】也就是说，自建接收端对 `/unify_logs`、`/zcfg`、`/heartbeat` 都应返回
`200` + `Content-Type: application/thrift` + 上述 8 字节；只返回 `200 {}` 会导致客户端视为失败并重试。

## 5. 自定义域名（`+[UMConfigure setDomain:]` @0x2c）

【观测】`strings #4216–#4222`：`ERROR:SdkDomainUndefined`、`http://`、`https://`、`https://%@`、
`://ulogs.umeng.com`、`://ulogs.umengcloud.com`、`://alogus.umeng.com`、`://alogsus.umeng.com`。

【推导】行为：

1. 传入空串 → 打印 `ERROR:SdkDomainUndefined` 并**保持官方域名**。
2. 不含 `http://` / `https://` 前缀 → 自动补 `https://`。
3. 命中白名单（含上述 4 个 `://<host>` 片段）→ 只打印 `E` 日志，**不改域名**。
4. 其余 → 同时设置 **primary 与 standby** 两个域名。

【推导】接入自建接收端时因此只需提供一个 host；SDK 会把主备都指向它，`/unify_logs`、
`/zcfg`、`/heartbeat` 都会打到同一台。注意 host 里不要出现上面 4 个片段之一。

## 6. 改写版 iOS SDK 与「后台收不到数据」的关系

业务工程 `AppDelegate+UMeng.m` 的当前实现（工作区未提交改动）把初始化整体交给
`AXXUmengSampled`，其内部仍调用官方 API：

```objc
[UMCrashConfigure setAPMConfig:apmConfig];
if (configuration.domain.length) [UMConfigure setDomain:configuration.domain];
[UMConfigure setLogEnabled:…]; [UMConfigure setEncryptEnabled:…]; [UMConfigure setAnalyticsEnabled:…];
[UMConfigure initWithAppkey:configuration.appKey channel:configuration.channel];
```

【观测】`AXXSamplingPolicy` 的分桶函数 `UMSStableRateForFeature` 返回值域为 `[0,1)`，
而 `shouldSampleFeature:` 在 `rate >= 1.0` 时**直接返回 YES**（不做哈希比较）；工程里 13 个 feature 全部配 `@1.0`：

```objc
- (BOOL)shouldSampleFeature:(NSString *)feature subject:(nullable NSString *)subject {
  double rate = [self rateForFeature:feature];
  if (rate <= 0.0) return NO;
  if (rate >= 1.0) return YES;      // ← 本项目实际路径
  return UMSStableRateForFeature(feature, subject, self.salt) < rate;
}
```

【推导】因此 iOS 侧改写层**不是一条会丢数据的闸门**：它只是把 `MobClick` /
`UMCrashConfigure` / `UMLaunch` / `UMPage` 的公开 API 包了一层，决策恒为放行，
真正发数据、真正决定采样与上报的仍是官方 SDK。这与 H5 侧（改写层直接注入
`sampleConfig.enable=false` 而触发 100% 丢弃）性质完全不同。

【推导】另一个曾被怀疑的假设——「appkey 是占位符」——证据不支持。友盟 appkey 形态为
`[前 4 字节 = 创建时间秒级 epoch 的十六进制][后 10 字节随机]`，实测：

| appkey | 前 4 字节解码 | 出现位置 |
| --- | --- | --- |
| `694a02588560e348720def2a` | 2025-12-23T02:45:44Z | gslearnwhat（`AppDelegate+UMeng.m`，DEBUG 与 RELEASE 相同） |
| `66c2e946192e0574e764c77b` | 2024-08-19T06:42:14Z | GSParent |
| `66c2e928192e0574e764c779` | 2024-08-19T06:41:44Z | gaosiapp（与上一行相差 30 秒，同批创建） |
| `5afd1d9ea40fa31e23000082` | 2018-05-17T06:13:50Z | app-teacher-ios |

【观测】`git log -S` 显示该 appkey 自 `3904f48f6b`（导入 gslearnwhat 主库）起从未改动，
`c21727896f`（“进行集成测试配置”，作者为业务同学）中它只是上下文行，未被改写。

【结论】iOS 侧无法用现有证据把「后台收不到数据」归因到改写层或 appkey 被伪造。
剩余的可能原因见 §7，需要设备/后台侧取证；它们都不属于协议层缺陷。

## 7. iOS 侧未验证项（取证步骤）

- 【未知】Umeng 后台被查看的 App 是否就是 `694a02588560e348720def2a` 对应的 App。
  取证：在友盟后台「应用设置 → Appkey」比对；SDK 侧已打印
  `[AXX Umeng] start result=%d, rates=%@`。
- 【未知】被测包是否真的执行了这段初始化（pod 是否装进了 `AXXUmengSampled`）。
  取证：看 `[AXX Umeng] start result=1` 是否出现，以及官方 SDK 日志
  （`UMConfigure setLogEnabled:YES` 会打印域名、appkey、上传结果）。
- 【未知】临时 Debug 包数据是否落到了友盟后台的「测试/调试」视图而非正式统计；
  同时 `#ifdef DEBUG` 分支里 `[UMessage openDebugMode:YES]` 只影响 U-Push。
  取证：用 Release 包跑一次再看后台。
- 【未知】U-APM 云控（`/apm_cc`）是否为该 App 下发了低采样率；`AXXUmengSampled`
  没有关闭 U-APM 云控（只有 H5 适配层关掉了 `enableRemoteConfig`）。
  取证：抓一次 `/apm_cc` 响应体。
