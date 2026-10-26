#import "AXXTelemetryWebView.h"
#import "AXXTelemetrySDK.h"

@implementation AXXTelemetryWebView

+ (NSURL *)URLByAppendingContextParametersToURL:(NSURL *)url {
  return [[AXXTelemetrySDK sharedInstance] URLByAppendingContextParametersToURL:url];
}

+ (NSString *)stringByAppendingContextParametersToURLString:(NSString *)urlString {
  return [[AXXTelemetrySDK sharedInstance] stringByAppendingContextParametersToURLString:urlString];
}

@end
