#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${IOS_SDK_ROOT:-$(xcrun --sdk iphoneos --show-sdk-path)}"
clang -fsyntax-only -fobjc-arc -fno-modules \
  -Wno-nullability-completeness \
  -isysroot "$SDK" -miphoneos-version-min=12.0 \
  -I "$ROOT/AXXTelemetryIOS" \
  "$ROOT/AXXTelemetryIOS"/*.m
printf '%s\n' 'AXXTelemetryIOS Objective-C syntax check passed.'
