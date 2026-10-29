import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { dashboardHtml } from "../src/dashboard.js";

test("recent errors paginate 15 at a time with numbered controls", () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.match(dashboardHtml, /id="error-pager"[^>]*aria-label="最近错误分页"/);
  assert.match(dashboardHtml, /\.error-pager\{[^}]*justify-content:flex-end/);
  assert.match(
    dashboardHtml,
    /\.error-detail-shell\{[^}]*grid-template-rows:0fr;transition:grid-template-rows/,
  );
  assert.match(
    dashboardHtml,
    /\.error-item\[data-open\] \.error-detail-shell\{grid-template-rows:1fr\}/,
  );
  assert.match(dashboardHtml, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(
    dashboardHtml,
    /id="error-list-head"[^>]*>.*?序号.*?错误信息.*?版本.*?时间/,
  );
  const render = script.slice(
    script.indexOf("function renderRecentErrors(data)"),
    script.indexOf("function renderErrors(data, isElk)"),
  );
  const click = script
    .split("\n")
    .find((line) =>
      line.startsWith("$('#error-pager').addEventListener('click'"),
    );
  const clickRow = script.match(
    /\$\('#error-list'\)\.addEventListener\('click', function \(event\) \{[\s\S]*?\n\}\);/,
  )?.[0];
  assert.ok(click && clickRow);
  const elements = new Map();
  const $ = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        addEventListener(_name, listener) {
          this.click = listener;
        },
        querySelectorAll() {
          return this.openRows || [];
        },
        contains(row) {
          return row.insideList;
        },
      });
    return elements.get(selector);
  };
  const state = { errorPage: 0 };
  const context = {
    $,
    state,
    integer: String,
    datetime: String,
    esc: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;"),
  };
  runInNewContext(render, context);
  const data = {
    overview: { errors: 50 },
    errors: Array.from({ length: 32 }, (_, index) => ({
      name: "js_exception",
      message: "error-" + index,
      page: "/home",
      at: "2026-10-22",
      version: index === 0 ? "1.1.7" : null,
      file: "https://example.com/a.js",
      line: 69,
      column: 20,
      reasonCode: "uncaught_exception",
      codeSnippet: "throw new Error()",
      stack: "https://example.com/a.js:69:20",
    })),
  };
  context.currentData = data;
  runInNewContext(click, context);
  runInNewContext(clickRow, context);

  context.renderRecentErrors(data);
  assert.equal(
    ($("#error-list").innerHTML.match(/<article class="error-item"/g) || [])
      .length,
    15,
  );
  assert.match($("#error-list").innerHTML, /error-0/);
  assert.doesNotMatch($("#error-list").innerHTML, /error-15/);
  assert.match(
    $("#error-list").innerHTML,
    /<button type="button" class="error-row" aria-expanded="false" aria-controls="error-detail-0"><span class="error-index">1<\/span>/,
  );
  assert.match(
    $("#error-list").innerHTML,
    /<span class="error-version" title="1\.1\.7">1\.1\.7<\/span>/,
  );
  assert.match(
    $("#error-list").innerHTML,
    /<time class="error-time" datetime="2026-10-22">/,
  );
  const first = $("#error-list").innerHTML.split("</article>")[0];
  assert.doesNotMatch(
    first.split("</button>")[0],
    /页面路径|代码位置|uncaught_exception|throw new Error/,
  );
  assert.match(
    first.split("</button>")[1],
    /页面路径|代码位置|uncaught_exception|throw new Error/,
  );
  const makeRow = () => {
    const attributes = new Map();
    const detail = {
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    };
    const item = {
      insideList: true,
      attributes,
      hasAttribute(name) {
        return attributes.has(name);
      },
      toggleAttribute(name, value) {
        if (value) attributes.set(name, "");
        else attributes.delete(name);
      },
      querySelector() {
        return detail;
      },
    };
    const row = {
      insideList: true,
      parentElement: item,
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    };
    return { row, item, attributes };
  };
  const firstRow = makeRow(),
    secondRow = makeRow();
  const clickError = (row) =>
    $("#error-list").click({
      target: {
        closest: (selector) => (selector === ".error-row" ? row : null),
      },
    });
  clickError(firstRow.row);
  clickError(secondRow.row);
  assert.equal(firstRow.item.hasAttribute("data-open"), true);
  assert.equal(secondRow.item.hasAttribute("data-open"), true);
  assert.equal(firstRow.attributes.get("aria-expanded"), "true");
  assert.equal(secondRow.attributes.get("aria-hidden"), "false");
  clickError(firstRow.row);
  assert.equal(firstRow.item.hasAttribute("data-open"), false);
  assert.equal(firstRow.attributes.get("aria-hidden"), "true");
  assert.equal(secondRow.item.hasAttribute("data-open"), true);
  $("#error-list").openRows = [0, 1].map((index) => ({
    dataset: {
      errorKey: JSON.stringify([
        data.errors[index].at,
        data.errors[index].name,
        data.errors[index].message,
        data.errors[index].page,
      ]),
    },
  }));
  context.renderRecentErrors(data);
  assert.equal(
    ($("#error-list").innerHTML.match(/data-open><button/g) || []).length,
    2,
  );
  assert.match(
    $("#error-list").innerHTML,
    /aria-expanded="true" aria-controls="error-detail-0"/,
  );
  assert.match(
    $("#error-count").textContent,
    /第 1–15 条 \/ 最近 32 条 · 共 50 条/,
  );
  assert.match(
    $("#error-pager").innerHTML,
    /data-error-page="2"[^>]*>3<\/button>/,
  );
  const clickPage = (page) =>
    $("#error-pager").click({
      target: { closest: () => ({ dataset: { errorPage: String(page) } }) },
    });
  clickPage(2);
  assert.equal(state.errorPage, 2);
  assert.equal(
    ($("#error-list").innerHTML.match(/<article class="error-item"/g) || [])
      .length,
    2,
  );
  assert.match($("#error-list").innerHTML, /error-31/);
  assert.match(
    $("#error-list").innerHTML,
    /<button type="button" class="error-row" aria-expanded="false" aria-controls="error-detail-30"><span class="error-index">31<\/span>/,
  );
  assert.match($("#error-count").textContent, /第 31–32 条/);
  assert.match($("#error-pager").innerHTML, /aria-label="下一页"[^>]*disabled/);
  clickPage(3);
  assert.equal(state.errorPage, 2);

  data.errors = data.errors.slice(0, 4);
  context.renderRecentErrors(data);
  assert.equal(state.errorPage, 0);
  assert.equal(
    ($("#error-list").innerHTML.match(/<article class="error-item"/g) || [])
      .length,
    4,
  );
  assert.equal($("#error-pager").hidden, false);
  data.errors = [];
  context.renderRecentErrors(data);
  assert.equal($("#error-pager").hidden, true);
  assert.equal($("#error-empty").hidden, false);
});
