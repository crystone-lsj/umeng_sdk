# 从旧 iOS Reporter 迁移

## 当前接入（gslearnwhat）

1. `Podfile` 引入独立 `AXXTelemetryIOS` 本地 Pod；原 `AXXUmengSampled` 继续独立引入，官方初始化、AppKey、APM 和官方上传地址不变。
2. AppDelegate 从 `Info.plist` 的 `AXXTelemetry` 字典读取开关、项目、环境、接收端。Debug 构建启用自建副本，Release 构建关闭；上线前必须改为生产 HTTPS 接收端并另行授权启用，不能使用开发 LAN 的 HTTP 地址。
3. 三处已知 WebView 入口改为 `AXXTelemetryWebView` 注入。旧 `AXXUmengContextReporter` 暂保留在旧 Pod 内（兼容旧业务），在本工程不再启动；若其他入口仍调用旧类，需单独迁移。
4. H5 仍由自己的 JS SDK 上报；当前 H5 接收端只按 `axx_ap_context` 精确关联。`axx_ap_session` 和 `axx_ap_navigation` 已在 URL 注入，但 H5 SDK 与服务端尚未消费导航 ID，须在后续协议阶段完成。

## 新工程最小接入

- 引入本包，在启动时创建 `AXXTelemetryConfiguration` 并显式设置 `projectId`, `baseURL`, `environment`, `enabled`。
- 每个集中创建的 WKWebView 在请求 URL 前调用 `AXXTelemetryWebView`；不要为了未知入口使用全局 Swizzle。
- 若需要官方上报，额外引入并初始化官方友盟/现有 `AXXUmengSampled`；本包不接管该功能。
- 自定义原生事件由调用方先移除任何个人信息/敏感请求数据。SDK 有基本字段遮盖与上限，但并非通用脱敏引擎。

## 尚未实现

- 本地源码 Pod 已有版本号，但尚未发布至私有 CocoaPods Specs 仓库或 Swift Package。
- 不捕获真实崩溃现场、OOM 或 WebView 加载错误；MetricKit 诊断为延迟摘要。旧友盟官方链路继续提供其已有监控。
- 无跨进程持久队列；网络不可用时最多有限次重试，接收端 / SLS 容灾在后续阶段。
- 部分工程可能有未列出的 WebView 入口，应在新工程逐一接入并真机验证。
