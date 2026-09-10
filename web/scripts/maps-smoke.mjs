// Offline browser acceptance for the Google Maps search/clustering increment.
// Every Maps and Places API is stubbed at the browser boundary. This proves
// integration and recovery behavior only; it says nothing about live Google
// credentials, quota, billing, coverage, geocoding quality, or production SDK.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GOOGLE_MAPS_STUB } from "./google-maps-stub.mjs";

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
let page;
let pageErrors = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  let blockedRequests = 0;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    blockedRequests += 1;
    // Deliberately abort every external request. A blocked request is expected
    // for the offline map, but an external request must never be continued.
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.addInitScript({ content: GOOGLE_MAPS_STUB });
  const go = async () => {
    await page.goto(`${origin}/console`, { waitUntil: "load" });
    await page.locator("[data-testid='google-map-container'], [data-testid='maplibre-container']").first().waitFor();
  };
  const results = [];

  await go();
  await page.locator("[data-testid='google-map-container']").waitFor();
  assert.ok(await page.getByRole("button", { name: "Search location" }).count(), "Google search control is rendered");
  const initialUrl = page.url();
  await page.getByRole("button", { name: "Search location" }).click();
  await page.locator("gmp-place-autocomplete").waitFor({ state: "attached" });
  await page.evaluate(() => window.__emitGooglePlace(29.95, 78.11));
  await page.waitForFunction(() => window.__mapencroachGoogleStub.maps.some((map) => map.panCalls.length > 0));
  assert.equal(page.url(), initialUrl, "Place selection pans the camera without changing URL selection");
  await page.locator("[data-testid='alert-cluster-wrapper']").first().waitFor();
  const clusterButton = page.getByTestId("alert-cluster-wrapper").getByRole("button").first();
  await clusterButton.waitFor();
  // MarkerClusterer removes the individual marker nodes on the next animation
  // frame after installing its aggregate marker.
  await page.waitForTimeout(100);
  const fitBeforeMouseClick = await page.evaluate(() => window.__mapencroachGoogleStub.maps.at(-1)?.fitCalls.length ?? 0);
  await clusterButton.click();
  await page.waitForFunction((before) => (window.__mapencroachGoogleStub.maps.at(-1)?.fitCalls.length ?? 0) === before + 1, fitBeforeMouseClick);
  const fitAfterMouseClick = await page.evaluate(() => window.__mapencroachGoogleStub.maps.at(-1)?.fitCalls.length ?? 0);
  assert.equal(fitAfterMouseClick, fitBeforeMouseClick + 1, "Cluster mouse activation fits bounds exactly once");
  const fitBeforeEnter = fitAfterMouseClick;
  await clusterButton.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((before) => (window.__mapencroachGoogleStub.maps.at(-1)?.fitCalls.length ?? 0) === before + 1, fitBeforeEnter);
  assert.equal(await page.evaluate(() => window.__mapencroachGoogleStub.maps.at(-1)?.fitCalls.length ?? 0), fitBeforeEnter + 1, "Cluster keyboard activation fits bounds exactly once");
  results.push("Stubbed Places selection pans Google camera and preserves URL state; alerts cluster");

  await page.getByRole("button", { name: /Close location search|Search location/ }).first().click();
  await page.evaluate(() => { window.__mapencroachGoogleStub.failPlacesOnce = true; });
  await page.getByRole("button", { name: "Search location" }).click();
  await page.getByText("Location search unavailable. Try again.").waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator("gmp-place-autocomplete").waitFor({ state: "attached" });
  results.push("Places failure stays local and retry remounts the stubbed element");

  await page.evaluate(() => window.gm_authFailure?.());
  await page.getByTestId("map-provider-notice").waitFor();
  assert.match(await page.getByTestId("map-provider-notice").innerText(), /fallback map/i);
  results.push("Stubbed Google auth failure recovers to MapLibre");

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload({ waitUntil: "load" });
    await page.locator("[data-testid='google-map-container']").waitFor();
    await page.getByRole("button", { name: "Search location" }).click();
    await page.locator("gmp-place-autocomplete").waitFor({ state: "attached" });
    const geometry = await page.evaluate(() => {
      // Compare siblings and controls inside the map canvas only. Ancestor /
      // descendant pairs are intentionally excluded because they overlap by
      // definition in the DOM while remaining valid layout.
      const selectors = ["[data-testid='google-search-row']", "[data-testid='map-canvas-region']", "[data-testid='map-footer']", "[data-testid='google-location-search']", "[data-testid='map-toolbar']"];
      const boxes = selectors.map((selector) => { const element = document.querySelector(selector); const r = element?.getBoundingClientRect(); return r && r.width && r.height ? { element, selector, x: r.x, y: r.y, right: r.right, bottom: r.bottom } : null; }).filter(Boolean);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) { const a = boxes[i], b = boxes[j]; if (a.element.contains(b.element) || b.element.contains(a.element)) continue; if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1) overlaps.push([a.selector, b.selector]); }
      const row = document.querySelector("[data-testid='google-search-row']")?.getBoundingClientRect();
      const canvas = document.querySelector("[data-testid='map-canvas-region']")?.getBoundingClientRect();
      return { overlaps, overflow: document.documentElement.scrollWidth > innerWidth, rowHeight: row?.height ?? 0, canvasHeight: canvas?.height ?? 0 };
    });
    assert.equal(geometry.overflow, false, `Console overflows at ${width}px`);
    assert.deepEqual(geometry.overlaps, [], `Map controls overlap at ${width}px`);
    assert.ok(geometry.rowHeight > 0 && geometry.canvasHeight >= 120, `Open search leaves usable map at ${width}px`);
    if (width === 390) {
      if (process.env.MAPS_SCREENSHOT_PATH) await page.screenshot({ path: process.env.MAPS_SCREENSHOT_PATH, fullPage: true });
      await page.addScriptTag({ path: require.resolve("axe-core/axe.js") });
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.filter((item) => ["serious", "critical"].includes(item.impact)).map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })));
      assert.deepEqual(violations, [], `Open Google search accessibility violations: ${JSON.stringify(violations)}`);
    }
    await page.reload({ waitUntil: "load" });
    await page.locator("[data-testid='google-map-container']").waitFor();
    await page.goto(`${origin}/console?alert=ALT-5001`, { waitUntil: "load" });
    await page.locator("[data-testid='google-map-container']").waitFor();
    const selectedGeometry = await page.evaluate(() => {
      const map = document.querySelector("[data-testid='map-canvas-region']")?.getBoundingClientRect();
      const aside = document.querySelector("aside[aria-label^='Selected alert']")?.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, mapHeight: map?.height ?? 0, asideHeight: aside?.height ?? 0, overlap: map && aside ? Math.min(map.right, aside.right) - Math.max(map.x, aside.x) > 1 && Math.min(map.bottom, aside.bottom) - Math.max(map.y, aside.y) > 1 : false };
    });
    assert.equal(selectedGeometry.overflow, false, `Selected alert overflows at ${width}px`);
    assert.equal(selectedGeometry.overlap, false, `Selected alert overlaps map at ${width}px`);
  }
  results.push("Console remains usable without horizontal overflow or map chrome overlap at 320/390/768/1440px");
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify({ stubbedExternalApis: ["Maps", "AdvancedMarker", "Places"], realLibrary: "@googlemaps/markerclusterer", blockedExternalRequests: blockedRequests, pageErrors, passed: results }, null, 2));
} catch (error) {
  console.error(error);
  if (page && process.env.MAPS_SCREENSHOT_PATH) await page.screenshot({ path: process.env.MAPS_SCREENSHOT_PATH, fullPage: true }).catch(() => {});
  if (page) console.error("Browser diagnostics:", await page.locator("body").innerText().catch(() => "<body unavailable>"), pageErrors);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
}
