// Browser smoke test: serve docs/, open the page, choose a photo, pick a frame,
// make the JPG and check it, with no console errors along the way. On phone sizes
// it also checks the phone layout: the preview stays in sight while frames are
// picked, a category tap changes the frame at once, buttons are big enough to tap,
// and nothing scrolls sideways. Set SHOT_DIR to save screenshots of each size.
// Needs the playwright package and a Chromium (npx playwright install chromium);
// set CHROMIUM_PATH to use another Chromium build.
import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
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
  const shots = process.env.SHOT_DIR;
  if (shots) await mkdir(shots, {recursive: true});
  // The preview redraws on the next animation frame, so wait for it rather than read at once.
  const waitFor = (page, check, arg) => page.waitForFunction(check, arg, {timeout: 3000}).then(() => true, () => false);
  const shoot = async (page, name) => shots && page.screenshot({path: join(shots, `${name}.png`)});
  for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}, {width: 360, height: 780}]) {
    const phone = viewport.width < 700;
    const at = `${viewport.width}px`;
    const page = await browser.newPage({viewport, acceptDownloads: true, hasTouch: phone, isMobile: phone});
    page.on('console', message => message.type() === 'error' && errors.push(`${at} console: ${message.text()}`));
    page.on('pageerror', error => errors.push(`${at} page: ${error.message}`));
    page.on('response', response => response.status() >= 400 && errors.push(`${at} ${response.status()} ${response.url()}`));
    await page.goto(url);
    await page.locator('#preview').waitFor({state: 'visible'});
    await shoot(page, `${viewport.width}-1-start`);
    if (phone && !(await page.locator('#bar-main').isVisible())) errors.push(`${at}: the bottom bar is missing`);
    await page.setInputFiles('#file', join(docs, 'assets', 'example.webp'));
    await page.getByText('照片已选好。').waitFor();

    // A category tap puts that category's first frame on the photo straight away.
    await page.locator('#filters button', {hasText: '节庆'}).click();
    if (!(await waitFor(page, () => document.querySelector('#preview').getAttribute('aria-label').includes('福寿安康')))) {
      errors.push(`${at}: tapping 节庆 did not change the frame (${await page.locator('#preview').getAttribute('aria-label')})`);
    }
    await page.locator('#filters button', {hasText: '全部'}).click();

    if (phone) {
      // Pick a frame far down the list: the preview must still be on screen.
      await page.locator('#more').click();
      const far = page.locator('#frames button[data-frame]').nth(20);
      await far.scrollIntoViewIfNeeded();
      await far.click();
      const name = (await far.innerText()).trim();
      if (!(await waitFor(page, text => document.querySelector('#stage-badge').textContent.includes(text), name))) {
        errors.push(`${at}: the preview label did not follow the frame`);
      }
      const box = await page.locator('#preview').boundingBox();
      if (!box || box.y < 0 || box.y + box.height > viewport.height) errors.push(`${at}: the preview left the screen while picking a frame`);
      await shoot(page, `${viewport.width}-2-picking`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (wide > 0) errors.push(`${at}: the page scrolls sideways by ${wide}px`);
      const small = await page.evaluate(() => [...document.querySelectorAll('button, summary, select, a.button')]
        .filter(el => el.offsetParent && !el.closest('dialog, .skip'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; })
        .map(el => el.textContent.trim() || el.id));
      if (small.length) errors.push(`${at}: tap targets under 44px: ${small.join(', ')}`);
      await page.locator('.adjust summary').click();
      await shoot(page, `${viewport.width}-3-adjust`);
      if (!(await page.locator('#adjust-done').isVisible())) errors.push(`${at}: the adjust sheet did not open`);
      await page.locator('#adjust-done').click();
      await page.locator('#bar-main').click();
    } else {
      await page.locator('#frames button[data-frame]').nth(2).click();
      await page.locator('#save').click();
    }
    await page.locator('#result-dialog').waitFor({state: 'visible'});
    await shoot(page, `${viewport.width}-4-result`);
    const download = page.waitForEvent('download');
    await page.locator('#result-download').click();
    const file = await (await download).path();
    const bytes = await readFile(file);
    if (bytes.length < 10_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      errors.push(`${at}: download is not a JPG (${bytes.length} bytes)`);
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
console.log('OK: page loads, imports a photo, frames it and downloads a JPG on desktop and two phone sizes; phone layout checks pass');
