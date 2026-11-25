// Layout and flow checks from the elder-friendly user review, on small, normal and
// large-text phones, zoomed pages, tablets and computers:
// - after choosing a photo, a whole frame card shows between the pinned preview and the bottom bar;
// - tapping a category shows that category's frames (the words box no longer pushes them away);
// - saving says "已保存" on the page afterwards;
// - the adjust and words sheets close with Back, Esc or a tap outside, and their button stays in sight;
// - an unreadable photo gives one short sentence and one way on, not a wall of text;
// - category chips have visible outlines; nothing wraps in the bottom bar or scrolls sideways;
// - tablets and computers keep the preview and the save button in sight while picking frames.
// Set SHOT_DIR to save screenshots. Needs playwright and a Chromium (see smoke.mjs).
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {serve} from './serve.mjs';

const server = await serve();
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
const shots = process.env.SHOT_DIR;
if (shots) await mkdir(shots, {recursive: true});
const errors = [];
const notes = [];
const festival = ['longevity', 'red', 'lantern', 'moon', 'lantern-blue', 'birthday', 'double-happiness', 'silk'];

// iPadOS says it is a Mac; app.js tells it apart by its touch points.
const ipadUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const androidTabletUA = 'Mozilla/5.0 (Linux; Android 12; HUAWEI MatePad) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const phones = [
  {name: '320x568', viewport: {width: 320, height: 568}},
  // An older Android phone: its browser must open the photo album, not a file manager.
  {name: '360x780-android8', viewport: {width: 360, height: 780}, android: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 8.1.0; vivo Y83A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Mobile Safari/537.36'},
  {name: '375x667-se', viewport: {width: 375, height: 667}},
  {name: '390x844', viewport: {width: 390, height: 844}},
  {name: '390x844-text150', viewport: {width: 390, height: 844}, font: 24},
  {name: '390x844-text200', viewport: {width: 390, height: 844}, font: 32},
  // Browser zoom shrinks the CSS viewport: 150% of a 390x844 phone is 260x562.
  {name: '390x844-zoom150', viewport: {width: 260, height: 562}, scale: 3},
  {name: '390x844-zoom200', viewport: {width: 195, height: 422}, scale: 4, tiny: true},
];
const wide = [
  {name: 'ipad-768x1024', viewport: {width: 768, height: 1024}, touch: true, userAgent: ipadUA},
  {name: 'ipad-1024x768-landscape', viewport: {width: 1024, height: 768}, touch: true, userAgent: ipadUA},
  {name: 'tablet-820x1180', viewport: {width: 820, height: 1180}, touch: true},
  {name: 'android-tablet-800x1280', viewport: {width: 800, height: 1280}, touch: true, userAgent: androidTabletUA},
  {name: 'android-tablet-1280x800-landscape', viewport: {width: 1280, height: 800}, touch: true, userAgent: androidTabletUA},
  {name: 'desktop-1280x800', viewport: {width: 1280, height: 800}},
  {name: 'desktop-1440x900', viewport: {width: 1440, height: 900}},
];

async function open(setup) {
  const page = await browser.newPage({
    viewport: setup.viewport, deviceScaleFactor: setup.scale || 2, acceptDownloads: true,
    hasTouch: Boolean(setup.phone || setup.touch), isMobile: Boolean(setup.phone),
    ...(setup.userAgent ? {userAgent: setup.userAgent} : {}),
  });
  const at = setup.name;
  page.on('console', message => message.type() === 'error' && errors.push(`${at} console: ${message.text()}`));
  page.on('pageerror', error => errors.push(`${at} page: ${error.message}`));
  page.on('response', response => response.status() >= 400 && errors.push(`${at} ${response.status()} ${response.url()}`));
  if (setup.font) {
    // Like the phone's own "large text" setting: changes rem and rem-based media queries.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', {fontSizes: {standard: setup.font, fixed: Math.round(setup.font * .8)}});
  }
  if (setup.userAgent && /Macintosh/.test(setup.userAgent)) {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {get: () => 5}));
  }
  await page.goto(server.url);
  await page.locator('#preview').waitFor({state: 'visible'});
  return page;
}

// Waits until the page has stopped moving: the page glides (smooth scrolling) to
// show the frames after a photo or a category, so measure only once it is still.
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

