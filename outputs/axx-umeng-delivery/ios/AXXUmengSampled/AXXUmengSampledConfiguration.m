#import "AXXUmengSampledConfiguration.h"

@implementation AXXUmengSampledConfiguration

+ (instancetype)configurationWithAppKey:(NSString *)appKey
                                channel:(nullable NSString *)channel {
  return [[self alloc] initWithAppKey:appKey channel:channel];
}

- (instancetype)initWithAppKey:(NSString *)appKey
                       channel:(nullable NSString *)channel {
  self = [super init];
  if (self) {
    _appKey = [appKey copy];
    _channel = [channel copy];
    _analyticsEnabled = YES;
    _piEnabled = YES;
    _asaEnabled = YES;
    _skanEnabled = NO;
    _blockSendBeatInterval = 2.0f;
    _blockCheckBeatInterval = 2.0f;
  }
  return self;
}

@end
