# H5 端协议与「后台收不到数据」根因

分析对象：`@umengfe/apm@2.0.11`（友盟 U-APM H5/JS SDK）。

证据：[`evidence/h5/package/package/dist/esm/uapm.esm.js`](evidence/h5/package/package/dist/esm/uapm.esm.js)
（SHA-256 `d2e1298c882e00d3a98e7e1415d6358c7f1ff5bc3d210d189992d17d5f17256c`；压缩包
`umengfe-apm-2.0.11.tgz` SHA-256 `a56f201932055713e666c746096d32b63ef6ace50126b39070b871bf20c90050`）。
该 dist 是单行压缩代码，本文按「函数名 @ 字节偏移」引用，函数名即 dist 中的原始标识符，可直接定位。

分类标签：【观测】= 代码/字节级事实；【推导】= 由观测按实现语义推出；【推断】= 未取证但合理的解释；
【未知】= 当前证据无法判定。

## 1. 端点与传输契约

【观测】`ae(kind)` @8029 与 `te()` @7851 组装 URL：

```js
var ne = "https://errlog.umeng.com";       // dsn，init({ dsn }) 可覆盖
function te(){ return ne }
function ae(e){ var n = "?a="+pid+"&ver=1"; Q().enableCrypt && (n+="&dc=1");
  return te()+"/"+{ beacon:"apm_web_ping"+n, post:"apm_web_logs"+n, image:"apm_web_img.gif"+n }[e] }
```

| 用途 | 方法 | 路径 | 触发条件 |
| --- | --- | --- | --- |
| 日志上报 | POST | `{dsn}/apm_web_logs?a=<pid>&ver=1` | 队列 `>0`（主通道） |
| 卸载/保活 | `sendBeacon` | `{dsn}/apm_web_ping?a=<pid>&ver=1` | `oe && ie()` 且 `0 < 长度 < 61440` |
| 兜底埋点 | GET | `{dsn}/apm_web_img.gif?a=<pid>&ver=1` | POST 与 beacon 都不满足 |
| 云控拉取 | GET | `{dsn}/apm_cc_web?app=…&os=web&um_sdk_ver=2.0.10` | `enableRemoteConfig` 为真 |
| 白屏截图 | POST | `{dsn}/apm_img_upload?screen_id=…&appkey=…&uid=…` | 白屏监控开启（@29232） |

【观测】`ce()` @8200 是所有 HTTP 的公共发送器：`XMLHttpRequest`，POST 时
`Content-Type: text/plain`，`withCredentials = false`，`timeout = 6000`。

【观测】成功判定（`ce()` @9004 起）：只有 `readyState === 4 && status === 200` 才走 `success`。
非 200 还会按状态码对**整个客户端**下封禁：

```js
405 === t.status ? ue(6e5)          // 封禁 600000 ms = 10 分钟
: 406 === t.status ? ue(31536e7)    // 封禁 31536000000 ms = 1 年
: 419 === t.status && O("服务端日志解密失败")
```

【观测】封禁写入 `localStorage`（`ue()` @9410 → `_silent` 键），发送前由 `le()` 读取：
`re > Date.now()` 时整段跳过。

【观测】Body 结构与编码：

- `cn(logs)` @~13700：`<header>|^|<log1>,<log2>,…`（分隔符 `|^|`）。
- `header` 字段序：`js_ver|pid|sid|uid|puid|tag|release|environment|cna`，`js_ver` 硬编码 `"2.0.10"`；
  每段 `encodeURIComponent`，取不到填 `-`。
- 每条 log：`t|page|times|sampling|pv_id|ct|sr|vp|auto|ctime|cusp` + `$` + 类型字段（`an()` @13319）。
- v1 类型字段表 `on` @13128：
  `pv:enable_api|enable_error|enable_perf|enable_blank`；
  `error:name|msg|stack|file|line|col`；
  `api:url|method|rt|rc|type|traceid|req_query|req_body`；
  `perf:appcache|dns|tcp|ssl|ttfb|trans|dom|res|firstbyte|fpt|!fcp|tti|ready|load|total|unload|redirect|begin|navtype|jump`（20 槽）；
  `perf_fcp:fcp`；`perf_fid:fid`；
  `blank:blank_timeout|blank_target|blank_domready|score|screen_id`；
  `end:error_count|page_duration`。
