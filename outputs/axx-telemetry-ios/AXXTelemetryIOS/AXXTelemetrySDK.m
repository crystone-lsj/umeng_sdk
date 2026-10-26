#import "AXXTelemetrySDK.h"

#import <CoreTelephony/CTCarrier.h>
#import <CoreTelephony/CTTelephonyNetworkInfo.h>
#import <Network/Network.h>
#import <mach/mach.h>
#import <sys/utsname.h>

#if __has_include(<MetricKit/MetricKit.h>)
#import <MetricKit/MetricKit.h>
#define AXX_HAS_METRICKIT 1
#else
#define AXX_HAS_METRICKIT 0
#endif

static NSString * const AXXContextQuery = @"axx_ap_context";
static NSString * const AXXSessionQuery = @"axx_ap_session";
static NSString * const AXXNavigationQuery = @"axx_ap_navigation";
static NSString * const AXXSchema = @"ios-context-v1";
static const NSUInteger AXXMaxPayloadBytes = 64 * 1024;
static const NSInteger AXXMaxPendingUploads = 32;

static NSString *AXXCompactIdentifier(void) {
  return [[[NSUUID UUID].UUIDString stringByReplacingOccurrencesOfString:@"-" withString:@""] uppercaseString];
}

static BOOL AXXIsHTTPURL(NSURL *url) {
  NSString *scheme = url.scheme.lowercaseString;
  return [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"];
}

// Only application-owned custom event fields pass through this boundary.
// Built-in device/network snapshots contain no URL or request bodies.
static id AXXRedactedValue(id value, NSUInteger depth) {
  if (depth > 8) return @"[omitted]";
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSSet *sensitive = [NSSet setWithArray:@[@"authorization", @"cookie", @"setcookie", @"password", @"passwd", @"token", @"accesskey", @"secret", @"credential"]];
    for (id key in value) {
      if (![key isKindOfClass:[NSString class]]) continue;
      NSString *normalized = [[[key lowercaseString] stringByReplacingOccurrencesOfString:@"_" withString:@""] stringByReplacingOccurrencesOfString:@"-" withString:@""];
      result[key] = [sensitive containsObject:normalized] ? @"[redacted]" : AXXRedactedValue(value[key], depth + 1);
    }
    return result;
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSMutableArray *result = [NSMutableArray array];
    for (id item in value) [result addObject:AXXRedactedValue(item, depth + 1)];
    return result;
  }
  if ([value isKindOfClass:[NSString class]]) {
    NSString *text = value;
    NSURLComponents *url = [NSURLComponents componentsWithString:text];
    if (url.host.length && AXXIsHTTPURL(url.URL)) {
      url.user = nil;
      url.password = nil;
      url.query = nil;
      url.fragment = nil;
      return url.string ?: @"[redacted-url]";
    }
    return text.length > 2048 ? [text substringToIndex:2048] : text;
  }
  if ([value isKindOfClass:[NSNumber class]] || value == NSNull.null) return value;
  return @"[omitted]";
}

#if AXX_HAS_METRICKIT
@interface AXXTelemetrySDK () <MXMetricManagerSubscriber>
#else
@interface AXXTelemetrySDK ()
#endif
@property(nonatomic, copy, readwrite, nullable) NSString *contextId;
@property(nonatomic, copy, readwrite, nullable) NSString *sessionId;
@property(nonatomic, copy, readwrite, nullable) AXXTelemetryConfiguration *configuration;
@property(nonatomic, assign, readwrite, getter=isStarted) BOOL started;
@property(nonatomic, strong) NSURLSession *uploadSession;
@property(nonatomic, strong, nullable) nw_path_monitor_t networkMonitor;
@property(nonatomic, strong, nullable) dispatch_queue_t networkQueue;
@property(nonatomic, copy) NSString *networkType;
@property(nonatomic, copy) NSString *carrier;
@property(nonatomic, assign) NSInteger memoryWarningCount;
@property(nonatomic, assign) NSInteger pendingUploads;
@property(nonatomic, strong) NSDate *startedAt;
@end

@implementation AXXTelemetrySDK

+ (instancetype)sharedInstance {
  static AXXTelemetrySDK *instance;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{ instance = [[self alloc] init]; });
  return instance;
}

