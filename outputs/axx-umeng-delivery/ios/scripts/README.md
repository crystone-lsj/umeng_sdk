# Verification scripts

`syntax-check.sh` requires Xcode command line tools. In this repository it locates the preserved official frameworks under `umeng-analysis/evidence/ios/`; outside this repository set:

```bash
UMCOMMON_FRAMEWORK_ROOT=/path/to/UMCommon.xcframework/ios-arm64 \
UMAPM_FRAMEWORK_ROOT=/path/to/UMAPM.xcframework/ios-arm64 \
./scripts/syntax-check.sh
```
