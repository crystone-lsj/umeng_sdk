import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { dashboardHtml } from "../src/dashboard.js";

test("client time checkbox and label stay aligned as one filter-row item", () => {
  assert.match(
    dashboardHtml,
    /<label class="client-time-option"><input id="client-time" type="checkbox">客户端发生时间<\/label>/,
  );
  assert.match(
    dashboardHtml,
    /\.filter-row \.client-time-option\{[^}]*display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:none/,
  );
  assert.match(
    dashboardHtml,
    /\.filter-row \.client-time-option input\[type=checkbox\]\{[^}]*width:14px;height:14px/,
  );
});

test("identity and page filters choose values from log-backed autocomplete options", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(dashboardHtml, /data-autocomplete-field="PAGE"/);
  assert.match(
    dashboardHtml,
    /id="page-filter-options" class="autocomplete-options" role="listbox"/,
  );
  assert.match(script, /input\.dataset\.autocompleteField = field/);
  assert.match(dashboardHtml, /className = 'autocomplete-options'/);
  assert.match(
    dashboardHtml,
    /\.autocomplete-options\[hidden\]\{display:none\}/,
  );
  assert.match(script, /function autocompleteValues\(field\)/);
  assert.match(script, /currentData\.userPerception\.pageOptions/);
  assert.match(
    script,
    /currentData\.userPerception\.filterOptions && currentData\.userPerception\.filterOptions\[field\]/,
  );
  assert.match(
    script,
    /function commitAutocompleteField\(field, value, input\)/,
  );
  assert.match(script, /loadFilterSilently\(\);/);

  const inputListeners = script.slice(
    script.indexOf("$('#page-filter').addEventListener('input'"),
    script.indexOf("$('#user-dimension-filters').addEventListener('toggle'"),
  );
  assert.match(inputListeners, /renderAutocompleteOptions/);
  assert.doesNotMatch(inputListeners, /setTimeout\(loadFilterSilently/);
  assert.match(
    inputListeners,
    /event\.target\.matches\('\[data-identity-field\]'\)/,
  );
  assert.match(inputListeners, /resetAutocompleteField/);
  assert.match(
    inputListeners,
    /document\.addEventListener\('keydown', handleAutocompleteKeydown\)/,
  );
});

test("top filter popovers are mutually exclusive", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(script, /function closeFilterDetails\(except\)/);
  assert.match(
    script,
    /#user-ranges details\[open\], #user-dimension-filters details\[open\]/,
  );
  assert.match(
    script,
    /document\.addEventListener\('toggle', function \(event\)/,
  );
  assert.match(
    script,
    /closeFilterDetails\(\);\s*closeAutocompleteOptions\(\);/,
  );
});

test("dashboard client script remains syntactically valid", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("dimension and page filters reload silently while preserving the viewport", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const helper = script.slice(
    script.indexOf("function restoreViewport"),
    script.indexOf("function rangeWindow"),
  );
  const positions = [];
  const context = {
    window: {
      scrollTo: (x, y) => positions.push([x, y]),
      requestAnimationFrame: (callback) => callback(),
    },
  };
  runInNewContext(helper + "\nrestoreViewport({ x: 12, y: 34 });", context);
  assert.match(helper, /window\.scrollTo\(viewport\.x, viewport\.y\)/);
  assert.deepEqual(positions, [
    [12, 34],
    [12, 34],
  ]);

  const loadStart = script.indexOf("async function load(options)");
  const filterStart = script.indexOf(
    "$('#user-dimension-filters').addEventListener('change'",
  );
  const filterEnd = script.indexOf(
    "$('#user-dimension-filters').addEventListener('submit'",
    filterStart,
  );
  const filterListener = script.slice(filterStart, filterEnd);
  assert.match(
    script.slice(loadStart, filterStart),
    /restoreViewport\(viewport\)/,
  );
  assert.match(
    filterListener,
    /var viewport = \{ x: window\.scrollX, y: window\.scrollY \}/,
  );
  assert.match(
    filterListener,
    /focusWithoutScrolling\(dropdown\.querySelector\('summary'\)\)/,
  );
  assert.doesNotMatch(
    filterListener,
    /focusWithoutScrolling\(dropdown\.querySelector\('summary'\)\);\s*restoreViewport\(viewport\)/,
  );
  assert.match(
    filterListener,
    /load\(\{ preserveViewport: viewport, silent: true \}\)/,
  );

  const pageFilterStart = script.indexOf(
    "$('#page-filter').addEventListener('input'",
  );
  const resetStart = script.indexOf(
    "$('#user-reset-all').addEventListener",
    pageFilterStart,
  );
  const pageFilterListeners = script.slice(pageFilterStart, resetStart);
  assert.match(pageFilterListeners, /renderAutocompleteOptions/);
  assert.doesNotMatch(
    pageFilterListeners,
    /pageFilterLoadTimer|identityFilterLoadTimer/,
  );

  const resetListeners = script.slice(
    resetStart,
    script.indexOf("$('#user-prev').addEventListener", resetStart),
  );
  assert.match(
    resetListeners,
    /load\(\{ preserveViewport: viewport, silent: true \}\)/g,
  );
  assert.doesNotMatch(resetListeners, /user-host|userHost|pageHost/);
});

