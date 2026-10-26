#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#import "AXXTelemetryConfiguration.h"

NS_ASSUME_NONNULL_BEGIN

/// Independent native telemetry SDK. It reports only to the configured
/// self-hosted receiver and does not intercept or replace official Umeng SDK
/// traffic.
@interface AXXTelemetrySDK : NSObject

+ (instancetype)sharedInstance;

@property(nonatomic, copy, readonly, nullable) NSString *contextId;
@property(nonatomic, copy, readonly, nullable) NSString *sessionId;
@property(nonatomic, copy, readonly, nullable) AXXTelemetryConfiguration *configuration;
@property(nonatomic, assign, readonly, getter=isStarted) BOOL started;

- (BOOL)startWithConfiguration:(AXXTelemetryConfiguration *)configuration;

/// Adds current context/session and a fresh navigation ID per URL preparation.
/// Old telemetry query values are replaced; other query items and fragment remain.
- (NSURL *)URLByAppendingContextParametersToURL:(NSURL *)url;
- (nullable NSString *)stringByAppendingContextParametersToURLString:(nullable NSString *)urlString;

/// Sends an application-owned native event with a JSON-compatible payload.
/// This is additive; it does not replace official crash/APM collection.
- (void)recordNativeEvent:(NSString *)eventType
                  payload:(nullable NSDictionary<NSString *, id> *)payload;

@end

NS_ASSUME_NONNULL_END
