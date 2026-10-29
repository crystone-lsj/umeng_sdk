/**
 * Dependency-free dashboard shell for the self-hosted H5 receiver.
 *
 * The information architecture follows common analytics products (overview,
 * pages, APIs, errors, performance), but all styling, wording, icons and code
 * here are original; no Umeng visual assets or frontend code are embedded.
 */

// Keep this template free of nested JavaScript template literals: this file is
// shipped without a bundler and must remain valid plain ECMAScript.
const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>H5 性能分析接收台</title>
<style>
.kpi.has-tooltip{position:relative;padding-right:42px}.kpi-help{position:absolute;right:12px;top:12px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:19px;height:19px;padding:0;border:1px solid #9ba8b9;border-radius:50%;background:#fff;color:#667085;font:600 12px/1 Arial,sans-serif;cursor:help}.kpi-help span{display:block;line-height:1;transform:translateY(-1px)}.kpi-help:hover,.kpi-help:focus-visible{border-color:var(--brand);color:var(--brand)}.kpi-help:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.kpi-tooltip{position:absolute;right:10px;top:38px;z-index:10;box-sizing:border-box;width:max-content;max-width:min(280px,calc(100vw - 60px));padding:9px 11px;border:1px solid #cfd9e8;border-radius:4px;background:#fff;box-shadow:0 6px 20px #17255426;color:#334155;font-size:12px;line-height:1.5;overflow-wrap:anywhere;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s ease}.kpi-help:hover+.kpi-tooltip,.kpi-help:focus+.kpi-tooltip{opacity:1;visibility:visible}.panel-title-with-help{display:inline-flex;align-items:center;gap:7px;position:relative}.panel-title-help{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:1px solid #9ba8b9;border-radius:50%;background:#fff;color:#667085;font:600 12px/1 Arial,sans-serif;cursor:help}.panel-title-help span{display:block;line-height:1;transform:translateY(-1px)}.panel-title-help:hover,.panel-title-help:focus-visible{border-color:var(--brand);color:var(--brand)}.panel-title-help:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.panel-title-tooltip{position:absolute;left:25px;top:26px;z-index:10;box-sizing:border-box;width:max-content;max-width:min(300px,calc(100vw - 60px));padding:9px 11px;border:1px solid #cfd9e8;border-radius:4px;background:#fff;box-shadow:0 6px 20px #17255426;color:#334155;font-size:12px;line-height:1.5;overflow-wrap:anywhere;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s ease}.panel-title-help:hover+.panel-title-tooltip,.panel-title-help:focus+.panel-title-tooltip{opacity:1;visibility:visible}
:root{color-scheme:light;--bg:#edf2f8;--panel:#fff;--line:#dbe3ee;--ink:#17233b;--muted:#667085;--brand:#2f6bff;--brand-dark:#1e48b8;--brand-soft:#edf3ff;--ok:#00a870;--warn:#f59f0b;--bad:#e5484d;--chart:#2f6bff}.app{display:grid;min-height:100vh;grid-template-columns:224px 1fr}.side{position:sticky;top:0;height:100vh;overflow:auto;background:#0d1f3c;color:#d8e4f4;padding:18px 12px}.brand{margin:4px 12px 20px}.brand b{display:block;color:#fff;font-size:17px}.brand span{color:#8ea9c8;font-size:12px}.nav-group{margin:16px 12px 7px;color:#7f9cbd;font-size:12px;font-weight:700}.nav{display:grid;gap:3px}.nav button{border:0;background:transparent;color:#c8d7ea;padding:9px 11px;border-radius:6px;text-align:left;cursor:pointer;font-size:14px}.nav button:hover{background:#173355;color:#fff}.nav button[aria-selected=true]{background:var(--brand);color:#fff;box-shadow:inset 3px 0 0 #8fb4ff}.main{min-width:0}.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 24px;background:#fffffff2;backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}.top h1{font-size:19px;margin:0}.controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}.controls label{font-size:12px;color:var(--muted)}.controls input,.controls select{height:30px;border:1px solid #cfd8e6;border-radius:6px;background:#fff;color:var(--ink);padding:0 8px;font-size:12px}.controls input[type=search]{width:205px}.button{height:30px;border:1px solid #bdcbe0;border-radius:6px;background:#fff;color:#334155;padding:0 11px;font-size:12px;cursor:pointer}.button:hover{border-color:var(--brand);color:var(--brand)}.status{min-width:210px;font-size:12px;color:var(--muted);text-align:right}.content{padding:20px 24px 40px}.section-header{display:flex;align-items:end;justify-content:space-between;gap:14px;margin:2px 0 14px}.section-header h2{font-size:21px;margin:0}.section-header p{margin:5px 0 0;color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:13px 14px;box-shadow:0 1px 2px #0f172a08}.kpi .label{color:var(--muted);font-size:12px}.kpi .value{font-size:23px;font-weight:750;margin-top:5px;letter-spacing:-.3px}.kpi .sub{font-size:11px;color:var(--muted);margin-top:3px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:9px;margin-top:14px;overflow:hidden}.panel>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px;border-bottom:1px solid var(--line)}.panel h3{font-size:15px;margin:0}.hint{font-size:12px;color:var(--muted)}.panel select{height:29px;border:1px solid #cfd8e6;border-radius:6px;padding:0 7px;font-size:12px;background:#fff;color:var(--ink)}.body{padding:14px 15px}.distribution-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.distribution-card{border:1px solid var(--line);border-radius:9px;padding:13px 14px}.distribution-card h4{margin:0 0 10px;font-size:13px}.dist-row{display:grid;grid-template-columns:110px 1fr 68px;align-items:center;gap:8px;margin:7px 0;font-size:12px}.dist-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dist-track{height:8px;border-radius:99px;background:#eef2f7;overflow:hidden}.dist-bar{height:100%;border-radius:99px;background:var(--brand)}.dist-value{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}.note{border-top:1px dashed var(--line);margin-top:11px;padding-top:9px;color:var(--muted);font-size:12px;line-height:1.6}.scroll{overflow:auto;max-width:100%}table{border-collapse:separate;border-spacing:0;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;white-space:nowrap;padding:9px 10px;border-bottom:1px solid #edf1f7}th{color:var(--muted);font-size:11px;font-weight:650;background:#f7f9fc;position:sticky;top:0;z-index:1}tbody tr:hover td{background:#f8faff}tbody tr:last-child td{border-bottom:0}td.numeric,th.numeric{text-align:right}.page-cell{max-width:430px;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}.empty{padding:27px;color:var(--muted);text-align:center}.trend{display:grid;grid-template-columns:repeat(24,1fr);align-items:end;gap:3px;height:150px}.bar{position:relative;min-height:2px;border-radius:3px 3px 0 0;background:#dbe6f6}.bar.api{background:#91d8b4}.bar.error{background:#f1a5aa}.hour-labels{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-top:6px;color:var(--muted);font-size:10px}.legend{display:flex;gap:11px;align-items:center}.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}.line-chart{display:block;width:100%;height:230px}.line-empty{padding:50px 0;color:var(--muted);text-align:center;font-size:13px}.axis{stroke:#e2e8f0;stroke-width:1}.series{fill:none;stroke:var(--chart);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.series-area{fill:#2f6bff12;stroke:0}.series-dot{fill:#fff;stroke:var(--chart);stroke-width:2}.error-item{border-bottom:1px solid #edf1f7;padding:12px 15px}.error-item:last-child{border-bottom:0}.error-head{display:flex;justify-content:space-between;gap:12px}.error-title{font-weight:650}.mono{font-family:ui-monospace,SFMono-Regular,monospace}.stack{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,monospace;color:#475569;font-size:12px}.tag{display:inline-block;border-radius:999px;padding:1px 8px;background:var(--brand-soft);color:var(--brand);font-size:12px}.quality{color:var(--ok)}.warn-rate{color:var(--warn)}.bad-rate{color:var(--bad)}.section[hidden]{display:none}#loading{padding:40px;text-align:center;color:var(--muted)}.error-box{margin:20px;padding:16px;border:1px solid #fecaca;background:#fff1f1;color:#991b1b;border-radius:8px}@media(max-width:860px){.app{grid-template-columns:1fr}.side{position:static;height:auto;padding:10px}.nav-group:first-child{margin-top:0}.nav{display:flex;overflow:auto}.nav button{white-space:nowrap}.top{align-items:flex-start;flex-direction:column}.status{min-width:0;text-align:left}.content{padding:13px}.section-header{align-items:flex-start;flex-direction:column}.page-cell{max-width:230px}.controls input[type=search]{width:155px}}

/* Keep the shell stable while switching dashboard sections. */
body{--bg:#f6f7fa;--ink:#2d3144;--line:#e8ebf0;--brand:#3b82fe}
.app{grid-template-columns:164px minmax(0,1fr)}
.side{padding:8px 4px}
.brand{margin:0 8px 12px;padding:10px 2px 14px}
.nav-group{margin:11px 10px 4px}
.nav button{font-size:12px;padding:8px 17px;border-radius:0}
.nav button[aria-selected=true]{box-shadow:none;background:#f0f8ff}
.top{position:relative;padding:8px 20px;min-height:35px;box-sizing:border-box}
.top h1{font-size:14px;font-weight:600}
.top .controls{gap:6px}
.top .controls>label,.top .controls>input,.top #status{display:none}
.main>.section:not(#userPerception){box-sizing:border-box;min-width:0;padding:0 20px 40px}
#userPerception{padding:0 20px 40px}
.perception-title{height:48px;display:flex;align-items:center;gap:16px}.perception-title h2{font-size:18px;font-weight:500;margin:0}.perception-title h2 span{font-size:14px;color:#9aa3b1}.local-badge{font-size:11px;color:#7991b2}
.perception-tip{background:#f5f9ff;padding:12px 16px;color:#56657b;font-size:12px;line-height:1.6;margin-bottom:16px}.perception-tip #perf-freshness{display:block;color:#8791a2}
.perception-filter{background:#fff;padding:10px 20px 16px;margin-bottom:16px}.global-filter{margin-top:16px}.filter-row{min-height:46px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;border-bottom:1px solid #f3f5f8}.filter-row:last-child{border:0}.filter-label{width:72px;flex:none;color:#2d3144}.filter-row label,.filter-note{font-size:12px;color:#8b95a3}.filter-row input,.filter-row select{height:30px;padding:0 8px;border:1px solid #d9dfe9;background:#fff;color:#374151;border-radius:2px;font-size:12px}.filter-row input[type=search]{width:230px}.filter-row .button{height:30px}.dimension-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dimension-filters select{max-width:170px;min-width:115px}.dimension-filter{position:relative}.dimension-filter>summary{list-style:none;border:1px solid #d9dfe9;background:#fff;color:#374151;border-radius:3px;font-size:12px;min-width:115px;max-width:180px;padding:7px 22px 7px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.dimension-filter>summary::-webkit-details-marker{display:none}.dimension-filter>summary:after{content:"⌄";position:absolute;right:8px}.dimension-filter[open]>summary{border-color:var(--brand);color:var(--brand)}.dimension-menu{position:absolute;top:calc(100% + 3px);left:0;z-index:12;min-width:220px;max-width:300px;background:#fff;border:1px solid #d9e0eb;box-shadow:0 9px 25px #17255425;border-radius:5px;padding:7px}.dimension-menu input[type=search]{box-sizing:border-box;width:100%;height:30px}.dimension-menu .app-name-form{display:flex;gap:5px;margin-top:7px}.dimension-menu .app-name-form input{min-width:0;flex:1;width:0}.dimension-options{max-height:230px;overflow:auto;margin-top:5px}.dimension-option{display:flex;align-items:center;gap:5px;min-height:30px;padding:3px 6px;cursor:pointer;overflow-wrap:anywhere}.dimension-option:hover{background:#f0f5ff}.dimension-option[hidden]{display:none}.dimension-option input{flex:none;height:auto}.dimension-empty{padding:9px;color:var(--muted);font-size:12px}
.autocomplete-field{position:relative;display:inline-flex;align-items:center;min-width:0}.filter-row>.autocomplete-field{flex:none}.filter-row>.autocomplete-field>input{width:230px}.identity-filter{display:inline-flex;align-items:center;gap:5px;position:relative;white-space:nowrap}.identity-filter .autocomplete-field>input{width:150px}.autocomplete-options{position:absolute;top:calc(100% + 3px);left:0;z-index:20;box-sizing:border-box;min-width:230px;max-width:360px;max-height:240px;overflow:auto;padding:4px;border:1px solid #d9e0eb;border-radius:4px;background:#fff;box-shadow:0 9px 25px #17255425}.autocomplete-options[hidden]{display:none}.autocomplete-option{display:block;width:100%;padding:8px 9px;border:0;background:#fff;color:#374151;text-align:left;font-size:12px;line-height:1.3;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.autocomplete-option:hover,.autocomplete-option[aria-selected=true]{background:#f0f5ff;color:var(--brand)}.autocomplete-empty{padding:8px 9px;color:var(--muted);font-size:12px}
.filter-row .client-time-option{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:none;cursor:pointer}.filter-row .client-time-option input[type=checkbox]{width:14px;height:14px;margin:0;padding:0;flex:none;accent-color:var(--brand)}
.perception-summary{background:#fff;margin:0 0 16px}.perception-summary>.perception-mode{padding:12px 20px 0}.perception-mode{display:flex;gap:0;align-items:center;flex-wrap:wrap;font-size:13px}.perception-mode label{padding:6px 16px;display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap;color:#465264}.perception-mode input{accent-color:var(--brand);margin:0}.perception-surface{padding:20px}
.metric-availability{margin:10px 0 0;padding:9px 12px;background:#f5f9ff;color:#56657b;font-size:12px;line-height:1.6}.metric-availability.is-empty{background:#fff8ed;color:#865b18}
.perception-kpis{display:flex;gap:0;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}.perception-kpis .kpi{position:relative;flex:0 0 228px;min-height:117px;box-sizing:border-box;border:1px solid #e7ebf1;border-right:0;border-radius:0;box-shadow:none;padding:0}.perception-kpis .kpi[data-selected]{border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)}.perception-kpis .kpi[data-selected] .value{color:var(--brand)}.perception-kpis .kpi:last-child{border-right:1px solid #e7ebf1}.perception-kpi-content{display:block;width:100%;min-height:115px;box-sizing:border-box;border:0;background:transparent;color:var(--ink);padding:16px 42px 16px 20px;text-align:left;font:inherit;cursor:pointer}.perception-kpi-content:focus-visible,.perception-kpi-help:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}.perception-kpis .kpi .label{display:block;font-size:14px;color:#374151}.perception-kpis .kpi .value{font-weight:500;font-size:25px;margin:8px 0 2px}.perception-kpis .kpi .sub{font-size:11px;color:#98a3b2}.perception-kpis .kpi .period{font-size:11px;color:#8793a3;margin-top:4px;white-space:nowrap}.perception-kpis .kpi .period span{margin-left:10px}.perception-kpi-help{position:absolute;right:16px;top:16px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:19px;height:19px;padding:0;border:1px solid #9ba8b9;border-radius:50%;background:#fff;color:#667085;font:600 12px/1 Arial,sans-serif;cursor:help}.perception-kpi-help span{display:block;line-height:1;transform:translateY(-1px)}.perception-kpi-help:hover,.perception-kpi-help:focus-visible{border-color:var(--brand);color:var(--brand)}.perception-kpi-tooltip{position:absolute;left:10px;top:42px;z-index:10;box-sizing:border-box;width:max-content;max-width:min(260px,calc(100vw - 60px));padding:9px 11px;border:1px solid #cfd9e8;border-radius:4px;background:#fff;box-shadow:0 6px 20px #17255426;color:#334155;font-size:12px;line-height:1.5;overflow-wrap:anywhere;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s ease}.perception-kpi-help:hover+.perception-kpi-tooltip,.perception-kpi-help:focus+.perception-kpi-tooltip{opacity:1;visibility:visible}
.perception-block{padding:20px 0 24px;border-bottom:1px solid #edf0f4}.perception-block:last-child{border:0}.perception-block h3{margin:0 0 16px;font-size:18px;font-weight:500}.perception-block-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.perception-block-title select{font-size:12px;height:30px;border:1px solid #dce2eb;background:#fff;color:#455366}.perception-chart{min-height:250px}.perception-chart .line-chart{height:260px}.perception-samples{max-width:620px;min-height:150px}.perception-samples .dist-row{grid-template-columns:90px 1fr 100px;margin:16px 0}.metric-dim-row{display:grid;grid-template-columns:minmax(90px,1fr) 60px 70px;align-items:center;gap:6px;margin:11px 0;font-size:12px}.metric-dim-row>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric-dim-row strong{text-align:right;font-size:12px;font-weight:500}.metric-dim-row small{grid-column:1/-1;color:#98a3b2;text-align:right;font-size:10px}.perception-block .note{border:0;font-size:11px;padding:0}
#userPerception .dimension-panels{grid-template-columns:repeat(3,minmax(220px,1fr));gap:16px}#userPerception .dimension-panel{min-height:0;padding:15px;border:1px solid #e9edf3}#userPerception .dimension-panel h4{font-size:14px;font-weight:500}#userPerception .dimension-panel .report-label{margin:6px 0 10px}
.perception-table-panel{margin-top:16px;border:0;border-radius:2px;box-shadow:none}.perception-table-panel>header{padding:20px;border:0}.perception-table-panel h3{font-size:18px;font-weight:500}.perception-table-tools{padding:0 20px 15px;display:flex;justify-content:space-between;align-items:center;gap:10px}.perception-table-panel th{background:#fafbfc;color:#616d7c}.perception-table-panel th,.perception-table-panel td{padding:12px 10px;border-bottom:1px solid #edf0f4}.perception-pager{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:16px 20px;color:#7b8797;font-size:12px}.perception-pager .button:disabled{opacity:.4;cursor:default}
@media(max-width:860px){.app{grid-template-columns:1fr}.side{position:relative;height:auto}#userPerception .dimension-panels{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}}
 .range-buttons{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.range-buttons button,.range-buttons summary{border:1px solid #d9e0eb;background:#fff;padding:6px 10px;border-radius:4px;cursor:pointer;color:#344054;font:inherit}.range-buttons button[aria-pressed="true"]{color:#2f6bff;border-color:#2f6bff;background:#f0f5ff}.range-buttons details{position:relative}.range-more{position:absolute;z-index:10;top:100%;right:0;background:#fff;border:1px solid #d9e0eb;border-radius:5px;box-shadow:0 8px 24px #17255422;display:grid;min-width:120px;padding:5px}.range-more button{text-align:left;border:0;white-space:nowrap}
.error-trend{padding:0 15px 10px}.error-trend .line-chart{height:260px}
#error-kpis{grid-template-columns:repeat(4,minmax(0,216px));gap:0}.error-kpi{position:relative;min-width:0;min-height:117px;box-sizing:border-box;padding:0;border-color:#e7ebf1;border-radius:0;box-shadow:none}.error-kpi:not(:last-child){border-right:0}.error-kpi[data-selected]{border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)}.error-kpi[data-selected] .value{color:var(--brand)}.error-kpi-content{display:block;box-sizing:border-box;width:100%;min-height:115px;border:0;background:transparent;color:inherit;padding:16px 42px 16px 20px;text-align:left;font:inherit;cursor:pointer}.error-kpi-content:focus-visible,.error-kpi-help:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}.error-kpi .label{display:block;color:#374151;font-size:14px;font-weight:400;line-height:1.4}.error-kpi .value{display:block;margin-top:8px;font-size:25px;font-weight:500;line-height:1.25;font-variant-numeric:tabular-nums}.error-kpi-help{position:absolute;right:16px;top:16px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:19px;height:19px;padding:0;border:1px solid #9ba8b9;border-radius:50%;background:#fff;color:#667085;font:600 12px/1 Arial,sans-serif;cursor:help}.error-kpi-help span{display:block;line-height:1;transform:translateY(-1px)}.error-kpi-help:hover,.error-kpi-help:focus-visible{border-color:var(--brand);color:var(--brand)}.error-kpi-tooltip{position:absolute;right:10px;top:42px;z-index:10;box-sizing:border-box;width:max-content;max-width:min(260px,calc(100vw - 60px));padding:9px 11px;border:1px solid #cfd9e8;border-radius:4px;background:#fff;box-shadow:0 6px 20px #17255426;color:#334155;font-size:12px;line-height:1.5;overflow-wrap:anywhere;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s ease}.error-kpi-help:hover+.error-kpi-tooltip,.error-kpi-help:focus+.error-kpi-tooltip{opacity:1;visibility:visible}
.series-error{stroke:var(--bad)}.series-area-error{fill:#e5484d1f}.series-dot-error{stroke:var(--bad)}.trend-bars{pointer-events:none}.trend-bar{fill:var(--chart);opacity:.16}.trend-bar-error{fill:var(--bad);opacity:.18}
.error-distribution-block{padding-top:20px}.error-distribution-block .dimension-panel .dist-row{grid-template-columns:minmax(85px,1fr) 1fr 95px}.error-distribution-block .dimension-panel .dist-name{min-width:0}.error-item{padding:13px 15px;border-bottom:1px solid var(--line)}.error-item:last-child{border:0}.error-head{display:flex;align-items:start;justify-content:space-between;gap:15px}.error-head>div:first-child{min-width:0}.error-title{font-weight:600;font-size:13px}.error-item .mono{overflow-wrap:anywhere;white-space:normal}.error-item .hint{margin-top:7px;overflow-wrap:anywhere}.error-item .tag{white-space:nowrap}
@media(max-width:1080px){#error-kpis{grid-template-columns:repeat(2,minmax(0,216px))}.error-kpi:nth-child(2){border-right:1px solid #e7ebf1}.error-kpi:nth-child(-n+2){border-bottom:0}}
@media(max-width:520px){#error-kpis{grid-template-columns:minmax(0,min(216px,100%))}.error-kpi:not(:last-child){border-right:1px solid #e7ebf1;border-bottom:0}}
@media(prefers-reduced-motion:reduce){.error-kpi-tooltip{transition:none}}
.error-pager{display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:6px;padding:14px 15px;color:var(--muted);font-size:12px}.error-pager[hidden]{display:none}.error-pager .button{min-width:30px;padding:0 7px}.error-pager .button[aria-current="page"]{background:var(--brand);border-color:var(--brand);color:#fff}.error-pager .button:disabled{opacity:.4;cursor:default}.error-pager .page-size{margin-left:8px}
.error-list-head,.error-row{display:grid;grid-template-columns:36px minmax(0,1fr) 112px 170px 16px;gap:12px;align-items:center}.error-list-head{padding:10px 15px;background:#f8fafc;border-bottom:1px solid var(--line);color:var(--muted);font-size:12px}.error-list-head[hidden]{display:none}.error-item{padding:0}.error-row{box-sizing:border-box;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:12px 15px;cursor:pointer}.error-row:hover{background:#f8faff}.error-row:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}.error-item[data-open] .error-row{background:#f8faff}.error-index,.error-version,.error-time{color:#667085;font-size:12px;font-variant-numeric:tabular-nums}.error-summary{min-width:0}.error-summary .error-title{font-size:13px}.error-message{margin-top:4px;color:#667085;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.error-version{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.error-time{white-space:nowrap}.error-expand-icon{color:#8492a6;text-align:center;transition:transform .28s ease}.error-item[data-open] .error-expand-icon{transform:rotate(180deg)}.error-detail-shell{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s ease}.error-item[data-open] .error-detail-shell{grid-template-rows:1fr}.error-detail-clip{min-height:0;overflow:hidden}.error-detail{padding:0 15px 16px 63px;border-top:1px solid var(--line);overflow-wrap:anywhere;opacity:0;transform:translateY(-6px);transition:opacity .22s ease,transform .28s ease}.error-item[data-open] .error-detail{opacity:1;transform:translateY(0)}.error-detail-line{display:flex;gap:12px;padding-top:10px;font-size:12px;line-height:1.5}.error-detail-line>span:first-child{flex:0 0 56px;color:var(--muted)}.error-detail-line>span:last-child{min-width:0}.error-detail .stack{margin:6px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.error-detail-block{margin-top:12px}.error-detail-block .report-label{margin:0}
@media(prefers-reduced-motion:reduce){.error-detail-shell,.error-detail,.error-expand-icon{transition:none}}
.error-summary .error-title,.error-message{display:block}
.error-analysis-row{display:flex;align-items:flex-start;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid #edf0f4;font-size:12px;line-height:1.5}.error-analysis-row>span:first-child{flex:0 0 56px;color:var(--muted)}.error-analysis-button{border:1px solid #cbd8ee;border-radius:4px;background:#fff;color:var(--brand);padding:4px 9px;font:inherit;cursor:pointer}.error-analysis-button:hover:not(:disabled),.error-analysis-button:focus-visible{border-color:var(--brand);background:var(--brand-soft)}.error-analysis-button:disabled{color:#8492a6;cursor:wait}.error-analysis-result{min-width:0}.error-analysis-result .mono{display:block}.error-analysis-result pre{margin:6px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.error-analysis-result .hint{margin-top:0}
@media(max-width:700px){.error-list-head{display:none}.error-row{grid-template-columns:32px minmax(0,1fr) 16px;gap:4px 9px}.error-summary{grid-column:2}.error-expand-icon{grid-column:3;grid-row:1}.error-version,.error-time{grid-column:2}.error-version{grid-row:2}.error-time{grid-row:3}.error-version:before{content:'版本  '}.error-time:before{content:'时间  '}.error-detail{padding-left:56px}}
#errors .dimension-panels{grid-template-columns:repeat(3,minmax(220px,1fr));gap:16px}#errors .dimension-panel{min-height:215px;padding:15px;border:1px solid #e9edf3}#errors .dimension-panel h4{font-size:14px;font-weight:500}#errors .dimension-panel .report-label{margin:6px 0 12px}
@media(max-width:860px){#errors .dimension-panels{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}}
</style>
<style>
.storage-status{display:flex;align-items:center;gap:4px;font-size:11px;color:#697586;white-space:nowrap}.storage-status label{display:flex;align-items:center;gap:4px}.storage-status select{height:26px;border:1px solid #cfd8e6;border-radius:5px;background:#fff;color:#334155;padding:0 5px;font:inherit;cursor:pointer}.storage-status select:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
/* The three H5 views share a compact filter header and report-style panels.
   These styles are original; no third-party font, icon or artwork is loaded. */
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink)}
:root{--bg:#f5f7fa;--line:#e7ebf0;--ink:#273244;--brand:#3778f6;--brand-soft:#eff5ff}
.side{background:#fff;color:#374151;border-right:1px solid var(--line);padding:17px 12px}
.brand{padding:3px 0 16px;border-bottom:1px solid var(--line)}.brand b{color:#263448}
.brand span{color:#8995a7}.nav-group{color:#8995a7}.nav button{color:#46546b}
.nav button:hover{background:#f2f6ff;color:var(--brand)}
.nav button[aria-selected=true]{background:#edf4ff;color:var(--brand);box-shadow:inset 3px 0 0 var(--brand)}
.top{background:#fff}.content{max-width:1600px;margin:auto}.panel,.kpi{box-shadow:0 1px 3px #17233b08;border-radius:4px}
.section-header h2{font-size:20px}.section-header p{line-height:1.5}.kpi .value{font-size:25px}
.report-breadcrumb{color:#8a96a8;font-size:12px;margin:0 0 13px}
.report-breadcrumb strong{color:#273244;font-weight:600}.report-controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.report-controls label{font-size:12px;color:#657085}.report-controls select{font-size:12px;background:#fff;border:1px solid #d3dce8;border-radius:4px;padding:5px 8px;color:#273244}
.report-label{color:#657085;font-size:12px;display:block;margin-bottom:4px}.waterfall{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}
.waterfall-item{padding:12px;border:1px solid var(--line);background:#fbfcff;min-width:0}
.waterfall-item strong{font-size:16px;font-variant-numeric:tabular-nums}.waterfall-item small{display:block;color:var(--muted);margin-top:5px}
.waterfall-track{height:5px;border-radius:9px;background:#e9eef8;margin-top:12px;overflow:hidden}.waterfall-track i{display:block;height:100%;background:var(--brand)}
.dist-row{grid-template-columns:minmax(0,1fr) auto;gap:12px;margin:7px 0;padding:10px 12px;background:#eef5ff}.dist-value{color:#334155}.perception-samples .dist-row{grid-template-columns:90px minmax(0,1fr) 100px;gap:8px;margin:16px 0;padding:0;background:transparent}.perception-samples .dist-bar{display:block}.metric-dim-row{grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;margin:4px 0;padding:6px 12px;background:#eef5ff}.metric-dim-row strong{color:#334155;font-variant-numeric:tabular-nums}.metric-dim-row small{color:#8b98aa}.error-distribution-block .dimension-panel .dist-row{grid-template-columns:minmax(0,1fr) auto}
.dimension-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
.dimension-panel{border:1px solid var(--line);padding:13px;min-height:90px}.dimension-panel h4{margin:0 0 4px;font-size:13px}.dimension-panel .report-label{margin-bottom:10px}
.dim-detail{display:block;color:var(--brand);font-size:11px;margin-top:8px}
@media(max-width:860px){.side{border-right:0;border-bottom:1px solid var(--line)}.brand{border:0;padding:0}.report-controls{width:100%}}
 .range-buttons{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.range-buttons button,.range-buttons summary{border:1px solid #d9e0eb;background:#fff;padding:6px 10px;border-radius:4px;cursor:pointer;color:#344054;font:inherit}.range-buttons button[aria-pressed="true"]{color:#2f6bff;border-color:#2f6bff;background:#f0f5ff}.range-buttons details{position:relative}.range-more{position:absolute;z-index:10;top:100%;right:0;background:#fff;border:1px solid #d9e0eb;border-radius:5px;box-shadow:0 8px 24px #17255422;display:grid;min-width:120px;padding:5px}.range-more button{text-align:left;border:0;white-space:nowrap}
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand"><b>H5 APM</b><span>自建接收看板</span></div>
    <div class="nav-group">H5 页面分析</div>
    <nav class="nav" aria-label="看板模块">
      <button type="button" data-section="overview">总览</button>
      <button type="button" data-section="userPerception" aria-selected="true">用户感知</button>
      <button type="button" data-section="slowLoading">慢加载</button>
      <button type="button" data-section="apis">API 监控</button>
      <button type="button" data-section="errors">错误分析</button>
    </nav>
  </aside>
  <main class="main">
    <header class="top">
      <h1>H5 页面分析</h1>
      <div class="controls">
        <label for="date">归档日期</label><input id="date" type="date">
        <button id="source-map-upload" class="button" type="button">上传 Source Map ZIP</button><input id="source-map-file" type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden>
        <button id="refresh" class="button" type="button">刷新</button>
        <span id="status" class="status"></span><span id="source-map-status" class="status" role="status">未上传 Source Map</span><span id="storage-status" class="storage-status" role="status"><label for="storage-source">数据来源：<select id="storage-source" aria-label="数据来源"><option value="test">测试环境 ELK</option><option value="online">线上环境 ELK</option></select></label></span>
      </div>
    </header>
    <div id="loading">正在读取数据…</div>
    <div id="error" class="error-box" hidden></div>

    <div id="global-filters" class="perception-filter global-filter">
      <div class="filter-row"><span class="filter-label">时间范围:</span><div class="range-buttons" id="user-ranges" role="group" aria-label="时间范围"><button type="button" data-range="hour">过去一个小时</button><button type="button" data-range="48hours">过去48小时</button><button type="button" data-range="today">今天</button><button type="button" data-range="7days" aria-pressed="true">最近七天</button><details id="user-more"><summary>更多</summary><div class="range-more"><button type="button" data-range="30days">最近30天</button><button type="button" data-range="60days">最近60天</button><button type="button" data-range="90days">最近90天</button></div></details></div><label for="user-date">自定义单日</label><input id="user-date" type="date" aria-label="自定义单日"><label class="client-time-option"><input id="client-time" type="checkbox">客户端发生时间</label><span id="range-label" class="filter-note">按接收时间筛选</span></div>
      <div class="filter-row"><span class="filter-label">筛选维度:</span><div id="user-dimension-filters" class="dimension-filters"></div><button type="button" class="button" id="user-reset-all">重置全部</button><span class="filter-note">应用于当前看板全部页面和指标；未采集字段无可选值。</span></div>
      <div class="filter-row"><span class="filter-label">页面筛选:</span><span class="autocomplete-field"><input id="page-filter" data-autocomplete-field="PAGE" type="search" placeholder="搜索页面 URL 或路径" aria-label="搜索页面 URL 或路径" autocomplete="off"><div id="page-filter-options" class="autocomplete-options" role="listbox" hidden></div></span><button class="button" id="user-reset" type="button">重置页面筛选</button><span class="filter-note">应用于总览、趋势、页面、接口、错误和性能数据。</span></div>
    </div>

    <section id="userPerception" class="section">
      <div class="perception-title"><h2>用户感知 <span title="页面性能来自本地采集，不受友盟采样率约束">ⓘ</span></h2><span class="local-badge">自建数据看板 · 非官方采样</span></div>
      <div class="perception-tip">本模块展示 H5 页面加载过程中的用户感知指标。所有数值来自本地接收的真实性能事件，未采集的字段显示 —。样本量仅计算收到的 perf 事件，不等于 PV。<span id="perf-freshness"></span></div>
      <div class="perception-summary">
        <div class="perception-mode" id="user-mode" role="group" aria-label="整体指标口径">
          <label><input type="radio" name="user-mode" value="average">平均值</label><label><input type="radio" name="user-mode" value="p50">50%分位值</label><label><input type="radio" name="user-mode" value="p90" checked>90%分位值</label><label><input type="radio" name="user-mode" value="p95">95%分位值</label>
        </div>
        <div class="perception-surface">
          <div id="user-kpis" class="perception-kpis"></div><div id="metric-availability" class="metric-availability" role="status"></div>
          <div class="perception-block"><div class="perception-block-title"><h3>整体趋势</h3><select id="user-metric" aria-label="用户感知趋势指标"></select></div><div id="user-trend" class="perception-chart"></div></div>
          <div class="perception-block"><h3>样本分布</h3><div id="sample-distribution" class="perception-samples"></div><div class="note">本地分档：良好 ≤ 2s、一般 2–5s、较差 &gt; 5s；不是官网私有分桶口径。仅计算带 total（缺失时回退 load）的性能样本。</div></div>
          <div class="perception-block"><div class="perception-block-title"><h3>维度分布</h3><span class="hint">TOP5 · 有来源的性能样本 · 点击上方指标卡切换</span></div><div id="user-dimensions" class="dimension-panels"></div><div class="note" id="context-note"></div></div>
        </div>
      </div>
      <div class="panel perception-table-panel">
        <header><h3>指标列表</h3><span class="hint">按 Host + Path 聚合，列表筛选不影响上方整体指标</span></header>
        <div class="perception-table-tools"><div class="perception-mode" id="user-table-mode" role="group" aria-label="指标列表口径"><label><input type="radio" name="user-table-mode" value="average" checked>平均值</label><label><input type="radio" name="user-table-mode" value="p50">50%分位值</label><label><input type="radio" name="user-table-mode" value="p90">90%分位值</label><label><input type="radio" name="user-table-mode" value="p95">95%分位值</label></div><button class="button" id="user-export" type="button">导出 CSV</button></div>
        <div class="scroll"><table><thead><tr><th>页面</th><th class="numeric">首字节响应时间(TTFB)</th><th class="numeric">TCP连接</th><th class="numeric">页面可交互时间(TTI)</th><th class="numeric">页面完全加载</th><th class="numeric">1秒快开比</th><th class="numeric">2秒快开比</th><th class="numeric">5秒慢开比</th><th class="numeric">样本量</th></tr></thead><tbody id="user-rows"></tbody></table></div>
        <div id="user-empty" class="empty" hidden>暂无页面数据</div><div class="perception-pager"><span id="user-page-count"></span><button class="button" id="user-prev" type="button">上一页</button><span id="user-page-number">1</span><button class="button" id="user-next" type="button">下一页</button><span>10 条/页</span></div>
      </div>
    </section>

    <section id="slowLoading" class="section" hidden>
      <div class="report-breadcrumb">性能分析 / H5 页面分析 / <strong>慢加载</strong></div>
      <div class="section-header"><div><h2 class="panel-title-with-help">慢加载<button type="button" class="panel-title-help" aria-label="慢加载说明" aria-describedby="slow-loading-section-tip"><span aria-hidden="true">?</span></button><span id="slow-loading-section-tip" class="panel-title-tooltip" role="tooltip">按设定阈值统计页面完全加载耗时超过阈值的性能样本，用于定位加载明显偏慢的页面。</span></h2><p>页面加载时间定义为 loadEventEnd - fetchStart，对应 SDK total 字段。</p></div></div>
      <div id="slow-kpis" class="grid"></div>
      <div class="panel">
        <header><h3 class="panel-title-with-help">慢加载 URL 列表<button type="button" class="panel-title-help" aria-label="慢加载 URL 列表说明" aria-describedby="slow-url-list-tip"><span aria-hidden="true">?</span></button><span id="slow-url-list-tip" class="panel-title-tooltip" role="tooltip">按页面 URL 汇总超过当前阈值的加载样本，仅展示存在慢加载样本的页面。</span></h3><label class="hint" for="slow-threshold">慢加载阈值</label><select id="slow-threshold"><option value="1000">1 秒</option><option value="2000">2 秒</option><option value="3000">3 秒</option><option value="5000" selected>5 秒</option><option value="10000">10 秒</option></select></header>
        <div class="scroll"><table><thead><tr><th>URL</th><th class="numeric">URL首字节加载耗时</th><th class="numeric">DOM Ready耗时</th><th class="numeric">页面完全加载耗时</th><th class="numeric">慢加载次数</th><th class="numeric">样本量</th><th class="numeric">慢加载率</th><th>最近采样</th></tr></thead><tbody id="slow-rows"></tbody></table></div>
        <div id="slow-empty" class="empty" hidden>暂无慢加载数据</div>
      </div>
    </section>

    <section id="overview" class="section" hidden>
      <div class="section-header"><div><h2 class="panel-title-with-help">总览<button type="button" class="panel-title-help" aria-label="总览说明" aria-describedby="overview-section-tip"><span aria-hidden="true">?</span></button><span id="overview-section-tip" class="panel-title-tooltip" role="tooltip">汇总当前时间范围、页面和筛选条件下的 H5 访问、会话、错误及接口数据。</span></h2><p>H5 直报数据整体概览。</p></div></div>
      <div id="overview-kpis" class="grid"></div>
      <div class="panel"><header><h3 class="panel-title-with-help">iOS 独立运行快照<button type="button" class="panel-title-help" aria-label="iOS 独立运行快照说明" aria-describedby="overview-ios-tip"><span aria-hidden="true">?</span></button><span id="overview-ios-tip" class="panel-title-tooltip" role="tooltip">展示 iOS Reporter 独立上报的运行上下文和系统诊断摘要，不代表友盟原生 APM 的完整崩溃、卡顿或 OOM 指标。</span></h3><span class="hint">Reporter 自行采集，非友盟原生 APM 上报数据；不代表崩溃、卡顿或 OOM 检测</span></header><div class="body"><div id="native-kpis" class="grid"></div><div class="note" id="native-note"></div></div></div>
      <div class="panel">
        <header><h3 class="panel-title-with-help">24 小时趋势<button type="button" class="panel-title-help" aria-label="24 小时趋势说明" aria-describedby="overview-trend-tip"><span aria-hidden="true">?</span></button><span id="overview-trend-tip" class="panel-title-tooltip" role="tooltip">按小时展示当前筛选范围内的页面访问、API 请求和页面错误数量；不同时间范围会使用对应的时间粒度。</span></h3><div class="legend"><span><i style="background:#dbe6f6"></i>PV</span><span><i style="background:#91d8b4"></i>API</span><span><i style="background:#f1a5aa"></i>错误</span></div></header>
        <div class="body"><div id="trend" class="trend"></div><div id="hour-labels" class="hour-labels"></div></div>
      </div>
    </section>

    <section id="apis" class="section" hidden>
      <div class="section-header"><div><h2>API 监控</h2><p>2xx 视为成功。</p></div></div>
      <div class="panel"><div class="scroll"><table><thead><tr><th>接口</th><th class="numeric">请求数</th><th class="numeric">失败数</th><th class="numeric">成功率</th><th class="numeric">平均耗时</th><th class="numeric">P50</th><th class="numeric">P95</th></tr></thead><tbody id="api-rows"></tbody></table></div><div id="api-empty" class="empty" hidden>暂无 API 数据</div></div>
    </section>

    <section id="errors" class="section" hidden>
      <div class="section-header"><div><h2>错误分析</h2><p>按当前时间范围统计已上报的页面错误；页面卡顿属于不同事件，不计入错误。</p></div></div>
      <div id="error-kpis" class="grid" role="group" aria-label="错误趋势指标"></div>
      <div class="panel"><header><h3>整体趋势</h3><span id="error-trend-note" class="hint"></span></header><div id="error-trend" class="perception-chart error-trend"></div></div>
      <div class="perception-block error-distribution-block"><div class="perception-block-title"><h3>错误分布</h3><span class="hint">TOP5 · 按错误次数排序 · 占全部错误比例</span></div><div id="error-dimensions" class="dimension-panels"></div><div class="note">错误维度按当前筛选范围内的 page_error 记录聚合；缺失字段统一归入“未上报”。</div></div>
      <div class="panel"><header><h3>受影响页面</h3></header><div class="scroll"><table><thead><tr><th>页面路径</th><th class="numeric">错误次数</th><th class="numeric">占比</th><th>最近发生</th></tr></thead><tbody id="error-page-rows"></tbody></table></div><div id="error-page-empty" class="empty" hidden>暂无页面错误</div></div>
      <div class="panel"><header><h3>最近错误</h3><span id="error-count" class="hint"></span></header><div id="error-list-head" class="error-list-head" hidden><span>序号</span><span>错误信息</span><span>版本</span><span>时间</span><span></span></div><div id="error-list"></div><div id="error-empty" class="empty" hidden>暂无错误数据</div><nav id="error-pager" class="error-pager" aria-label="最近错误分页" hidden></nav></div>
    </section>

  </main>
</div>
<script>
window.__SINK_BASE_PATH__ = __BASE_PATH__;
var state = { range: '7days', elkEnvironment: 'test', userMode: 'p90', userTableMode: 'average', userPage: 0, errorPage: 0, pageFilter: '', userMetric: 'ttfb', errorMetric: 'errors', slowThreshold: 5000, clientTime: false, performanceFilters: {}, previousMetrics: null };
var errorAnalysisJobs = Object.create(null);
var userMetricLabels = { ttfb: '首字节响应时间(TTFB)', tcp: 'TCP连接', tti: '页面可交互时间(TTI)', pageLoad: '页面完全加载', oneSecondFastRate: '1秒快开比', twoSecondFastRate: '2秒快开比', fiveSecondSlowRate: '5秒慢开比' };
var userMetricDescriptions = { ttfb: '从页面开始导航到收到服务器返回的第一个字节所经过的时间。', tcp: '建立 TCP 连接所经过的时间，数值越低表示网络连接建立越快。', tti: '页面达到可交互状态所经过的时间，表示用户可以开始稳定操作页面。', pageLoad: '从页面开始导航到页面加载完成事件触发所经过的时间。', oneSecondFastRate: '有效加载样本中，在 1 秒内完成加载的比例。', twoSecondFastRate: '有效加载样本中，在 2 秒内完成加载的比例。', fiveSecondSlowRate: '有效加载样本中，加载耗时超过 5 秒的比例。' };
var errorTrendMetricLabels = { errors: '错误总数', affectedVisitors: '受影响访客数', issues: '独立问题', pageCount: '涉及页面' };
var dimensionLabels = { screenSize: '设备屏幕尺寸', viewport: '视口', release: 'H5 release', appVersion: '应用版本（iOS 副本）', deviceModel: '机型（iOS 副本）', osVersion: '操作系统（iOS 副本）', networkType: '网络类型', carrier: '运营商（iOS 副本）', region: '地域（iOS 副本）', environment: '环境' };
function $(selector) { return document.querySelector(selector); }
function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]; }); }
function pct(value) { return value == null ? '—' : value.toFixed(1) + '%'; }
function ms(value) { return value == null ? '—' : Math.round(value) + ' ms'; }
function integer(value) { return (value == null ? 0 : value).toLocaleString('zh-CN'); }
function optionalInteger(value) { return value == null ? '—' : value.toLocaleString('zh-CN'); }
function datetime(value) {
  if (!value) return '—';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  var pad = function (number) { return String(number).padStart(2, '0'); };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}
function trendDate(item, index, data) {
  if (!data.range) return new Date(data.date + 'T' + item.hour + ':00:00Z');
  if (data.range.bucket === 'utc-5-minute') return new Date(Math.floor(Date.parse(data.range.from) / 300000) * 300000 + index * 300000);
  return new Date(item.hour.replace(' ', 'T') + (data.range.bucket === 'utc-day' ? 'T00:00:00Z' : ':00:00Z'));
}
function trendLabel(item, index, data) {
  var date = trendDate(item, index, data);
  return Number.isNaN(date.getTime()) ? item.hour : datetime(date).slice(data.range && data.range.bucket === 'utc-day' ? 0 : 5, data.range && data.range.bucket === 'utc-day' ? 10 : 16);
}
function apiPath(path) { return (window.__SINK_BASE_PATH__ || '') + path; }
var cardDescriptions = {
  '浏览量 PV': '统计当前筛选范围内收到的页面浏览事件；不同数据源的事件口径可能不同。',
  '已观测加载': '统计当前筛选范围内收到的 page_load 事件，不等同于完整 PV。',
  '独立访客 UV': '按照当前数据源提供的访客标识去重后的访客数量。',
  '会话数': '按照当前数据源提供的会话标识去重后的会话数量。',
  'JS 错误': '统计当前筛选范围内收到的 JavaScript 异常记录，可在错误分析中查看详情。',
  '页面错误': '统计当前筛选范围内收到的 page_error 记录。',
  'API 请求': '统计当前筛选范围内收到的 API 请求记录；下方补充显示请求成功率。',
  'API 平均耗时': '当前筛选范围内已测得 API 请求耗时的平均值，未提供耗时的记录不参与计算。',
  'iOS 上下文': '统计收到 iOS Reporter 运行快照的独立上下文数量。',
  '上报快照': '统计 iOS Reporter 实际接收的运行快照记录数量。',
  'Reporter 启动': '统计由 Reporter 启动触发的独立运行快照，不代表官方启动性能指标。',
  '进入前台': '统计由应用进入前台通知触发的 iOS Reporter 快照。',
  '进入后台': '统计由应用进入后台通知触发的 iOS Reporter 快照；进程挂起时可能无法及时上报。',
  '内存警告': '统计 iOS 系统内存警告通知触发的 Reporter 快照数量。',
  '最近常驻内存': '最近一次 iOS Reporter 快照中的应用自身进程常驻内存，不是系统总内存。',
  '网络变化': '统计由网络状态变化通知触发的 iOS Reporter 快照。',
  'MetricKit 崩溃': '最近收到的 MetricKit 诊断期崩溃摘要，不代表当前时间范围内的实时崩溃数。',
  'MetricKit 卡顿': '最近收到的 MetricKit 诊断期卡顿摘要，通常会延迟送达，不能与当前 H5 样本直接相加。',
  '慢加载次数': '统计页面完全加载耗时超过当前阈值的性能样本数量。',
  '慢加载率': '慢加载样本数占有效加载样本数的比例。',
  '受影响页面': '当前筛选范围内存在至少一个慢加载样本的页面数量。',
  '受影响用户': '按照性能记录中的访客标识去重后，出现慢加载样本的用户数量。',
};
function card(label, value, sub) {
  var tooltipId = 'metric-tip-' + String(label).replace(/[^\w\u4e00-\u9fff]+/g, '-');
  var description = cardDescriptions[label] || sub;
  return '<div class="kpi has-tooltip"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div><button type="button" class="kpi-help" aria-label="' + esc(label) + '说明" aria-describedby="' + tooltipId + '"><span aria-hidden="true">?</span></button><span id="' + tooltipId + '" class="kpi-tooltip" role="tooltip">' + esc(description) + '</span></div>';
}
function cells(values, classes) { return values.map(function (value, index) { return '<td class="' + (classes && classes[index] ? 'numeric' : '') + '">' + value + '</td>'; }).join(''); }
function renderRows(selector, rows, mapper, emptySelector, classes) { $(selector).innerHTML = rows.map(function (row) { return '<tr>' + cells(mapper(row), classes) + '</tr>'; }).join(''); if (emptySelector) $(emptySelector).hidden = rows.length > 0; }
function ratioMetric(value) { return value != null ? pct(value) : '—'; }
function metricValue(summary, mode) { return summary == null || summary[mode] == null ? '—' : ms(summary[mode]); }
function trendValue(summary, id, mode) { if (id === 'oneSecondFastRate' || id === 'twoSecondFastRate' || id === 'fiveSecondSlowRate') return summary == null ? null : summary.rate; return summary == null ? null : summary[mode]; }
function formatTrendValue(id, value) { return value == null ? '—' : (id === 'oneSecondFastRate' || id === 'twoSecondFastRate' || id === 'fiveSecondSlowRate' ? pct(value) : ms(value)); }
function filteredPages(rows) { var needle = state.pageFilter.toLowerCase(); return needle ? rows.filter(function (row) { return row.page.toLowerCase().indexOf(needle) >= 0; }) : rows; }
function fillSelect(selector, order, labels, selected) { $(selector).innerHTML = order.map(function (id) { return '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(labels[id] || id) + '</option>'; }).join(''); }
function renderTrendChart(selector, trend, getValue, formatValue, data, seriesName, ariaLabel) {
  var points = [];
  var bars = [];
  trend.forEach(function (item, index) {
    var value = getValue(item, index);
    if (value != null && Number.isFinite(Number(value))) {
      var point = { index: index, value: Number(value), hour: trendLabel(item, index, data) };
      points.push(point);
      bars.push(point);
    }
  });
  if (points.length === 0) { $(selector).innerHTML = '<div class="line-empty">暂无趋势数据</div>'; return; }
  var values = points.map(function (point) { return point.value; });
  var min = Math.min.apply(null, values); var max = Math.max.apply(null, values);
  if (min === max) { min = Math.max(0, min - 1); max += 1; }
  var width = 960, height = 210, left = 55, right = 15, top = 15, bottom = 28;
  var x = function (index) { return left + (width - left - right) * (index / Math.max(1, trend.length - 1)); };
  var y = function (value) { return top + (height - top - bottom) * (1 - (value - min) / (max - min)); };
  var path = points.map(function (point) { return (point === points[0] ? 'M' : 'L') + x(point.index).toFixed(1) + ' ' + y(point.value).toFixed(1); }).join(' ');
  var area = path + ' L' + x(points[points.length - 1].index).toFixed(1) + ' ' + (height - bottom) + ' L' + x(points[0].index).toFixed(1) + ' ' + (height - bottom) + ' Z';
  var gridValues = [0, 0.25, 0.5, 0.75, 1].map(function (part) { return min + (max - min) * part; });
  var grid = gridValues.map(function (value) { var py = y(value); return '<line class="axis" x1="' + left + '" x2="' + (width - right) + '" y1="' + py + '" y2="' + py + '"></line><text x="8" y="' + (py + 4) + '" font-size="10" fill="#667085">' + esc(formatValue(value)) + '</text>'; }).join('');
  var lineClass = seriesName ? ' series-' + seriesName : '';
  var areaClass = seriesName ? ' series-area-' + seriesName : '';
  var dotClass = seriesName ? ' series-dot-' + seriesName : '';
  var barClass = seriesName === 'error' ? ' trend-bar-error' : '';
  var step = (width - left - right) / Math.max(1, trend.length - 1);
  var barWidth = Math.max(2, Math.min(28, step * 0.62));
  var barsMarkup = bars.map(function (point) {
    var topY = y(point.value);
    var barHeight = Math.max(1, height - bottom - topY);
    return '<rect class="trend-bar' + barClass + '" x="' + (x(point.index) - barWidth / 2).toFixed(1) + '" y="' + topY.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + barHeight.toFixed(1) + '" rx="1"><title>' + esc(point.hour + ' · ' + formatValue(point.value)) + '</title></rect>';
  }).join('');
  var dots = points.map(function (point) { return '<circle class="series-dot' + dotClass + '" cx="' + x(point.index).toFixed(1) + '" cy="' + y(point.value).toFixed(1) + '" r="3"><title>' + esc(point.hour + ' · ' + formatValue(point.value)) + '</title></circle>'; }).join('');
  var labels = [0, 0.25, 0.5, 0.75, 1].map(function (fraction) { var index = Math.round((trend.length - 1) * fraction); return '<text x="' + x(index) + '" y="' + (height - 7) + '" font-size="10" fill="#667085" text-anchor="middle">' + esc(trendLabel(trend[index], index, data)) + '</text>'; }).join('');
  $(selector).innerHTML = '<svg class="line-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(ariaLabel || '趋势图') + '">' + grid + '<g class="trend-bars" aria-hidden="true">' + barsMarkup + '</g><path class="series-area' + areaClass + '" d="' + area + '"></path><path class="series' + lineClass + '" d="' + path + '"></path>' + dots + labels + '</svg>';
}
function renderLineChart(selector, trend, id, mode, data) {
  renderTrendChart(selector, trend, function (item) { return trendValue(item.metrics[id], id, mode); }, function (value) { return formatTrendValue(id, value); }, data, '', '趋势图');
}
function renderErrorTrendChart(selector, trend, metric, data) {
  renderTrendChart(selector, trend, function (item) { return item[metric] == null ? 0 : item[metric]; }, function (value) { return integer(Math.round(value)); }, data, 'error', errorTrendMetricLabels[metric] || '错误趋势');
}
function renderDistribution(rows, emptyText, showBars) {
  if (!rows || rows.length === 0) return '<div class="hint">' + esc(emptyText || '暂无数据') + '</div>';
  return rows.map(function (row) { var width = row.rate == null ? 0 : Math.max(0, Math.min(100, Number(row.rate) || 0)); var track = showBars ? '<span class="dist-track"><span class="dist-bar" style="width:' + width + '%"></span></span>' : ''; return '<div class="dist-row"><span class="dist-name" title="' + esc(row.value) + '">' + esc(row.value) + '</span>' + track + '<span class="dist-value">' + integer(row.count) + ' · ' + pct(row.rate) + '</span></div>'; }).join('');
}
function renderDimensionPanels(dimensions, fields) {
  return fields.map(function (field) {
    var rows = dimensions && dimensions[field] || [];
    return '<div class="dimension-panel"><h4>' + esc(dimensionLabels[field] || field) + '</h4><span class="report-label">TOP5 · 按有来源样本排序</span>' + renderDistribution(rows.slice(0, 5), '暂无来源数据') + (rows.length > 5 ? '<span class="dim-detail">仅展示前五项</span>' : '') + '</div>';
  }).join('');
}
function renderErrorDimensionPanels(analysis) {
  var definitions = [
    ['types', '错误类型', '按错误记录数排序'],
    ['versions', '客户端版本', '按错误记录数排序'],
    ['stages', '发生阶段', '按错误记录数排序'],
    ['reasons', '原因代码', '按错误记录数排序'],
    ['resources', '资源类型', '按错误记录数排序'],
  ];
  return definitions.map(function (definition) {
    var field = definition[0];
    var rows = analysis && analysis[field] || [];
    return '<div class="dimension-panel"><h4>' + esc(definition[1]) + '</h4><span class="report-label">TOP5 · ' + esc(definition[2]) + ' · 占全部错误</span><div id="error-' + field + '">' + renderDistribution(rows.slice(0, 5), '暂无错误数据') + '</div>' + (rows.length > 5 ? '<span class="dim-detail">仅展示前五项</span>' : '') + '</div>';
  }).join('');
}
function renderSampleDistribution(selector, distribution) {
  var total = distribution.good + distribution.fair + distribution.poor;
  var rows = [{ value: '良好', count: distribution.good }, { value: '一般', count: distribution.fair }, { value: '较差', count: distribution.poor }]
    .filter(function (row) { return row.count > 0; })
    .map(function (row) { return { value: row.value, count: row.count, rate: total ? row.count / total * 100 : null }; });
  $(selector).innerHTML = renderDistribution(rows, '暂无页面加载样本', true);
}
function renderTrend(trend, data) {
  var max = Math.max.apply(null, [1].concat(trend.map(function (item) { return item.pageViews + item.apiRequests + item.errors; })));
  function height(value) { return Math.max(2, Math.round(value / max * 100)); }
  $('#trend').style.gridTemplateColumns = 'repeat(' + trend.length + ', minmax(2px,1fr))';
  $('#hour-labels').style.gridTemplateColumns = 'repeat(' + trend.length + ', minmax(2px,1fr))';
  $('#trend').innerHTML = trend.map(function (item, index) { var label = trendLabel(item, index, data); return '<div class="bar" style="height:' + height(item.pageViews) + '%" title="' + esc(label + ' PV ' + item.pageViews) + '"><div class="bar api" style="height:' + height(item.apiRequests) + '%" title="' + esc(label + ' API ' + item.apiRequests) + '"></div><div class="bar error" style="height:' + height(item.errors) + '%" title="' + esc(label + ' 错误 ' + item.errors) + '"></div></div>'; }).join('');
  $('#hour-labels').innerHTML = trend.map(function (item, index) { return '<span>' + (index % Math.max(1, Math.ceil(trend.length / 8)) === 0 ? esc(trendLabel(item, index, data)) : '') + '</span>'; }).join('');
}
function perceptionCard(id, label, value, sub) {
  var previous = state.previousMetrics && state.previousMetrics[id];
  var previousValue = previous && (id.indexOf('Rate') !== -1 ? ratioMetric(previous.rate) : metricValue(previous, state.userMode));
  var tooltipId = 'user-metric-tip-' + esc(id);
  var selected = state.userMetric === id;
  return '<div class="kpi"' + (selected ? ' data-selected' : '') + '><button type="button" class="perception-kpi-content" data-metric="' + esc(id) + '" aria-pressed="' + selected + '"><span class="label">' + esc(label) + '</span><div class="value">' + esc(value) + '</div><span class="period" title="按本地同长时间窗口和相同指标口径重算，非官网私有算法">前一周期 <span>' + esc(previousValue || '—') + '</span></span><span class="sub">' + esc(sub) + '</span></button><button type="button" class="perception-kpi-help" aria-label="' + esc(label) + '说明" aria-describedby="' + tooltipId + '"><span aria-hidden="true">?</span></button><span id="' + tooltipId + '" class="perception-kpi-tooltip" role="tooltip">' + esc(userMetricDescriptions[id] || '') + '</span></div>';
}
function renderMetricDimensionPanels(dimensions, metricId, mode) {
  var labels = { deviceModel: '设备机型', osVersion: '操作系统', appVersion: '应用版本', networkType: '网络类型' };
  var isRatio = metricId.indexOf('Rate') !== -1;
  return Object.keys(labels).map(function (field) {
    var rows = dimensions && dimensions[field] || [];
    return '<div class="dimension-panel"><h4>' + labels[field] + '</h4><span class="report-label">TOP5 · ' + esc(userMetricLabels[metricId]) + ' · ' + (isRatio ? '比例' : esc({ average:'平均值',p50:'50%分位值',p90:'90%分位值',p95:'95%分位值' }[mode])) + '</span>' +
      (rows.length ? rows.map(function (row) { var summary = row[metricId]; var value = isRatio ? ratioMetric(summary.rate) : metricValue(summary, mode); return '<div class="metric-dim-row"><span title="' + esc(row.value) + '">' + esc(row.value) + '</span><strong>' + esc(value) + '</strong></div>'; }).join('') : '<div class="hint">暂无来源数据</div>') + '</div>';
  }).join('');
}
function nativeLookback(data) { return data.native && data.native.lookbackContexts || 0; }
var performanceFilterLabels = { AN:'应用名', AV:'全部 App 版本', OT:'全部系统类型', OV:'全部系统版本', EV:'全部事件类型' };
var identityFilterLabels = { UNAME:'用户姓名', PHONE:'手机号' };
var autocompleteLimit = 30;
function autocompleteValues(field) {
  if (field === 'PAGE') return currentData && currentData.userPerception && currentData.userPerception.pageOptions || [];
  return currentData && currentData.userPerception && currentData.userPerception.filterOptions && currentData.userPerception.filterOptions[field] || [];
}
function closeAutocompleteOptions() {
  document.querySelectorAll('.autocomplete-options').forEach(function (options) { options.hidden = true; options.replaceChildren(); });
}
function renderAutocompleteOptions(input) {
  if (!input || !input.matches('[data-autocomplete-field]')) return;
  var field = input.dataset.autocompleteField;
  var options = input.closest('.autocomplete-field').querySelector('.autocomplete-options');
  var query = input.value.trim().toLocaleLowerCase();
  var values = autocompleteValues(field).filter(function (value) { return String(value).toLocaleLowerCase().includes(query); }).slice(0, autocompleteLimit);
  options.replaceChildren();
  if (!values.length) {
    options.innerHTML = '<div class="autocomplete-empty">暂无匹配的日志选项</div>';
    options.hidden = false;
    return;
  }
  values.forEach(function (value, index) {
    var option = document.createElement('button'); option.type = 'button'; option.className = 'autocomplete-option'; option.dataset.autocompleteOption = ''; option.dataset.autocompleteValue = String(value); option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === 0)); option.textContent = value;
    options.appendChild(option);
  });
  options.hidden = false;
}
function resetAutocompleteField(field, input) {
  if (field === 'PAGE') {
    if (!state.pageFilter) return;
    state.pageFilter = '';
  } else {
    if (!state.performanceFilters[field]) return;
    delete state.performanceFilters[field];
  }
  input.value = '';
  state.userPage = 0; state.errorPage = 0;
  closeAutocompleteOptions(); loadFilterSilently();
}
function commitAutocompleteField(field, value, input) {
  input.value = value;
  if (field === 'PAGE') state.pageFilter = value;
  else state.performanceFilters[field] = value;
  state.userPage = 0; state.errorPage = 0;
  closeAutocompleteOptions(); loadFilterSilently();
}
function moveAutocompleteSelection(input, direction) {
  var options = Array.from(input.closest('.autocomplete-field').querySelectorAll('.autocomplete-option'));
  if (!options.length) return;
  var selected = options.findIndex(function (option) { return option.getAttribute('aria-selected') === 'true'; });
  var next = Math.max(0, Math.min(options.length - 1, selected + direction));
  options.forEach(function (option, index) { option.setAttribute('aria-selected', String(index === next)); });
  options[next].scrollIntoView({ block: 'nearest' });
}
function selectAutocompleteOption(input) {
  var option = input.closest('.autocomplete-field').querySelector('.autocomplete-option[aria-selected="true"]') || input.closest('.autocomplete-field').querySelector('.autocomplete-option');
  if (option) commitAutocompleteField(input.dataset.autocompleteField, option.dataset.autocompleteValue, input);
}
function handleAutocompleteKeydown(event) {
  var input = event.target;
  if (!input.matches('[data-autocomplete-field]')) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); renderAutocompleteOptions(input); moveAutocompleteSelection(input, event.key === 'ArrowDown' ? 1 : -1); }
  else if (event.key === 'Enter') { event.preventDefault(); selectAutocompleteOption(input); }
  else if (event.key === 'Escape') { closeAutocompleteOptions(); }
}
function syncRangeButtons() {
  var ranges = $('#user-ranges');
  if (!ranges) return;
  ranges.querySelectorAll('[data-range]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.range === state.range)); });
  var moreLabel = {'30days':'最近30天','60days':'最近60天','90days':'最近90天'}[state.range];
  var more = $('#user-more summary');
  if (more) more.textContent = moreLabel ? '更多 · ' + moreLabel : '更多';
}
function renderPerformanceFilters(options) {
  var holder = $('#user-dimension-filters');
  closeAutocompleteOptions();
  Object.keys(performanceFilterLabels).forEach(function (field) {
    var dropdown = holder.querySelector('[data-field="' + field + '"]');
    if (!dropdown) {
      dropdown = document.createElement('details'); dropdown.className = 'dimension-filter'; dropdown.dataset.field = field;
      var summary = document.createElement('summary'); summary.setAttribute('aria-label', performanceFilterLabels[field]);
      var menu = document.createElement('div'); menu.className = 'dimension-menu';
      var search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索' + performanceFilterLabels[field].replace(/^全部\s*/, ''); search.setAttribute('aria-label', search.placeholder);
      var list = document.createElement('div'); list.className = 'dimension-options';
      menu.append(search, list); dropdown.append(summary, menu); holder.appendChild(dropdown);
      if (field === 'AN') {
        var form = document.createElement('form'); form.className = 'app-name-form';
        var appInput = document.createElement('input'); appInput.type = 'text'; appInput.maxLength = 128; appInput.placeholder = '输入应用名'; appInput.setAttribute('aria-label', '输入应用名');
        var apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'button'; apply.textContent = '筛选';
        form.append(appInput, apply); menu.appendChild(form);
      }
    }
    var values = options[field] || [];
    var selected = state.performanceFilters[field] || (field === 'AN' ? options.selectedApp || '' : '');
    var searchInput = dropdown.querySelector('input[type=search]');
    var search = searchInput.value.trim().toLocaleLowerCase();
    dropdown.querySelector('summary').textContent = selected || performanceFilterLabels[field];
    dropdown.querySelector('summary').title = selected || performanceFilterLabels[field];
    var list = dropdown.querySelector('.dimension-options');
    list.replaceChildren();
    (field === 'AN' ? [] : [['', performanceFilterLabels[field]]]).concat(values.map(function (value) { return [value, value]; }), selected && !values.includes(selected) ? [[selected, selected + '（当前范围无样本）']] : []).forEach(function (entry) {
      var label = document.createElement('label'); label.className = 'dimension-option';
      var radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'dimension-' + field; radio.value = entry[0]; radio.checked = entry[0] === selected; radio.setAttribute('aria-label', entry[1]);
      label.append(radio, document.createTextNode(entry[1]));
      // "全部" stays reachable even when the search has no matches.
      label.hidden = !!entry[0] && !entry[1].toLocaleLowerCase().includes(search);
      list.appendChild(label);
    });
    if (!values.length && !selected) {
      var hint = document.createElement('div'); hint.className = 'dimension-empty'; hint.textContent = '当前范围暂无有来源的选项'; list.appendChild(hint);
    }
  });
  Object.keys(identityFilterLabels).forEach(function (field) {
    var input = holder.querySelector('[data-identity-field="' + field + '"]');
    if (!input) {
      var label = document.createElement('label'); label.className = 'identity-filter';
      var text = document.createElement('span'); text.textContent = identityFilterLabels[field];
      var wrapper = document.createElement('span'); wrapper.className = 'autocomplete-field';
      input = document.createElement('input'); input.type = 'search'; input.dataset.identityField = field; input.dataset.autocompleteField = field;
      input.setAttribute('aria-label', identityFilterLabels[field] + '（从日志候选中选择）');
      input.placeholder = '搜索' + identityFilterLabels[field]; input.autocomplete = 'off';
      if (field === 'PHONE') input.inputMode = 'numeric';
      var optionsMenu = document.createElement('div'); optionsMenu.className = 'autocomplete-options'; optionsMenu.setAttribute('role', 'listbox'); optionsMenu.hidden = true;
      wrapper.append(input, optionsMenu); label.append(text, wrapper); holder.appendChild(label);
    }
    if (document.activeElement !== input) input.value = state.performanceFilters[field] || '';
  });
}
function renderUserPerception(data) {
  renderPerformanceFilters({ ...data.userPerception.filterOptions, selectedApp: data.userPerception.activeFilters?.AN });
  var metrics = data.userPerception.metrics; var mode = state.userMode;
  state.previousMetrics = data.userPerception.previous && data.userPerception.previous.metrics;
  $('#user-kpis').innerHTML = [
    perceptionCard('ttfb', '首字节响应时间(TTFB)', metricValue(metrics.ttfb, mode), integer(metrics.ttfb.count) + ' 个样本'),
    perceptionCard('tcp', 'TCP连接', metricValue(metrics.tcp, mode), integer(metrics.tcp.count) + ' 个样本'),
    perceptionCard('tti', '页面可交互时间(TTI)', metricValue(metrics.tti, mode), integer(metrics.tti.count) + ' 个样本'),
    perceptionCard('pageLoad', '页面完全加载', metricValue(metrics.pageLoad, mode), integer(metrics.pageLoad.count) + ' 个样本'),
    perceptionCard('oneSecondFastRate', '1秒快开比', ratioMetric(metrics.oneSecondFastRate.rate), integer(metrics.oneSecondFastRate.count) + ' / ' + integer(metrics.oneSecondFastRate.sampleCount)),
    perceptionCard('twoSecondFastRate', '2秒快开比', ratioMetric(metrics.twoSecondFastRate.rate), integer(metrics.twoSecondFastRate.count) + ' / ' + integer(metrics.twoSecondFastRate.sampleCount)),
    perceptionCard('fiveSecondSlowRate', '5秒慢开比', ratioMetric(metrics.fiveSecondSlowRate.rate), integer(metrics.fiveSecondSlowRate.count) + ' / ' + integer(metrics.fiveSecondSlowRate.sampleCount))
  ].join('');
  var perfSamples = data.userPerception.contextCoverage.total;
  var missing = data.userPerception.missingMilestoneSamples || 0;
  var navigationMissing = data.userPerception.navigationMissingMilestoneSamples || 0;
  var available = $('#metric-availability');
  var counts = '当前筛选 ' + integer(perfSamples) + ' 个加载样本；TTFB ' + integer(metrics.ttfb.count) + '、TCP ' + integer(metrics.tcp.count) + '、TTI ' + integer(metrics.tti.count) + '、页面完全加载 ' + integer(metrics.pageLoad.count) + ' 个有效样本。';
  if (perfSamples === 0) counts += '此时间范围与维度组合未匹配到性能事件。';
  else if (metrics.ttfb.count === 0 && metrics.tcp.count === 0 && metrics.tti.count === 0 && metrics.pageLoad.count === 0) {
    counts += '这组样本均未上报上述指标，横线代表无实测值，不是页面刷新清空。';
  }
  if (missing) counts += '其中 ' + integer(missing) + ' 个加载样本缺少部分页面时刻数据' + (navigationMissing ? '（' + integer(navigationMissing) + ' 个来自内嵌导航回退）' : '') + '；不会借用未关联的 H5 样本填充。';
  available.textContent = counts;
  available.classList.toggle('is-empty', perfSamples === 0 || metrics.ttfb.count + metrics.tcp.count + metrics.tti.count + metrics.pageLoad.count === 0);
  renderLineChart('#user-trend', data.trend, state.userMetric, mode, data);
  renderSampleDistribution('#sample-distribution', data.userPerception.sampleDistribution);
  $('#user-dimensions').innerHTML = renderMetricDimensionPanels(data.userPerception.metricDimensions, state.userMetric, mode);
  var coverage = data.userPerception.contextCoverage || { total: 0, exact: 0, singleContextFallback: 0, h5NetworkOnly: 0, none: 0, contexts: 0 };
  $('#context-note').textContent = 'iOS 上下文 ' + integer(coverage.contexts) + ' 条 · 精确关联 ' + integer(coverage.exact) + ' / ' + integer(coverage.total) + ' 个加载样本 · 单上下文回退 ' + integer(coverage.singleContextFallback) + ' · 仅 H5 网络字段 ' + integer(coverage.h5NetworkOnly) + '。机型、系统、应用版本、运营商、地域来自 iOS 副本；未关联且无来源的维度不虚构。';
  if (state.range === 'date') $('#user-date').value = $('#date').value;
  syncRangeButtons();
  var rows = filteredPages(data.userPerception.pages);
  var pages = Math.max(1, Math.ceil(rows.length / 10));
  state.userPage = Math.min(state.userPage, pages - 1);
  $('#user-page-number').textContent = String(state.userPage + 1);
  $('#user-page-count').textContent = rows.length + ' 条';
  $('#user-prev').disabled = state.userPage === 0;
  $('#user-next').disabled = state.userPage + 1 >= pages;
  renderRows('#user-rows', rows.slice(state.userPage * 10, (state.userPage + 1) * 10), function (page) {
    return ['<span class="page-cell" title="' + esc(page.page) + '">' + esc(page.page) + '</span>', metricValue(page.ttfb, state.userTableMode), metricValue(page.tcp, state.userTableMode), metricValue(page.tti, state.userTableMode), metricValue(page.pageLoad, state.userTableMode), ratioMetric(page.oneSecondFastRate.rate), ratioMetric(page.twoSecondFastRate.rate), ratioMetric(page.fiveSecondSlowRate.rate), optionalInteger(page.sampleCount)];
  }, null, [false, true, true, true, true, true, true, true, true]);
  $('#user-empty').hidden = rows.length > 0;
}
function renderSlowLoading(data) {
  var slow = data.slowLoading; var overview = slow.overview;
  $('#slow-kpis').innerHTML = [card('慢加载次数', integer(overview.slowLoadingCount), '阈值 ' + slow.thresholdMs / 1000 + ' 秒'), card('慢加载率', ratioMetric(overview.slowLoadingRate), integer(overview.samples) + ' 个加载样本'), card('受影响页面', integer(overview.affectedPages), '存在慢加载样本的页面'), card('受影响用户', integer(overview.affectedVisitors), '按 perf 记录 uid 去重')].join('');
  renderRows('#slow-rows', filteredPages(slow.pages.filter(function (page) { return page.slowLoadingCount > 0; })), function (page) {
    return ['<span class="page-cell" title="' + esc(page.page) + '">' + esc(page.page) + '</span>', ms(page.slowFirstbyteMs), ms(page.slowReadyMs), ms(page.slowTotalMs), optionalInteger(page.slowLoadingCount), optionalInteger(page.sampleCount), ratioMetric(page.slowLoadingRate), datetime(page.lastPerfAt)];
  }, '#slow-empty', [false, true, true, true, true, true, true, false]);
}
function errorTrendCard(id, label, value, sub) {
  var selected = state.errorMetric === id;
  var tooltipId = 'error-kpi-tip-' + id;
  return '<div class="kpi error-kpi"' + (selected ? ' data-selected' : '') + '><button class="error-kpi-content" type="button" data-error-metric="' + esc(id) + '" aria-pressed="' + selected + '"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value) + '</span></button><button type="button" class="error-kpi-help" aria-label="' + esc(label) + '说明" aria-describedby="' + tooltipId + '"><span aria-hidden="true">?</span></button><span id="' + tooltipId + '" class="error-kpi-tooltip" role="tooltip">' + esc(sub) + '</span></div>';
}
function startErrorAnalysis(item, key) {
  if (!currentData || (errorAnalysisJobs[key] && ['queued', 'running'].indexOf(errorAnalysisJobs[key].status) >= 0)) return;
  errorAnalysisJobs[key] = { status: 'queued', result: null, error: null };
  renderRecentErrors(currentData);
  fetch(apiPath('/__sink/api/error-analysis'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: {
    eventId: item.eventId || null, errorKey: item.errorKey || key, name: item.name || null, message: item.message || null,
    file: item.file || null, line: item.line || null, column: item.column || null, stack: item.stack || null,
    page: item.page || null, app: item.app || null,
  } }), cache: 'no-store' }).then(async function (response) {
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));
    errorAnalysisJobs[key] = payload;
    if (currentData) renderRecentErrors(currentData);
    if (payload.status === 'queued' || payload.status === 'running') pollErrorAnalysis(payload.jobId, key);
  }).catch(function (error) {
    errorAnalysisJobs[key] = { status: 'failed', error: error.message || '分析失败' };
    if (currentData) renderRecentErrors(currentData);
  });
}
function pollErrorAnalysis(jobId, key) {
  window.setTimeout(function () {
    fetch(apiPath('/__sink/api/error-analysis/' + encodeURIComponent(jobId)), { cache: 'no-store' }).then(async function (response) {
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));
      errorAnalysisJobs[key] = payload;
      if (currentData) renderRecentErrors(currentData);
      if (payload.status === 'queued' || payload.status === 'running') pollErrorAnalysis(jobId, key);
    }).catch(function (error) {
      errorAnalysisJobs[key] = { status: 'failed', error: error.message || '分析失败' };
      if (currentData) renderRecentErrors(currentData);
    });
  }, 350);
}
function renderRecentErrors(data) {
  var pageSize = 15, total = data.errors.length, pages = Math.max(1, Math.ceil(total / pageSize));
  state.errorPage = Math.max(0, Math.min(state.errorPage, pages - 1));
  var start = state.errorPage * pageSize;
  var openKeys = new Set(Array.from($('#error-list').querySelectorAll?.('.error-item[data-open]') || [], function (row) { return row.dataset.errorKey; }));
  $('#error-count').textContent = total ? '第 ' + (start + 1) + '–' + Math.min(start + pageSize, total) + ' 条 / 最近 ' + integer(total) + ' 条 · 共 ' + integer(data.overview.errors) + ' 条' : '共 ' + integer(data.overview.errors) + ' 条';
  var pageButton = function (page, label, title) {
    return '<button type="button" class="button" data-error-page="' + page + '"' + (title ? ' aria-label="' + title + '" title="' + title + '"' : ' aria-current="' + (page === state.errorPage ? 'page' : 'false') + '"') + (page < 0 || page >= pages ? ' disabled' : '') + '>' + label + '</button>';
  };
  $('#error-pager').innerHTML = pageButton(state.errorPage - 1, '‹', '上一页') + Array.from({length: pages}, function (_, index) { return pageButton(index, index + 1); }).join('') + pageButton(state.errorPage + 1, '›', '下一页') + '<span class="page-size">15 条/页</span>';
  $('#error-pager').hidden = total === 0;
  $('#error-list-head').hidden = total === 0;
  $('#error-list').innerHTML = data.errors.slice(start, start + pageSize).map(function (item, index) {
    var key = item.errorKey || JSON.stringify([item.at, item.name, item.message, item.page]);
    var location = item.file ? esc(item.file) + (item.line != null ? ':' + esc(item.line) : '') + (item.column != null ? ':' + esc(item.column) : '') : '未上报';
    var details = [['阶段', item.stage], ['原因', item.reasonCode], ['资源', item.resourceType], ['HTTP', item.httpStatus]]
      .filter(function (entry) { return entry[1] != null && entry[1] !== ''; })
      .map(function (entry) { return '<div class="error-detail-line"><span>' + entry[0] + '</span><span>' + esc(entry[1]) + '</span></div>'; }).join('');
    var stack = item.stack ? '<div class="error-detail-block"><span class="report-label">堆栈</span><pre class="stack">' + esc(item.stack) + '</pre></div>' : '';
    var recovered = item.devSource && item.devSource.status === 'restored' ? item.devSource : null;
    var sourcePosition = recovered ? '<div class="error-detail-line"><span>Vue 源码位置</span><span class="mono">' + esc(recovered.file) + ':' + esc(recovered.line) + ':' + esc(recovered.column) + '</span></div><div class="hint">由已上传的 Source Map 还原；未访问 H5 运行地址。上方代码位置为日志原始位置。</div>' : '';
    var job = typeof errorAnalysisJobs === 'object' ? errorAnalysisJobs[key] : null;
    var analysis;
    if (!job) analysis = '<button type="button" class="error-analysis-button" data-error-analysis="' + esc(key) + '">AI 分析</button>';
    else if (job.status === 'queued' || job.status === 'running') analysis = '<button type="button" class="error-analysis-button" disabled>AI 分析中</button>';
    else if (job.status === 'failed') analysis = '<div class="error-analysis-result"><div class="hint">' + esc(job.error || 'AI 分析失败') + '</div><button type="button" class="error-analysis-button" data-error-analysis="' + esc(key) + '">重新分析</button></div>';
    else if (job.result && job.result.status === 'selected') {
      var result = job.result;
      var lines = Array.isArray(result.lines) ? result.lines.map(function (line, offset) { return (Number(result.startLine) + offset) + '  ' + line; }).join('\n') : '';
      analysis = '<div class="error-analysis-result"><span class="mono">' + esc(result.file) + ':' + esc(result.line) + (result.column != null ? ':' + esc(result.column) : '') + '</span><pre class="stack">' + esc(lines) + '</pre><div class="hint">' + esc(result.reason || '已从本地候选源码中定位') + ' · 置信度 ' + esc(result.confidence || 'low') + (result.precision ? ' · 精度 ' + esc(result.precision) : '') + (result.matchReason ? ' · 依据 ' + esc(result.matchReason) : '') + (result.sourceVersion ? ' · 版本 ' + esc(result.sourceVersion) : '') + '</div></div>';
    } else analysis = '<div class="error-analysis-result"><div class="hint">不确定：' + esc(job.result?.reason || '未能从候选源码中确定位置') + '</div></div>';
    var analysisBlock = '<div class="error-analysis-row"><span>AI 分析</span><span>' + analysis + '</span></div>';
    var isOpen = openKeys.has(key), detailId = 'error-detail-' + (start + index);
    return '<article class="error-item" data-error-key="' + esc(key) + '"' + (isOpen ? ' data-open' : '') + '><button type="button" class="error-row" aria-expanded="' + isOpen + '" aria-controls="' + detailId + '"><span class="error-index">' + (start + index + 1) + '</span><span class="error-summary"><span class="error-title">' + esc(item.name || '未上报类型') + '</span><span class="error-message" title="' + esc(item.message || '未上报消息') + '">' + esc(item.message || '未上报消息') + '</span></span><span class="error-version" title="' + esc(item.version || '未上报') + '">' + esc(item.version || '未上报') + '</span><time class="error-time" datetime="' + esc(item.at || '') + '">' + esc(datetime(item.at)) + '</time><span class="error-expand-icon" aria-hidden="true">⌄</span></button><div id="' + detailId + '" class="error-detail-shell" aria-hidden="' + !isOpen + '"><div class="error-detail-clip"><div class="error-detail"><div class="error-detail-line"><span>页面路径</span><span class="mono">' + esc(item.page || '未上报') + '</span></div><div class="error-detail-line"><span>代码位置</span><span class="mono">' + location + '</span></div>' + sourcePosition + details + analysisBlock + stack + '</div></div></div></article>';
  }).join('');
  $('#error-empty').hidden = total > 0;
}
function renderErrors(data, isElk) {
  var analysis = data.errorAnalysis || { affectedVisitors: 0, pageCount: 0, issueCount: 0, latestAt: null, types: [], stages: [], reasons: [], resources: [], statuses: [], pages: [], versions: [], issues: [], missingReasons: 0 };
  $('#error-kpis').innerHTML = [
    errorTrendCard('errors', '错误总数', integer(data.overview.errors), isElk ? 'page_error 记录' : 'error 记录'),
    errorTrendCard('affectedVisitors', '受影响访客数', integer(analysis.affectedVisitors), '按全部错误记录的访客 ID 去重'),
    errorTrendCard('issues', '独立问题', integer(analysis.issueCount), '当前筛选范围内，按错误类型、原因、页面路径和错误消息合并后的不同组合数。同一组合出现 100 次也只算 1 个；消息里的编号每次变化，可能算成多个。不是错误次数，也不是受影响人数。'),
    errorTrendCard('pageCount', '涉及页面', integer(analysis.pageCount), '按错误路径去重')
  ].join('');
  var trend = data.trend || [];
  if (!errorTrendMetricLabels[state.errorMetric]) state.errorMetric = 'errors';
  $('#error-trend-note').textContent = (state.clientTime ? '客户端发生时间' : '接收时间') + (isElk ? ' · page_error' : ' · error') + ' · ' + errorTrendMetricLabels[state.errorMetric];
  renderErrorTrendChart('#error-trend', trend, state.errorMetric, data);
  $('#error-dimensions').innerHTML = renderErrorDimensionPanels(analysis);
  renderRows('#error-page-rows', analysis.pages, function (row) { return [
    '<span class="page-cell" title="' + esc(row.value) + '">' + esc(row.value) + '</span>', integer(row.count), pct(row.rate), datetime(row.lastAt)
  ]; }, '#error-page-empty', [false, true, true, false]);
  renderRecentErrors(data);
}
function render(data) {
  var storage = data.storage || { source: 'local', reason: '未启用 SLS' };
  var isElk = storage.source === 'elk';
  var environment = storage.environment === 'online' ? 'online' : 'test';
  $('#storage-source').value = environment;
  if (isElk) document.querySelector('.perception-tip').firstChild.nodeValue = '页面加载指标来自' + (environment === 'online' ? '线上' : '测试') + '环境 ELK；缺失的指标显示 —。加载次数不等于完整 PV。';
  $('#storage-status').title = isElk ? storage.sampleSemantics : storage.source === 'sls' ? '已验证完整镜像' : (storage.reason || '查询已回退');
  document.querySelector('[data-section="apis"]').hidden = isElk;
  if (isElk && document.body.dataset.section === 'apis') selectSection('overview');
  if (!$('#date').value) $('#date').value = data.date;
  state.slowThreshold = data.slowLoading.thresholdMs;
  fillSelect('#user-metric', data.userPerception.metricOrder, userMetricLabels, state.userMetric);
  $('#slow-threshold').value = String(state.slowThreshold);
  var perfCount = data.overview.logTypes.perf || 0;
  if (Object.keys(state.performanceFilters).length) perfCount = data.userPerception.contextCoverage.total || 0;
  var latestPerf = data.userPerception.pages.reduce(function (latest, page) { return page.lastPerfAt && (!latest || page.lastPerfAt > latest) ? page.lastPerfAt : latest; }, null);
  $('#status').textContent = isElk ? '已观测加载 ' + integer(data.overview.pageViews) + ' · 错误 ' + integer(data.overview.errors) + ' · 样本 ' + integer(perfCount) : (data.range ? datetime(data.range.from) + ' ~ ' + datetime(data.range.to) + '（本地时间）' : data.date + '（UTC 归档日）') + ' · PV ' + integer(data.overview.pageViews) + ' · 性能样本 ' + integer(perfCount) + '（内嵌导航回退 ' + integer(data.userPerception.navigationFallbackSamples || 0) + '）' + ' · iOS 快照 ' + integer(data.native.snapshots) + ' · 归档 ' + integer(data.archive.records) + ' 条';
  $('#perf-freshness').textContent = isElk ? '从测试环境读取；加载次数不等于完整 PV，未实测的指标留空。最近加载样本（本地时间）：' + (latestPerf ? datetime(latestPerf) : '暂无') : (state.clientTime ? '客户端时间有效记录 ' + integer(data.clientTimeCoverage.valid) + ' 条，缺失/偏差超过24小时的日志 ' + integer(data.clientTimeCoverage.missingOrSkewed) + ' 条。' : '') + '最近性能采样（本地时间）：' + (latestPerf ? datetime(latestPerf) : '尚未收到') + (Object.keys(state.performanceFilters).length || state.pageFilter ? '；当前筛选已应用于全部看板指标。' : (data.overview.pageViews > perfCount ? '；已有新 PV 不代表产生了新 perf 样本。' : '。'));
  renderUserPerception(data); renderSlowLoading(data);
  $('#overview-kpis').innerHTML = isElk ? [card('已观测加载', integer(data.overview.pageViews), '仅 page_load；非完整 PV'), card('独立访客 UV', integer(data.overview.uniqueVisitors), '按 contextId 去重'), card('会话数', integer(data.overview.sessions), '按 sessionId 去重'), card('页面错误', integer(data.overview.errors), '仅 page_error'), card('API 请求', integer(data.overview.apiRequests), '成功率 ' + pct(data.overview.apiSuccessRate)), card('API 平均耗时', ms(data.overview.averageApiRtMs), '按已测得耗时汇总')].join('') : [card('浏览量 PV', integer(data.overview.pageViews), '页面 PV 事件'), card('独立访客 UV', integer(data.overview.uniqueVisitors), '按 uid 去重'), card('会话数', integer(data.overview.sessions), '按 sid 去重'), card('JS 错误', integer(data.overview.errors), '可展开查看堆栈'), card('API 请求', integer(data.overview.apiRequests), '成功率 ' + pct(data.overview.apiSuccessRate)), card('API 平均耗时', ms(data.overview.averageApiRtMs), '按请求记录汇总')].join('');
  var native = data.native || { contexts: 0, snapshots: 0, memoryWarnings: 0, latestResidentMemoryBytes: null, networkChanges: 0 };
  $('#native-kpis').innerHTML = [card('iOS 上下文', integer(native.contexts), '有真实运行快照的上下文'), card('上报快照', integer(native.snapshots), '按真实接收记录计数'), card('Reporter 启动', integer(native.starts), '独立快照，非官方启动性能指标'), card('进入前台', integer(native.foregrounds), '通知触发的快照'), card('进入后台', integer(native.backgrounds), '尽力上报，进程可能挂起'), card('内存警告', integer(native.memoryWarnings), '各进程最近快照累计'), card('最近常驻内存', native.latestResidentMemoryBytes == null ? '—' : (native.latestResidentMemoryBytes / 1048576).toFixed(1) + ' MiB', '仅应用自身进程'), card('网络变化', integer(native.networkChanges), '通知触发的快照'), card('MetricKit 崩溃', native.latestDiagnostics ? integer(native.latestDiagnostics.crashes) : '—', '最近收到的诊断期摘要；非官方 SDK 原始上报'), card('MetricKit 卡顿', native.latestDiagnostics ? integer(native.latestDiagnostics.hangs) : '—', '通常延迟送达；不能与当前 H5 样本混算')].join('');
  $('#native-note').textContent = (native.latestAt ? '最近快照 ' + datetime(native.latestAt) + ' · 触发原因 ' + (native.latestTrigger || '未知') : '尚未收到 iOS Reporter 快照；H5 页面上报与此独立。') + (native.latestDiagnostics ? ' · MetricKit 最近诊断期 ' + datetime(native.latestDiagnostics.periodStart) + ' ~ ' + datetime(native.latestDiagnostics.periodEnd) + '（接收 ' + datetime(native.latestDiagnostics.receivedAt) + '；可能重送，不累计）' : '');
  renderTrend(data.trend, data);
  renderRows('#api-rows', data.apis, function (api) { var rate = '<span class="' + (api.successRate != null && api.successRate < 95 ? 'bad-rate' : 'quality') + '">' + pct(api.successRate) + '</span>'; return ['<span class="mono">' + esc(api.api) + '</span>', integer(api.requests), integer(api.errors), rate, ms(api.averageRtMs), ms(api.p50RtMs), ms(api.p95RtMs)]; }, '#api-empty', [false, true, true, true, true, true, true]);
  renderErrors(data, isElk);
}
// Query state is shareable and survives a full browser reload. Hash remains the selected page.
var viewRanges = ['hour', '48hours', 'today', '7days', '30days', '60days', '90days', 'date'];
function restoreView() {
  var params = new URL(location.href).searchParams;
  if (params.get('view.elkEnvironment') === 'online') state.elkEnvironment = 'online';
  if (viewRanges.includes(params.get('view.range'))) state.range = params.get('view.range');
  var date = params.get('view.date');
  if (state.range === 'date' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { $('#date').value = date; $('#user-date').value = date; }
  if (state.range === 'date' && !$('#date').value) state.range = '7days';
  state.clientTime = params.get('view.clientTime') === '1'; $('#client-time').checked = state.clientTime;
  state.pageFilter = params.get('view.pageFilter') || '';
  $('#page-filter').value = state.pageFilter;
  Object.keys(performanceFilterLabels).forEach(function (field) {
    var value = params.get('dim.' + field);
    if (value && value.length <= 128) state.performanceFilters[field] = value;
  });
}
function persistView() {
  var url = new URL(location.href);
  [...url.searchParams.keys()].forEach(function (key) { if (key.startsWith('dim.') || key.startsWith('view.')) url.searchParams.delete(key); });
  url.searchParams.set('view.range', state.range);
  if (state.elkEnvironment === 'online') url.searchParams.set('view.elkEnvironment', 'online');
  if (state.range === 'date' && $('#date').value) url.searchParams.set('view.date', $('#date').value);
  if (state.clientTime) url.searchParams.set('view.clientTime', '1');
  if (state.pageFilter) url.searchParams.set('view.pageFilter', state.pageFilter);
  Object.keys(state.performanceFilters).filter(function (field) { return !identityFilterLabels[field]; }).forEach(function (field) { url.searchParams.set('dim.' + field, state.performanceFilters[field]); });
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
restoreView();
var loadSequence = 0;
async function loadSourceMapStatus() {
  try {
    var response = await fetch(apiPath('/__sink/api/source-maps'), { cache: 'no-store' });
    if (!response.ok) return;
    var result = await response.json();
    if (result.uploaded) $('#source-map-status').textContent = '已上传 ' + integer(result.mappedFiles) + '/' + integer(result.maps) + ' 个可映射文件';
  } catch (_) {}
}
function restoreViewport(viewport) {
  if (!viewport || typeof window.scrollTo !== 'function') return;
  var restore = function () { window.scrollTo(viewport.x, viewport.y); };
  restore();
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore);
  else window.setTimeout(restore, 0);
}
function focusWithoutScrolling(element) {
  if (!element || typeof element.focus !== 'function') return;
  try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
}
function loadFilterSilently() {
  var viewport = { x: window.scrollX, y: window.scrollY };
  return load({ preserveViewport: viewport, silent: true });
}
function rangeWindow(key) {
  var now = new Date(), start = new Date(now);
  if (key === 'hour') start.setTime(now.getTime() - 3600000);
  else if (key === '48hours') start.setTime(now.getTime() - 48 * 3600000);
  else {
    start.setHours(0, 0, 0, 0);
    var days = {today:1, '7days':7, '30days':30, '60days':60, '90days':90}[key];
    start.setDate(start.getDate() - (days - 1));
  }
  return {from:start.toISOString(), to:now.toISOString()};
}
async function load(options) {
  options = options || {};
  var sequence = ++loadSequence;
  var viewport = options.preserveViewport || null;
  var silent = options.silent === true;
  persistView();
  try {
    $('#loading').hidden = silent; $('#error').hidden = true;
    var query = new URLSearchParams();
    if (state.range === 'date') { if ($('#date').value) query.set('date', $('#date').value); $('#range-label').textContent = '按 UTC 归档日期'; }
    else { var windowRange = rangeWindow(state.range); query.set('from', windowRange.from); query.set('to', windowRange.to); $('#range-label').textContent = datetime(windowRange.from) + ' ~ ' + datetime(windowRange.to) + '（本地时间 · ' + (state.clientTime ? '客户端发生' : '接收') + '）'; }
    query.set('timeField', state.clientTime ? 'clientAt' : 'receivedAt');
    query.set('elkEnvironment', state.elkEnvironment);
    query.set('slowThresholdMs', state.slowThreshold);
    if (state.pageFilter) query.set('pageFilter', state.pageFilter);
    Object.keys(state.performanceFilters).forEach(function (field) { query.set('dim.' + field, state.performanceFilters[field]); });
    var response = await fetch(apiPath('/__sink/api/dashboard'), {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:query.toString(),cache:'no-store'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var data = await response.json();
    if (sequence === loadSequence) render(data);
  } catch (error) { if (sequence === loadSequence) { $('#error').textContent = '读取失败：' + error.message; $('#error').hidden = false; } }
  finally {
    if (sequence === loadSequence) {
      $('#loading').hidden = true;
      restoreViewport(viewport);
    }
  }
}
function selectSection(name) {
  document.querySelectorAll('.nav button').forEach(function (button) { button.setAttribute('aria-selected', String(button.dataset.section === name)); });
  document.querySelectorAll('.section').forEach(function (section) { section.hidden = section.id !== name; });
  document.body.dataset.section = name;
}
document.querySelectorAll('.nav button').forEach(function (button) { button.addEventListener('click', function () {
  selectSection(button.dataset.section);
  if (location.hash !== '#' + button.dataset.section) history.pushState(null, '', location.pathname + location.search + '#' + button.dataset.section);
}); });
$('#client-time').addEventListener('change', function (event) { state.clientTime = event.target.checked; state.errorPage = 0; load(); });
$('#date').addEventListener('change', function () { state.range = 'date'; state.errorPage = 0; load(); });
$('#refresh').addEventListener('click', load);
$('#source-map-upload').addEventListener('click', function () { $('#source-map-file').click(); });
$('#source-map-file').addEventListener('change', async function (event) {
  var file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  var viewport = { x: window.scrollX, y: window.scrollY };
  $('#source-map-status').textContent = '正在解析 Source Map…';
  try {
    var response = await fetch(apiPath('/__sink/api/source-maps'), {
      method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Source-Map-File-Name': file.name },
      body: file, cache: 'no-store'
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
    $('#source-map-status').textContent = '已上传 ' + integer(result.mappedFiles) + '/' + integer(result.maps) + ' 个可映射文件';
    await load({ preserveViewport: viewport, silent: true });
  } catch (error) {
    $('#source-map-status').textContent = 'Source Map 上传失败：' + error.message;
  }
});
$('#storage-source').addEventListener('change', function (event) {
  state.elkEnvironment = event.target.value === 'online' ? 'online' : 'test';
  state.userPage = 0; state.errorPage = 0; load();
});
$('#user-mode').addEventListener('change', function (event) { if (event.target.matches('input')) { state.userMode = event.target.value; if (currentData) render(currentData); } });
$('#user-table-mode').addEventListener('change', function (event) { if (event.target.matches('input')) { state.userTableMode = event.target.value; if (currentData) render(currentData); } });
$('#page-filter').addEventListener('input', function (event) {
  var input = event.target;
  renderAutocompleteOptions(input);
  if (!input.value.trim()) resetAutocompleteField(input.dataset.autocompleteField, input);
});
$('#page-filter').addEventListener('focus', function (event) { renderAutocompleteOptions(event.target); });
$('#user-dimension-filters').addEventListener('change', function (event) {
  var radio = event.target.closest('input[type=radio]'); if (!radio) return;
  var dropdown = radio.closest('[data-field]');
  var viewport = { x: window.scrollX, y: window.scrollY };
  if (radio.value) state.performanceFilters[dropdown.dataset.field] = radio.value;
  else delete state.performanceFilters[dropdown.dataset.field];
  dropdown.open = false; dropdown.querySelector('input[type=search]').value = '';
  focusWithoutScrolling(dropdown.querySelector('summary'));
  state.userPage = 0; state.errorPage = 0; load({ preserveViewport: viewport, silent: true });
});
$('#user-dimension-filters').addEventListener('submit', function (event) {
  if (!event.target.matches('.app-name-form')) return;
  event.preventDefault();
  var name = event.target.querySelector('input').value.trim();
  if (!name) return;
  state.performanceFilters.AN = name; state.userPage = 0; state.errorPage = 0;
  event.target.closest('details').open = false; loadFilterSilently();
});
$('#user-dimension-filters').addEventListener('input', function (event) {
  if (event.target.matches('[data-identity-field]')) {
    renderAutocompleteOptions(event.target);
    if (!event.target.value.trim()) resetAutocompleteField(event.target.dataset.identityField, event.target);
    return;
  }
  if (!event.target.matches('input[type=search]')) return;
  var query = event.target.value.trim().toLocaleLowerCase();
  event.target.closest('.dimension-filter').querySelectorAll('.dimension-option').forEach(function (label) {
    var radio = label.querySelector('input'); label.hidden = !!radio.value && !label.textContent.toLocaleLowerCase().includes(query);
  });
});
$('#user-dimension-filters').addEventListener('focusin', function (event) {
  if (event.target.matches('[data-identity-field]')) renderAutocompleteOptions(event.target);
});
document.addEventListener('keydown', handleAutocompleteKeydown);
document.addEventListener('click', function (event) {
  var option = event.target.closest('[data-autocomplete-option]');
  if (option) {
    var input = option.closest('.autocomplete-field').querySelector('[data-autocomplete-field]');
    commitAutocompleteField(input.dataset.autocompleteField, option.dataset.autocompleteValue, input);
    return;
  }
  if (event.target.closest('.autocomplete-field')) return;
  closeAutocompleteOptions();
});
$('#user-dimension-filters').addEventListener('toggle', function (event) {
  if (!event.target.matches('details[open]')) return;
  $('#user-dimension-filters').querySelectorAll('details').forEach(function (other) { if (other !== event.target) other.open = false; });
  event.target.querySelector('input[type=search]').focus();
}, true);
document.addEventListener('click', function (event) {
  if (event.target.closest('#user-dimension-filters')) return;
  $('#user-dimension-filters').querySelectorAll('details[open]').forEach(function (details) { details.open = false; });
});
$('#user-reset-all').addEventListener('click', function () {
  var viewport = { x: window.scrollX, y: window.scrollY };
  state.range = '7days'; state.performanceFilters = {}; state.pageFilter = ''; state.clientTime = false; state.userPage = 0; state.errorPage = 0;
  $('#date').value = ''; $('#user-date').value = ''; $('#client-time').checked = false; $('#page-filter').value = '';
  load({ preserveViewport: viewport, silent: true });
});
$('#user-reset').addEventListener('click', function () {
  var viewport = { x: window.scrollX, y: window.scrollY };
  state.pageFilter = ''; state.userPage = 0; state.errorPage = 0; $('#page-filter').value = '';
  load({ preserveViewport: viewport, silent: true });
});
$('#user-prev').addEventListener('click', function () { state.userPage--; if (currentData) render(currentData); });
$('#user-next').addEventListener('click', function () { state.userPage++; if (currentData) render(currentData); });
$('#user-date').addEventListener('change', function (event) { $('#date').value = event.target.value; state.range = 'date'; state.errorPage = 0; load(); });
$('#user-ranges').addEventListener('click', function (event) {
  var button = event.target.closest('[data-range]'); if (!button) return;
  var viewport = { x: window.scrollX, y: window.scrollY };
  state.range = button.dataset.range; state.userPage = 0; state.errorPage = 0;
  syncRangeButtons(); $('#user-more').open = false;
  restoreViewport(viewport); load({ preserveViewport: viewport, silent: true });
});
$('#user-export').addEventListener('click', function () { if (!currentData) return; var rows = filteredPages(currentData.userPerception.pages); var columns = ['页面','TTFB','TCP连接','TTI','页面完全加载','1秒快开比','2秒快开比','5秒慢开比','样本量']; var csv = [columns].concat(rows.map(function (p) { return [p.page,metricValue(p.ttfb,state.userTableMode),metricValue(p.tcp,state.userTableMode),metricValue(p.tti,state.userTableMode),metricValue(p.pageLoad,state.userTableMode),ratioMetric(p.oneSecondFastRate.rate),ratioMetric(p.twoSecondFastRate.rate),ratioMetric(p.fiveSecondSlowRate.rate),p.sampleCount]; })).map(function (row) { return row.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'); var link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\uFEFF',csv], {type:'text/csv;charset=utf-8'})); link.download = 'h5-user-perception-' + currentData.date + '.csv'; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000); });
$('#user-metric').addEventListener('change', function (event) { state.userMetric = event.target.value; if (currentData) render(currentData); });
$('#user-kpis').addEventListener('click', function (event) { var button = event.target.closest('[data-metric]'); if (button) { state.userMetric = button.dataset.metric; if (currentData) render(currentData); } });
$('#error-kpis').addEventListener('click', function (event) { var button = event.target.closest('[data-error-metric]'); if (button) { state.errorMetric = button.dataset.errorMetric; if (currentData) render(currentData); } });
$('#error-pager').addEventListener('click', function (event) { var button = event.target.closest('[data-error-page]'); if (!button || !currentData) return; var page = Number(button.dataset.errorPage); if (Number.isInteger(page) && page >= 0 && page < Math.ceil(currentData.errors.length / 15)) { state.errorPage = page; renderRecentErrors(currentData); } });
$('#error-list').addEventListener('click', function (event) {
  var button = event.target.closest('.error-analysis-button');
  if (button && $('#error-list').contains(button)) {
    event.stopPropagation();
    var key = button.dataset.errorAnalysis;
    var item = currentData && currentData.errors.find(function (entry) {
      return (entry.errorKey || JSON.stringify([entry.at, entry.name, entry.message, entry.page])) === key;
    });
    if (item && key) startErrorAnalysis(item, key);
    return;
  }
  var row = event.target.closest('.error-row');
  if (!row || !$('#error-list').contains(row)) return;
  var item = row.parentElement, isOpen = !item.hasAttribute('data-open'); item.toggleAttribute('data-open', isOpen); row.setAttribute('aria-expanded', String(isOpen)); item.querySelector('.error-detail-shell').setAttribute('aria-hidden', String(!isOpen));
});
$('#slow-threshold').addEventListener('change', function (event) { state.slowThreshold = Number(event.target.value); load(); });
function selectLocationSection() {
  var section = document.getElementById(location.hash.slice(1));
  selectSection(section && section.classList.contains('section') ? section.id : 'userPerception');
}
window.addEventListener('hashchange', selectLocationSection);
window.addEventListener('popstate', selectLocationSection);
var currentData = null; var originalRender = render;
render = function (data) { currentData = data; originalRender(data); };
selectLocationSection();
loadSourceMapStatus();
load();
</script>
</body>
</html>`;

function encodeBasePath(basePath = "") {
  const value = basePath === "/" ? "" : basePath;
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderDashboard(basePath = "") {
  return html.replace("__BASE_PATH__", encodeBasePath(basePath));
}

export { html as dashboardHtml };
