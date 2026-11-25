// How long the page takes on a slow cross-border link, like opening it from
// mainland China (about 230 ms per round trip, a few Mbit/s). Measures the time
// until the buttons work (the script has started) and until the example photo shows in a frame:
//   - first visit, as the page is now;
//   - first visit without the script preloads (how it was before), for comparison;
//   - second visit, from the copy the service worker saved.
// Served over HTTP/2 and gzipped like Cloudflare does (a throwaway certificate from
// openssl), since over HTTP/1.1 the browser opens only six connections and queues
// the rest, and uncompressed scripts would make the link look slower than it is.
// Prints the numbers; it fails only if the page does not load.
// Needs the playwright package, a Chromium and openssl; set CHROMIUM_PATH to use another build.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createSecureServer} from 'node:http2';
import {tmpdir} from 'node:os';
import {extname, join, normalize} from 'node:path';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {docs} from './serve.mjs';

const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

function serve() {
  const dir = mkdtempSync(join(tmpdir(), 'speed-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], {stdio: 'ignore'});
  const server = createSecureServer({key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')), allowHTTP1: true},
    async (request, response) => {
      const path = normalize(decodeURIComponent(new URL(request.url, 'https://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      try {
        const file = path.endsWith('/') ? path + 'index.html' : path;
        const type = types[extname(file)] || 'text/html; charset=utf-8';
        let body = await readFile(join(docs, file));
        const headers = {'content-type': type};
        if (/text|svg/.test(type) && /gzip/.test(request.headers['accept-encoding'] || '')) {
          body = gzipSync(body);
          headers['content-encoding'] = 'gzip';
        }
        response.writeHead(200, headers);
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({url: `https://localhost:${server.address().port}/`, close: () => server.close()})));
}

const link = {offline: false, latency: 230, downloadThroughput: 4e6 / 8, uploadThroughput: 1e6 / 8};
const runs = 5;
const server = await serve();
// Trust the throwaway certificate everywhere, the service worker included.
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP localhost 127.0.0.1']});

async function slow(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', link);
}

// Polls inside the page (the page's CSP blocks Playwright's string-based waits) and
// returns the times since the navigation started: [script started, photo shown].
const shown = page => page.evaluate(() => new Promise(resolve => {
  let ready = 0;
  const tick = () => {
    if (!ready && window.frameAppReady) ready = performance.now();
    const preview = document.getElementById('preview');
    if (ready && preview && !preview.hidden && /示例/.test(preview.getAttribute('aria-label') || '')) resolve([ready, performance.now()]);
    else requestAnimationFrame(tick);
  };
  tick();
}));

async function firstVisit(withoutPreloads) {
  const context = await browser.newContext({serviceWorkers: 'block', ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}});
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
  return [0, 1].map(at => Math.round(median(times.map(pair => pair[at]))));
}

try {
  const rows = [
    ['first visit, before (no script preloads)', await measure(() => firstVisit(true))],
    ['first visit, now', await measure(() => firstVisit(false))],
    ['second visit, from the saved copy', await measure(secondVisit)],
  ];
  console.log(`${link.latency} ms round trip, ${link.downloadThroughput * 8 / 1e6} Mbit/s, median of ${runs}:`);
  for (const [name, [ready, photo]] of rows) console.log(`  ${name}: buttons work at ${ready} ms, photo shows at ${photo} ms`);
} finally {
  await browser.close();
  server.close();
}
