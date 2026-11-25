// Browser smoke test: serve docs/, open the page, choose a photo, pick a frame,
// make the JPG and check it, with no console errors along the way.
// Needs the playwright package and a Chromium (npx playwright install chromium);
// set CHROMIUM_PATH to use another Chromium build.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp'};

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(docs, path.endsWith('/') ? path + 'index.html' : path));
    response.writeHead(200, {'content-type': types[extname(path)] || 'text/html; charset=utf-8'});
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
const errors = [];
try {
  for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
    const page = await browser.newPage({viewport, acceptDownloads: true});
    page.on('console', message => message.type() === 'error' && errors.push(`${viewport.width}px console: ${message.text()}`));
    page.on('pageerror', error => errors.push(`${viewport.width}px page: ${error.message}`));
    page.on('response', response => response.status() >= 400 && errors.push(`${viewport.width}px ${response.status()} ${response.url()}`));
    await page.goto(url);
    await page.locator('#preview').waitFor({state: 'visible'});
    await page.setInputFiles('#file', join(docs, 'assets', 'example.webp'));
    await page.getByText('照片已选好。').waitFor();
    await page.locator('#frames button[data-frame]').nth(2).click();
    await page.locator('#save').click();
    await page.locator('#result-dialog').waitFor({state: 'visible'});
    const download = page.waitForEvent('download');
    await page.locator('#result-download').click();
    const file = await (await download).path();
    const bytes = await readFile(file);
    if (bytes.length < 10_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      errors.push(`${viewport.width}px: download is not a JPG (${bytes.length} bytes)`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('OK: page loads, imports a photo, frames it and downloads a JPG on desktop and phone sizes');
