// Run against a production build made without NEXT_PUBLIC_API_URL.
// Browser/runtime paths may be supplied by a local toolchain; no user profile is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const next = require("next");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = next({ dev: false, dir: webRoot });
await app.prepare();
const server = createServer(app.getRequestHandler());
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  // Offline acceptance: do not contact map providers, analytics, or live APIs.
  let blockedRequests = 0;
  await context.route("**/*", (route) => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    blockedRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  const results = [];
  const go = (pathname) => page.goto(`${origin}${pathname}`, { waitUntil: "networkidle" });

  await go("/console");
  await page.getByRole("button", {name:"Retry map tiles"}).waitFor();
  const beforeRetry = blockedRequests;
  await page.getByRole("button", {name:"Retry map tiles"}).click();
  const retryDeadline = Date.now() + 5000;
  while (blockedRequests === beforeRetry && Date.now() < retryDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(blockedRequests > beforeRetry, "Tile retry must issue new source requests");
  results.push("Unavailable basemap has a working source retry");
  assert.match(await page.getByTestId("demo-mode-banner").innerText(), /read only/i);
  const parcelLink = page.getByTestId("alert-sidebar").getByRole("link", { name: "Parcel →" }).first();
  const parcelHref = await parcelLink.getAttribute("href");
  await parcelLink.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`${origin}${parcelHref}`);
  results.push("Keyboard Parcel link opens its record");

  await go("/alerts");
  await page.getByRole("searchbox", { name: "Search alerts" }).fill("44/2");
  assert.match(await page.getByTestId("alerts-table").innerText(), /Showing 1 of/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  assert.match(await page.getByTestId("alerts-table").innerText(), /Showing 5 of 5/);
  results.push("Survey search and clear filters work");

  await page.setViewportSize({ width: 390, height: 844 });
  await go("/console");
  const trigger = page.getByRole("button", { name: "Open work queue" });
  await trigger.click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), true);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
  await trigger.click();
  await page.getByTestId("alert-list-item").first().click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Open parcel record" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Stop watching alert|Watch alert/ }).isDisabled(), true);
  await page.waitForFunction(() => {
    const container = document.querySelector("[data-testid='maplibre-container']")?.getBoundingClientRect();
    const canvas = document.querySelector(".maplibregl-canvas")?.getBoundingClientRect();
    return container && canvas && Math.abs(container.height - canvas.height) < 2;
  }, undefined, {timeout: 3000});
  const liveMapSizes = await page.evaluate(() => ({
    container: document.querySelector("[data-testid='maplibre-container']")?.getBoundingClientRect().height,
    canvas: document.querySelector(".maplibregl-canvas")?.getBoundingClientRect().height,
  }));
  assert.ok(Math.abs(liveMapSizes.container - liveMapSizes.canvas) < 2,
    `Opening selected details must resize the rendered map: ${JSON.stringify(liveMapSizes)}`);
  await page.getByRole("button", { name: "Close selected alert" }).click();
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("console-background").getAttribute("inert"), null);
  results.push("Mobile focus, dismissal, selection, and desktop resizing work");

  await go("/cases/CASE-9001");
  const dismiss = page.getByRole("button", {name:"Dismiss false positive",exact:true});
  assert.equal(await dismiss.isEnabled(), true);
  await dismiss.click();
  assert.equal(await page.getByRole("button", {name:"Record dismissal",exact:true}).isDisabled(), true);
  results.push("Read-only users can explore alternative case steps without submitting");

  const routes = ["/", "/console", "/alerts", "/cases", "/cases/CASE-9001", "/parcels/PCL-1001", "/watchlist", "/personas", "/cases/CASE-9001/evidence-packet"];
  const accessibility = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await go(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${route} overflows at ${width}px`);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.js") });
      const violations = await page.evaluate(async () =>
        (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations
          .filter((item) => ["serious", "critical"].includes(item.impact))
          .map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))
      );
      if (violations.length) accessibility.push({ route, width, violations });
    }
  }
  assert.deepEqual(accessibility, [], JSON.stringify(accessibility, null, 2));
  results.push("Nine routes fit 390/768/1440px with no serious/critical axe violations");

  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:844});
    for (const selected of [false,true]) {
      await go(`/console${selected ? "?alert=ALT-5001" : ""}`);
      const layout = await page.evaluate(() => {
        const selectors = ["[data-testid='map-toolbar']", "[data-testid='map-canvas-region']", "[data-testid='map-footer']", "aside[aria-label^='Selected alert']"];
        const boxes = selectors.map(selector => {
          const e = document.querySelector(selector);
          const r = e?.getBoundingClientRect();
          return r && r.width && r.height ? {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom} : null;
        }).filter(Boolean);
        const overlaps = [];
        for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
          const a=boxes[i], b=boxes[j];
          if (Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1) overlaps.push([a.selector,b.selector]);
        }
        const canvas=document.querySelector("[data-testid='maplibre-container']")?.getBoundingClientRect();
        const rendered = document.querySelector(".maplibregl-canvas")?.getBoundingClientRect();
        return {overlaps,canvasHeight:canvas?.height ?? 0, renderedHeight: rendered?.height ?? 0};
      });
      assert.deepEqual(layout.overlaps,[],`Map chrome overlaps at ${width}px, selected=${selected}`);
      assert.ok(Math.abs(layout.canvasHeight - layout.renderedHeight) < 2, `Rendered map must fit resized container at ${width}px, selected=${selected}: ${JSON.stringify(layout)}`);
      assert.ok(layout.canvasHeight >= 120, `Map must remain usable at ${width}px, selected=${selected}`);
    }
  }
  results.push("Map rows and selected details do not overlap at 320/390/768/1440px");

  const backend = path.resolve(webRoot, "../backend");
  const png = execFileSync(process.env.PYTHON || path.join(backend, ".venv/bin/python"), ["-c", `
import base64
from mapencroach.imagery.providers import DemoImageryProvider
from mapencroach.imagery.schedule import WeekRef
geometry = {"type":"Polygon","coordinates":[[[78.0,29.8],[78.0,29.9],[78.1,29.9]]]}
scene = DemoImageryProvider().fetch(geometry=geometry, week=WeekRef(2026,32))
print(base64.b64encode(scene.data).decode())
`], { cwd: backend, env: { ...process.env, PYTHONPATH: path.join(backend, "src") }, encoding: "utf8" }).trim();
  const size = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, png);
  assert.deepEqual(size, [160, 90]);
  results.push("Actual backend demo PNG decodes in Chrome at 160 × 90");
  console.log(JSON.stringify({ passed: results }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
}
