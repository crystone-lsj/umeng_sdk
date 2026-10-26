# AXX Umeng target-project integration

The prepared integration replaces direct initialization/manual analytics with
the AXX gateway. Official Umeng components remain the transport because AXX
wraps their public APIs; it does not redistribute or reimplement private Umeng
protocols. All AXX feature rates are initialized to `1.0`, and remote sampling
configuration is disabled.

## Apply

```bash
python3 /Users/mac/REA/rea/outputs/integration-gslearnwhat-bx-app-h5/apply-integration.py \
  --ios-root /Users/mac/develop/ios/newIos/ios-assets/apps/gslearnwhat/GSLearnwhat \
  --h5-root /Users/mac/develop/h5/app_inner_h5/gs-vue \
  --install
```

The script is idempotent only in the sense that it refuses to overwrite an
existing AXX destination. Re-run after deleting generated destinations if
necessary.

## Verify

iOS:

```bash
pod install --project-directory=/Users/mac/develop/ios/newIos/ios-assets/apps/gslearnwhat/GSLearnwhat
xcodebuild -workspace /Users/mac/develop/ios/newIos/ios-assets/apps/gslearnwhat/GSLearnwhat/GSLearnwhat.xcworkspace \
  -scheme GSLearnwhat -sdk iphonesimulator -configuration Debug build
```

H5:

```bash
cd /Users/mac/develop/h5/app_inner_h5/gs-vue/apps/bx-app-h5
pnpm lint
pnpm build
```

## Runtime checks

- iOS log should include `[AXX Umeng] start result=1`.
- H5 console should not log `AXX Umeng H5 init failed`.
- The old CDN `uapm.iife.js` request should no longer appear.
- Native H5 bridge remains enabled through `AXXSampledFeatureH5Bridge = 1.0`.
