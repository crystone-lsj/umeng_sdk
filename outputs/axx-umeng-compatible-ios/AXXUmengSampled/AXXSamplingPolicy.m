#import "AXXSamplingPolicy.h"

NSString * const AXXSampledFeatureEvent = @"event";
NSString * const AXXSampledFeaturePageView = @"pageView";
NSString * const AXXSampledFeatureCrash = @"crash";
NSString * const AXXSampledFeatureBlock = @"block";
NSString * const AXXSampledFeatureLaunch = @"launch";
NSString * const AXXSampledFeatureMemory = @"memory";
NSString * const AXXSampledFeatureOOM = @"oom";
NSString * const AXXSampledFeatureNetwork = @"network";
NSString * const AXXSampledFeatureH5Bridge = @"h5Bridge";
NSString * const AXXSampledFeaturePageMonitor = @"pageMonitor";
NSString * const AXXSampledFeatureLogCollect = @"logCollect";
NSString * const AXXSampledFeatureCustomLog = @"customLog";
NSString * const AXXSampledFeatureUserProfile = @"userProfile";

static NSArray<NSString *> *UMSAllFeatures(void) {
  static NSArray<NSString *> *features;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    features = @[
      AXXSampledFeatureEvent,
      AXXSampledFeaturePageView,
      AXXSampledFeatureCrash,
      AXXSampledFeatureBlock,
      AXXSampledFeatureLaunch,
      AXXSampledFeatureMemory,
      AXXSampledFeatureOOM,
      AXXSampledFeatureNetwork,
      AXXSampledFeatureH5Bridge,
      AXXSampledFeaturePageMonitor,
      AXXSampledFeatureLogCollect,
      AXXSampledFeatureCustomLog,
      AXXSampledFeatureUserProfile
    ];
  });
  return features;
}

@interface AXXSamplingPolicy ()
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *rates;
@property(nonatomic, copy) NSString *salt;
@end

@implementation AXXSamplingPolicy

- (instancetype)initWithSalt:(nullable NSString *)salt {
  self = [super init];
  if (self) {
    _queue = dispatch_queue_create("local.axxumengsampled.policy", DISPATCH_QUEUE_CONCURRENT);
    _rates = [NSMutableDictionary dictionary];
    for (NSString *feature in UMSAllFeatures()) {
      _rates[feature] = @1.0;
    }
    _salt = [salt copy] ?: @"";
  }
  return self;
}

- (BOOL)setRate:(double)rate forFeature:(NSString *)feature {
  if (feature.length == 0 || !isfinite(rate) || rate < 0.0 || rate > 1.0) {
    return NO;
  }
  NSNumber *number = @(rate);
  dispatch_barrier_sync(self.queue, ^{
    if ([UMSAllFeatures() containsObject:feature]) {
      self.rates[feature] = number;
    }
  });
  return YES;
}

- (void)applyRates:(nullable NSDictionary<NSString *, NSNumber *> *)rates {
  [rates enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSNumber *value, BOOL *stop) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [self setRate:value.doubleValue forFeature:key];
    }
  }];
}

- (double)rateForFeature:(NSString *)feature {
  __block double result = 0.0;
  dispatch_sync(self.queue, ^{
    result = self.rates[feature].doubleValue;
  });
  return result;
}

- (BOOL)shouldSampleFeature:(NSString *)feature subject:(nullable NSString *)subject {
  double rate = [self rateForFeature:feature];
  if (rate <= 0.0) return NO;
  if (rate >= 1.0) return YES;
  return UMSStableRateForFeature(feature, subject, self.salt) < rate;
}

- (NSDictionary<NSString *, NSNumber *> *)samplingRates {
  __block NSDictionary<NSString *, NSNumber *> *result;
  dispatch_sync(self.queue, ^{
    result = [self.rates copy];
  });
  return result;
}

static double UMSStableRateForFeature(NSString *feature,
                                      NSString * _Nullable nullableSubject,
                                      NSString *salt) {
  NSString *text = [NSString stringWithFormat:@"%@\0%@:%@",
                    salt ?: @"",
                    feature ?: @"",
                    nullableSubject.length ? nullableSubject : (feature ?: @"")];
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
  const unsigned char *bytes = data.bytes;
  uint32_t hash = 0x811c9dc5u;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    hash ^= bytes[index];
    hash = (uint32_t)(hash * 0x01000193u);
  }
  return (double)hash / 4294967296.0;
}

@end
