#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// WebView integration helpers. The SDK does not swizzle or own WKWebView.
@interface AXXTelemetryWebView : NSObject

+ (NSURL *)URLByAppendingContextParametersToURL:(NSURL *)url;
+ (nullable NSString *)stringByAppendingContextParametersToURLString:(nullable NSString *)urlString;

@end

NS_ASSUME_NONNULL_END
