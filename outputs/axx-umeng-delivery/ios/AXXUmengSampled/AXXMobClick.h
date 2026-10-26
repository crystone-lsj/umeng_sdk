#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Source-compatible facade for existing MobClick calls.
/// All methods route through AXXUmengSampled's feature-level policy.
@interface AXXMobClick : NSObject

+ (void)event:(NSString *)eventId;
+ (void)event:(NSString *)eventId label:(nullable NSString *)label;
+ (void)event:(NSString *)eventId attributes:(nullable NSDictionary<NSString *, id> *)attributes;
+ (void)event:(NSString *)eventId
       attributes:(nullable NSDictionary<NSString *, id> *)attributes
          counter:(int)counter;
+ (void)event:(NSString *)eventId durations:(int)milliseconds;
+ (void)event:(NSString *)eventId label:(nullable NSString *)label durations:(int)milliseconds;
+ (void)event:(NSString *)eventId
       attributes:(nullable NSDictionary<NSString *, id> *)attributes
       durations:(int)milliseconds;

+ (void)beginLogPageView:(NSString *)pageName;
+ (void)endLogPageView:(NSString *)pageName;
+ (void)logPageView:(NSString *)pageName seconds:(int)seconds;

+ (void)profileSignInWithPUID:(NSString *)puid;
+ (void)profileSignInWithPUID:(NSString *)puid provider:(nullable NSString *)provider;
+ (void)profileSignOff;

@end

NS_ASSUME_NONNULL_END