- v2 类型字段表 `An` @19062：`jn = t|js_ver|page|times|sampling|pid|sid|uid|pv_id|tag|release|environment|ct|sr|vp|auto|ctime`，
  `perf = jn + "|$|appcache|…|begin|navtype"`（19 槽，无 `!fcp` / `jump`），`error = jn + "|$|msg|stack|file|line|col"`。
  解码必须先判定 schema 再选字段表，否则 v2 的 `perf` 会整体错位一位。

## 2. 客户端闸门链（根因所在）

【观测】配置默认值 `Z` @7169：

```js
sampleConfig:{ enable:!0, sampleRate:100,
               rules:{ api:{enable:!0,sampleRate:30}, error:{enable:!0,sampleRate:100}, perf:{enable:!0,sampleRate:10} } },
dsn:"https://errlog.umeng.com", pkgList:void 0, enableRemoteConfig:!0, enableCrypt:!1
```

【观测】采样全局变量与判定函数 @10284 起：

```js
var ve=!0,he=!0,ge=!0,ye=!0,be=!1,we=100,_e=100,Se=30,ke=10,Ce=10,Oe=!0,Ee=!0,Re=!0,je=!0,Ae=!0;
function Ne(e){ return 100*Math.random() <= e }        // 量纲是 0–100，不是 0–1
function Ie(){ return { api:  he&&Re&&ge&&Oe ? "Y":"N",
                        error:he&&Re&&ve&&Ee ? "Y":"N",
                        pv:   he&&Re        ? "Y":"N",
                        perf: he&&Re&&ye&&je? "Y":"N",
                        blank:he&&Re&&be&&Ae? "Y":"N" } }
function Ue(){ var e = Q().sampleConfig;                // Q() = 合并后的用户配置
  e && ( he = e.enable, we = e.sampleRate, Re = Ne(e.sampleRate),
         e.rules && ( Se = e.rules.api.sampleRate,   ge = e.rules.api.enable,   Oe = Ne(e.rules.api.sampleRate),
                      _e = e.rules.error.sampleRate, ve = e.rules.error.enable, Ee = Ne(e.rules.error.sampleRate),
                      ke = e.rules.perf.sampleRate,  ye = e.rules.perf.enable,  je = Ne(e.rules.perf.sampleRate) ) ) }
```

【观测】每条记录的闸门 `sn()` @~14800：

```js
function sn(e){ return "N" !== Ie().pv && ( e.common.sampling = {api:Se,pv:we,error:_e,perf:ke,perf_fcp:ke,perf_fid:ke,blank:Ce}[e.common.t],
  … ("error"!==e.common.t || "N"!==Ie().error) && ("api"!==e.common.t || "N"!==Ie().api) … ) }
```

调用点（@14785）：`… || sn(a) ? o.push(a) : O("数据未被采样，已抛弃 -->", a)`。
即 **`Ie().pv === "N"` 时，所有类型（含 error/api/perf）的记录都会被丢弃**。

【观测】批次级闸门 `On()` @17612：

```js
function pe(){ return fe }                                            // fe 初值 5（= 5%）
function de(e){ m(e) && (se = "N"!==e && "N"!==e.split(".")[0]) }      // se: undefined | boolean
… (h(se) ? se = 100*Math.random() <= pe() : se) && <URL 过滤>
      ? R("数据采集成功，采样率 -->", pe(), n, …)
      : O("数据未被采样，已抛弃，采样率 -->", pe(), n, …)
```

【观测】`On()` 的成功分支**并不会把所有批次发出去**。完整逻辑是：

```js
(… && <URL 过滤>)
  ? (R("数据采集成功，采样率 -->", pe(), n, …),
     x() && 0 === n.indexOf("perf|") && M("sendData", n))   // 只有 perf| 开头才转发桥
  : O("数据未被采样，已抛弃，采样率 -->", pe(), n, …)
```

`M()` @5625 会把数据交给 `window.webkit.messageHandlers.UAPM_JSBridge.postMessage` 或
`window.UAPM_JSBridge[e]`；`yn()` @15442 里的 `if (x()) return M("sendData", e)` 只出现在
**无桥**队列 `fn/pn` 的 HTTP 冲刷路径中，桥模式下不会走 `yn()`。

