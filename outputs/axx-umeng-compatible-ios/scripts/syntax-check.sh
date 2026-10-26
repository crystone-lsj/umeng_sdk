#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${IOS_SDK_ROOT:-$(xcrun --sdk iphoneos --show-sdk-path)}"
COMMON="${UMCOMMON_FRAMEWORK_ROOT:-$ROOT/../../umeng-analysis/evidence/ios/extracted/UMCommon_7.6.4/UMCommon_7.6.4/UMCommon.xcframework/ios-arm64}"
APM="${UMAPM_FRAMEWORK_ROOT:-$ROOT/../../umeng-analysis/evidence/ios/extracted/UMAPM_2.0.7/UMAPM_2.0.7/UMAPM.xcframework/ios-arm64}"

for framework in "$COMMON" "$APM"; do
  if [[ ! -d "$framework" ]]; then
    echo "Missing framework root: $framework" >&2
    echo "Set UMCOMMON_FRAMEWORK_ROOT and UMAPM_FRAMEWORK_ROOT." >&2
    exit 2
  fi
done

clang -fsyntax-only \
  -fobjc-arc \
  -fno-modules \
  -Wno-nullability-completeness \
  -isysroot "$SDK" \
  -miphoneos-version-min=12.0 \
  -F "$COMMON" \
  -F "$APM" \
  -I "$ROOT/AXXUmengSampled" \
  "$ROOT/AXXUmengSampled"/*.m

echo "Objective-C syntax check passed."
