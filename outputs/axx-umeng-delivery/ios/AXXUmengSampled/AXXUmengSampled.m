#import "AXXUmengSampled.h"

#import <UMCommon/UMConfigure.h>
#import <UMCommon/MobClick.h>
#import <UMAPM/UMAPMConfig.h>
#import <UMAPM/UMCrashConfigure.h>
#import <UMAPM/UMAPMCustomLog.h>
#import <UMAPM/UMLaunch.h>
#import <UMAPM/UMPage.h>

static NSString * const UMSStartupSubject = @"@startup";

static void AXXInvokeOptionalBoolClassSetter(Class targetClass, SEL selector, BOOL value) {
  if (!targetClass || ![targetClass respondsToSelector:selector]) return;
  NSMethodSignature *signature = [targetClass methodSignatureForSelector:selector];
  if (!signature || signature.numberOfArguments < 3) return;
  if (strcmp([signature getArgumentTypeAtIndex:2], @encode(BOOL)) != 0) return;

  NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:signature];
  invocation.target = targetClass;
  invocation.selector = selector;
  [invocation setArgument:&value atIndex:2];
  [invocation invoke];
}

@interface AXXUmengSampled ()
@property(nonatomic, strong, readwrite) AXXSamplingPolicy *policy;
@property(nonatomic, strong, readwrite) NSMutableDictionary<NSString *, NSNumber *> *activeNativeMonitorState;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *pendingPairs;
@property(nonatomic, strong) NSMapTable<UIViewController *, NSNumber *> *pendingNativePages;
@property(nonatomic, strong) dispatch_queue_t pairQueue;
@end

@implementation AXXUmengSampled

+ (instancetype)sharedAdapter {
  static AXXUmengSampled *adapter;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    adapter = [[super alloc] initPrivate];
  });
  return adapter;
}

