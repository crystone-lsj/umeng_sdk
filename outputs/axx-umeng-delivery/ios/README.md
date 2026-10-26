# Umeng iOS sampled adapter

这是基于官方友盟 iOS SDK 公共 Objective-C API 的采样接入层，不复制、不分发友盟反编译代码，也不模拟私有上报协议。官方运行时依赖保持不变：`UMCommon 7.6.4`、`UMDevice 3.6.0`、`UMAPM 2.0.7`。

适配器做的事：

- 把官方公共监控入口包装成返回 `BOOL` 的采样入口。
- 使用 FNV-1a 做稳定分桶；相同 feature/subject/salt 的决定在同一安装内稳定。
- 提供逐功能采样率，自定义事件、页面、错误、日志、用户属性等入口可运行时调整。
- 原生 APM 自动监控仍受官方初始化开关限制，采样决定在启动时确定；运行时改率后需要下一次 `startWithConfiguration:` 才能改变原生自动采集。

## 集成

把本目录复制进工程后，在 `Podfile` 中引用本地 podspec：

```ruby
pod 'AXXUmengSampled', :path => '../axx-umeng-compatible-ios'
```

然后执行：

```bash
pod install
```

## 启动

```objc
- (BOOL)application:(UIApplication *)application
didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    AXXUmengSampledConfiguration *configuration =
        [AXXUmengSampledConfiguration configurationWithAppKey:@"your-umeng-app-key"
                                                   channel:@"App Store"];
    configuration.samplingSalt = @"your-stable-salt";
    configuration.samplingRates = @{
        AXXSampledFeatureEvent: @0.20,
        AXXSampledFeaturePageView: @0.10,
        AXXSampledFeatureCrash: @1.0,
        AXXSampledFeatureBlock: @0.05,
        AXXSampledFeatureLaunch: @0.10,
        AXXSampledFeatureMemory: @0.10,
        AXXSampledFeatureOOM: @1.0,
        AXXSampledFeatureNetwork: @0.05,
        AXXSampledFeatureH5Bridge: @0.10,
        AXXSampledFeaturePageMonitor: @0.10,
        AXXSampledFeatureLogCollect: @0.0,
        AXXSampledFeatureCustomLog: @0.01,
        AXXSampledFeatureUserProfile: @0.50
    };
    configuration.domain = @"https://www.umeng.com";

    [[AXXUmengSampled sharedAdapter] startWithConfiguration:configuration];
    [[AXXUmengSampled sharedAdapter] setPredefineLaunchTypeFinishedLaunchingEnd];
    return YES;
}
```

## 业务调用

```objc
AXXUmengSampled *monitor = [AXXUmengSampled sharedAdapter];

if ([monitor trackEvent:@"order_submit"
             attributes:@{ @"payment": @"apple_pay" }
                 counter:1]) {
    // 已命中 event 采样。
}

[monitor beginLogPageView:@"OrderDetailController"];
// 页面退出时：
[monitor endLogPageView:@"OrderDetailController"];

[monitor reportExceptionWithName:@"checkout"
                           reason:@"payment timeout"
                       stackTrace:@[@"frame-1", @"frame-2"]
                            force:YES];
```

运行时调整只影响后续事件级入口：

```objc
[[AXXUmengSampled sharedAdapter] applySamplingRates:@{
    AXXSampledFeatureEvent: @0.50,
    AXXSampledFeatureCustomLog: @0.10
}];
```

## 验证

在本仓库内运行 Objective-C 语法检查：

```bash
./outputs/axx-umeng-compatible-ios/scripts/syntax-check.sh
```

该命令使用 Xcode iPhoneOS SDK 和本地留存的官方框架头文件做 `clang -fsyntax-only`，不链接、不运行 SDK。真机初始化、友盟后台展示和原生模块上报率仍需在真实 App 中验证。
