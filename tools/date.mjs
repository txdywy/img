// The date switch (加日期) and the date it prints on the frame:
// - the switch shows only once one's own photo is in, beside 点一下，换相框, off by default;
// - one tap prints the day the photo was taken (from its EXIF data) in the bottom border,
//   and the bar says which day; a photo without one gets today, and the bar says so;
// - turning it on or off never moves the preview box, the categories or the frames,
//   never changes the picture's size, and leaves the photo itself untouched;
// - 出游纪念 still shows a date before anyone touches the switch, and the switch says so;
//   once turned off, no frame shows one;
// - the switch stays on one line and nothing scrolls sideways, on small phones, with
//   large text, on tablets and on computers; the saved JPG carries the date.
// Needs playwright and a Chromium (see smoke.mjs); ENGINE=webkit runs it in the engine
// of iPhone and iPad Safari and iPhone WeChat instead.
import * as playwright from 'playwright';
import {serve} from './serve.mjs';

const server = await serve();
const engine = process.env.ENGINE || 'chromium';
const browser = await playwright[engine].launch(engine === 'chromium' ? {executablePath: process.env.CHROMIUM_PATH || undefined} : {});
const errors = [];

const setups = [
  {name: '320x568', viewport: {width: 320, height: 568}, phone: true},
  {name: '390x844', viewport: {width: 390, height: 844}, phone: true},
  {name: '390x844-text200', viewport: {width: 390, height: 844}, phone: true, font: 32},
  {name: 'ipad-768x1024', viewport: {width: 768, height: 1024}, touch: true},
  {name: 'desktop-1280x800', viewport: {width: 1280, height: 800}},
];

// A little-endian TIFF block holding only DateTimeOriginal, as cameras write it.
function exifBlock(taken) {
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); // IFD0: one entry, the Exif IFD pointer
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26); // Exif IFD: DateTimeOriginal
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.writeUInt32LE(0, 40);
  tiff.write(`${taken}\0`, 44, 'latin1');
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

// A plain JPG drawn in the page; with taken, an APP1 EXIF segment right after SOI.
async function makePhoto(page, taken) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6b8fb3';
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#e0b070';
    for (let i = 0; i < 5; i++) ctx.fillRect(140 + i * 200, 380, 120, 300);
    return canvas.toDataURL('image/jpeg', .9);
  });
  const jpeg = Buffer.from(data.split(',')[1], 'base64');
  const buffer = taken ? Buffer.concat([jpeg.subarray(0, 2), exifBlock(taken), jpeg.subarray(2)]) : jpeg;
  return {name: taken ? 'dated.jpg' : 'plain.jpg', mimeType: 'image/jpeg', buffer};
}

async function open(setup) {
  const page = await browser.newPage({
    viewport: setup.viewport, acceptDownloads: true,
    hasTouch: Boolean(setup.phone || setup.touch), isMobile: Boolean(setup.phone) && engine === 'chromium',
  });
  const at = `${engine} ${setup.name}`;
  page.on('console', message => message.type() === 'error' && errors.push(`${at} console: ${message.text()}`));
  page.on('pageerror', error => errors.push(`${at} page: ${error.message}`));
  if (setup.font && engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', {fontSizes: {standard: setup.font, fixed: Math.round(setup.font * .8)}});
  }
  await page.goto(server.url);
  await page.locator('#preview').waitFor({state: 'visible'});
  return page;
}

