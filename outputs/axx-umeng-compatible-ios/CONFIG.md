# iOS sampling configuration

## Feature keys and timing

| Key | Controls | Official wrapper | Rate change effect |
| --- | --- | --- | --- |
| `event` | 自定义事件、时长事件 | `MobClick` | 后续调用生效 |
| `pageView` | 手动页面时长 | `MobClick` | 后续调用生效 |
| `crash` | 手动异常上报 | `UMCrashConfigure reportExceptionWithName:...` | 后续调用生效 |
| `block` | 原生卡顿自动监控 | `UMAPMConfig.crashAndBlockMonitorEnable` | 下一次启动生效 |
| `launch` | 启动监控 | `UMLaunch` / `UMAPMConfig.launchMonitorEnable` | 下一次启动生效 |
| `memory` | 内存监控 | `UMAPMConfig.memMonitorEnable` | 下一次启动生效 |
| `oom` | OOM 监控 | `UMAPMConfig.oomMonitorEnable` | 下一次启动生效 |
| `network` | 网络监控 | `UMAPMConfig.networkEnable` | 下一次启动生效 |
| `h5Bridge` | H5 打通 | `UMAPMConfig.javaScriptBridgeEnable` | 下一次启动生效 |
| `pageMonitor` | 原生页面监控 | `UMPage` / `UMAPMConfig.pageMonitorEnable` | 新页面入口生效；官方模块开关下一次启动生效 |
| `logCollect` | 日志回捞 | `UMAPMConfig.logCollectEnable` | 下一次启动生效 |
| `customLog` | APM 自定义日志 | `UMAPMCustomLog` | 后续调用生效 |
| `userProfile` | 登录、登出、用户属性 | `MobClick` | 后续调用生效 |

采样率必须是 `0.0..1.0`。`NSNumber` 以外的非法值不会写入；越界或非数字会返回失败或保持默认。

## Native monitor semantics

- 官方 `UMAPMConfig` 中 crash 与卡顿共用 `crashAndBlockMonitorEnable`。
- 适配器采用保守策略：只有 `crash` 和 `block` 两个独立分桶都命中时，才打开原生 crash/block 自动监控；否则两者都关闭，避免未采样的一方被 sibling 开关带开。
- 手动 `reportExceptionWithName:...` 仍按 `crash` 的事件级采样或 `force:YES` 判断。
- 其余原生自动监控按各自 feature 在启动时确定一次。若分桶未命中，适配器传给官方 SDK 的开关为 `NO`，而不是让 SDK 内部继续采集后再过滤。

## Official overrides

`AXXUmengSampledConfiguration` 中的 `crashAndBlockMonitorEnabled`、`launchMonitorEnabled` 等表示“是否允许该官方模块参与采样”。传 `NO` 会关闭该功能；传 `YES` 或 `nil` 时由采样率决定。`nil` 使用官方默认允许状态。

`domain` 必须在 `startWithConfiguration:` 内部调用 `UMConfigure initWithAppkey:channel:` 之前设置；适配器已保证这一顺序。APM 配置和版本号同样先于 appkey 初始化。