test("time range changes are optimistic and load silently without moving the viewport", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(script, /function syncRangeButtons\(\) \{/);
  assert.match(script, /var silent = options\.silent === true;/);
  assert.match(script, /\$\('#loading'\)\.hidden = silent/);
  const rangeListenerStart = script.indexOf(
    "$('#user-ranges').addEventListener('click'",
  );
  const rangeListenerEnd = script.indexOf(
    "$('#user-export').addEventListener",
    rangeListenerStart,
  );
  const rangeListener = script.slice(rangeListenerStart, rangeListenerEnd);
  assert.match(
    rangeListener,
    /var viewport = \{ x: window\.scrollX, y: window\.scrollY \}/,
  );
  assert.match(rangeListener, /state\.range = button\.dataset\.range/);
  assert.match(rangeListener, /syncRangeButtons\(\)/);
  assert.match(
    rangeListener,
    /load\(\{ preserveViewport: viewport, silent: true \}\)/,
  );
});

test("dashboard hides HTTP status distribution and carrier/region perception dimensions", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  const errorDimensions = script.slice(
    script.indexOf("function renderErrorDimensionPanels("),
    script.indexOf("function renderSampleDistribution("),
  );
  assert.doesNotMatch(errorDimensions, /HTTP 状态码|statuses/);
  assert.match(errorDimensions, /资源类型/);

  const perceptionDimensions = script.slice(
    script.indexOf("function renderMetricDimensionPanels("),
    script.indexOf("function nativeLookback("),
  );
  assert.doesNotMatch(perceptionDimensions, /运营商|地域|carrier|region/);
  assert.match(perceptionDimensions, /设备机型/);
  assert.match(perceptionDimensions, /网络类型/);
});

