#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Controls the independent native telemetry copy. It never changes the
/// official Umeng SDK configuration or destination.
@interface AXXTelemetryConfiguration : NSObject <NSCopying>

+ (instancetype)configurationWithProjectId:(NSString *)projectId
                                    baseURL:(NSURL *)baseURL;

@property(nonatomic, copy, readonly) NSString *projectId;
@property(nonatomic, copy, readonly) NSURL *baseURL;

/// Relative path below baseURL. Defaults to __sink/api/ios-context.
@property(nonatomic, copy) NSString *endpointPath;
@property(nonatomic, copy, nullable) NSString *appId;
@property(nonatomic, copy, nullable) NSString *environment;
@property(nonatomic, copy, nullable) NSString *channel;
@property(nonatomic, copy, nullable) NSString *sdkVersion;
@property(nonatomic, copy, nullable) NSString *appVersion;
@property(nonatomic, copy, nullable) NSString *appBuildVersion;

@property(nonatomic, assign) BOOL enabled;
@property(nonatomic, assign) BOOL launchEnabled;
@property(nonatomic, assign) BOOL lifecycleEnabled;
@property(nonatomic, assign) BOOL memoryEnabled;
@property(nonatomic, assign) BOOL networkEnabled;
@property(nonatomic, assign) BOOL metricKitEnabled;
@property(nonatomic, assign) BOOL debugLoggingEnabled;

@property(nonatomic, assign) NSTimeInterval timeoutInterval;
@property(nonatomic, assign) NSInteger maxRetryCount;
/// Explicit opt-in for HTTP receivers on a trusted development LAN.
@property(nonatomic, assign) BOOL allowsInsecureHTTP;

@end

NS_ASSUME_NONNULL_END