【观测】有桥时的入队路径在 `En()` @17935：`if (!x())` 才进 `fn/pn` HTTP 队列；有桥时攒 200ms 后
调用 `On(batch)`。因此**桥模式下 api/error/pv 批次即使通过采样，也只打印「数据采集成功」，
不会发往任何通道**（HTTP 不发、桥也不发）。该结论已由真实 bundle 网关验证复现（见 §6）。

【观测】原生桥决定 `se` 与 `fe`。`q()` @5239：

```js
if (window.UAPM_JSB_CONFIG) return _ = { sample: parseInt(UAPM_JSB_CONFIG.sample,10),
                                         appName: UAPM_JSB_CONFIG.appName,
                                         sampleResult: UAPM_JSB_CONFIG.sampleResult };
if (UAPM_JSBridge) { … getLaunchOptionsSync() … }
return _ = { sample:5, appName:"", sampleResult:"Y" };                 // 纯浏览器兜底
```

【观测】init `ct()` @29941：

```js
if (x()) {                                     // x() = !!(window.UAPM_JSBridge || window.UAPM_JSB_CONFIG)
  var l = u.pkgList || "";
  (m(l) || g(l)) && m(q().appName) && -1 === l.indexOf(q().appName) ? de("N") : de(q().sampleResult);
  a = q().sample; void 0 !== fe && (fe = a);   // 采样率与结果全部来自原生桥，不读用户配置
} else { G(u.pid); … O("UM_JSBridge不存在") }
```

## 3. 根因：为什么友盟后台收不到数据

【观测】改写版适配层 [`outputs/axx-umeng-delivery/h5/src/index.js`](../outputs/axx-umeng-delivery/h5/src/index.js)
第 84–86 行向官方 SDK 注入：

```js
sample: 1,
sampleConfig: { enable: false, sampleRate: 1 },
enableRemoteConfig: false,
```

【推导】这条注入触发两道独立的「全丢」闸门，且都发生在**客户端内**，数据根本不会离开浏览器：

1. `sampleConfig.enable = false` → `Ue()` 令 `he = false` → `Ie()` 五个开关全为 `"N"` →
   `sn()` 第一条 `"N" !== Ie().pv` 即为假 → 每条记录走 `O("数据未被采样，已抛弃 -->")`。**丢弃率 100%。**
2. 覆盖后的 `sampleConfig` 不再带 `rules`，且 `sampleRate = 1` 被 `Ne()` 按 0–100 量纲解读为
   `100*Math.random() <= 1` ≈ 1% 通过；即使把 `enable` 改回 `true`，`Re` 仍会让 `Ie().pv` 在约 99% 的批次为 `"N"`。

【推导】官方**默认**配置本身也不是全量：`rules.api.sampleRate = 30`、`rules.perf.sampleRate = 10`
→ 默认 api 只采 30%、perf 只采 10%。所以「不受官方采样率控制」的正确做法不是关掉采样对象，
而是显式把 `enable` 与三条 `rules` 全部置 100。

【推导】第二道独立闸门（批次级 `se`）：`de()` 只在 `x()` 为真（原生桥存在）时被调用，调用后
`se` 固定为布尔值，此后每个批次被整体放行或整体丢弃：

- 原生桥存在、`pkgList` 非空、`appName` 非空、且 `pkgList` 不含该 `appName` → `de("N")` → `se = false` → **全丢**。
- 原生桥存在且 `UAPM_JSB_CONFIG.sampleResult` 为 `"N"`（或 `"N.…"`）→ `de("N")` → **全丢**。
- 原生桥不存在（纯浏览器）→ `de()` 从不调用，`se` 保持 `undefined` → `100*Math.random() <= 5` → **只采 5%**。

【推断】bx-app-h5 的 `pkgList: ["com.student.learnwhat"]` 与该 App 的
`PRODUCT_BUNDLE_IDENTIFIER = com.student.learnwhat` 一致，因此本条**目前不是**该项目的失败原因；
但原生桥传入的 `appName` 究竟取 bundle id 还是友盟自定义 App 名仍未在设备上取证（见 §5）。

【推导】`enableRemoteConfig: false` 本身不丢数据：它只跳过 `me()` / `/apm_cc_web` 云控，
而云控的 `case "pr"` 只会把 `Re` 改成 `Ne(r.set)`（即只能下调）。保留它是正确的。

【推导】`sample: 1` 是**无效**字段：`q()` 只读 `window.UAPM_JSB_CONFIG` / `UAPM_JSBridge`，不读用户配置，
因此它既不能提高也不能降低采样率，只会让配置看起来「已处理」。