async function waitFor(page, check, arg, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(check, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

const shoot = (page, setup, step) => shots && page.screenshot({path: join(shots, `${setup.name}-${step}.png`)});

// Test photos drawn in the page: people-like dots so crops are easy to see.
async function makePhoto(page, width, height, name) {
  const data = await page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#d9734e');
    gradient.addColorStop(1, '#3d6fa8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f3e3b5';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(w * (i + .5) / 7, h * .55, Math.min(w / 18, h * .2), 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  }, [width, height]);
  return {name, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64')};
}

const fakeHeic = {
  name: 'IMG_0001.heic', mimeType: 'image/heic',
  buffer: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(200, 7)]),
};

// Frame cards wholly between the pinned preview and the bottom bar.
function cardsInView() {
  const dock = document.querySelector('#dock');
  const pinned = getComputedStyle(dock).position === 'sticky';
  const top = pinned ? Math.max(0, dock.getBoundingClientRect().bottom) : 0;
  const bar = document.querySelector('#bar');
  const bottom = getComputedStyle(bar).display === 'none' ? window.innerHeight : bar.getBoundingClientRect().top;
  return [...document.querySelectorAll('#frames button[data-frame]')].filter(card => {
    const r = card.getBoundingClientRect();
    return r.height > 0 && r.top >= top - 1 && r.bottom <= bottom + 1;
  }).map(card => card.dataset.frame);
}

async function importPhoto(page, file) {
  await page.setInputFiles('#file', file);
  const ok = await waitFor(page, () => ['保存照片', '做好照片'].includes(document.querySelector('#bar-main-text').textContent)
    && !document.querySelector('#save').disabled && !document.querySelector('#bar-main').disabled);
  await settle(page);
  return ok;
}

async function commonChecks(page, at) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sideways > 0) errors.push(`${at}: the page scrolls sideways by ${sideways}px`);
  const small = await page.evaluate(() => [...document.querySelectorAll('button, summary, a.button')]
    .filter(el => el.offsetParent && !el.closest('dialog, .skip, [hidden], details:not([open]) > :not(summary)'))
    .filter(el => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; })
    .map(el => el.textContent.trim() || el.id));
  if (small.length) errors.push(`${at}: tap targets under 44px: ${small.join(', ')}`);
  // The category chips must look like buttons: an outline of at least 3:1 against the page.
  const contrast = await page.evaluate(() => {
    const parse = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = rgb => {
      const [r, g, b] = rgb.map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const chip = document.querySelector('#filters button[aria-pressed="false"]');
    const a = lum(parse(getComputedStyle(chip).borderTopColor));
    const b = lum(parse(getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'
      ? getComputedStyle(document.documentElement).backgroundColor : getComputedStyle(document.body).backgroundColor));
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  if (contrast < 3) errors.push(`${at}: category chip outline contrast is ${contrast.toFixed(2)}:1, under 3:1`);
}

async function phoneFlow(setup, photos) {
  const at = setup.name;
  const page = await open({...setup, phone: true});
  // Before a photo: no adjust or enlarge for the sample, one clear button.
  if (await page.locator('#dock-tools').isVisible()) errors.push(`${at}: adjust/enlarge show before a photo is chosen`);
  // Review 5: people who treasure an old photo read that it stays untouched before they tap.
  const reassure = await page.locator('#bar-hint').innerText();
  if (!reassure.includes('原照片还在')) errors.push(`${at}: the bar does not say the original photo stays (${reassure})`);
  if (setup.android) {
    const accept = await page.locator('#file').getAttribute('accept');
    if (accept !== 'image/*') errors.push(`${at}: Android photo picker asks for ${accept}, which opens a file manager on many phones`);
  }
  await shoot(page, setup, '1-start');
  if (!(await importPhoto(page, photos.landscape))) errors.push(`${at}: the photo did not open`);

  // 1. A whole row of frames is visible under the preview right after choosing a photo.
  let seen = await page.evaluate(cardsInView);
  // Short or zoomed screens don't pin the preview; there the list is scrolled to instead.
  const pinned = await page.evaluate(() => getComputedStyle(document.querySelector('#dock')).position === 'sticky');
  const tiny = setup.tiny || !pinned;
  if (!tiny && !seen.length) {
    const info = await page.evaluate(() => ({
      stage: document.querySelector('#stage').offsetHeight, dock: document.querySelector('#dock').getBoundingClientRect().bottom,
      bar: document.querySelector('#bar').getBoundingClientRect().top, card: document.querySelector('#frames button')?.getBoundingClientRect().toJSON(),
    }));
    errors.push(`${at}: no whole frame card in view after choosing a photo ${JSON.stringify(info)}`);
  }
  if (tiny) {
    // Very zoomed pages: once the list is scrolled up to the preview (or the top), a whole card fits.
    await page.evaluate(pinned => {
      const grid = document.querySelector('#frames').getBoundingClientRect();
      window.scrollBy(0, grid.top - (pinned ? document.querySelector('#dock').getBoundingClientRect().bottom : 0));
    }, pinned);
    await settle(page);
    if (!(await page.evaluate(cardsInView)).length) errors.push(`${at}: no whole frame card fits between preview and bar`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  notes.push(`${at}: stage ${await page.evaluate(() => document.querySelector('#stage').offsetHeight)}px, ${seen.length} cards in view`);
  await shoot(page, setup, '2-picked');

  // Nothing in the bottom bar wraps onto a second line.
  const wrapped = await page.evaluate(() => ['#bar-main-text', '#bar-pick'].map(id => document.querySelector(id))
    .filter(el => el && el.offsetParent)
    .filter(el => {
      const style = getComputedStyle(el);
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.35;
      const box = el.id === 'bar-pick' ? el.querySelector('span') || el : el;
      const range = document.createRange();
      range.selectNodeContents(box);
      const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
      return lines.size > 1 || el.scrollWidth > el.clientWidth + 1 || (el.id !== 'bar-pick' && el.getBoundingClientRect().height > line * 1.6);
    }).map(el => el.textContent.trim()));
  if (wrapped.length) errors.push(`${at}: bottom bar text wraps: ${wrapped.join(', ')}`);

  // 2. Tapping 节庆 shows 节庆 frames, and the words box stays out of the way.
  await page.locator('#filters button[data-category="festival"]').click();
  await settle(page);
  seen = await page.evaluate(cardsInView);
  if (!seen.some(id => festival.includes(id))) errors.push(`${at}: after tapping 节庆 no 节庆 frame is in view (${seen.join(', ')})`);
  if (await page.locator('#caption-text').isVisible()) errors.push(`${at}: the words box opened by itself`);
  if (!(await page.locator('#words summary').isVisible())) errors.push(`${at}: no 改字 button on a frame with words`);
  await shoot(page, setup, '3-festival');

  // Words sheet: its button stays in sight; Esc closes it.
  await page.locator('#words summary').click();
  await page.locator('#caption-text').waitFor({state: 'visible'});
  await page.locator('#caption-text').fill('身体健康');
  const wordsDone = await page.locator('#words [data-close-sheet]').boundingBox();
  if (!wordsDone || wordsDone.y < 0 || wordsDone.y + wordsDone.height > setup.viewport.height + 1) {
    errors.push(`${at}: 写好了 is off screen in the words sheet`);
  }
  await shoot(page, setup, '4-words');
  await page.keyboard.press('Escape');
  if (!(await waitFor(page, () => !document.querySelector('#words').open))) errors.push(`${at}: Esc did not close the words sheet`);
  // Review 2: the blessing someone typed stays when they try the 生日快乐 frame, and comes back with the first one.
  const birthday = page.locator('#frames button[data-frame="birthday"]');
  await birthday.scrollIntoViewIfNeeded();
  await birthday.click();
  await settle(page);
  let words = await page.locator('#caption-text').inputValue();
  if (words !== '身体健康') errors.push(`${at}: switching to 生日快乐 replaced the typed blessing with ${JSON.stringify(words)}`);
  const first = page.locator('#frames button[data-frame="longevity"]');
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await settle(page);
  words = await page.locator('#caption-text').inputValue();
  if (words !== '身体健康') errors.push(`${at}: back on the first frame the blessing is ${JSON.stringify(words)}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);

  // Review 3: 看大图 shows the photo bigger than the page does, can zoom in, and has a way back in sight.
  if (!setup.tiny) {
    const small = await page.evaluate(() => document.querySelector('#preview').getBoundingClientRect().width);
    await page.locator('#dock-view').click();
    await page.locator('#frame-dialog').waitFor({state: 'visible'});
    await settle(page);
    const big = await page.evaluate(() => document.querySelector('#frame-preview').getBoundingClientRect().width);
    if (big < small || big < setup.viewport.width * .9) errors.push(`${at}: 看大图 is ${Math.round(big)}px wide, the page preview ${Math.round(small)}px, screen ${setup.viewport.width}px`);
    const back = await page.locator('#frame-dialog form .button').boundingBox();
    if (!back || back.y < 0 || back.y + back.height > setup.viewport.height + 1) errors.push(`${at}: 返回挑相框 is off screen in 看大图`);
    await shoot(page, setup, '4b-big');
    await page.locator('#zoom-toggle').click();
    await settle(page);
    const zoom = await page.evaluate(() => {
      const view = document.querySelector('#zoom-view');
      return {canvas: document.querySelector('#frame-preview').getBoundingClientRect().width, scrolls: view.scrollWidth > view.clientWidth};
    });
    if (zoom.canvas < big * 1.5 || !zoom.scrolls) errors.push(`${at}: 放大看清楚 does not zoom in (${JSON.stringify(zoom)})`);
    await shoot(page, setup, '4c-zoomed');
    await page.locator('#frame-preview').click({position: {x: 30, y: 30}});
    await settle(page);
    if (await page.evaluate(() => document.querySelector('#zoom-view').classList.contains('zoomed'))) errors.push(`${at}: a tap on the zoomed photo does not go back to the whole photo`);
    await page.goBack();
    if (!(await waitFor(page, () => !document.querySelector('#frame-dialog').open))) errors.push(`${at}: Back did not close 看大图`);
    await settle(page);
  }

  // 4. Adjust sheet: simple choices, a clear crop warning, 调好了 in sight, Back closes it.
  await page.locator('#filters button[data-category="all"]').click();
  await page.locator('#adjust summary').click();
  await page.locator('#ratio-choices [data-ratio="1"]').click();
  await page.locator('#fit-choices [data-fit="cover"]').click();
  await settle(page);
  const note = await page.locator('#crop-note').isVisible() ? await page.locator('#crop-note').innerText() : '';
  if (!note.includes('左右')) errors.push(`${at}: no warning that the sides were cut off (${JSON.stringify(note)})`);
  const done = await page.locator('#adjust [data-close-sheet]').boundingBox();
  if (!done || done.y < 0 || done.y + done.height > setup.viewport.height + 1) errors.push(`${at}: 调好了 is off screen in the adjust sheet`);
  const sheet = await page.evaluate(() => {
    const small = [...document.querySelectorAll('#adjust .sheet-body button')].filter(el => el.offsetParent && !el.closest('[hidden]'))
      .filter(el => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map(el => el.textContent.trim());
    const width = name => document.querySelector(`#ratio-choices .shape-${name}`).getBoundingClientRect().width;
    return {small, square: width('square'), wide: width('wide')};
  });
  if (sheet.small.length) errors.push(`${at}: tap targets under 44px in the adjust sheet: ${sheet.small.join(', ')}`);
  if (sheet.wide <= sheet.square) errors.push(`${at}: the shape icons all look the same`);
  await shoot(page, setup, '5-adjust');
  const before = page.url();
  await page.goBack();
  await settle(page);
  if (page.url() !== before || !(await page.locator('#preview').count())) errors.push(`${at}: Back left the page instead of closing the sheet`);
  else if (await page.evaluate(() => document.querySelector('#adjust').open)) errors.push(`${at}: Back did not close the adjust sheet`);
  // A tap outside the sheet closes it too.
  await page.locator('#adjust summary').click();
  await page.locator('#reset').click();
  const gap = await page.evaluate(() => {
    const dock = document.querySelector('#dock').getBoundingClientRect().bottom;
    const sheet = document.querySelector('#adjust .sheet-body').getBoundingClientRect().top;
    return sheet - dock > 12 ? {x: 20, y: Math.round((dock + sheet) / 2)} : null;
  });
  if (gap) {
    await page.mouse.click(gap.x, gap.y);
    if (!(await waitFor(page, () => !document.querySelector('#adjust').open))) errors.push(`${at}: a tap outside did not close the adjust sheet`);
  } else {
    await page.keyboard.press('Escape');
  }
  await settle(page);

  // 3. Saving: Android phones download at once, and the page says it is saved afterwards.
  const download = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  const file = await download;
  if (!file) errors.push(`${at}: 保存照片 did not download straight away`);
  else {
    const bytes = await readFile(await file.path());
    if (bytes.length < 10_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) errors.push(`${at}: download is not a JPG`);
  }
  const lead = await page.locator('#result-lead').innerText();
  if (!lead.includes('已存到')) errors.push(`${at}: the result window does not say where the photo went (${lead})`);
  const title = await page.locator('#result-title').innerText();
  if (!title.includes('已保存')) errors.push(`${at}: after saving, the window title says ${title}`);
  await shoot(page, setup, '6-saved-window');
  // Back closes the result window too.
  await page.goBack();
  if (!(await waitFor(page, () => !document.querySelector('#result-dialog').open))) errors.push(`${at}: Back did not close the result window`);
  await settle(page);
  const hint = await page.locator('#bar-hint').innerText();
  if (!hint.includes('已保存')) errors.push(`${at}: no 已保存 note after saving (${hint})`);
  await shoot(page, setup, '7-saved');
  const other = page.locator('#frames button[aria-pressed="false"]').first();
  await other.scrollIntoViewIfNeeded();
  await other.click();
  if (!(await waitFor(page, () => !document.querySelector('#bar-hint').textContent.includes('已保存')))) {
    errors.push(`${at}: 已保存 stays after changing the frame`);
  }

  // 7. An unreadable file: one sentence, one way on, how-to folded away.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setInputFiles('#file', fakeHeic);
  await page.locator('#status.error').waitFor({state: 'visible'});
  await settle(page);
  const problem = await page.evaluate(() => {
    const status = document.querySelector('#status');
    const line = parseFloat(getComputedStyle(status).lineHeight) || 28;
    return {
      text: status.textContent, lines: Math.round(status.getBoundingClientRect().height / line),
      bar: document.querySelector('#bar-hint').textContent, barError: document.querySelector('#bar-hint').classList.contains('error'),
      help: Boolean(document.querySelector('#status-help').offsetParent), retry: document.querySelectorAll('#retry-photo').length,
    };
  });
  if (problem.text.length > 14 || problem.lines > 2) errors.push(`${at}: error message is too long (${problem.text})`);
  if (!problem.help) errors.push(`${at}: no 怎么办？ for the error`);
  if (problem.bar !== problem.text.replace(/。$/, '') && problem.bar !== problem.text) errors.push(`${at}: bar says ${problem.bar} but the error is ${problem.text}`);
  if (!problem.barError) errors.push(`${at}: the bar does not show the error`);
  if (problem.retry) errors.push(`${at}: a second 换照片 button is shown`);
  if (!tiny && !(await page.evaluate(cardsInView)).length) errors.push(`${at}: the error pushed every frame card out of view`);
  await shoot(page, setup, '8-error');

  // 1e. A panorama gets a shorter preview box, not empty space.
  await importPhoto(page, photos.panorama);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const pano = await page.evaluate(() => {
    const stage = document.querySelector('#stage');
    const style = getComputedStyle(stage);
    const preview = document.querySelector('#preview');
    const inner = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const natural = inner * preview.height / preview.width + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {height: stage.clientHeight, natural, min: 7 * rem};
  });
  if (pano.height > Math.max(pano.natural, pano.min) + 2) errors.push(`${at}: panorama preview box is ${pano.height}px, photo needs ${Math.round(pano.natural)}px`);
  await shoot(page, setup, '9-panorama');
  await commonChecks(page, at);
  await page.close();
}

async function wideFlow(setup, photos) {
  const at = setup.name;
  const page = await open(setup);
  if (!(await importPhoto(page, photos.portrait))) errors.push(`${at}: the photo did not open`);
  await settle(page);
  if (!(await page.evaluate(() => document.querySelector('.photo-panel').classList.contains('stick')))) {
    errors.push(`${at}: the photo column does not stay in view`);
  }
  const columns = await page.evaluate(() => {
    const a = document.querySelector('.photo-panel').getBoundingClientRect();
    const b = document.querySelector('.frames-panel').getBoundingClientRect();
    return a.right <= b.left + 1;
  });
  if (!columns) errors.push(`${at}: photo and frames are not side by side`);
  await page.locator('#more').click();
  const far = page.locator('#frames button[data-frame]').nth(30);
  await far.scrollIntoViewIfNeeded();
  await far.click();
  await settle(page);
  for (const id of ['#preview', '#save']) {
    const box = await page.locator(id).boundingBox();
    if (!box || box.y < 0 || box.y + box.height > setup.viewport.height) errors.push(`${at}: ${id} left the screen while picking a frame far down`);
  }
  await shoot(page, setup, '1-picking');
  await page.locator('#filters button[data-category="festival"]').click();
  await settle(page);
  if (await page.locator('#caption-text').isVisible()) errors.push(`${at}: the words box opened by itself`);
  if (!(await page.evaluate(cardsInView)).some(id => festival.includes(id))) errors.push(`${at}: no 节庆 frame in view after tapping 节庆`);
  await page.locator('#save').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  // Review 1: the window does not say the photo is done before it is saved.
  let title = await page.locator('#result-title').innerText();
  if (!title.includes('还差一步')) errors.push(`${at}: before saving, the window title says ${title}`);
  const download = page.waitForEvent('download');
  await page.locator('#result-download').click();
  await download;
  title = await page.locator('#result-title').innerText();
  if (!title.includes('已保存')) errors.push(`${at}: after saving, the window title says ${title}`);
  await page.locator('#result-close').click();
  await settle(page);
  const hint = await page.locator('#save-hint').innerText();
  if (!hint.includes('已保存')) errors.push(`${at}: no 已保存 note after saving (${hint})`);
  await shoot(page, setup, '2-saved');
  await commonChecks(page, at);
  await page.close();
}

// iPhone (Chromium with an iPhone's name; tools/webkit.mjs runs the real engine in CI):
// the first tap makes the photo and says one step is left, closing early leaves a
// note, and the second tap saves.
async function iPhoneFlow(setup, photos) {
  const at = setup.name;
  const page = await open({...setup, phone: true, userAgent: iphoneUA});
  if (!(await importPhoto(page, photos.portrait))) errors.push(`${at}: the photo did not open`);
  const label = await page.locator('#bar-main-text').innerText();
  if (label !== '做好照片') errors.push(`${at}: the bar button promises ${label} though one more tap is needed`);
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  await settle(page);
  const title = await page.locator('#result-title').innerText();
  if (!title.includes('还差一步')) errors.push(`${at}: the window says ${title} before anything is saved`);
  if (downloaded) errors.push(`${at}: a download started without the second tap`);
  for (const id of ['#result-download', '#result-close']) {
    const box = await page.locator(id).boundingBox();
    if (!box || box.y + box.height > setup.viewport.height + 1) errors.push(`${at}: ${id} is off screen in the result window`);
  }
  await shoot(page, setup, '1-made');
  await page.locator('#result-close').click();
  await settle(page);
  const hint = await page.locator('#bar-hint').innerText();
  if (!hint.includes('还没存好')) errors.push(`${at}: closing before saving leaves no note (${hint})`);
  await shoot(page, setup, '2-not-saved');
  await page.locator('#bar-main').click();
  await page.locator('#result-dialog').waitFor({state: 'visible'});
  const file = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
  await page.locator('#result-download').click();
  if (!(await file)) errors.push(`${at}: 下载照片 did not download`);
  const done = await page.locator('#result-title').innerText();
  const lead = await page.locator('#result-lead').innerText();
  if (!done.includes('已保存') || !lead.includes('文件')) errors.push(`${at}: after saving: ${done} / ${lead}`);
  await shoot(page, setup, '3-saved');
  await page.goBack();
  await waitFor(page, () => !document.querySelector('#result-dialog').open);
  if (!(await page.locator('#bar-hint').innerText()).includes('已保存')) errors.push(`${at}: no 已保存 note after saving`);
  await commonChecks(page, at);
  await page.close();
}

// A browser too old for the page's script gets a plain note, not dead buttons.
async function oldBrowserFlow() {
  const at = 'old-browser';
  const page = await browser.newPage({viewport: {width: 360, height: 640}});
  await page.route(/app\.js/, route => route.fulfill({contentType: 'text/javascript', body: 'const a = b?.c ?? 1_000; export {};'}));
  // Stand in for a browser that cannot parse it: make the module fail outright.
  await page.route(/frames\.js/, route => route.fulfill({status: 404}));
  await page.goto(server.url);
  const shown = await waitFor(page, () => {
    const note = document.querySelector('#old-browser');
    return note && !note.hidden && note.getBoundingClientRect().height > 0;
  }, null, 60);
  if (!shown) errors.push(`${at}: no note when the page cannot start`);
  if (await page.locator('#bar-main').isVisible()) errors.push(`${at}: buttons that cannot work are still shown`);
  await page.close();
}

// WeChat: no download, so the result image itself must show for a long-press save.
async function weChatFlow(photos) {
  const setup = {
    name: 'wechat-390x844', viewport: {width: 390, height: 844}, phone: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50',
  };
  const at = setup.name;
  const page = await open(setup);
  if (!(await importPhoto(page, photos.landscape))) errors.push(`${at}: the photo did not open`);
  await page.locator('#bar-main').click();
  const shown = await waitFor(page, () => {
    const image = document.querySelector('#result-image');
    return image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height > 0;
  });
  if (!shown) errors.push(`${at}: the finished photo does not show, so it cannot be long-pressed`);
  const lead = await page.locator('#result-lead').innerText();
  if (!lead.includes('按住')) errors.push(`${at}: no long-press tip (${lead})`);
  if (!(await page.locator('#result-title').innerText()).includes('按住照片')) errors.push(`${at}: the title does not say to press and hold`);
  // The long-press tip sits above the picture it points at.
  const order = await page.evaluate(() => document.querySelector('#result-lead').getBoundingClientRect().top < document.querySelector('#result-image').getBoundingClientRect().top);
  if (!order || !lead.includes('下面')) errors.push(`${at}: the tip and the picture are in the wrong order`);
  const accept = await page.locator('#file').getAttribute('accept');
  if (accept !== 'image/*') errors.push(`${at}: WeChat photo picker asks for ${accept}`);
  await shoot(page, setup, '1-result');
  await page.locator('#result-close').click();
  await settle(page);
  // WeChat cannot tell the page whether the long press saved it, so the page claims neither.
  const hint = await page.locator('#bar-hint').innerText();
  if (hint.includes('已保存') || hint.includes('还没存好')) errors.push(`${at}: the bar guesses whether it was saved (${hint})`);
  await page.close();
}

try {
  const first = await open({name: 'setup', viewport: {width: 800, height: 600}});
  const photos = {
    landscape: await makePhoto(first, 4000, 3000, 'landscape.jpg'),
    portrait: await makePhoto(first, 3000, 4000, 'portrait.jpg'),
    panorama: await makePhoto(first, 8000, 1400, 'panorama.jpg'),
  };
  await first.close();
  for (const setup of [...phones, ...wide]) {
    try {
      await (phones.includes(setup) ? phoneFlow : wideFlow)(setup, photos);
    } catch (error) {
      errors.push(`${setup.name}: test stopped: ${String(error.message || error).split('\n')[0]}`);
    }
  }
  for (const setup of [{name: 'iphone-se-375x667', viewport: {width: 375, height: 667}},
    {name: 'iphone-15-393x852', viewport: {width: 393, height: 852}, scale: 3}]) {
    try {
      await iPhoneFlow(setup, photos);
    } catch (error) {
      errors.push(`${setup.name}: test stopped: ${String(error.message || error).split('\n')[0]}`);
    }
  }
  try {
    await oldBrowserFlow();
  } catch (error) {
    errors.push(`old-browser: test stopped: ${String(error.message || error).split('\n')[0]}`);
  }
  try {
    await weChatFlow(photos);
  } catch (error) {
    errors.push(`wechat: test stopped: ${String(error.message || error).split('\n')[0]}`);
  }
} catch (error) {
  errors.push(`test crashed: ${error.stack || error}`);
} finally {
  await browser.close();
  server.close();
}
console.log(notes.join('\n'));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: review checks pass on ${phones.length} phone setups and ${wide.length} tablet and computer sizes`);