test("sample distribution uses proportional bars while dimension rows stay tinted", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /\.dist-row\{grid-template-columns:minmax\(0,1fr\) auto;gap:12px;margin:7px 0;padding:10px 12px;background:#eef5ff\}/,
  );
  assert.match(
    dashboardHtml,
    /#userPerception \.dimension-panel\{min-height:0;padding:15px;border:1px solid #e9edf3\}/,
  );
  assert.match(
    dashboardHtml,
    /\.perception-samples \.dist-row\{grid-template-columns:90px minmax\(0,1fr\) 100px;gap:8px;margin:16px 0;padding:0;background:transparent\}/,
  );
  assert.match(
    dashboardHtml,
    /\.perception-samples \.dist-bar\{display:block\}/,
  );
  assert.match(
    dashboardHtml,
    /\.metric-dim-row\{grid-template-columns:minmax\(0,1fr\) auto;gap:4px 12px;margin:4px 0;padding:6px 12px;background:#eef5ff\}/,
  );

  const renderDistribution = script.slice(
    script.indexOf("function renderDistribution("),
    script.indexOf("function renderDimensionPanels("),
  );
  const renderMetricDimensions = script.slice(
    script.indexOf("function renderMetricDimensionPanels("),
    script.indexOf("function nativeLookback("),
  );
  const context = {
    esc: (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
    integer: String,
    pct: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
    metricValue: (_summary, mode) => (mode === "p95" ? "949 ms" : "120 ms"),
    ratioMetric: (value) => Number(value * 100).toFixed(1) + "%",
    userMetricLabels: { ttfb: "首字节响应时间(TTFB)" },
  };
  runInNewContext(renderDistribution + "\n" + renderMetricDimensions, context);

  const distribution = context.renderDistribution(
    [{ value: "良好", count: 28, rate: 56 }],
    "暂无数据",
    true,
  );
  assert.match(distribution, /class="dist-row"/);
  assert.match(
    distribution,
    /良好<\/span><span class="dist-track"><span class="dist-bar" style="width:56%"><\/span><\/span><span class="dist-value">28 · 56\.0%<\/span>/,
  );

  const dimensions = context.renderMetricDimensionPanels(
    {
      deviceModel: [1, 2, 3, 4, 5].map((index) => ({
        value: "device-" + index,
        count: 46,
        ttfb: { count: 46, rate: 0.8 },
      })),
      osVersion: [],
      appVersion: [],
      networkType: [],
    },
    "ttfb",
    "p95",
  );
  assert.match(
    dimensions,
    /class="metric-dim-row"[^>]*><span title="device-1">device-1<\/span><strong>949 ms<\/strong><\/div>/,
  );
  assert.equal((dimensions.match(/class="metric-dim-row"/g) || []).length, 5);
  assert.doesNotMatch(dimensions, /有效样本|sampleCount/);
  assert.doesNotMatch(dimensions, /dist-track|dist-bar/);
});

test("dashboard requests data on entry and explicit actions, not on timers or tab visibility", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotMatch(script, /\bsetInterval\s*\(/);
  assert.doesNotMatch(script, /visibilitychange/);
  assert.match(script, /\$\('#refresh'\)\.addEventListener\('click', load\)/);
  assert.match(
    script,
    /selectLocationSection\(\);\s*loadSourceMapStatus\(\);\s*load\(\);\s*$/,
  );
  assert.match(
    dashboardHtml,
    /id="source-map-upload" class="button" type="button">上传 Source Map ZIP/,
  );
  assert.match(dashboardHtml, /id="source-map-file" type="file" accept="\.zip/);
  assert.match(
    script,
    /fetch\(apiPath\('\/__sink\/api\/source-maps'\), \{\s*method: 'POST'/,
  );
  assert.match(
    script,
    /\$\('#date'\)\.addEventListener\('change', function \(\) \{[^}]*load\(\)/,
  );
});

test("data source is a fixed environment selector and reloads the dashboard on change", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /<select id="storage-source" aria-label="数据来源"><option value="test">测试环境 ELK<\/option><option value="online">线上环境 ELK<\/option><\/select>/,
  );
  assert.match(script, /elkEnvironment: 'test'/);
  assert.match(script, /query\.set\('elkEnvironment', state\.elkEnvironment\)/);
  assert.match(
    script,
    /\$\('#storage-source'\)\.addEventListener\('change', function \(event\)/,
  );
  assert.match(
    script,
    /state\.elkEnvironment = event\.target\.value === 'online' \? 'online' : 'test'/,
  );
  assert.match(script, /view\.elkEnvironment/);
  assert.doesNotMatch(
    dashboardHtml,
    /测试环境 ELK<\/span>|线上环境 ELK<\/span>/,
  );
});

test("page filtering uses only the URL or path search input", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /<input id="page-filter" data-autocomplete-field="PAGE" type="search" placeholder="搜索页面 URL 或路径" aria-label="搜索页面 URL 或路径" autocomplete="off">/,
  );
  assert.doesNotMatch(dashboardHtml, /id="user-host"|全部 Host/);
  assert.doesNotMatch(script, /userHost|pageHost|pageMatchesHost|pageHosts/);
  assert.match(
    script,
    /var rows = filteredPages\(data\.userPerception\.pages\);/,
  );
  assert.match(
    script,
    /var rows = filteredPages\(currentData\.userPerception\.pages\);/,
  );
});

test("dashboard sections share the same shell and content inset", () => {
  assert.match(
    dashboardHtml,
    /\.app\{grid-template-columns:164px minmax\(0,1fr\)\}/,
  );
  assert.match(
    dashboardHtml,
    /\.main>\.section:not\(#userPerception\)\{[^}]*padding:0 20px 40px\}/,
  );
  assert.match(dashboardHtml, /#userPerception\{padding:0 20px 40px\}/);
  assert.doesNotMatch(
    dashboardHtml,
    /body\[data-section="userPerception"\] \.app/,
  );
});

test("overview is the first navigation item without a separate operations group", () => {
  const navigation = dashboardHtml.match(
    /<nav class="nav"[\s\S]*?<\/nav>/,
  )?.[0];
  assert.ok(navigation);
  assert.doesNotMatch(navigation, /运营总览/);
  assert.match(
    navigation,
    /^<nav class="nav"[^>]*>\s*<button type="button" data-section="overview">总览<\/button>/,
  );
});

test("user perception displays TTFB, TCP and page load while legacy performance pages are hidden", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /首字节响应时间\(TTFB\).*TCP连接.*页面可交互时间\(TTI\).*页面完全加载/,
  );
  assert.doesNotMatch(
    dashboardHtml,
    /首次绘制时间\(FP\).*首次内容绘制时间\(FCP\).*页面可交互时间\(TTI\)/,
  );
  assert.match(
    script,
    /userMetricLabels = \{ ttfb: '首字节响应时间\(TTFB\)', tcp: 'TCP连接', tti: '页面可交互时间\(TTI\)', pageLoad: '页面完全加载'/,
  );
  assert.doesNotMatch(dashboardHtml, /data-section="loadingPerformance"/);
  assert.doesNotMatch(dashboardHtml, /id="loadingPerformance"/);
  assert.doesNotMatch(
    dashboardHtml,
    /data-section="pages"|data-section="performance"/,
  );
  assert.doesNotMatch(dashboardHtml, /id="pages"|id="performance"/);
  assert.doesNotMatch(
    script,
    /renderLoadingPerformance|loadingDisplayOrder|loading-stage|#performance-kpis|#performance-rows|#page-rows/,
  );
});

test("user perception metric cards provide explanatory help tooltips", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /\.perception-kpi-help:hover\+\.perception-kpi-tooltip,\.perception-kpi-help:focus\+\.perception-kpi-tooltip/,
  );
  assert.match(
    dashboardHtml,
    /\.perception-kpi-help span\{[^}]*translateY\(-1px\)/,
  );
  assert.match(
    script,
    /userMetricDescriptions = \{ ttfb: '[^']+', tcp: '[^']+', tti: '[^']+', pageLoad: '[^']+', oneSecondFastRate: '[^']+', twoSecondFastRate: '[^']+', fiveSecondSlowRate: '[^']+' \}/,
  );
  const card = script.slice(
    script.indexOf("function perceptionCard("),
    script.indexOf("function renderMetricDimensionPanels("),
  );
  const context = {
    state: { previousMetrics: null, userMetric: "ttfb", userMode: "average" },
    userMetricDescriptions: {
      ttfb: "从页面开始导航到收到服务器返回的第一个字节所经过的时间。",
    },
    esc: (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
    metricValue: () => "120 ms",
    ratioMetric: () => "80%",
  };
  runInNewContext(card, context);
  const rendered = context.perceptionCard(
    "ttfb",
    "首字节响应时间(TTFB)",
    "120 ms",
    "4 个样本",
  );
  assert.match(
    rendered,
    /class="perception-kpi-content"[^>]*data-metric="ttfb"[^>]*aria-pressed="true"/,
  );
  assert.match(
    rendered,
    /class="perception-kpi-help" aria-label="首字节响应时间\(TTFB\)说明" aria-describedby="user-metric-tip-ttfb"/,
  );
  assert.match(
    rendered,
    /id="user-metric-tip-ttfb" class="perception-kpi-tooltip" role="tooltip">从页面开始导航到收到服务器返回的第一个字节所经过的时间。<\/span>/,
  );
});

test("overview and slow-loading metric cards provide explanatory help tooltips", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /\.kpi\.has-tooltip\{[^}]*position:relative[^}]*padding-right:42px/,
  );
  assert.match(
    dashboardHtml,
    /\.kpi-help:hover\+\.kpi-tooltip,\.kpi-help:focus\+\.kpi-tooltip/,
  );
  assert.match(dashboardHtml, /\.kpi-help span\{[^}]*translateY\(-1px\)/);
  assert.match(script, /'慢加载次数': '[^']+'/);
  assert.match(script, /'已观测加载': '[^']+'/);
  assert.match(script, /'MetricKit 卡顿': '[^']+'/);

  const card = script.slice(
    script.indexOf("function card("),
    script.indexOf("function cells("),
  );
  const context = {
    cardDescriptions: {
      慢加载次数: "统计页面完全加载耗时超过当前阈值的性能样本数量。",
    },
    esc: (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
  };
  runInNewContext(card, context);

  const slowCard = context.card("慢加载次数", "12", "阈值 5 秒");
  assert.match(slowCard, /class="kpi has-tooltip"/);
  assert.match(
    slowCard,
    /class="kpi-help" aria-label="慢加载次数说明" aria-describedby="metric-tip-慢加载次数"/,
  );
  assert.match(
    slowCard,
    /id="metric-tip-慢加载次数" class="kpi-tooltip" role="tooltip">统计页面完全加载耗时超过当前阈值的性能样本数量。<\/span>/,
  );

  const fallbackCard = context.card("未定义指标", "3", "回退说明");
  assert.match(
    fallbackCard,
    /aria-label="未定义指标说明" aria-describedby="metric-tip-未定义指标"/,
  );
  assert.match(
    fallbackCard,
    /class="kpi-tooltip" role="tooltip">回退说明<\/span>/,
  );
});