- (BOOL)startWithConfiguration:(AXXTelemetryConfiguration *)configuration {
  if (![configuration isKindOfClass:[AXXTelemetryConfiguration class]] ||
      !configuration.enabled || configuration.projectId.length == 0 ||
      !configuration.baseURL.host.length || configuration.baseURL.user ||
      configuration.baseURL.password || configuration.baseURL.query || configuration.baseURL.fragment ||
      !AXXIsHTTPURL(configuration.baseURL) ||
      ([configuration.baseURL.scheme.lowercaseString isEqualToString:@"http"] && !configuration.allowsInsecureHTTP) ||
      !configuration.endpointPath.length || [configuration.endpointPath hasPrefix:@"/"] ||
      [configuration.endpointPath containsString:@".."] ||
      [configuration.endpointPath containsString:@"?"] ||
      [configuration.endpointPath containsString:@"#"] ||
      configuration.timeoutInterval < 1 || configuration.timeoutInterval > 120 ||
      configuration.maxRetryCount < 0 || configuration.maxRetryCount > 8) return NO;
  if (self.started) {
    AXXTelemetryConfiguration *current = self.configuration;
    return [current.projectId isEqualToString:configuration.projectId] &&
           [current.baseURL isEqual:configuration.baseURL] &&
           [current.endpointPath isEqualToString:configuration.endpointPath] &&
           [(current.environment ?: @"") isEqualToString:(configuration.environment ?: @"")] &&
           [(current.appId ?: @"") isEqualToString:(configuration.appId ?: @"")] &&
           [(current.channel ?: @"") isEqualToString:(configuration.channel ?: @"")] &&
           [(current.appVersion ?: @"") isEqualToString:(configuration.appVersion ?: @"")] &&
           [(current.appBuildVersion ?: @"") isEqualToString:(configuration.appBuildVersion ?: @"")] &&
           [(current.sdkVersion ?: @"") isEqualToString:(configuration.sdkVersion ?: @"")] &&
           current.debugLoggingEnabled == configuration.debugLoggingEnabled &&
           current.enabled == configuration.enabled &&
           current.launchEnabled == configuration.launchEnabled &&
           current.lifecycleEnabled == configuration.lifecycleEnabled &&
           current.memoryEnabled == configuration.memoryEnabled &&
           current.networkEnabled == configuration.networkEnabled &&
           current.metricKitEnabled == configuration.metricKitEnabled &&
           current.timeoutInterval == configuration.timeoutInterval &&
           current.maxRetryCount == configuration.maxRetryCount &&
           current.allowsInsecureHTTP == configuration.allowsInsecureHTTP;

  }

  self.configuration = configuration;
  self.contextId = AXXCompactIdentifier();
  self.sessionId = AXXCompactIdentifier();
  self.startedAt = [NSDate date];
  self.started = YES;

  NSURLSessionConfiguration *sessionConfiguration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  sessionConfiguration.timeoutIntervalForRequest = MAX(1.0, self.configuration.timeoutInterval);
  sessionConfiguration.timeoutIntervalForResource = MAX(2.0, self.configuration.timeoutInterval * 2.0);
  sessionConfiguration.waitsForConnectivity = NO;
  self.uploadSession = [NSURLSession sessionWithConfiguration:sessionConfiguration];

  if (configuration.lifecycleEnabled || configuration.memoryEnabled) {
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    if (configuration.lifecycleEnabled) {
      [center addObserver:self selector:@selector(onDidBecomeActive:) name:UIApplicationDidBecomeActiveNotification object:nil];
      [center addObserver:self selector:@selector(onDidEnterBackground:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    }
    if (configuration.memoryEnabled) {
      [center addObserver:self selector:@selector(onMemoryWarning:) name:UIApplicationDidReceiveMemoryWarningNotification object:nil];
    }
  }
  if (configuration.networkEnabled) [self startNetworkMonitor];
#if AXX_HAS_METRICKIT
  if (configuration.metricKitEnabled) {
    if (@available(iOS 14.0, *)) {
      [[MXMetricManager sharedManager] addSubscriber:self];
    }
  }
#endif

  [self log:@"native telemetry started" extra:@{ @"contextId": self.contextId ?: @"" }];
  if (configuration.launchEnabled) [self postSnapshotWithEventType:@"reporter_start"];
  return YES;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  if (self.networkMonitor) nw_path_monitor_cancel(self.networkMonitor);
#if AXX_HAS_METRICKIT
  if (@available(iOS 14.0, *)) [[MXMetricManager sharedManager] removeSubscriber:self];
#endif
}

- (void)log:(NSString *)message extra:(NSDictionary *)extra {
  if (!self.configuration.debugLoggingEnabled) return;
  NSLog(@"[AXX Telemetry] %@ %@", message, extra ?: @{});
}

- (void)onDidBecomeActive:(NSNotification *)note { [self postSnapshotWithEventType:@"foreground"]; }
- (void)onDidEnterBackground:(NSNotification *)note { [self postSnapshotWithEventType:@"background"]; }
- (void)onMemoryWarning:(NSNotification *)note {
  @synchronized (self) { self.memoryWarningCount += 1; }
  [self postSnapshotWithEventType:@"memory_warning"];
}

- (void)startNetworkMonitor {
  nw_path_monitor_t monitor = nw_path_monitor_create();
  dispatch_queue_t queue = dispatch_queue_create("com.axx.telemetry.network", DISPATCH_QUEUE_SERIAL);
  __weak typeof(self) weakSelf = self;
  nw_path_monitor_set_update_handler(monitor, ^(nw_path_t path) {
    __strong typeof(weakSelf) self = weakSelf;
    if (!self) return;
    NSString *networkType = [self networkTypeForPath:path];
    NSString *carrier = [self currentCarrier] ?: @"";
    BOOL changed;
    @synchronized (self) {
      changed = ![networkType isEqualToString:(self.networkType ?: @"")] ||
                ![carrier isEqualToString:(self.carrier ?: @"")];
      self.networkType = networkType;
      self.carrier = carrier;
    }
    if (changed) [self postSnapshotWithEventType:@"network_change"];
  });
  nw_path_monitor_set_queue(monitor, queue);
  nw_path_monitor_start(monitor);
  self.networkMonitor = monitor;
  self.networkQueue = queue;
}

- (NSString *)networkTypeForPath:(nw_path_t)path {
  if (nw_path_get_status(path) == nw_path_status_unsatisfied) return @"offline";
  if (nw_path_uses_interface_type(path, nw_interface_type_wifi)) return @"wifi";
  if (nw_path_uses_interface_type(path, nw_interface_type_wired)) return @"wired";
  if (nw_path_uses_interface_type(path, nw_interface_type_cellular)) {
    NSString *technology = [self currentRadioAccessTechnology];
    if ([technology containsString:@"LTE"]) return @"4g";
    if ([technology containsString:@"NR"] || [technology containsString:@"5G"]) return @"5g";
    if ([technology containsString:@"WCDMA"] || [technology containsString:@"HSDPA"] || [technology containsString:@"HSUPA"]) return @"3g";
    if ([technology containsString:@"GPRS"] || [technology containsString:@"Edge"] || [technology containsString:@"CDMA1x"]) return @"2g";
    return @"cellular";
  }
  return @"unknown";
}

- (NSString *)currentRadioAccessTechnology {
  if (@available(iOS 12.0, *)) {
    NSDictionary *technologies = [[[CTTelephonyNetworkInfo alloc] init] serviceCurrentRadioAccessTechnology];
    for (NSString *value in technologies.allValues) if (value.length) return value;
  }
  return @"";
}

- (NSString *)currentCarrier {
  if (@available(iOS 12.0, *)) {
    NSDictionary *providers = [[[CTTelephonyNetworkInfo alloc] init] serviceSubscriberCellularProviders];
    for (CTCarrier *value in providers.allValues) if (value.carrierName.length) return value.carrierName;
  }
  return @"";
}

- (NSString *)modelIdentifier {
  struct utsname info;
  if (uname(&info) == 0 && info.machine[0] != '\0') {
    NSString *value = [NSString stringWithCString:info.machine encoding:NSUTF8StringEncoding];
    if (value.length) return value;
  }
  return UIDevice.currentDevice.model ?: @"unknown";
}

- (NSDictionary *)nativeSnapshotForEventType:(NSString *)eventType {
  mach_task_basic_info_data_t memoryInfo;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  BOOL memoryAvailable = task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&memoryInfo, &count) == KERN_SUCCESS;
  NSInteger warnings;
  @synchronized (self) {
    warnings = self.memoryWarningCount;
  }
  return @{
    @"trigger": eventType ?: @"unknown",
    @"reporterUptimeMs": @((NSInteger)([[NSDate date] timeIntervalSinceDate:self.startedAt] * 1000)),
    @"residentMemoryBytes": memoryAvailable ? @((unsigned long long)memoryInfo.resident_size) : NSNull.null,
    @"physicalMemoryBytes": @((unsigned long long)NSProcessInfo.processInfo.physicalMemory),
    @"memoryWarningCount": @(warnings)
  };
}

- (NSString *)currentNetworkType {
  @synchronized (self) { return self.networkType ?: @"unknown"; }
}

- (NSString *)currentCarrierName {
  @synchronized (self) { return self.carrier; }
}

- (NSDictionary *)basePayloadForEventType:(NSString *)eventType {
  NSBundle *bundle = NSBundle.mainBundle;
  NSLocale *locale = NSLocale.currentLocale;
  NSTimeZone *timeZone = NSTimeZone.localTimeZone;
  NSString *now = [[NSISO8601DateFormatter new] stringFromDate:[NSDate date]];
  AXXTelemetryConfiguration *configuration = self.configuration;
  NSMutableDictionary *payload = [@{
    @"schema": AXXSchema,
    @"source": @"ios",
    @"eventId": AXXCompactIdentifier(),
    @"eventType": eventType ?: @"unknown",
    @"projectId": configuration.projectId ?: @"",
    @"appId": configuration.appId ?: bundle.bundleIdentifier ?: @"",
    @"environment": configuration.environment ?: @"",
    @"contextId": self.contextId ?: @"",
    @"sessionId": self.sessionId ?: @"",
    @"occurredAt": now,
    @"capturedAt": now,
    @"clientTimestamp": @([[NSDate date] timeIntervalSince1970] * 1000.0),
    @"device": @{
      @"model": UIDevice.currentDevice.model ?: @"",
      @"modelIdentifier": [self modelIdentifier],
      @"os": UIDevice.currentDevice.systemName ?: @"",
      @"osVersion": UIDevice.currentDevice.systemVersion ?: @""
    },
    @"app": @{
      @"version": configuration.appVersion ?: [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"",
      @"build": configuration.appBuildVersion ?: [bundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"",
      @"bundleIdentifier": bundle.bundleIdentifier ?: @"",
      @"channel": configuration.channel ?: @"",
      @"sdkVersion": configuration.sdkVersion ?: @"1.0.0"
    },
    @"screen": @{
      @"width": @(UIScreen.mainScreen.bounds.size.width),
      @"height": @(UIScreen.mainScreen.bounds.size.height),
      @"scale": @(UIScreen.mainScreen.scale)
    },
    @"network": @{ @"type": [self currentNetworkType], @"carrier": [self currentCarrierName] ?: NSNull.null },
    @"region": @{
      @"country": locale.countryCode ?: NSNull.null,
      @"language": locale.languageCode ?: NSNull.null,
      @"timezone": timeZone.name ?: NSNull.null
    },
    @"native": [self nativeSnapshotForEventType:eventType]
  } mutableCopy];
  return payload;
}

- (void)postSnapshotWithEventType:(NSString *)eventType {
  if (!self.started || !self.configuration.enabled) return;
  [self uploadPayload:[self basePayloadForEventType:eventType]];
}

- (void)recordNativeEvent:(NSString *)eventType payload:(NSDictionary<NSString *,id> *)payload {
  if (!self.started || !eventType.length) return;
  NSMutableDictionary *event = [[self basePayloadForEventType:eventType] mutableCopy];
  // Public event data is opt-in. Reject rather than silently persisting arbitrary
  // objects, URLs or oversized values. Applications must redact before calling.
  if (payload.count) {
    NSError *validationError = nil;
    NSDictionary *redacted = AXXRedactedValue(payload, 0);
    NSData *eventData = [NSJSONSerialization dataWithJSONObject:redacted options:0 error:&validationError];
    if (!eventData || eventData.length > AXXMaxPayloadBytes / 2) return;
    if ([eventType isEqualToString:@"metrickit_diagnostics"]) {
      NSMutableDictionary *native = [event[@"native"] mutableCopy];
      native[@"diagnostics"] = redacted;
      event[@"native"] = native;
    } else {
      event[@"event"] = redacted;
    }
  }
  [self uploadPayload:event];
}

- (NSURL *)endpointURL {
  NSURLComponents *components = [NSURLComponents componentsWithURL:self.configuration.baseURL resolvingAgainstBaseURL:NO];
  if (!components) return nil;
  NSString *basePath = components.path ?: @"";
  while ([basePath hasSuffix:@"/"]) basePath = [basePath substringToIndex:basePath.length - 1];
  NSString *path = self.configuration.endpointPath ?: @"__sink/api/ios-context";
  while ([path hasPrefix:@"/"]) path = [path substringFromIndex:1];
  components.path = [NSString stringWithFormat:@"%@/%@", basePath, path];
  components.query = nil;
  return components.URL;
}

- (void)uploadPayload:(NSDictionary *)payload {
  NSError *error;
  NSData *body = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (!body || body.length > AXXMaxPayloadBytes) {
    [self log:@"payload rejected (invalid JSON or size limit)" extra:nil];
    return;
  }
  @synchronized (self) {
    if (self.pendingUploads >= AXXMaxPendingUploads) {
      [self log:@"upload capacity reached" extra:nil];
      return;
    }
    self.pendingUploads++;
  }
  [self sendBody:body eventType:payload[@"eventType"] attempt:0];
}

- (void)finishUpload {
  @synchronized (self) { self.pendingUploads = MAX(0, self.pendingUploads - 1); }
}

- (void)sendBody:(NSData *)body eventType:(NSString *)eventType attempt:(NSInteger)attempt {
  NSURL *endpoint = [self endpointURL];
  if (!endpoint) { [self finishUpload]; return; }
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:endpoint];
  request.HTTPMethod = @"POST";
  request.HTTPBody = body;
  request.timeoutInterval = self.configuration.timeoutInterval;
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  __weak typeof(self) weakSelf = self;
  [[self.uploadSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *uploadError) {
    __strong typeof(weakSelf) self = weakSelf;
    if (!self) return;
    NSInteger status = [(NSHTTPURLResponse *)response statusCode];
    BOOL retryable = uploadError != nil || status == 408 || status == 429 || status >= 500;
    if (retryable && attempt < self.configuration.maxRetryCount) {
      int64_t seconds = (int64_t)1 << MIN(attempt, 5);
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, seconds * NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        [self sendBody:body eventType:eventType attempt:attempt + 1];
      });
      return;
    }
    [self log:(uploadError || status < 200 || status >= 300) ? @"upload failed" : @"upload succeeded"
          extra:@{ @"eventType": eventType ?: @"", @"status": @(status) }];
    [self finishUpload];
  }] resume];
}

