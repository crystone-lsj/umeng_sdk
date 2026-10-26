#!/usr/bin/env python3
"""Apply the prepared AXX Umeng integration to the two target projects."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
IOS_SDK = REPO_ROOT / "outputs" / "axx-umeng-compatible-ios"
H5_SDK = REPO_ROOT / "outputs" / "axx-umeng-compatible-h5"


def fail(message: str) -> None:
    raise SystemExit(message)


def replace_once(text: str, old: str, new: str, path: Path) -> str:
    count = text.count(old)
    if count != 1:
        fail(f"Expected exactly one match in {path}, found {count}")
    return text.replace(old, new, 1)


def copy_sdk(source: Path, destination: Path, include_tests: bool = False) -> None:
    if destination.exists():
        fail(f"Refusing to overwrite existing destination: {destination}")
    destination.mkdir(parents=True)
    for item in source.iterdir():
        if item.name in {"Example", "scripts", "node_modules", ".DS_Store"}:
            continue
        if not include_tests and item.name == "test":
            continue
        target = destination / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)


def integrate_ios(ios_root: Path) -> None:
    app_root = ios_root / "GSLearnwhat"
    podfile = ios_root / "Podfile"
    launch_file = app_root / "AppDelegate" / "AppDelegate+UMeng.m"
    prefix_file = app_root / "Config" / "PrefixHeader.pch"
    destination = ios_root / "thirdPodspec" / "AXXUmengSampled"
    for path in (podfile, launch_file, prefix_file):
        if not path.is_file():
            fail(f"Required iOS file is missing: {path}")

    copy_sdk(IOS_SDK, destination)

    text = podfile.read_text()
    text = replace_once(
        text,
        "  # 友盟\n  pod 'UMCommon', '7.5.8'",
        "  # 友盟\n  pod 'AXXUmengSampled', :path => './thirdPodspec/AXXUmengSampled'\n  pod 'UMCommon', '7.5.8'",
        podfile,
    )
    podfile.write_text(text)

    text = launch_file.read_text()
    text = replace_once(
        text,
        '#import "AppDelegate+UMeng.h"\n',
        '#import "AppDelegate+UMeng.h"\n#import <AXXUmengSampled/AXXUmengSampled.h>\n',
        launch_file,
    )
    old_start = "        // 显式配置 U-APM，确保 H5 打通、页面分析、启动监控、崩溃卡顿监控全部开启。"
    old_end = "        [UMConfigure initWithAppkey:UMENG_APPKEY channel:nil];\n"
    start = text.index(old_start)
    end = text.index(old_end, start) + len(old_end)
    replacement = """        // AXX 统一入口：固定 100% 采集，远端采样开关由 AXX 控制。
        AXXUmengSampledConfiguration *axxConfiguration =
            [AXXUmengSampledConfiguration configurationWithAppKey:UMENG_APPKEY channel:nil];
        axxConfiguration.samplingSalt = @"gslearnwhat.axx.umeng.v1";
        axxConfiguration.samplingRates = @{
            AXXSampledFeatureEvent: @1.0,
            AXXSampledFeaturePageView: @1.0,
            AXXSampledFeatureCrash: @1.0,
            AXXSampledFeatureBlock: @1.0,
            AXXSampledFeatureLaunch: @1.0,
            AXXSampledFeatureMemory: @1.0,
            AXXSampledFeatureOOM: @1.0,
            AXXSampledFeatureNetwork: @1.0,
            AXXSampledFeatureH5Bridge: @1.0,
            AXXSampledFeaturePageMonitor: @1.0,
            AXXSampledFeatureLogCollect: @1.0,
            AXXSampledFeatureCustomLog: @1.0,
            AXXSampledFeatureUserProfile: @1.0
        };
        axxConfiguration.crashAndBlockMonitorEnabled = @YES;
        axxConfiguration.launchMonitorEnabled = @YES;
        axxConfiguration.memoryMonitorEnabled = @YES;
        axxConfiguration.oomMonitorEnabled = @YES;
        axxConfiguration.networkMonitorEnabled = @YES;
        axxConfiguration.h5BridgeEnabled = @YES;
        axxConfiguration.pageMonitorEnabled = @YES;
        axxConfiguration.logCollectEnabled = @YES;
        BOOL axxStarted = [[AXXUmengSampled sharedAdapter] startWithConfiguration:axxConfiguration];
        NSLog(@"[AXX Umeng] start result=%d, rates=%@",
              axxStarted,
              [AXXUmengSampled sharedAdapter].policy.samplingRates);

