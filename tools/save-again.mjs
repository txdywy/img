// Saving more than once without reloading, the way people use it: make a photo and
// save it, then a second photo, then the same photo with another frame and new
// words, and save each time. Runs with iPhone profiles, three ways:
// - download: the 下载到文件 / 下载照片 button each time;
// - share: a share sheet that works, like current iPhones;
// - stuck share: like iOS 15 and 16 (WebKit bug 231995), where choosing 存储图像
//   saves the photo but the share never finishes and every later share fails until
//   the page reloads. The second and third photos must still be savable.
// Needs playwright and a Chromium (see smoke.mjs); ENGINE=webkit runs it in the
// engine of iPhone and iPad Safari and iPhone WeChat.
import * as playwright from 'playwright';
import {serve} from './serve.mjs';

const server = await serve();
const engine = process.env.ENGINE || 'chromium';
const browser = await playwright[engine].launch(engine === 'chromium' ? {executablePath: process.env.CHROMIUM_PATH || undefined} : {});
const errors = [];
const profiles = ['iPhone SE', 'iPhone 12'].filter(name => playwright.devices[name]);
const wechat = ' MicroMessenger/8.0.50(0x1800323c) NetType/WIFI Language/zh_CN';

async function waitFor(page, check, arg, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(check, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function photo(page, color) {
  const data = await page.evaluate(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 2400, 1800);
    ctx.fillStyle = '#f3e3b5';
    ctx.fillRect(600, 500, 1200, 800);
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  }, color);
  return {name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64')};
}

// Pretends to be the phone's share sheet. "works" finishes each share; "stuck"
// never finishes the first one and refuses the rest, as iOS 15 and 16 do.
function fakeShare(mode) {
  window.shares = 0;
  let open = false;
  navigator.canShare = data => Boolean(data && data.files && data.files.length);
  navigator.share = () => {
    window.shares++;
    if (open) return Promise.reject(new DOMException('A share is already in progress.', 'InvalidStateError'));
    if (mode === 'stuck') {
      open = true;
      return new Promise(() => {});
    }
    return Promise.resolve();
  };
}

const state = page => page.evaluate(() => ({
  title: document.querySelector('#result-title').textContent,
  lead: document.querySelector('#result-lead').textContent,
  problem: document.querySelector('#share-status').textContent,
  share: !document.querySelector('#share').hidden,
  image: document.querySelector('#result-image').naturalWidth,
  bar: document.querySelector('#bar-main-text').textContent,
}));

// One round: open the photo window from the bar and save, the way the mode says.
async function round(page, at, mode, n) {
  const where = `${at} save ${n}`;
  if (!(await waitFor(page, () => !document.querySelector('#bar-main').disabled
    && document.querySelector('#bar-main-text').textContent === '做好照片'))) {
    errors.push(`${where}: the bar button never offered 做好照片 (says ${(await state(page)).bar})`);
    return;
  }
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  if (!(await waitFor(page, () => document.querySelector('#result-image').naturalWidth > 0))) {
    errors.push(`${where}: the finished photo does not show`);
  }
  let now = await state(page);
  if (mode === 'wechat') {
    // WeChat cannot download and never says whether a download failed, so the
    // long press is the one way offered, and the page never claims it saved.
    if (!now.title.includes('按住')) errors.push(`${where}: WeChat is not told to press and hold (${now.title})`);
    if (await page.locator('#result-download').isVisible()) errors.push(`${where}: WeChat offers a download it cannot do`);
    const src = await page.evaluate(() => document.querySelector('#result-image').src.slice(0, 5));
    if (src !== 'data:') errors.push(`${where}: the photo to press and hold is ${src}…, not the image itself`);
    if (now.title.includes('已保存')) errors.push(`${where}: claims the photo is saved`);
  } else if (mode === 'download') {
    const download = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
    await page.locator('#result-download').click();
    const file = await download;
    if (!file) errors.push(`${where}: 下载 gave no file`);
    now = await state(page);
    if (!now.title.includes('已保存')) errors.push(`${where}: after downloading the window says ${now.title}`);
  } else if (mode === 'works') {
    if (!now.share) errors.push(`${where}: no 保存到相册 button`);
    else {
      await page.locator('#share').click();
      await waitFor(page, () => document.querySelector('#result-title').textContent.includes('好了'));
      now = await state(page);
      if (!now.title.includes('好了')) errors.push(`${where}: after sharing the window says ${now.title} ${now.problem}`);
    }
  } else if (n === 1) {
    // The share sheet opens; the person picks 存储图像; the page hears nothing back.
    await page.locator('#share').click();
    await page.waitForTimeout(200);
    now = await state(page);
    if (now.problem) errors.push(`${where}: shows a problem after the first share: ${now.problem}`);
    // Tapping 保存到相册 again in the same window must not dead-end.
    await page.locator('#share').click();
    await page.waitForTimeout(300);
    now = await state(page);
    if (!now.title.includes('按住') || now.problem) errors.push(`${where}: a second tap on 保存到相册 says ${now.title} ${now.problem}`);
  } else {
    // Later photos: the page knows the share sheet is stuck and offers what still works.
    if (now.share) {
      await page.locator('#share').click();
      await page.waitForTimeout(300);
      now = await state(page);
    }
    if (now.problem) errors.push(`${where}: ${now.problem}`);
    if (!now.title.includes('按住')) errors.push(`${where}: not told to press and hold the photo (${now.title})`);
    const src = await page.evaluate(() => document.querySelector('#result-image').src.slice(0, 5));
    if (src !== 'data:') errors.push(`${where}: the photo to press and hold is ${src}…, not the image itself`);
    const download = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
    await page.locator('#result-download').click();
    if (!(await download)) errors.push(`${where}: 下载到文件 gave no file`);
    now = await state(page);
    if (!now.title.includes('已保存')) errors.push(`${where}: after 下载到文件 the window says ${now.title}`);
  }
  await page.locator('#result-close').click();
  await waitFor(page, () => !document.querySelector('#result-dialog').open);
}

for (const name of profiles) {
  for (const mode of ['download', 'works', 'stuck', 'wechat']) {
    const at = `${engine} ${name} ${mode}`;
    const device = playwright.devices[name];
    const context = await browser.newContext({...device, acceptDownloads: true,
      userAgent: mode === 'wechat' ? device.userAgent + wechat : device.userAgent});
    if (mode === 'works' || mode === 'stuck') await context.addInitScript(fakeShare, mode);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${at} page error: ${error.message}`));
    try {
      await page.goto(server.url);
      if (!(await waitFor(page, () => window.frameAppReady === true))) throw new Error('the page script did not start');
      // 1: first photo.
      await page.setInputFiles('#file', await photo(page, '#c8784c'));
      await round(page, at, mode, 1);
      // 2: a second photo, no reload.
      await page.setInputFiles('#file', await photo(page, '#4c78c8'));
      await round(page, at, mode, 2);
      // 3: the same photo, another frame and new words.
      await page.locator('#filters button[data-category="festival"]').click();
      await page.locator('#words summary').click();
      await page.locator('#caption-text').fill('祝妈妈健康长寿');
      await page.locator('#words [data-close-sheet]').click();
      const birthday = page.locator('#frames button[data-frame="birthday"]');
      await birthday.scrollIntoViewIfNeeded();
      await birthday.click();
      await page.waitForTimeout(200);
      await round(page, at, mode, 3);
    } catch (error) {
      errors.push(`${at}: test stopped: ${String(error.message || error).split('\n').slice(0, 3).join(' ')}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: saving three times in a row works in ${engine} on ${profiles.join(', ')} (download, share, stuck share, WeChat)`);