- (instancetype)initPrivate {
  self = [super init];
  if (self) {
    _policy = [[AXXSamplingPolicy alloc] initWithSalt:nil];
    _activeNativeMonitorState = [NSMutableDictionary dictionary];
    _pendingPairs = [NSMutableDictionary dictionary];
    _pendingNativePages = [NSMapTable mapTableWithKeyOptions:NSPointerFunctionsWeakMemory | NSPointerFunctionsObjectPersonality
                                               valueOptions:NSPointerFunctionsStrongMemory | NSPointerFunctionsObjectPersonality];
    _pairQueue = dispatch_queue_create("local.axxumengsampled.pairs", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (instancetype)init {
  return [AXXUmengSampled sharedAdapter];
}

+ (instancetype)new {
  return [AXXUmengSampled sharedAdapter];
}

- (NSDictionary<NSString *, NSNumber *> *)activeNativeMonitors {
  return [self.activeNativeMonitorState copy];
}

- (BOOL)startWithConfiguration:(AXXUmengSampledConfiguration *)configuration {
  if (!configuration || configuration.appKey.length == 0) return NO;

  self.policy = [[AXXSamplingPolicy alloc] initWithSalt:configuration.samplingSalt];
  [self.policy applyRates:configuration.samplingRates];
  self.activeNativeMonitorState = [NSMutableDictionary dictionary];

  UMAPMConfig *apmConfig = [UMAPMConfig defaultConfig];
  apmConfig.crashAndBlockMonitorEnable = [self sharedCrashBlockEnabled:configuration.crashAndBlockMonitorEnabled];
  apmConfig.launchMonitorEnable = [self monitorEnabledForFeature:AXXSampledFeatureLaunch
                                                        override:configuration.launchMonitorEnabled];
  apmConfig.memMonitorEnable = [self monitorEnabledForFeature:AXXSampledFeatureMemory
                                                      override:configuration.memoryMonitorEnabled];
  apmConfig.oomMonitorEnable = [self monitorEnabledForFeature:AXXSampledFeatureOOM
                                                      override:configuration.oomMonitorEnabled];
  apmConfig.networkEnable = [self monitorEnabledForFeature:AXXSampledFeatureNetwork
                                                   override:configuration.networkMonitorEnabled];
  apmConfig.javaScriptBridgeEnable = [self monitorEnabledForFeature:AXXSampledFeatureH5Bridge
                                                            override:configuration.h5BridgeEnabled];
  apmConfig.pageMonitorEnable = [self monitorEnabledForFeature:AXXSampledFeaturePageMonitor
                                                       override:configuration.pageMonitorEnabled];
  apmConfig.logCollectEnable = [self monitorEnabledForFeature:AXXSampledFeatureLogCollect
                                                      override:configuration.logCollectEnabled];
  apmConfig.sendBeatInterval = configuration.blockSendBeatInterval;
  apmConfig.checkBeatInterval = configuration.blockCheckBeatInterval;
  if (configuration.blockToleranceBeatMissingCount) {
    apmConfig.toleranceBeatMissingCount = configuration.blockToleranceBeatMissingCount.integerValue;
  }
  if (configuration.logCollectUserId && apmConfig.logCollectEnable) {
    apmConfig.logCollectUserId = configuration.logCollectUserId;
  }

  [UMCrashConfigure setAPMConfig:apmConfig];
  if (configuration.appVersion) {
    [UMCrashConfigure setAppVersion:configuration.appVersion
                       buildVersion:configuration.appBuildVersion];
  }
  if (configuration.networkForProtocolEnabled) {
    [UMCrashConfigure enableNetworkForProtocol:configuration.networkForProtocolEnabled.boolValue];
  }

  if (configuration.domain.length) [UMConfigure setDomain:configuration.domain];
  [UMConfigure setLogEnabled:configuration.logEnabled];
  [UMConfigure setEncryptEnabled:configuration.encryptEnabled];
  [UMConfigure setAnalyticsEnabled:configuration.analyticsEnabled];
  [UMConfigure enablePi:configuration.piEnabled];
  AXXInvokeOptionalBoolClassSetter([UMConfigure class],
                                   @selector(setASAEnabled:),
                                   configuration.asaEnabled);
  AXXInvokeOptionalBoolClassSetter([UMConfigure class],
                                   @selector(setSKANEnabled:),
                                   configuration.skanEnabled);
  [UMConfigure initWithAppkey:configuration.appKey channel:configuration.channel];
  [UMLaunch setLaunchEnable:self.activeNativeMonitorState[AXXSampledFeatureLaunch].boolValue];
  return YES;
}

- (BOOL)sharedCrashBlockEnabled:(NSNumber * _Nullable)override {
  if (override && !override.boolValue) return NO;
  BOOL crash = [self monitorEnabledForFeature:AXXSampledFeatureCrash override:@YES];
  BOOL block = [self monitorEnabledForFeature:AXXSampledFeatureBlock override:@YES];
  return crash && block;
}

- (BOOL)monitorEnabledForFeature:(NSString *)feature override:(NSNumber * _Nullable)override {
  double rate = [self.policy rateForFeature:feature];
  if (rate <= 0.0 || (override && !override.boolValue)) {
    self.activeNativeMonitorState[feature] = @NO;
    return NO;
  }
  BOOL enabled = [self.policy shouldSampleFeature:feature subject:UMSStartupSubject];
  self.activeNativeMonitorState[feature] = @(enabled);
  return enabled;
}

- (BOOL)shouldTrackFeature:(NSString *)feature subject:(nullable NSString *)subject {
  return [self.policy shouldSampleFeature:feature subject:subject];
}

- (BOOL)trackEvent:(NSString *)eventId {
  return [self trackEvent:eventId label:nil];
}

- (BOOL)trackEvent:(NSString *)eventId label:(nullable NSString *)label {
  if (![self shouldTrackFeature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick event:eventId label:label];
  return YES;
}

- (BOOL)trackEvent:(NSString *)eventId attributes:(nullable NSDictionary<NSString *, id> *)attributes {
  if (![self shouldTrackFeature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick event:eventId attributes:attributes];
  return YES;
}

- (BOOL)trackEvent:(NSString *)eventId
        attributes:(nullable NSDictionary<NSString *, id> *)attributes
           counter:(int)counter {
  if (![self shouldTrackFeature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick event:eventId attributes:attributes counter:counter];
  return YES;
}

- (NSString *)pairKeyKind:(NSString *)kind eventId:(NSString *)eventId label:(nullable NSString *)label key:(nullable NSString *)keyName {
  return [NSString stringWithFormat:@"%@|%@|%@|%@", kind, eventId, label ?: @"", keyName ?: @""];
}

- (BOOL)beginPendingPair:(NSString *)pairKey feature:(NSString *)feature subject:(NSString *)subject {
  __block BOOL sampled = NO;
  dispatch_sync(self.pairQueue, ^{
    sampled = [self shouldTrackFeature:feature subject:subject];
    if (sampled) self.pendingPairs[pairKey] = @YES;
  });
  return sampled;
}

- (BOOL)endPendingPair:(NSString *)pairKey {
  __block BOOL sampled = NO;
  dispatch_sync(self.pairQueue, ^{
    sampled = self.pendingPairs[pairKey] != nil;
    if (sampled) [self.pendingPairs removeObjectForKey:pairKey];
  });
  return sampled;
}

- (BOOL)beginEvent:(NSString *)eventId {
  return [self beginEvent:eventId label:nil];
}

- (BOOL)endEvent:(NSString *)eventId {
  return [self endEvent:eventId label:nil];
}

- (BOOL)beginEvent:(NSString *)eventId label:(nullable NSString *)label {
  NSString *pair = [self pairKeyKind:@"event" eventId:eventId label:label key:nil];
  if (![self beginPendingPair:pair feature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick beginEvent:eventId label:label];
  return YES;
}

- (BOOL)endEvent:(NSString *)eventId label:(nullable NSString *)label {
  NSString *pair = [self pairKeyKind:@"event" eventId:eventId label:label key:nil];
  if (![self endPendingPair:pair]) return NO;
  [MobClick endEvent:eventId label:label];
  return YES;
}

- (BOOL)beginEvent:(NSString *)eventId
        primarykey:(NSString *)keyName
        attributes:(nullable NSDictionary<NSString *, id> *)attributes {
  NSString *pair = [self pairKeyKind:@"event" eventId:eventId label:nil key:keyName];
  if (![self beginPendingPair:pair feature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick beginEvent:eventId primarykey:keyName attributes:attributes];
  return YES;
}

- (BOOL)endEvent:(NSString *)eventId primarykey:(NSString *)keyName {
  NSString *pair = [self pairKeyKind:@"event" eventId:eventId label:nil key:keyName];
  if (![self endPendingPair:pair]) return NO;
  [MobClick endEvent:eventId primarykey:keyName];
  return YES;
}

- (BOOL)trackEvent:(NSString *)eventId durations:(int)milliseconds {
  if (![self shouldTrackFeature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick event:eventId durations:milliseconds];
  return YES;
}

- (BOOL)trackEvent:(NSString *)eventId label:(nullable NSString *)label durations:(int)milliseconds {
  if (![self shouldTrackFeature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick event:eventId label:label durations:milliseconds];
  return YES;
}

- (BOOL)trackEvent:(NSString *)eventId
        attributes:(nullable NSDictionary<NSString *, id> *)attributes
         durations:(int)milliseconds {
  if (![self shouldTrackFeature:AXXSampledFeatureEvent subject:eventId]) return NO;
  [MobClick event:eventId attributes:attributes durations:milliseconds];
  return YES;
}

- (BOOL)beginLogPageView:(NSString *)pageName {
  NSString *pair = [self pairKeyKind:@"page" eventId:pageName label:nil key:nil];
  if (![self beginPendingPair:pair feature:AXXSampledFeaturePageView subject:pageName]) return NO;
  [MobClick beginLogPageView:pageName];
  return YES;
}

- (BOOL)endLogPageView:(NSString *)pageName {
  NSString *pair = [self pairKeyKind:@"page" eventId:pageName label:nil key:nil];
  if (![self endPendingPair:pair]) return NO;
  [MobClick endLogPageView:pageName];
  return YES;
}

- (BOOL)logPageView:(NSString *)pageName seconds:(int)seconds {
  if (![self shouldTrackFeature:AXXSampledFeaturePageView subject:pageName]) return NO;
  [MobClick logPageView:pageName seconds:seconds];
  return YES;
}

- (BOOL)trackNativePageBegin:(NSString *)pageName
              viewController:(UIViewController *)viewController {
  if (![self shouldTrackFeature:AXXSampledFeaturePageMonitor subject:pageName]) return NO;
  @synchronized(self.pendingNativePages) {
    [self.pendingNativePages setObject:@YES forKey:viewController];
  }
  [UMPage trackBegin:pageName viewController:viewController];
  return YES;
}

- (BOOL)trackNativePageEnd:(NSString *)pageName
            viewController:(UIViewController *)viewController {
  __block BOOL sampled = NO;
  @synchronized(self.pendingNativePages) {
    sampled = [self.pendingNativePages objectForKey:viewController] != nil;
    if (sampled) [self.pendingNativePages removeObjectForKey:viewController];
  }
  if (!sampled) return NO;
  [UMPage trackEnd:pageName viewController:viewController];
  return YES;
}

- (BOOL)reportExceptionWithName:(NSString *)name
                         reason:(NSString *)reason
                     stackTrace:(NSArray<NSString *> *)stackTrace
                          force:(BOOL)force {
  NSString *subject = [NSString stringWithFormat:@"%@|%@", name, reason];
  if (!force && ![self shouldTrackFeature:AXXSampledFeatureCrash subject:subject]) return NO;
  [UMCrashConfigure reportExceptionWithName:name reason:reason stackTrace:stackTrace];
  return YES;
}

- (BOOL)addCustomInfoKey:(NSString *)key value:(NSString *)value {
  if (!self.activeNativeMonitorState[AXXSampledFeatureCrash].boolValue) return NO;
  [UMCrashConfigure addCustomInfoKey:key value:value];
  return YES;
}

- (BOOL)verboseLogWithTag:(NSString *)tag message:(NSString *)message {
  return [self customLogLevel:0 tag:tag message:message];
}

- (BOOL)debugLogWithTag:(NSString *)tag message:(NSString *)message {
  return [self customLogLevel:1 tag:tag message:message];
}

- (BOOL)infoLogWithTag:(NSString *)tag message:(NSString *)message {
  return [self customLogLevel:2 tag:tag message:message];
}

- (BOOL)warningLogWithTag:(NSString *)tag message:(NSString *)message {
  return [self customLogLevel:3 tag:tag message:message];
}

- (BOOL)errorLogWithTag:(NSString *)tag message:(NSString *)message {
  return [self customLogLevel:4 tag:tag message:message];
}

- (BOOL)customLogLevel:(NSInteger)level tag:(NSString *)tag message:(NSString *)message {
  NSString *subject = [NSString stringWithFormat:@"%@|%@", tag ?: @"", message ?: @""];
  if (![self shouldTrackFeature:AXXSampledFeatureCustomLog subject:subject]) return NO;
  switch (level) {
    case 0: [UMAPMCustomLog vTag:tag msg:message]; break;
    case 1: [UMAPMCustomLog dTag:tag msg:message]; break;
    case 2: [UMAPMCustomLog iTag:tag msg:message]; break;
    case 3: [UMAPMCustomLog wTag:tag msg:message]; break;
    default: [UMAPMCustomLog eTag:tag msg:message]; break;
  }
  return YES;
}

- (BOOL)beginLaunchPhase:(NSString *)methodName {
  if (!self.activeNativeMonitorState[AXXSampledFeatureLaunch].boolValue) return NO;
  [UMLaunch beginLaunch:methodName];
  return YES;
}

- (BOOL)endLaunchPhase:(NSString *)methodName {
  if (!self.activeNativeMonitorState[AXXSampledFeatureLaunch].boolValue) return NO;
  [UMLaunch endLaunch:methodName];
  return YES;
}

- (void)setPredefineLaunchTypeFinishedLaunchingEnd {
  if (self.activeNativeMonitorState[AXXSampledFeatureLaunch].boolValue) {
    [UMLaunch setPredefineLaunchType:UMPredefineLaunchType_DidFinishLaunchingEnd];
  }
}

- (void)setPredefineLaunchTypeViewDidLoadEnd {
  if (self.activeNativeMonitorState[AXXSampledFeatureLaunch].boolValue) {
    [UMLaunch setPredefineLaunchType:UMPredefineLaunchType_ViewDidLoadEnd];
  }
}

- (void)setPredefineLaunchTypeViewDidAppearEnd {
  if (self.activeNativeMonitorState[AXXSampledFeatureLaunch].boolValue) {
    [UMLaunch setPredefineLaunchType:UMPredefineLaunchType_ViewDidAppearEnd];
  }
}

- (BOOL)profileSignInWithPUID:(NSString *)puid {
  return [self profileSignInWithPUID:puid provider:nil];
}

- (BOOL)profileSignInWithPUID:(NSString *)puid provider:(nullable NSString *)provider {
  if (![self shouldTrackFeature:AXXSampledFeatureUserProfile subject:puid]) return NO;
  [MobClick profileSignInWithPUID:puid provider:provider];
  return YES;
}

- (BOOL)profileSignOff {
  if (![self shouldTrackFeature:AXXSampledFeatureUserProfile subject:@"sign-off"]) return NO;
  [MobClick profileSignOff];
  return YES;
}

- (BOOL)setUserProfile:(id)value forKey:(NSString *)key {
  if (![self shouldTrackFeature:AXXSampledFeatureUserProfile subject:key]) return NO;
  [MobClick userProfile:value to:key];
  return YES;
}

- (BOOL)setSamplingRate:(double)rate forFeature:(NSString *)feature {
  return [self.policy setRate:rate forFeature:feature];
}

- (void)applySamplingRates:(NSDictionary<NSString *, NSNumber *> *)rates {
  [self.policy applyRates:rates];
}

@end
