#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface AXXUmengSampledConfiguration : NSObject

+ (instancetype)new NS_UNAVAILABLE;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)configurationWithAppKey:(NSString *)appKey
                                channel:(nullable NSString *)channel;

@property(nonatomic, copy, readonly) NSString *appKey;
@property(nonatomic, copy, readonly, nullable) NSString *channel;

@property(nonatomic, copy, nullable) NSDictionary<NSString *, NSNumber *> *samplingRates;
@property(nonatomic, copy, nullable) NSString *samplingSalt;

@property(nonatomic, assign) BOOL logEnabled;
@property(nonatomic, assign) BOOL encryptEnabled;
@property(nonatomic, assign) BOOL analyticsEnabled;
@property(nonatomic, assign) BOOL piEnabled;
@property(nonatomic, assign) BOOL asaEnabled;
@property(nonatomic, assign) BOOL skanEnabled;
@property(nonatomic, copy, nullable) NSString *domain;

/// Use nil to retain the official SDK default. Non-nil values override it.
@property(nonatomic, copy, nullable) NSNumber *crashAndBlockMonitorEnabled;
@property(nonatomic, copy, nullable) NSNumber *launchMonitorEnabled;
@property(nonatomic, copy, nullable) NSNumber *memoryMonitorEnabled;
@property(nonatomic, copy, nullable) NSNumber *oomMonitorEnabled;
@property(nonatomic, copy, nullable) NSNumber *networkMonitorEnabled;
@property(nonatomic, copy, nullable) NSNumber *h5BridgeEnabled;
@property(nonatomic, copy, nullable) NSNumber *pageMonitorEnabled;
@property(nonatomic, copy, nullable) NSNumber *logCollectEnabled;
@property(nonatomic, copy, nullable) NSString *logCollectUserId;

@property(nonatomic, copy, nullable) NSNumber *networkForProtocolEnabled;
@property(nonatomic, copy, nullable) NSString *appVersion;
@property(nonatomic, copy, nullable) NSString *appBuildVersion;

@property(nonatomic, assign) float blockSendBeatInterval;
@property(nonatomic, assign) float blockCheckBeatInterval;
@property(nonatomic, copy, nullable) NSNumber *blockToleranceBeatMissingCount;

@end

NS_ASSUME_NONNULL_END
