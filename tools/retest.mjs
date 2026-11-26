// Checks the problems an outside retest of v19 reported, on an iPhone profile, so they
// stay fixed:
// 1. Only the moment a photo was taken counts as its date (a 1976 scan too; the day a
//    file was last changed does not). A photo without one, chosen while 加日期 is on,
//    gets no date by itself: the switch shows off and the page says why. One tap prints
//    today and says so.
// 2. After a new photo, 改字's date box on 出游纪念 shows the new photo's date; a photo
//    without one leaves the box empty, and writing a date there puts it on.
// 3. A share that finishes late does not mark a newer, unsaved photo as saved, and an
//    iPhone download only says to tap 下载 in Safari's window, never that it saved.
// 4. A photo that fails to open: the page says, in sight, that the preview is still the last one.
// Needs playwright and a Chromium (see smoke.mjs); ENGINE=webkit runs it in the engine
// of iPhone and iPad Safari and iPhone WeChat.
import * as playwright from 'playwright';
import {serve} from './serve.mjs';

const server = await serve();
const engine = process.env.ENGINE || 'chromium';
const browser = await playwright[engine].launch(engine === 'chromium' ? {executablePath: process.env.CHROMIUM_PATH || undefined} : {});
const device = playwright.devices['iPhone 12'];
const failed = [];
const seen = [];

function exifBlock(taken, tag = 0x9003) {
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(tag, 28);
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

async function photo(page, color, taken, tag) {
  const data = await page.evaluate(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1200, 900);
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  }, color);
  const jpeg = Buffer.from(data, 'base64');
  const buffer = taken ? Buffer.concat([jpeg.subarray(0, 2), exifBlock(taken, tag), jpeg.subarray(2)]) : jpeg;
  return {name: 'photo.jpg', mimeType: 'image/jpeg', buffer};
}

