// The same engine as iPhone and iPad Safari (and WeChat on iPhone): Playwright's
// WebKit with phone and tablet profiles. Checks that the page starts without
// errors, a photo opens, a whole row of frames shows, a typed blessing survives a
// frame change, 看大图 is bigger than the page, and saving takes two honest steps.
// Real iPhones still differ (share sheet, Photos, WeChat), so this is a floor, not proof.
// Needs: npx playwright install webkit. Run with: node tools/webkit.mjs
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {webkit, devices} from 'playwright';
import {serve} from './serve.mjs';

const server = await serve();
const browser = await webkit.launch();
const shots = process.env.SHOT_DIR;
if (shots) await mkdir(shots, {recursive: true});
const errors = [];
const profiles = ['iPhone SE', 'iPhone 12 Mini', 'iPhone 15 Pro Max', 'iPad (gen 7)', 'iPad (gen 7) landscape', 'iPad Pro 11 landscape']
  .filter(name => devices[name]);

async function waitFor(page, check, arg, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(check, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// Waits until the page has stopped moving. After the first photo the page glides
// (smooth scrolling) to put the frames under the preview, and on a busy machine that
// takes longer than a fixed pause, so measure only once the page is still.
const settle = page => page.evaluate(() => new Promise(resolve => {
  let last = -1;
  let still = 0;
  const check = () => {
    const now = window.scrollY;
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 6) setTimeout(resolve, 40);
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}));

async function photo(page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 2250;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c8784c';
    ctx.fillRect(0, 0, 3000, 2250);
    ctx.fillStyle = '#f3e3b5';
    for (let i = 0; i < 5; i++) ctx.fillRect(300 + i * 520, 900, 300, 500);
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  });
  return {name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64')};
}

for (const name of profiles) {
  const at = `webkit ${name}`;
  const context = await browser.newContext({...devices[name], acceptDownloads: true});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${at} page error: ${error.message}`));
  // Playwright's WebKit screenshot always adds a <style> to line up animations; the
  // page's Content Security Policy (style-src 'self') refuses it and WebKit logs that.
  // Only that message, and only while a screenshot is being taken, is not the page's.
  let shooting = false;
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (shooting && /^Refused to apply a stylesheet/.test(message.text())) return;
    errors.push(`${at} console: ${message.text()}`);
  });
  const shoot = async step => {
    if (!shots) return;
    shooting = true;
    try {
      await page.screenshot({path: join(shots, `${name.replace(/\W+/g, '-')}-${step}.png`)});
      await page.waitForTimeout(100);
    } finally {
      shooting = false;
    }
  };
  try {
    await page.goto(server.url);
    if (!(await waitFor(page, () => window.frameAppReady === true))) errors.push(`${at}: the page script did not start`);
    if (await page.locator('#old-browser').isVisible()) errors.push(`${at}: the old-browser note shows`);
    const phone = await page.evaluate(() => matchMedia('(max-width: 46rem)').matches);
    await page.setInputFiles('#file', await photo(page));
    const opened = await waitFor(page, () => !document.querySelector('#save').disabled);
    if (!opened) {
      errors.push(`${at}: the photo did not open`);
      continue;
    }
    await page.waitForTimeout(300);
    await settle(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sideways > 0) errors.push(`${at}: the page scrolls sideways by ${sideways}px`);
    if (phone) {
      const label = await page.locator('#bar-main-text').innerText();
      if (label !== '做好照片') errors.push(`${at}: the bar button says ${label}`);
      const cards = await page.evaluate(() => {
        const top = document.querySelector('#dock').getBoundingClientRect().bottom;
        const bottom = document.querySelector('#bar').getBoundingClientRect().top;
        return [...document.querySelectorAll('#frames button[data-frame]')].filter(card => {
          const r = card.getBoundingClientRect();
          return r.top >= top - 1 && r.bottom <= bottom + 1;
        }).length;
      });
      if (!cards) errors.push(`${at}: no whole frame card between the preview and the bar`);
    }
    await shoot('1-picked');

    // A typed blessing survives trying another frame with words.
    await page.locator('#filters button[data-category="festival"]').click();
    await page.locator('#words summary').click();
    await page.locator('#caption-text').fill('祝老伴生日快乐');
    await page.locator(phone ? '#words [data-close-sheet]' : '#words summary').click();
    const birthday = page.locator('#frames button[data-frame="birthday"]');
    await birthday.scrollIntoViewIfNeeded();
    await birthday.click();
    await page.waitForTimeout(200);
    const words = await page.locator('#caption-text').inputValue();
    if (words !== '祝老伴生日快乐') errors.push(`${at}: the blessing became ${JSON.stringify(words)} on another frame`);

    // 看大图 is at least as big as the page preview, and zooms.
    await page.evaluate(() => window.scrollTo(0, 0));
    const opener = phone ? '#dock-view' : '#view-frame';
    const small = await page.evaluate(() => document.querySelector('#preview').getBoundingClientRect().width);
    await page.locator(opener).click();
    await page.locator('#frame-dialog').waitFor({state: 'visible'});
    await page.waitForTimeout(200);
    const big = await page.evaluate(() => document.querySelector('#frame-preview').getBoundingClientRect().width);
    if (phone && big < small) errors.push(`${at}: 看大图 ${Math.round(big)}px is smaller than the page preview ${Math.round(small)}px`);
    await page.locator('#zoom-toggle').click();
    await page.waitForTimeout(200);
    if (!(await page.evaluate(() => document.querySelector('#zoom-view').scrollWidth > document.querySelector('#zoom-view').clientWidth))) {
      errors.push(`${at}: 放大看清楚 does not zoom`);
    }
    await shoot('2-big');
    await page.locator('#frame-dialog form .button').click();
    await waitFor(page, () => !document.querySelector('#frame-dialog').open);

    // Saving: first the photo is made and the window says one step is left.
    await page.locator(phone ? '#bar-main' : '#save').click();
    await page.locator('#result-dialog').waitFor({state: 'visible'});
    const title = await page.locator('#result-title').innerText();
    if (!title.includes('还差一步')) errors.push(`${at}: before saving the window says ${title}`);
    if (!(await waitFor(page, () => document.querySelector('#result-image').naturalWidth > 0))) errors.push(`${at}: the finished photo does not show`);
    await shoot('3-made');
    const download = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
    await page.locator('#result-download').click();
    await download;
    const done = await page.locator('#result-title').innerText();
    if (!done.includes('已保存')) errors.push(`${at}: after saving the window says ${done}`);
    await shoot('4-saved');
  } catch (error) {
    errors.push(`${at}: test stopped: ${String(error.message || error).split('\n').slice(0, 3).join(' ')}`);
  } finally {
    await context.close();
  }
}

await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: WebKit (iPhone and iPad Safari engine) checks pass on ${profiles.length} devices: ${profiles.join(', ')}`);