- (NSURL *)URLByAppendingContextParametersToURL:(NSURL *)url {
  if (!url || !AXXIsHTTPURL(url) || !self.started) return [url copy];
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  if (!components) return [url copy];
  // Each load is a distinct navigation; never propagate IDs from a stale URL.
  NSMutableArray *items = [NSMutableArray array];
  for (NSURLQueryItem *item in components.queryItems ?: @[]) {
    if (![item.name isEqualToString:AXXContextQuery] &&
        ![item.name isEqualToString:AXXSessionQuery] &&
        ![item.name isEqualToString:AXXNavigationQuery]) [items addObject:item];
  }
  [items addObject:[NSURLQueryItem queryItemWithName:AXXContextQuery value:self.contextId]];
  [items addObject:[NSURLQueryItem queryItemWithName:AXXSessionQuery value:self.sessionId]];
  [items addObject:[NSURLQueryItem queryItemWithName:AXXNavigationQuery value:AXXCompactIdentifier()]];
  components.queryItems = items;
  return components.URL ?: [url copy];
}

- (NSString *)stringByAppendingContextParametersToURLString:(NSString *)urlString {
  if (![urlString isKindOfClass:[NSString class]] || !urlString.length) return urlString;
  NSURL *url = [NSURL URLWithString:urlString];
  return [self URLByAppendingContextParametersToURL:url].absoluteString ?: urlString;
}

#if AXX_HAS_METRICKIT
- (void)didReceiveDiagnosticPayloads:(NSArray<MXDiagnosticPayload *> *)payloads API_AVAILABLE(ios(14.0)) {
  if (!self.configuration.metricKitEnabled) return;
  for (MXDiagnosticPayload *payload in payloads) {
    if (!payload.crashDiagnostics.count && !payload.hangDiagnostics.count) continue;
    [self recordNativeEvent:@"metrickit_diagnostics" payload:@{
      @"source": @"MetricKit",
      @"crashes": @(payload.crashDiagnostics.count),
      @"hangs": @(payload.hangDiagnostics.count),
      @"periodStart": [[NSISO8601DateFormatter new] stringFromDate:payload.timeStampBegin],
      @"periodEnd": [[NSISO8601DateFormatter new] stringFromDate:payload.timeStampEnd]
    }];
  }
}
#endif

@end
