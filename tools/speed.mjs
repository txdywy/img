// How long the page takes on a slow cross-border link, like opening it from
// mainland China (about 230 ms per round trip, a few Mbit/s). Measures the time
// until the example photo shows in a frame:
//   - first visit, as the page is now;
//   - first visit without the script preloads (how it was before), for comparison;
//   - second visit, from the copy the service worker saved.
// Prints the numbers; it fails only if the page does not load.
// Needs the playwright package and a Chromium; set CHROMIUM_PATH to use another build.
import {chromium} from 'playwright';
import {serve} from './serve.mjs';

const link = {offline: false, latency: 230, downloadThroughput: 4e6 / 8, uploadThroughput: 1e6 / 8};
const runs = 3;
const server = await serve();
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});

async function slow(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', link);
}

// Polls inside the page (the page's CSP blocks Playwright's string-based waits) and
// returns the time since the navigation started.
const shown = page => page.evaluate(() => new Promise(resolve => {
  const tick = () => {
    const preview = document.getElementById('preview');
    if (preview && !preview.hidden && /示例/.test(preview.getAttribute('aria-label') || '')) resolve(performance.now());
    else requestAnimationFrame(tick);
  };
  tick();
}));

async function firstVisit(withoutPreloads) {
  const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  if (withoutPreloads) {
    await page.route(server.url, async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
      await route.fulfill({response, body: html});
    });
  }
  await slow(page);
  await page.goto(server.url, {waitUntil: 'domcontentloaded'});
  const time = await shown(page);
  await context.close();
  return time;
}

async function secondVisit() {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  await page.goto(server.url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await slow(page);
  await page.reload({waitUntil: 'domcontentloaded'});
  const time = await shown(page);
  await context.close();
  return time;
}

const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
async function measure(run) {
  const times = [];
  for (let i = 0; i < runs; i++) times.push(await run());
  return Math.round(median(times));
}

try {
  const rows = [
    ['first visit, before (no script preloads)', await measure(() => firstVisit(true))],
    ['first visit, now', await measure(() => firstVisit(false))],
    ['second visit, from the saved copy', await measure(secondVisit)],
  ];
  console.log(`Time until the example photo shows, ${link.latency} ms round trip, median of ${runs}:`);
  for (const [name, ms] of rows) console.log(`  ${name}: ${ms} ms`);
} finally {
  await browser.close();
  server.close();
}
