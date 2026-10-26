#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

extern NSString * const AXXSampledFeatureEvent;
extern NSString * const AXXSampledFeaturePageView;
extern NSString * const AXXSampledFeatureCrash;
extern NSString * const AXXSampledFeatureBlock;
extern NSString * const AXXSampledFeatureLaunch;
extern NSString * const AXXSampledFeatureMemory;
extern NSString * const AXXSampledFeatureOOM;
extern NSString * const AXXSampledFeatureNetwork;
extern NSString * const AXXSampledFeatureH5Bridge;
extern NSString * const AXXSampledFeaturePageMonitor;
extern NSString * const AXXSampledFeatureLogCollect;
extern NSString * const AXXSampledFeatureCustomLog;
extern NSString * const AXXSampledFeatureUserProfile;

/// Thread-safe deterministic 0..1 bucketing policy.
/// Rates are stored independently, but some native monitors have shared official
/// switches; see AXXUmengSampled documentation for the crash/block limitation.
@interface AXXSamplingPolicy : NSObject

- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
- (instancetype)initWithSalt:(nullable NSString *)salt NS_DESIGNATED_INITIALIZER;

- (BOOL)setRate:(double)rate forFeature:(NSString *)feature;
- (void)applyRates:(nullable NSDictionary<NSString *, NSNumber *> *)rates;
- (double)rateForFeature:(NSString *)feature;
- (BOOL)shouldSampleFeature:(NSString *)feature subject:(nullable NSString *)subject;
- (NSDictionary<NSString *, NSNumber *> *)samplingRates;

@end

NS_ASSUME_NONNULL_END