async function waitFor(page, check, arg, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(check, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// Waits until smooth scrolling and the redraw are over.
const settle = page => page.evaluate(() => new Promise(resolve => {
  let last = -1;
  let still = 0;
  const check = () => {
    const now = window.scrollY;
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 6) setTimeout(resolve, 60);
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}));

// Where things are, and what the preview shows: its size, the middle of the photo
// and the middle of the bottom border (as average colours).
const snapshot = page => page.evaluate(() => {
  const rect = id => {
    const box = document.getElementById(id).getBoundingClientRect();
    return [box.x, box.y, box.width, box.height].map(Math.round).join(',');
  };
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d');
  const average = (x, y, w, h) => {
    const data = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return Math.round(sum / (data.length / 4));
  };
  const short = Math.min(canvas.width, canvas.height);
  const border = short * .1;
  return {
    stage: rect('stage'), filters: rect('filters'), frames: rect('frames'), size: `${canvas.width}x${canvas.height}`,
    photo: average(canvas.width * .3, canvas.height * .35, canvas.width * .4, canvas.height * .2),
    bottom: average(canvas.width * .4, canvas.height - border * .8, canvas.width * .2, border * .6),
    hint: document.getElementById('bar-hint').textContent, status: document.getElementById('status').textContent,
    on: document.getElementById('date-on').checked,
  };
});

async function check(setup) {
  const at = `${engine} ${setup.name}`;
  const page = await open(setup);
  const toggle = page.locator('#date-switch');
  if (await toggle.isVisible()) errors.push(`${at}: the date switch shows before a photo is chosen`);

  await page.setInputFiles('#file', await makePhoto(page, '2023:10:03 08:12:44'));
  await page.locator('#save:not([disabled])').waitFor({state: 'attached'});
  await settle(page);
  if (!(await toggle.isVisible())) {
    errors.push(`${at}: no date switch after choosing a photo`);
    await page.close();
    return;
  }
  // Tapping scrolls the switch into view first, as a finger would need it in sight; do
  // that before measuring, so only what the switch itself does is compared.
  await toggle.scrollIntoViewIfNeeded();
  await settle(page);
  // The first frame (全家福) has no date until the switch is turned on.
  const before = await snapshot(page);
  if (before.on) errors.push(`${at}: the date switch starts on`);

  const box = await toggle.boundingBox();
  // 加日期 stays on one line (the pill itself is at least a finger tall, so its height says nothing).
  const lines = await toggle.evaluate(el => {
    const words = el.lastElementChild;
    return Math.round(words.getBoundingClientRect().height / (parseFloat(getComputedStyle(words).fontSize) * 1.2));
  });
  if (lines > 1) errors.push(`${at}: 加日期 wraps onto ${lines} lines`);
  // The heading and the switch share one line, so the frames are not pushed down.
  const sameLine = await page.evaluate(() => {
    const title = document.getElementById('frame-title').getBoundingClientRect();
    const pill = document.getElementById('date-switch').getBoundingClientRect();
    return pill.top < title.top + title.height / 2;
  });
  if (!sameLine && !setup.font) errors.push(`${at}: the date switch fell below the heading`);
  if (box.height < 44 || box.width < 44) errors.push(`${at}: the date switch is too small to tap (${Math.round(box.width)}x${Math.round(box.height)})`);
  const title = await page.locator('#frame-title').boundingBox();
  const overlap = !(box.x >= title.x + title.width || box.x + box.width <= title.x || box.y >= title.y + title.height || box.y + box.height <= title.y);
  if (overlap) errors.push(`${at}: the date switch covers 点一下，换相框`);

  await toggle.click();
  await waitFor(page, () => document.getElementById('date-on').checked);
  await settle(page);
  const on = await snapshot(page);
  for (const part of ['stage', 'filters', 'frames', 'size']) {
    if (on[part] !== before[part]) errors.push(`${at}: turning the date on moved or resized ${part} (${before[part]} -> ${on[part]})`);
  }
  if (on.photo !== before.photo) errors.push(`${at}: turning the date on changed the photo itself`);
  if (on.bottom === before.bottom) errors.push(`${at}: no date appeared in the bottom border`);
  const said = setup.phone ? on.hint : on.status;
  if (!said.includes('2023年10月3日')) errors.push(`${at}: the page did not say which day was printed (${JSON.stringify(said)})`);

  // The same date follows to the next frame.
  const second = page.locator('#frames button[data-frame]').nth(1);
  await second.click();
  await settle(page);
  if (!(await page.locator('#date-on').isChecked())) errors.push(`${at}: the date switch turned off when the frame changed`);

  // Off again: the border is as it was on the first frame.
  await page.locator('#frames button[data-frame]').first().click();
  await toggle.click();
  await waitFor(page, () => !document.getElementById('date-on').checked);
  await settle(page);
  const off = await snapshot(page);
  if (off.bottom !== before.bottom) errors.push(`${at}: turning the date off left something in the bottom border`);
  if (off.stage !== before.stage) errors.push(`${at}: turning the date off moved the preview`);

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sideways > 0) errors.push(`${at}: the page scrolls sideways by ${sideways}px`);
  await page.close();
}

// 出游纪念 and a photo without a date, on one phone.
async function travel() {
  const at = `${engine} travel`;
  // No touch screen, so 做好照片 opens the finished picture instead of downloading it.
  const page = await open({viewport: {width: 390, height: 844}});
  await page.setInputFiles('#file', await makePhoto(page, ''));
  await page.locator('#save:not([disabled])').waitFor({state: 'attached'});
  await settle(page);
  await page.locator('#frames button[data-frame="trip"]').click();
  await settle(page);
  if (!(await page.locator('#date-on').isChecked())) errors.push(`${at}: 出游纪念 no longer shows its date by default`);
  const label = await page.locator('#preview').getAttribute('aria-label');
  if (!label.includes('出游纪念')) errors.push(`${at}: 出游纪念 was not chosen (${label})`);
  // Turning it off here turns it off everywhere; on again says today is used.
  await page.locator('#date-switch').click();
  await settle(page);
  if (await page.locator('#date-on').isChecked()) errors.push(`${at}: the switch did not turn off on 出游纪念`);
  await page.locator('#date-switch').click();
  await settle(page);
  const hint = await page.locator('#bar-hint').textContent();
  if (!hint.includes('今天')) errors.push(`${at}: a photo without a date did not say today is used (${JSON.stringify(hint)})`);

  // The saved picture carries the date: make it on 全家福 and compare its bottom border
  // with and without (the frame keeps its size, so the same pixels are compared).
  await page.locator('#frames button[data-frame="family"]').click();
  await settle(page);
  const bottomOfResult = async () => {
    // Wait for this picture, not the one made before it.
    const before = await page.locator('#result-image').getAttribute('src');
    await page.locator('#bar-main').click();
    await page.waitForFunction(previous => {
      const img = document.getElementById('result-image');
      const src = img.getAttribute('src');
      return src && src !== previous && img.complete && img.naturalWidth > 0;
    }, before, {timeout: 15000});
    const value = await page.evaluate(() => new Promise(resolve => {
      const img = document.getElementById('result-image');
      const done = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const border = Math.min(canvas.width, canvas.height) * .1;
        const data = ctx.getImageData(canvas.width * .2, canvas.height - border * .85, canvas.width * .6, border * .7).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 400) dark++;
        resolve(dark);
      };
      if (img.complete && img.naturalWidth) done();
      else img.onload = done;
    }));
    // 返回, as people close it (Escape does not reach the dialog in WebKit here).
    await page.locator('#result-close').click();
    await waitFor(page, () => !document.querySelector('#result-dialog').open);
    await settle(page);
    return value;
  };
  if (await page.locator('#bar-main').isVisible()) {
    const withDate = await bottomOfResult();
    await page.locator('#date-switch').click();
    await settle(page);
    const without = await bottomOfResult();
    if (!(withDate > without)) errors.push(`${at}: the saved picture has no date in its bottom border (${withDate} vs ${without})`);
  }
  await page.close();
}

try {
  for (const setup of setups) {
    if (setup.font && engine !== 'chromium') continue;
    await check(setup);
  }
  await travel();
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK (${engine}): date switch shows after a photo, prints the day it was taken, moves nothing, and follows every frame`);