"""
    text = text[:start] + replacement + text[end:]
    launch_file.write_text(text)

    text = prefix_file.read_text()
    text = replace_once(
        text,
        "#import <UMCommon/UMCommon.h>\n",
        "#import <UMCommon/UMCommon.h>\n#import <AXXUmengSampled/AXXMobClick.h>\n",
        prefix_file,
    )
    prefix_file.write_text(text)

    changed = 0
    for source_file in app_root.rglob("*.m"):
        old = source_file.read_text()
        new = old.replace("[MobClick ", "[AXXMobClick ")
        if new != old:
            source_file.write_text(new)
            changed += 1
    print(f"iOS SDK copied to {destination}")
    print(f"iOS MobClick call sites updated in {changed} files")


def integrate_h5(h5_root: Path, install: bool) -> None:
    app_root = h5_root / "apps" / "bx-app-h5"
    package_file = app_root / "package.json"
    index_file = app_root / "index.html"
    main_file = app_root / "src" / "main.js"
    destination = app_root / "vendor" / "axx-umeng-h5-sampled"
    for path in (package_file, index_file, main_file):
        if not path.is_file():
            fail(f"Required H5 file is missing: {path}")

    copy_sdk(H5_SDK, destination)
    package = json.loads((destination / "package.json").read_text())
    package["name"] = "axx-umeng-h5-sampled"
    (destination / "package.json").write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n"
    )

    package = json.loads(package_file.read_text())
    dependencies = package.setdefault("dependencies", {})
    dependencies["@umengfe/apm"] = "2.0.11"
    dependencies["axx-umeng-h5-sampled"] = "file:vendor/axx-umeng-h5-sampled"
    package_file.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")

    text = index_file.read_text()
    old_start = "    <script>\n      window._um_apm_namespace = '_apm';"
    old_end = '    <script src="https://g.alicdn.com/jssdk/apm/1.0.2/es5/uapm.iife.js" crossorigin></script>\n'
    start = text.index(old_start)
    end = text.index(old_end, start) + len(old_end)
    index_file.write_text(text[:start] + text[end:])

    text = main_file.read_text()
    marker = 'import * as Sentry from "@sentry/vue";\n'
    text = replace_once(
        text,
        marker,
        marker + 'import { initAXXUmengSampled } from "axx-umeng-h5-sampled";\n',
        main_file,
    )
    old = "async function init() {\n  try {\n    await silentLogin();"
    new = """async function init() {
  try {
    await initAXXUmengSampled({
      salt: "bx-app-h5.axx.umeng.v1",
      rates: {
        api: 1,
        pv: 1,
        error: 1,
        perf: 1,
        perf_fcp: 1,
        perf_fid: 1,
        blank: 1
      },
      config: {
        pageFilter: { mode: "ignore", rules: [] },
        pkgList: ["com.student.learnwhat"],
        logLevel: 3
      }
    });
  } catch (error) {
    console.error("AXX Umeng H5 init failed:", error);
  }

  try {
    await silentLogin();"""
    text = replace_once(text, old, new, main_file)
    main_file.write_text(text)

    print(f"H5 SDK copied to {destination}")
    if install:
        subprocess.run(
            ["pnpm", "install", "--frozen-lockfile=false"],
            cwd=app_root,
            check=True,
        )
    else:
        print("Run: pnpm install --frozen-lockfile=false")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--ios-root",
        type=Path,
        default=Path("/Users/mac/develop/ios/newIos/ios-assets/apps/gslearnwhat/GSLearnwhat"),
    )
    parser.add_argument(
        "--h5-root",
        type=Path,
        default=Path("/Users/mac/develop/h5/app_inner_h5/gs-vue"),
    )
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    integrate_ios(args.ios_root)
    integrate_h5(args.h5_root, args.install)
    print("AXX integration applied. Remember to run pod install and project builds.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        fail(f"{type(error).__name__}: {error}")
