#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#import "AXXSamplingPolicy.h"
#import "AXXUmengSampledConfiguration.h"

NS_ASSUME_NONNULL_BEGIN

@interface AXXUmengSampled : NSObject

@property(nonatomic, strong, readonly) AXXSamplingPolicy *policy;
@property(nonatomic, copy, readonly) NSDictionary<NSString *, NSNumber *> *activeNativeMonitors;

+ (instancetype)sharedAdapter;
- (BOOL)startWithConfiguration:(AXXUmengSampledConfiguration *)configuration;

- (BOOL)trackEvent:(NSString *)eventId;
- (BOOL)trackEvent:(NSString *)eventId label:(nullable NSString *)label;
- (BOOL)trackEvent:(NSString *)eventId attributes:(nullable NSDictionary<NSString *, id> *)attributes;
- (BOOL)trackEvent:(NSString *)eventId
        attributes:(nullable NSDictionary<NSString *, id> *)attributes
           counter:(int)counter;

- (BOOL)beginEvent:(NSString *)eventId;
- (BOOL)endEvent:(NSString *)eventId;
- (BOOL)beginEvent:(NSString *)eventId label:(nullable NSString *)label;
- (BOOL)endEvent:(NSString *)eventId label:(nullable NSString *)label;
- (BOOL)beginEvent:(NSString *)eventId
        primarykey:(NSString *)keyName
        attributes:(nullable NSDictionary<NSString *, id> *)attributes;
- (BOOL)endEvent:(NSString *)eventId primarykey:(NSString *)keyName;
- (BOOL)trackEvent:(NSString *)eventId durations:(int)milliseconds;
- (BOOL)trackEvent:(NSString *)eventId label:(nullable NSString *)label durations:(int)milliseconds;
- (BOOL)trackEvent:(NSString *)eventId
        attributes:(nullable NSDictionary<NSString *, id> *)attributes
         durations:(int)milliseconds;

- (BOOL)beginLogPageView:(NSString *)pageName;
- (BOOL)endLogPageView:(NSString *)pageName;
- (BOOL)logPageView:(NSString *)pageName seconds:(int)seconds;
- (BOOL)trackNativePageBegin:(NSString *)pageName
              viewController:(UIViewController *)viewController;
- (BOOL)trackNativePageEnd:(NSString *)pageName
            viewController:(UIViewController *)viewController;

- (BOOL)reportExceptionWithName:(NSString *)name
                         reason:(NSString *)reason
                     stackTrace:(NSArray<NSString *> *)stackTrace
                          force:(BOOL)force;
- (BOOL)addCustomInfoKey:(NSString *)key value:(NSString *)value;
- (BOOL)verboseLogWithTag:(NSString *)tag message:(NSString *)message;
- (BOOL)debugLogWithTag:(NSString *)tag message:(NSString *)message;
- (BOOL)infoLogWithTag:(NSString *)tag message:(NSString *)message;
- (BOOL)warningLogWithTag:(NSString *)tag message:(NSString *)message;
- (BOOL)errorLogWithTag:(NSString *)tag message:(NSString *)message;

- (BOOL)beginLaunchPhase:(NSString *)methodName;
- (BOOL)endLaunchPhase:(NSString *)methodName;
- (void)setPredefineLaunchTypeFinishedLaunchingEnd;
- (void)setPredefineLaunchTypeViewDidLoadEnd;
- (void)setPredefineLaunchTypeViewDidAppearEnd;
- (BOOL)profileSignInWithPUID:(NSString *)puid;
- (BOOL)profileSignInWithPUID:(NSString *)puid provider:(nullable NSString *)provider;
- (BOOL)profileSignOff;
- (BOOL)setUserProfile:(id)value forKey:(NSString *)key;

- (BOOL)setSamplingRate:(double)rate forFeature:(NSString *)feature;
- (void)applySamplingRates:(NSDictionary<NSString *, NSNumber *> *)rates;

@end

NS_ASSUME_NONNULL_END
