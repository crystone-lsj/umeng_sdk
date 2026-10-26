#import "AXXTelemetryConfiguration.h"

@implementation AXXTelemetryConfiguration

+ (instancetype)configurationWithProjectId:(NSString *)projectId
                                    baseURL:(NSURL *)baseURL {
  AXXTelemetryConfiguration *configuration = [[self alloc] initWithProjectId:projectId
                                                                       baseURL:baseURL];
  return configuration;
}

- (instancetype)initWithProjectId:(NSString *)projectId baseURL:(NSURL *)baseURL {
  self = [super init];
  if (!self) return nil;
  _projectId = [projectId copy];
  _baseURL = [baseURL copy];
  _endpointPath = @"__sink/api/ios-context";
  _enabled = YES;
  _launchEnabled = YES;
  _lifecycleEnabled = YES;
  _memoryEnabled = YES;
  _networkEnabled = YES;
  _metricKitEnabled = YES;
  _timeoutInterval = 10.0;
  _maxRetryCount = 5;
  return self;
}

- (id)copyWithZone:(NSZone *)zone {
  AXXTelemetryConfiguration *copy = [[[self class] allocWithZone:zone] initWithProjectId:self.projectId baseURL:self.baseURL];
  copy.endpointPath = self.endpointPath;
  copy.appId = self.appId;
  copy.environment = self.environment;
  copy.channel = self.channel;
  copy.sdkVersion = self.sdkVersion;
  copy.appVersion = self.appVersion;
  copy.appBuildVersion = self.appBuildVersion;
  copy.enabled = self.enabled;
  copy.launchEnabled = self.launchEnabled;
  copy.lifecycleEnabled = self.lifecycleEnabled;
  copy.memoryEnabled = self.memoryEnabled;
  copy.networkEnabled = self.networkEnabled;
  copy.metricKitEnabled = self.metricKitEnabled;
  copy.debugLoggingEnabled = self.debugLoggingEnabled;
  copy.timeoutInterval = self.timeoutInterval;
  copy.maxRetryCount = self.maxRetryCount;
  copy.allowsInsecureHTTP = self.allowsInsecureHTTP;
  return copy;
}

@end
