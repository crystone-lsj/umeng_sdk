# AXXTelemetryIOS

独立的 iOS 原生遥测副本与 WKWebView 上下文关联 SDK。

## 边界

- 只向配置的自建接收端发送副本，不修改、拦截或替换官方友盟 SDK 流量。
- 采集启动、前后台、内存警告、网络变化、设备/系统/应用维度和可选 MetricKit 诊断摘要。
- 不在客户端保存或使用 SLS AccessKey/Secret；接收端负责写入 SLS。
- 不对 WKWebView 做全局 Swizzle。业务在 WebView 加载前调用 URL helper。
- 官方友盟适配器仍为独立的 `AXXUmengSampled` Pod；仅业务工程同时引入它。核心 SDK 不依赖官方 SDK。

## 接入

```objc
#import <AXXTelemetryIOS/AXXTelemetryIOS.h>

AXXTelemetryConfiguration *configuration =
    [AXXTelemetryConfiguration configurationWithProjectId:@"your-project"
                                                  baseURL:[NSURL URLWithString:@"https://telemetry.example.com"]];
configuration.appId = [[NSBundle mainBundle] bundleIdentifier];
configuration.environment = @"production";
configuration.channel = @"AppStore";
configuration.debugLoggingEnabled = NO;
configuration.allowsInsecureHTTP = NO; // 仅可信测试 LAN 显式改为 YES
[[AXXTelemetrySDK sharedInstance] startWithConfiguration:configuration];

NSURL *url = [AXXTelemetryWebView URLByAppendingContextParametersToURL:originalURL];
```

URL 会按需增加：

- `axx_ap_context`：进程级关联 ID；
- `axx_ap_session`：本次 App 运行会话 ID；
- `axx_ap_navigation`：本次 H5 导航 ID。

原有查询参数、路径和 fragment 会保留。已有的遥测参数会替换为当前会话值；每次调用产生新的导航 ID。

## 兼容当前接收端

默认 endpoint 为 `__sink/api/ios-context`，因此可以先与现有 `umeng-sink` 兼容使用。接收端升级后可通过 `endpointPath` 切换到统一事件入口。

## 验证

```bash
./scripts/syntax-check.sh
```

该 SDK 本身不验证真实友盟后台或 SLS 写入；需要在接入项目中做真机端到端验证。

## 当前边界与发布

- 当前 v1 事件仍走 `ios-context-v1` 兼容接口，`network` / `native.trigger` 字段供旧看板消费；`eventId`, `sessionId` 为新增字段。导航 ID 只注入 H5 URL，尚未建立服务端导航级关联。
- MetricKit 仅 iOS 14+，系统通常延迟交付，不等同于友盟完整的崩溃、OOM 或卡顿原始数据；WebView helper 仅注入关联 ID，尚不采集 WebView 失败/白屏。
- 进程内上传有 32 条上限、64 KiB 单条上限、独立有限重试；当前无跨进程磁盘队列。后台与离线发送属于尽力而为。
- 不内含 SLS 密钥。原生事件自定义 `payload` 必须由调用方先脱敏，SDK 对常见敏感字段名进行递归遮盖、HTTP URL 去掉凭据/query/fragment，并限制 JSON 与大小；未知字段仍需调用方先脱敏。
- 此源码是本地可复用 CocoaPod；尚未推送到私有 Git/Specs 仓库或发布 Swift Package。
