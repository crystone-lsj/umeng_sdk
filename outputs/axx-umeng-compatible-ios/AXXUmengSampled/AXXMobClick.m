#import "AXXMobClick.h"
#import "AXXUmengSampled.h"

@implementation AXXMobClick

+ (void)event:(NSString *)eventId {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId];
}

+ (void)event:(NSString *)eventId label:(NSString *)label {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId label:label];
}

+ (void)event:(NSString *)eventId attributes:(NSDictionary<NSString *, id> *)attributes {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId attributes:attributes];
}

+ (void)event:(NSString *)eventId
       attributes:(NSDictionary<NSString *, id> *)attributes
          counter:(int)counter {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId
                                   attributes:attributes
                                      counter:counter];
}

+ (void)event:(NSString *)eventId durations:(int)milliseconds {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId durations:milliseconds];
}

+ (void)event:(NSString *)eventId label:(NSString *)label durations:(int)milliseconds {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId label:label durations:milliseconds];
}

+ (void)event:(NSString *)eventId
       attributes:(NSDictionary<NSString *, id> *)attributes
       durations:(int)milliseconds {
  [[AXXUmengSampled sharedAdapter] trackEvent:eventId
                                   attributes:attributes
                                   durations:milliseconds];
}

+ (void)beginLogPageView:(NSString *)pageName {
  [[AXXUmengSampled sharedAdapter] beginLogPageView:pageName];
}

+ (void)endLogPageView:(NSString *)pageName {
  [[AXXUmengSampled sharedAdapter] endLogPageView:pageName];
}

+ (void)logPageView:(NSString *)pageName seconds:(int)seconds {
  [[AXXUmengSampled sharedAdapter] logPageView:pageName seconds:seconds];
}

+ (void)profileSignInWithPUID:(NSString *)puid {
  [[AXXUmengSampled sharedAdapter] profileSignInWithPUID:puid];
}

+ (void)profileSignInWithPUID:(NSString *)puid provider:(NSString *)provider {
  [[AXXUmengSampled sharedAdapter] profileSignInWithPUID:puid provider:provider];
}

+ (void)profileSignOff {
  [[AXXUmengSampled sharedAdapter] profileSignOff];
}

@end