test("error summary cards use large titles, separate values and accessible help tooltips", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const card = script.slice(
    script.indexOf("function errorTrendCard("),
    script.indexOf("function renderRecentErrors("),
  );
  const context = {
    state: { errorMetric: "errors" },
    esc: (value) => String(value).replaceAll("<", "&lt;"),
  };
  runInNewContext(card, context);
  const selected = context.errorTrendCard(
    "errors",
    "错误总数",
    "127",
    "page_error 记录",
  );
  assert.match(selected, /class="kpi error-kpi" data-selected/);
  assert.match(
    selected,
    /class="error-kpi-content" type="button" data-error-metric="errors" aria-pressed="true"/,
  );
  assert.match(
    selected,
    /<span class="label">错误总数<\/span><span class="value">127<\/span>/,
  );
  assert.match(
    selected,
    /class="error-kpi-help" aria-label="错误总数说明" aria-describedby="error-kpi-tip-errors"><span aria-hidden="true">\?<\/span><\/button>/,
  );
  assert.match(
    selected,
    /id="error-kpi-tip-errors" class="error-kpi-tooltip" role="tooltip">page_error 记录<\/span>/,
  );
  assert.doesNotMatch(selected, /class="sub"/);
  const pageCard = context.errorTrendCard(
    "pageCount",
    "涉及页面",
    "8",
    "按错误路径去重",
  );
  assert.match(pageCard, /data-error-metric="pageCount" aria-pressed="false"/);
  assert.match(
    pageCard,
    /<span class="label">涉及页面<\/span><span class="value">8<\/span>/,
  );
  assert.match(
    dashboardHtml,
    /\.error-kpi-help:hover\+\.error-kpi-tooltip,\.error-kpi-help:focus\+\.error-kpi-tooltip/,
  );
  assert.match(
    dashboardHtml,
    /#error-kpis\{grid-template-columns:repeat\(4,minmax\(0,216px\)\);gap:0\}/,
  );
  assert.match(
    dashboardHtml,
    /@media\(max-width:1080px\)\{#error-kpis\{grid-template-columns:repeat\(2,minmax\(0,216px\)\)/,
  );
  assert.match(
    dashboardHtml,
    /@media\(max-width:520px\)\{#error-kpis\{grid-template-columns:minmax\(0,min\(216px,100%\)\)/,
  );
  assert.match(dashboardHtml, /\.error-kpi \.value\{[^}]*font-size:25px/);
  assert.match(dashboardHtml, /\.error-kpi-help span\{[^}]*translateY\(-1px\)/);
  assert.match(script, /pageCount: '涉及页面'/);
  assert.match(script, /errorTrendCard\('pageCount', '涉及页面'/);
  assert.match(
    script,
    /errorTrendCard\('issues', '独立问题', [^\n]+'当前筛选范围内，按错误类型、原因、页面路径和错误消息合并后的不同组合数。[^']+不是错误次数，也不是受影响人数。'/,
  );
  context.state.errorMetric = "pageCount";
  assert.match(
    context.errorTrendCard("pageCount", "涉及页面", "8", "按错误路径去重"),
    /aria-pressed="true"/,
  );
});

test("page metric renders the per-bucket page count in the error trend", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const chart = script.slice(
    script.indexOf("function renderErrorTrendChart("),
    script.indexOf("function renderDistribution("),
  );
  let selection;
  const context = {
    errorTrendMetricLabels: { pageCount: "涉及页面" },
    integer: String,
    renderTrendChart(...args) {
      selection = args;
    },
  };
  runInNewContext(chart, context);
  context.renderErrorTrendChart(
    "#error-trend",
    [{ pageCount: 2 }, { pageCount: 0 }],
    "pageCount",
    {},
  );
  assert.equal(selection[0], "#error-trend");
  assert.equal(selection[2]({ pageCount: 2 }), 2);
  assert.equal(selection[2]({ pageCount: 0 }), 0);
  assert.equal(selection[6], "涉及页面");
});

test("section navigation preserves the URL without scrolling to an anchor", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const selectionStart = script.indexOf("function selectSection(name)");
  const selection = script.slice(
    selectionStart,
    script.indexOf("$('#client-time').addEventListener", selectionStart),
  );
  const locationSelection = script.slice(
    script.indexOf("function selectLocationSection()"),
    script.indexOf("var currentData = null;"),
  );
  const sections = ["userPerception", "errors"].map((id) => ({
    id,
    hidden: false,
    classList: { contains: (name) => name === "section" },
  }));
  const buttons = sections.map((section) => ({
    dataset: { section: section.id },
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(name, listener) {
      this[name] = listener;
    },
  }));
  const listeners = {};
  let hash = "";
  const location = {
    pathname: "/__sink/dashboard",
    search: "?view.range=7days",
    get hash() {
      return hash;
    },
    set hash(_) {
      throw new Error("direct hash assignment scrolls to a section anchor");
    },
  };
  const pushed = [];
  const context = {
    document: {
      body: { dataset: {} },
      querySelectorAll(selector) {
        return selector === ".nav button" ? buttons : sections;
      },
      getElementById(id) {
        return sections.find((section) => section.id === id);
      },
    },
    history: {
      pushState(_state, _title, url) {
        pushed.push(url);
        hash = new URL(url, "http://localhost").hash;
      },
    },
    location,
    window: {
      addEventListener(name, listener) {
        listeners[name] = listener;
      },
    },
  };
  runInNewContext(selection + locationSelection, context);

  buttons[1].click();
  assert.equal(hash, "#errors");
  assert.deepEqual(pushed, ["/__sink/dashboard?view.range=7days#errors"]);
  assert.equal(sections[1].hidden, false);
  assert.equal(sections[0].hidden, true);
  buttons[1].click();
  assert.equal(pushed.length, 1);
  hash = "";
  listeners.popstate();
  assert.equal(sections[0].hidden, false);
  assert.equal(buttons[0]["aria-selected"], "true");
});