async function waitFor(page, check, arg, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(check, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

const text = (page, selector) => page.evaluate(selector => document.querySelector(selector).textContent, selector);
const ready = page => waitFor(page, () => !document.querySelector('#bar-main').disabled
  && document.querySelector('#bar-main-text').textContent === '做好照片');

// A share sheet whose first share finishes only when the test says so.
function lateShare() {
  window.shares = 0;
  navigator.canShare = data => Boolean(data && data.files && data.files.length);
  navigator.share = () => {
    window.shares++;
    if (window.shares === 1) return new Promise(resolve => { window.finishFirstShare = resolve; });
    return Promise.resolve();
  };
}

async function newPage(init) {
  const context = await browser.newContext({...device, acceptDownloads: true});
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('pageerror', error => failed.push(`page error: ${error.message}`));
  await page.goto(server.url);
  await waitFor(page, () => window.frameAppReady === true);
  return {context, page};
}

async function chooseTrip(page) {
  await page.locator('#filters button[data-category="travel"]').click();
  const trip = page.locator('#frames button[data-frame="trip"]');
  await trip.scrollIntoViewIfNeeded();
  await trip.click();
  await page.waitForTimeout(300);
}

const state = page => page.evaluate(() => ({
  on: document.querySelector('#date-on').checked,
  hint: document.querySelector('#bar-hint').textContent,
  status: document.querySelector('#status').textContent,
}));
async function toggle(page, want) {
  await page.locator('#date-switch').click();
  if (!(await waitFor(page, want => document.getElementById('date-on').checked === want, want))) {
    failed.push(`the date switch did not turn ${want ? 'on' : 'off'}`);
  }
  await page.waitForTimeout(150);
}

// 1. Which date a photo has, and a photo without one while 加日期 is on.
{
  const {context, page} = await newPage();
  await page.setInputFiles('#file', await photo(page, '#c8784c', '2019:10:01 10:00:00'));
  await ready(page);
  await toggle(page, true);
  let now = await state(page);
  seen.push(`1 dated photo, switch on: bar says "${now.hint}"`);
  if (!now.hint.includes('2019年10月1日')) failed.push(`1: the day taken was not printed (${now.hint})`);

  await page.setInputFiles('#file', await photo(page, '#4c78c8'));
  await ready(page);
  now = await state(page);
  seen.push(`1 then a photo without a date: switch ${now.on ? 'on' : 'off'}, bar "${now.hint}", status "${now.status}"`);
  if (now.on) failed.push('1: a photo without a date shows the date switch on');
  if (!now.hint.includes('没有拍照日期')) failed.push(`1: the bar does not say the photo has no date (${now.hint})`);
  await toggle(page, true);
  now = await state(page);
  if (!now.hint.includes('今天')) failed.push(`1: turning it on for a photo without a date does not say today is used (${now.hint})`);

  // Still wanted: the next photo with a date gets it at once.
  await page.setInputFiles('#file', await photo(page, '#4cc878', '1976:05:20 09:00:00'));
  await ready(page);
  now = await state(page);
  if (!now.on) failed.push('1: a photo taken in 1976 shows the switch off');
  await toggle(page, false);
  await toggle(page, true);
  now = await state(page);
  seen.push(`1 photo taken 1976: bar "${now.hint}"`);
  if (!now.hint.includes('1976年5月20日')) failed.push(`1: the 1976 date was not read (${now.hint})`);

  // Only "last changed" (0x0132): not the day it was taken.
  await page.setInputFiles('#file', await photo(page, '#c84c78', '2025:11:20 10:00:00', 0x0132));
  await ready(page);
  now = await state(page);
  seen.push(`1 photo with only a last-changed date: switch ${now.on ? 'on' : 'off'}, bar "${now.hint}"`);
  if (now.on || !now.hint.includes('没有拍照日期')) failed.push('1: the day a file was last changed is taken as the day the photo was taken');
  await context.close();
}

// 2. 出游纪念: 2008.8.8 written, then a photo taken 2019.10.1, then one without a date.
{
  const {context, page} = await newPage();
  await page.setInputFiles('#file', await photo(page, '#c8784c'));
  await ready(page);
  await chooseTrip(page);
  if ((await state(page)).on) failed.push('2: 出游纪念 shows a date for a photo without one');
  await page.locator('#words summary').click();
  const row = await page.locator('#caption-date').isVisible();
  if (!row) failed.push('2: 出游纪念 offers no date box for a photo without a date');
  else {
    await page.locator('#caption-date').fill('2008.8.8');
    if (!(await state(page)).on) failed.push('2: writing a date on 出游纪念 does not turn the date on');
  }
  await page.locator('#words [data-close-sheet]').click();
  await page.setInputFiles('#file', await photo(page, '#4c78c8', '2019:10:01 10:00:00'));
  await ready(page);
  await page.locator('#words summary').click();
  const box = await page.locator('#caption-date').inputValue();
  seen.push(`2 wrote 2008.8.8, new photo taken 2019.10.1: 改字 date box shows "${box}"`);
  if (!(await state(page)).on) failed.push('2: 出游纪念 does not show the day a photo was taken by default');
  if (box !== '2019.10.1') failed.push(`2: 改字 shows ${box} after a photo taken 2019.10.1`);
  await page.locator('#words [data-close-sheet]').click();
  await page.setInputFiles('#file', await photo(page, '#4cc878'));
  await ready(page);
  await page.locator('#words summary').click();
  const empty = await page.locator('#caption-date').inputValue();
  if (empty !== '') failed.push(`2: 改字 shows ${empty} for a photo without a date`);
  await context.close();
}

// 3. First photo shared, the share answers only after a second photo is made.
{
  const {context, page} = await newPage(lateShare);
  await page.setInputFiles('#file', await photo(page, '#c8784c'));
  await ready(page);
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  await page.locator('#share').click();
  await page.waitForTimeout(200);
  await page.locator('#result-close').click();
  await page.setInputFiles('#file', await photo(page, '#4c78c8'));
  await ready(page);
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  const fresh = await text(page, '#result-title');
  await page.evaluate(() => window.finishFirstShare());
  await page.waitForTimeout(300);
  const late = await text(page, '#result-title');
  seen.push(`3 second photo made, unsaved: "${fresh}"; after the first share answers late: "${late}"`);
  if (/已保存|好了/.test(late)) failed.push('3: a late share answer marks the second, unsaved photo as saved');
  await context.close();
}

// 3. iPhone download: Safari asks once more and never tells the page the answer.
{
  const {context, page} = await newPage();
  await page.setInputFiles('#file', await photo(page, '#c8784c'));
  await ready(page);
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  const download = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
  await page.locator('#result-download').click();
  if (!(await download)) failed.push('3: 下载 gave no file');
  const title = await text(page, '#result-title');
  const lead = await text(page, '#result-lead');
  seen.push(`3 iPhone download: "${title}" / "${lead}"`);
  if (title.includes('已保存') || !title.includes('下载')) failed.push(`3: after tapping 下载 on iPhone the window says ${title}`);
  await page.locator('#result-close').click();
  await waitFor(page, () => !document.querySelector('#result-dialog').open);
  const hint = await text(page, '#bar-hint');
  if (hint.includes('已保存') || hint.includes('还没存好')) failed.push(`3: the bar guesses whether the download was kept (${hint})`);
  await context.close();
}

// 4. A photo opens, then a file that is not a picture.
{
  const {context, page} = await newPage();
  await page.setInputFiles('#file', await photo(page, '#c8784c'));
  await ready(page);
  await page.setInputFiles('#file', {name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a picture at all')});
  await waitFor(page, () => !document.querySelector('#bar-main').disabled);
  await page.waitForTimeout(300);
  const main = await text(page, '#bar-main-text');
  const hint = await text(page, '#bar-hint');
  seen.push(`4 broken second photo: bar button "${main}", bar says "${hint}"`);
  if (!hint.includes('上一张')) failed.push(`4: the bar does not say the preview is still the last photo (${hint})`);
  await context.close();
}

await browser.close();
server.close();
console.log(`${engine}:\n${seen.join('\n')}`);
if (failed.length) {
  console.error(`Failed:\n${failed.join('\n')}`);
  process.exit(1);
}
console.log(`OK (${engine}): photo dates, 改字 date, save state and a photo that does not open behave as the retest asked`);
