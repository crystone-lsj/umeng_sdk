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
  assert.match(
    dashboardHtml,
    /input\[type=search\]::-webkit-search-cancel-button[^}]*display:none[^}]*-webkit-appearance:none/,
  );
  assert.match(
    dashboardHtml,
    /input\[type=search\]::-ms-clear\{display:none\}/,
  );
  assert.match(script, /function autocompleteValues\(field\)/);
  assert.match(script, /var autocompleteFocusLimit = 10/);
  assert.match(script, /function selectedAutocompleteValue\(field\)/);
  assert.match(script, /function renderAutocompleteOptions\(input, showAll\)/);
  assert.match(
    script,
    /var query = showAll \? '' : input\.value\.trim\(\)\.toLocaleLowerCase\(\)/,
  );
  assert.match(script, /if \(showAll\) \{/);
  assert.match(script, /values = values\.slice\(0, autocompleteFocusLimit\)/);
  assert.match(script, /renderAutocompleteOptions\(event\.target, true\)/);
  assert.match(script, /currentData\.userPerception\.pageOptions/);
  assert.match(
    script,
    /currentData\.userPerception\.filterOptions && currentData\.userPerception\.filterOptions\[field\]/,
  );
  assert.match(
    script,
    /function commitAutocompleteField\(field, value, input\)/,
  );
  assert.match(script, /event\.key === 'Delete'/);
  assert.match(
    script,
    /input\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/,
  );
  assert.match(
    script,
    /if \(document\.activeElement === input && !input\.value\.trim\(\)\) renderAutocompleteOptions\(input, true\)/,
  );
  assert.match(script, /loadFilterSilently\(\)\.then\(reopen\)/);
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

test("autocomplete fields do not preselect the first option when their value is empty", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const helper = script.slice(
    script.indexOf("var performanceFilterLabels"),
    script.indexOf("function resetAutocompleteField"),
  );
  const currentData = {
    userPerception: {
      pageOptions: ["/bx-app-h5/learningIndex", "/bx-app-h5/lessonDetail"],
      filterOptions: {
        UNAME: ["测试用户", "另一位用户"],
        PHONE: ["13800000000", "13900000000"],
      },
    },
  };

  function renderOptions(field, selectedValue = "") {
    let rendered = [];
    const optionsMenu = {
      hidden: true,
      replaceChildren() {
        rendered = [];
      },
      appendChild(option) {
        rendered.push(option);
      },
    };
    const input = {
      value: "",
      dataset: { autocompleteField: field },
      matches() {
        return true;
      },
      closest() {
        return {
          querySelector() {
            return optionsMenu;
          },
        };
      },
    };
    const state = {
      pageFilter: field === "PAGE" ? selectedValue : "",
      performanceFilters:
        field === "PAGE" || !selectedValue ? {} : { [field]: selectedValue },
    };
    const context = {
      currentData,
      state,
      document: {
        querySelectorAll() {
          return [];
        },
        createElement() {
          return {
            dataset: {},
            setAttribute(name, value) {
              this[name] = value;
            },
          };
        },
      },
      input,
    };
    runInNewContext(
      helper + "\nrenderAutocompleteOptions(input, true);",
      context,
    );
    return rendered;
  }

  for (const field of ["PAGE", "UNAME", "PHONE"]) {
    const rendered = renderOptions(field);
    assert.equal(rendered.length, 2);
    assert.deepEqual(
      rendered.map((option) => option["aria-selected"]),
      ["false", "false"],
    );
  }

  const selected = renderOptions("PAGE", "/bx-app-h5/lessonDetail");
  assert.deepEqual(
    selected.map((option) => option["aria-selected"]),
    ["true", "false"],
  );
  assert.equal(
    selected[0].dataset.autocompleteValue,
    "/bx-app-h5/lessonDetail",
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

test("top filter dropdowns provide slide animations and respect reduced motion", () => {
  assert.match(
    dashboardHtml,
    /\.dimension-filter> \.dimension-menu,[^{}]*\.range-buttons details> \.range-more\{display:block;max-height:0;overflow:hidden;opacity:0;visibility:hidden;pointer-events:none;transform:translateY\(-8px\) scaleY\(\.96\)/,
  );
  assert.match(
    dashboardHtml,
    /\.dimension-filter\[open\]> \.dimension-menu,[^{}]*\.range-buttons details\[open\]> \.range-more\{max-height:320px;opacity:1;visibility:visible;pointer-events:auto;transform:translateY\(0\) scaleY\(1\)/,
  );
  assert.match(
    dashboardHtml,
    /@media\(prefers-reduced-motion:reduce\)\{\.dimension-filter> \.dimension-menu/,
  );
  assert.match(
    dashboardHtml,
    /\.range-buttons details>summary:after\{content:"⌄"/,
  );
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
    /\.line-chart \.trend-bar\{fill:#2f6bff;opacity:\.3\}/,
  );
  assert.match(
    dashboardHtml,
    /\.trend-hit-area\{fill:transparent;pointer-events:all/,
  );
  assert.match(dashboardHtml, /\.chart-tooltip\{position:absolute/);
  assert.match(script, /data-trend-index/);
  assert.match(script, /tooltip\.classList\.add\('is-visible'\)/);
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
    metricModeTooltip: (mode, idPrefix) =>
      `<span class="mode-help">${mode}</span>` +
      `<span id="${idPrefix}-${mode}-tip" class="mode-tooltip"></span>`,
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

test("overview trend renders scaled bars, matching series lines and a value tooltip", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(dashboardHtml, /id="trend-y-axis" class="trend-y-axis"/);
  assert.match(dashboardHtml, /id="trend-plot" class="trend-plot"/);
  assert.match(dashboardHtml, /id="trend-grid" class="trend-grid"/);
  assert.match(
    dashboardHtml,
    /id="trend-lines" class="trend-lines" viewBox="0 0 1000 166" preserveAspectRatio="none" aria-hidden="true"/,
  );
  assert.match(
    dashboardHtml,
    /id="trend-tooltip" class="trend-tooltip" role="tooltip"/,
  );
  assert.match(
    dashboardHtml,
    /\.overview-trend \.trend-bar\{[^}]*min-width:4px;max-width:14px/,
  );
  assert.match(
    dashboardHtml,
    /\.overview-trend \.trend-bars\{[^}]*width:clamp\(18px,94%,54px\)/,
  );
  assert.match(
    dashboardHtml,
    /\.overview-trend \.trend-bar-pv\{background:linear-gradient\(180deg,#72adfb,#a8cef7\)\}/,
  );
  assert.match(
    dashboardHtml,
    /\.overview-trend \.trend-bar-api\{background:linear-gradient\(180deg,#43cda8,#8de4ca\)\}/,
  );
  assert.match(
    dashboardHtml,
    /\.overview-trend \.trend-bar-error\{background:linear-gradient\(180deg,#fa8298,#ffb7c2\)\}/,
  );
  assert.match(dashboardHtml, /\.trend-line-pv\{stroke:#72adfb\}/);
  assert.match(dashboardHtml, /\.trend-line-api\{stroke:#43cda8\}/);
  assert.match(dashboardHtml, /\.trend-line-error\{stroke:#fa8298\}/);

  const renderTrend = script.slice(
    script.indexOf("function renderTrend(trend, data)"),
    script.indexOf("function perceptionCard("),
  );
  const makeElement = () => {
    const listeners = Object.create(null);
    const classes = new Set();
    return {
      innerHTML: "",
      style: {},
      dataset: {},
      attributes: {},
      offsetWidth: 148,
      offsetHeight: 76,
      clientWidth: 300,
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        },
      },
      addEventListener(name, listener) {
        listeners[name] = listener;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 300, height: 166 };
      },
      listeners,
    };
  };
  const yAxis = makeElement();
  const grid = makeElement();
  const chart = makeElement();
  const lines = makeElement();
  const hourLabels = makeElement();
  const tooltip = makeElement();
  const plot = makeElement();
  let columns = [];
  plot.querySelectorAll = (selector) => {
    if (selector !== ".trend-column") return [];
    const count = (chart.innerHTML.match(/class="trend-column"/g) || []).length;
    columns = Array.from({ length: count }, (_, index) => {
      const column = makeElement();
      column.dataset.trendIndex = String(index);
      return column;
    });
    return columns;
  };
  const elements = {
    "#trend-y-axis": yAxis,
    "#trend-grid": grid,
    "#trend": chart,
    "#trend-lines": lines,
    "#hour-labels": hourLabels,
    "#trend-tooltip": tooltip,
    "#trend-plot": plot,
  };
  const context = {
    $: (selector) => elements[selector] || null,
    document: {
      querySelector(selector) {
        return elements[selector] || null;
      },
    },
    esc: (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;"),
    integer: String,
    trendLabel: (item) => item.hour,
  };
  runInNewContext(renderTrend, context);
  context.renderTrend(
    [
      { hour: "10:00", pageViews: 8, apiRequests: 4, errors: 2 },
      { hour: "11:00", pageViews: 2, apiRequests: 16, errors: 1 },
    ],
    {},
  );

  assert.equal(
    yAxis.innerHTML,
    '<span style="top:0%">16</span><span style="top:25%">12</span><span style="top:50%">8</span><span style="top:75%">4</span><span style="top:100%">0</span>',
  );
  assert.match(
    grid.innerHTML,
    /^<span style="top:0%"><\/span>.*<span style="top:100%"><\/span>$/,
  );
  assert.doesNotMatch(chart.innerHTML, /trend-stack|trend-segment/);
  assert.equal((chart.innerHTML.match(/class="trend-bars"/g) || []).length, 2);
  assert.equal(
    (chart.innerHTML.match(/class="trend-bar trend-bar-pv"/g) || []).length,
    2,
  );
  assert.equal(
    (chart.innerHTML.match(/class="trend-bar trend-bar-api"/g) || []).length,
    2,
  );
  assert.equal(
    (chart.innerHTML.match(/class="trend-bar trend-bar-error"/g) || []).length,
    2,
  );
  assert.match(
    chart.innerHTML,
    /class="trend-bar trend-bar-pv" style="height:50\.00%"><\/span><span class="trend-bar trend-bar-api" style="height:25\.00%"><\/span><span class="trend-bar trend-bar-error" style="height:12\.50%"/,
  );
  assert.match(
    chart.innerHTML,
    /role="group" tabindex="0" data-trend-index="0" aria-label="10:00：PV 8，API 4，错误 2"/,
  );
  assert.equal(
    (lines.innerHTML.match(/class="trend-line trend-line-/g) || []).length,
    3,
  );
  assert.match(
    lines.innerHTML,
    /class="trend-line trend-line-pv" d="M250\.00 83\.00 L750\.00 145\.25"/,
  );
  assert.match(
    lines.innerHTML,
    /class="trend-line trend-line-api" d="M250\.00 124\.50 L750\.00 0\.00"/,
  );
  assert.match(
    lines.innerHTML,
    /class="trend-line trend-line-error" d="M250\.00 145\.25 L750\.00 155\.63"/,
  );
  assert.equal(tooltip.attributes["aria-hidden"], "true");

  columns[0].listeners.mouseenter({
    currentTarget: columns[0],
    clientX: 40,
    clientY: 40,
  });
  assert.equal(tooltip.classList.contains("is-visible"), true);
  assert.equal(tooltip.attributes["aria-hidden"], "false");
  assert.match(
    tooltip.innerHTML,
    /<strong>10:00<\/strong>.*class="trend-tooltip-row trend-tooltip-pv".*<b>8<\/b>.*class="trend-tooltip-row trend-tooltip-api".*<b>4<\/b>.*class="trend-tooltip-row trend-tooltip-error".*<b>2<\/b>/,
  );
  columns[0].listeners.mouseleave();
  assert.equal(tooltip.classList.contains("is-visible"), false);
  assert.equal(tooltip.attributes["aria-hidden"], "true");
  columns[1].listeners.focus({ currentTarget: columns[1] });
  assert.equal(tooltip.classList.contains("is-visible"), true);
  assert.equal(tooltip.attributes["aria-hidden"], "false");
  columns[1].listeners.blur();
  assert.equal(tooltip.attributes["aria-hidden"], "true");

  context.renderTrend([], {});
  assert.equal(yAxis.innerHTML, "");
  assert.equal(grid.innerHTML, "");
  assert.equal(lines.innerHTML, "");
  assert.equal(hourLabels.innerHTML, "");
  assert.equal(tooltip.innerHTML, "");
  assert.equal(tooltip.attributes["aria-hidden"], "true");
  assert.match(chart.innerHTML, /暂无趋势数据/);

  delete elements["#trend-plot"];
  assert.doesNotThrow(() => {
    context.renderTrend(
      [{ hour: "12:00", pageViews: 1, apiRequests: 1, errors: 1 }],
      {},
    );
  });
});

test("overview trend explains its dynamic granularity and metric legends", () => {
  assert.match(
    dashboardHtml,
    /class="panel-title-with-help">时间范围趋势<button/,
  );
  assert.match(
    dashboardHtml,
    /class="panel-title-help" aria-label="时间范围趋势说明" aria-describedby="overview-trend-tip"/,
  );
  assert.match(
    dashboardHtml,
    /id="overview-trend-tip"[^>]*>展示当前筛选条件下的记录量变化，过去 1 小时按 5 分钟、48 小时内按小时、超过 48 小时按天聚合；单日归档按小时。柱形和对应颜色折线均表示该分桶内的记录数，折线连接相邻分桶以展示变化趋势；纵轴为数量，不是累计值。</,
  );
  assert.equal(
    (dashboardHtml.match(/class="trend-legend-help"/g) || []).length,
    3,
  );

  const legends = [
    [
      "PV 指标说明",
      "trend-legend-pv-tip",
      /页面浏览量（Page View）.*PV 事件记录数.*每条记录计 1 次/,
    ],
    [
      "API 指标说明",
      "trend-legend-api-tip",
      /API 请求量.*API 请求记录数.*每条请求记录计 1 次/,
    ],
    [
      "错误指标说明",
      "trend-legend-error-tip",
      /页面错误量.*page_error.*每条错误上报计 1 次/,
    ],
  ];
  for (const [ariaLabel, id, explanation] of legends) {
    assert.match(
      dashboardHtml,
      new RegExp(`aria-label="${ariaLabel}" aria-describedby="${id}"`),
    );
    assert.match(
      dashboardHtml,
      new RegExp(
        `id="${id}" class="trend-legend-tooltip" role="tooltip">[^<]*`,
      ),
    );
    assert.match(dashboardHtml, explanation);
  }

  assert.match(
    dashboardHtml,
    /\.legend \.trend-legend-tooltip\{[^}]*opacity:0;visibility:hidden;pointer-events:none/,
  );
  assert.match(
    dashboardHtml,
    /\.trend-legend-help:hover\+\.trend-legend-tooltip,\.trend-legend-help:focus-visible\+\.trend-legend-tooltip\{opacity:1;visibility:visible/,
  );
});

test("user perception mode help uses a viewport-safe global tooltip", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(script, /function metricModeTooltip\(/);
  assert.match(
    dashboardHtml,
    /id="user-mode-tip-(average|p50|p90|p95)" class="mode-tooltip"/,
  );
  assert.match(
    dashboardHtml,
    /id="user-table-mode-tip-(average|p50|p90|p95)" class="mode-tooltip"/,
  );
  assert.match(
    dashboardHtml,
    /\.mode-tooltip\{position:absolute;width:1px;height:1px;[^}]*clip:rect\(0 0 0 0\)/,
  );
  assert.match(
    dashboardHtml,
    /\.global-mode-tooltip\{position:fixed;[^}]*z-index:1000;[^}]*width:350px;max-width:calc\(100vw - 24px\)/,
  );
  assert.match(
    dashboardHtml,
    /<div id="global-mode-tooltip" class="global-mode-tooltip" aria-hidden="true"><\/div>\s*<script>/,
  );
  assert.doesNotMatch(dashboardHtml, /\.mode-help:hover\+\.mode-tooltip/);
  assert.doesNotMatch(
    dashboardHtml,
    /\.perception-table-panel\{[^}]*overflow:visible[^}]*\}/,
  );

  const helper = script.slice(
    script.indexOf("function metricModeTooltip("),
    script.indexOf("function renderMetricDimensionPanels("),
  );
  const context = {
    esc: (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
  };
  runInNewContext(helper, context);
  const rendered = context.metricModeTooltip("p95", "metric-dim-deviceModel");
  assert.match(rendered, /aria-describedby="metric-dim-deviceModel-p95-tip"/);
  assert.match(rendered, /id="metric-dim-deviceModel-p95-tip"/);
  assert.match(rendered, /95%分位值/);
  assert.match(rendered, /约 95% 样本不超过它/);
});

test("mode help flips below the trigger and clamps inside the viewport", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const helper = script.slice(
    script.indexOf("var modeTooltipVisual"),
    script.indexOf("function refreshModeHelpTooltip("),
  );
  const classes = new Set();
  const visual = {
    innerHTML: "",
    offsetWidth: 350,
    offsetHeight: 80,
    style: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const source = { innerHTML: "<strong>95%分位值</strong>完整说明" };
  const help = {
    getAttribute: () => "source-tip",
    getBoundingClientRect: () => ({
      left: 780,
      right: 800,
      top: 30,
      bottom: 49,
      width: 20,
      height: 19,
    }),
    contains: () => false,
  };
  const context = {
    window: { innerWidth: 800, innerHeight: 600 },
    document: {
      documentElement: {
        clientWidth: 800,
        clientHeight: 600,
        contains: () => true,
      },
      getElementById: (id) => (id === "global-mode-tooltip" ? visual : source),
    },
  };
  runInNewContext(helper, context);
  context.showModeHelpTooltip(help);
  assert.equal(context.activeModeHelp, help);
  assert.equal(visual.innerHTML, source.innerHTML);
  assert.equal(visual.style.left, "438px");
  assert.equal(visual.style.top, "57px");
  assert.ok(classes.has("is-visible"));
  context.hideModeHelpTooltip();
  assert.equal(context.activeModeHelp, null);
  assert.ok(!classes.has("is-visible"));
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
  assert.doesNotMatch(navigation, /data-section="apis"|API 监控/);
  const apiSection = dashboardHtml.match(
    /<section id="apis"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(apiSection);
  assert.match(
    dashboardHtml,
    /<section id="errors"[\s\S]*?<section id="apis" class="section" hidden aria-hidden="true">/,
  );
  assert.doesNotMatch(
    scriptFromDashboard(dashboardHtml),
    /querySelector\('\[data-section="apis"\]'\)/,
  );
});

function scriptFromDashboard(html) {
  return html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
}

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
  assert.doesNotMatch(script, /'MetricKit 崩溃'|'MetricKit 卡顿'/);
  assert.doesNotMatch(script, /card\('MetricKit 崩溃'|card\('MetricKit 卡顿'/);
  assert.doesNotMatch(script, /native\.latestDiagnostics/);

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

test("overview hides the entire iOS standalone snapshot panel", () => {
  assert.doesNotMatch(dashboardHtml, /iOS 独立运行快照/);
  assert.doesNotMatch(
    dashboardHtml,
    /id="native-kpis"|id="native-note"|id="overview-ios-tip"/,
  );
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotMatch(script, /#native-kpis|#native-note/);
});

test("overview omits the session-count card", () => {
  const script = scriptFromDashboard(dashboardHtml);
  assert.doesNotMatch(script, /card\('会话数'/);
  assert.doesNotMatch(script, /'会话数':/);
});

test("overview and slow-loading reports share the user-perception typography and surfaces", () => {
  assert.doesNotMatch(dashboardHtml, /class="report-breadcrumb"/);
  assert.match(
    dashboardHtml,
    /#overview \.section-header,#slowLoading \.section-header\{display:block;margin:0;padding:20px 0 16px\}/,
  );
  assert.match(
    dashboardHtml,
    /#overview \.section-header h2,#slowLoading \.section-header h2\{font-size:18px;font-weight:500/,
  );
  assert.match(
    dashboardHtml,
    /#overview-kpis,#slow-kpis\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(180px,1fr\)\);gap:0/,
  );
  assert.match(
    dashboardHtml,
    /#overview-kpis \.kpi,#slow-kpis \.kpi\{position:relative;min-width:0;min-height:117px;[^}]*border-radius:0;box-shadow:none\}/,
  );
  assert.match(
    dashboardHtml,
    /#overview \.panel,#slowLoading \.panel\{margin-top:16px;border:0;border-top:1px solid #edf0f4;border-bottom:1px solid #edf0f4/,
  );
});

test("slow-loading URL table omits the first-byte timing column", () => {
  const slowSection = dashboardHtml.match(
    /<section id="slowLoading"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(slowSection);
  assert.doesNotMatch(slowSection, /URL首字节加载耗时/);
  assert.match(
    slowSection,
    /<th>URL<\/th><th class="numeric">DOM Ready耗时<\/th><th class="numeric">页面完全加载耗时<\/th>/,
  );
  assert.match(
    dashboardHtml,
    /#slowLoading thead th:last-child,#slowLoading tbody td:last-child\{padding-left:64px;text-align:left\}/,
  );

  const script = scriptFromDashboard(dashboardHtml);
  assert.doesNotMatch(script, /slowFirstbyteMs/);
  assert.match(
    script,
    /ms\(page\.slowReadyMs\), ms\(page\.slowTotalMs\), optionalInteger\(page\.slowLoadingCount\)/,
  );
});

test("dashboard removes verbose metric and filter helper copy", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const removedCopy = [
    "应用于当前看板全部页面和指标",
    "未采集字段无可选值",
    "仅 page_load；非完整 PV",
    "仅 page_error",
    "按已测得耗时汇总",
    "按 contextId 去重",
    "按 sessionId 去重",
    "自建数据看板 · 非官方采样",
    "不是官网私有分桶口径",
    "对应 SDK total 字段",
    "iOS 上下文 ",
  ];
  for (const text of removedCopy) {
    assert.doesNotMatch(
      dashboardHtml,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.doesNotMatch(
      script,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(script, /\$\('#perf-freshness'\)\.textContent = ''/);
  assert.match(script, /\$\('#context-note'\)\.textContent = ''/);
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

test("AI analysis results provide a collapse control", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(
    dashboardHtml,
    /\.error-analysis-toggle-button\{[^}]*cursor:pointer/,
  );
  assert.match(
    dashboardHtml,
    /\.error-analysis-content\[hidden\]\{display:none\}/,
  );
  const render = script.slice(
    script.indexOf("function renderRecentErrors(data)"),
    script.indexOf("function renderErrors(data, isElk)"),
  );
  assert.match(render, /data-error-analysis-toggle/);
  assert.match(render, /errorAnalysisCollapsed\[key\] === true/);
  assert.match(script, /data-error-analysis-toggle/);
  assert.match(
    script,
    /errorAnalysisCollapsed\[toggleKey\] = toggleButton\.getAttribute\('aria-expanded'\) === 'true'/,
  );
  assert.match(
    dashboardHtml,
    /\.error-analysis-row>span:last-child\{flex:1;min-width:0\}/,
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
  const selectionStart = script.indexOf(
    "function selectSection(name, viewport)",
  );
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
  const restored = [];
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
    restoreViewport(viewport) {
      restored.push(viewport);
    },
    window: {
      scrollX: 24,
      scrollY: 180,
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
  assert.equal(restored[0].x, 24);
  assert.equal(restored[0].y, 180);
  buttons[1].click();
  assert.equal(pushed.length, 1);
  hash = "";
  listeners.popstate();
  assert.equal(sections[0].hidden, false);
  assert.equal(buttons[0]["aria-selected"], "true");
  assert.equal(restored.at(-1).x, 24);
  assert.equal(restored.at(-1).y, 180);
});
