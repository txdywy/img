// How long the page takes on a cross-border link, like opening it from mainland
// China (about 230 ms per round trip). For each link speed it measures:
//   - first visit: nothing saved yet;
//   - second visit: the browser's saved files have expired (the next day, say), so
//     without a service worker each one is checked with the server again.
// Each gives the time until the buttons work (the script has started) and until
// the example photo shows in a frame. Set BEFORE_DOCS to another copy of docs/
// (CI uses the version before this change) to measure that too, for comparison.
//
// Served over HTTP/2 and gzipped like Cloudflare, with ETags like GitHub Pages:
// over HTTP/1.1 the browser opens only six connections and queues the rest, and
// uncompressed scripts would make the link look slower than it is.
// Prints the numbers; it fails only if the page does not load.
// Needs the playwright package, a Chromium and openssl; set CHROMIUM_PATH to use another build.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createSecureServer} from 'node:http2';
import {tmpdir} from 'node:os';
import {extname, join, normalize} from 'node:path';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {docs} from './serve.mjs';

const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

// Browsers speak HTTP/2 only over HTTPS, so make a certificate for localhost that
// lives as long as this run. The browser below is told to accept it, and only it
// matters here: the server listens on 127.0.0.1 alone.
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), 'speed-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], {stdio: 'pipe'});
    return {key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem'))};
  } catch (error) {
    throw new Error(`speed.mjs needs openssl to make a test certificate: ${error.stderr || error.message}`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function serve(root) {
  const server = createSecureServer({...certificate(), allowHTTP1: true}, async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'https://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const file = path.endsWith('/') ? path + 'index.html' : path;
      const type = types[extname(file)] || 'text/html; charset=utf-8';
      let body = await readFile(join(root, file));
      const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
      // Expired at once, so a later visit has to ask again: what a browser does with
      // GitHub Pages' 10-minute cache on any visit after the first few minutes.
      const headers = {'content-type': type, etag, 'cache-control': 'no-cache'};
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, headers);
        response.end();
        return;
      }
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

// A slow and a typical cross-border mobile link, both at ~230 ms per round trip.
const links = [4, 20].map(mbit => ({offline: false, latency: 230, downloadThroughput: mbit * 1e6 / 8, uploadThroughput: 1e6 / 8}));
const runs = 5;
// Accept the test certificate: the launch flag covers the page and the service
// worker (which ignores the context option); ignoreHTTPSErrors covers Playwright's
// own requests.
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP localhost 127.0.0.1']});

// Opens the page on the slow link and returns it with the times since the
// navigation started: [script started, photo shown]. Polls inside the page, since
// the page's CSP blocks Playwright's string-based waits.
async function open(context, url, link) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', link);
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  const times = await page.evaluate(() => new Promise(resolve => {
    let ready = 0;
    const tick = () => {
      if (!ready && window.frameAppReady) ready = performance.now();
      const preview = document.getElementById('preview');
      if (ready && preview && !preview.hidden && /示例/.test(preview.getAttribute('aria-label') || '')) resolve([ready, performance.now()]);
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  return {page, times};
}

async function visits(url, link) {
  const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}});
  const first = await open(context, url, link);
  // If the page has a service worker, let it finish saving its copy.
  await first.page.waitForLoadState('load');
  await first.page.evaluate(async () => {
    if ('serviceWorker' in navigator && await navigator.serviceWorker.getRegistration()) {
      await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => setTimeout(resolve, 10000))]);
    }
  });
  await first.page.close();
  const second = await open(context, url, link);
  await context.close();
  return [first.times, second.times];
}

const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
async function measure(url, link) {
  const all = [];
  for (let i = 0; i < runs; i++) all.push(await visits(url, link));
  return [0, 1].map(visit => [0, 1].map(at => Math.round(median(all.map(run => run[visit][at])))));
}

const sites = [['now', await serve(docs)]];
if (process.env.BEFORE_DOCS) sites.unshift(['before', await serve(process.env.BEFORE_DOCS)]);
try {
  for (const link of links) {
    console.log(`${link.latency} ms round trip, ${link.downloadThroughput * 8 / 1e6} Mbit/s, median of ${runs}:`);
    for (const [name, site] of sites) {
      const [first, second] = await measure(site.url, link);
      console.log(`  ${name}: first visit: buttons ${first[0]} ms, photo ${first[1]} ms; second visit: buttons ${second[0]} ms, photo ${second[1]} ms`);
    }
  }
} finally {
  await browser.close();
  for (const [, site] of sites) site.close();
}