【结论】H5 侧「后台收不到数据」= 客户端 100% 丢弃；直接原因是适配层注入的
`sampleConfig:{enable:false,sampleRate:1}`，另有 `pkgList` / `sampleResult` 两道批次级闸门与默认 5% 采样叠加。
与网络、服务端、appkey 无关。

【推导】对运行在 iOS App 内嵌 WebView 的 bx-app-h5，还有第三道独立根因：业务侧
`AppDelegate+UMeng.m` 设置 `h5BridgeEnabled = @YES`，UMAPM 会在 WebView 注入
`window.UAPM_JSB_CONFIG`，使 `x()` 为真；此时即使修好 `sampleConfig`，非 perf 批次也会按上一节
的 `On()` 行为静默丢失。因此在「上报自建接收端」的架构里，H5 侧必须在 `init()` 前移除桥探测变量。

## 4. 正确的「不受采样控制」配置

【推导】同时满足以下条件才能保证 100% 上行：

```js
sdk.init({
  dsn: 'https://<自建域名或地址>',                    // 指向自有接收端；默认 https://errlog.umeng.com
  enableRemoteConfig: false,                          // 禁止云控改写采样率
  sampleConfig: { enable: true, sampleRate: 100,
                  rules: { api:   { enable: true, sampleRate: 100 },
                           error: { enable: true, sampleRate: 100 },
                           perf:  { enable: true, sampleRate: 100 } } }
});
```

【推导】批次级 `se` 无法通过 `init()` 配置消除。更稳妥的做法（也是
`axx-umeng-delivery/h5` 现在的实现）是在调用官方 `init()` **之前**删除
`window.UAPM_JSB_CONFIG` 与 `window.UAPM_JSBridge`，让 `x()` 返回 false：

- 绕开 `sampleResult` / `pkgList` 批次闸门；
- 避开 `On()` 只转发 `perf|` 批次的静默丢失；
- 强制走 HTTP `dsn` 通道，直连自建接收端。

如确需保留桥（例如原生侧还要消费 H5 日志），必须保证 `sampleResult !== "N"`、
`sample === 100`、`appName` 与 `pkgList` 自洽，且只能期待 perf 数据。

## 6. 真实 bundle 网关验证

`outputs/umeng-sink/scripts/h5-gate-check.mjs` 会加载真实官方 `uapm.esm.js` 并把
`XMLHttpRequest` / `sendBeacon` / 桥直接接到接收端路由上（不监听端口），7/7 场景通过：

| 场景 | HTTP POST | beacon | 桥调用 | 结果 |
| --- | ---: | ---: | ---: | --- |
| 旧适配层配置 | 0 | 0 | 0 | 3 条记录全部打印「数据未被采样，已抛弃」 |
| 全开 sampleConfig | 1（pv+api） | 1（error） | 0 | 全部到达 |
| 官方默认配置 | 1（pv） | 1（error） | 0 | api 被 30% 规则丢弃 |
| 桥 sampleResult="N" | 0 | 0 | 0 | 整批丢弃 |
| 桥 sampleResult="Y"/100 | 0 | 0 | 0 | 打印「采集成功」但**什么都不发** |
| 桥 pkgList 不匹配 | 0 | 0 | 0 | 整批丢弃 |
| 修复后适配层 + 敌意桥 | 1（pv+api） | 1（error） | 0 | 适配层移除桥后全部到达 |

## 5. 未验证项

- 【未知】iOS 侧 `UMH5LogManager` 写入 `UAPM_JSB_CONFIG.appName` 的实际取值（bundle id？友盟 App 名？），
  以及 `sampleResult` / `sample` 是否取自 U-APM 云控采样。设备取证方法：在 WebView 内打印
  `JSON.stringify(window.UAPM_JSB_CONFIG)` 与 `pkgList` 比对。
- 【未知】`h()` / `m()` / `g()` / `v()` / `b()` 等压缩辅助函数的精确语义（本文按上下文推定依次为
  「空值」「字符串」「数组」「对象」「空值」）；这不影响上述结论，因为
  `Ie().pv === "N"` 到丢弃的路径不依赖它们。
- 【未知】服务端在 `a=<pid>` 与 appkey 不匹配、或 appkey 未知时的响应码；`ce()` 只显式处理 405/406/419。
