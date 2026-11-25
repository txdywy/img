// Steadiness checks: nothing on screen should jump, grow, shrink or wobble while
// someone uses the page, because older users read any such movement as "it broke".
// - phones: tapping frames and categories never moves the preview box, the category
//   chips or the frame list; the browser's address bar sliding away (a taller window)
//   or the keyboard opening (a shorter one) does not resize the pinned preview;
// - motion: only colour, opacity and a small slide, never scale or a bounce, short,
//   and none at all with "reduce motion";
// - a quick double tap on a button does not zoom the page, and taps show no grey flash.
// Needs playwright and a Chromium (see smoke.mjs); ENGINE=webkit runs it in the
// engine of iPhone and iPad Safari and iPhone WeChat instead.
import * as playwright from 'playwright';
import {serve} from './serve.mjs';

const server = await serve();
const engine = process.env.ENGINE || 'chromium';
const browser = await playwright[engine].launch(engine === 'chromium' ? {executablePath: process.env.CHROMIUM_PATH || undefined} : {});
const errors = [];

// Waits until the page has stopped moving (smooth scrolls included).
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

async function waitFor(page, check, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate(check)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function makePhoto(page, width, height, name) {
  const data = await page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#7a8fa8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f3e3b5';
    ctx.fillRect(w * .3, h * .3, w * .4, h * .4);
    return canvas.toDataURL('image/jpeg', .9).split(',')[1];
  }, [width, height]);
  return {name, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64')};
}

async function open(viewport, extra = {}, font = 0) {
  const page = await browser.newPage({viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ...extra});
  page.on('pageerror', error => errors.push(`${viewport.width}x${viewport.height} page: ${error.message}`));
  if (font) {
    // Like the phone's own "large text" setting.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', {fontSizes: {standard: font, fixed: Math.round(font * .8)}});
  }
  await page.goto(server.url);
  await page.locator('#preview').waitFor({state: 'visible'});
  await settle(page);
  return page;
}

async function importPhoto(page, file) {
  await page.setInputFiles('#file', file);
  const ok = await waitFor(page, () => ['保存照片', '做好照片'].includes(document.querySelector('#bar-main-text').textContent));
  await settle(page);
  return ok;
}

// Where the things a finger aims at are, rounded to whole pixels.
const snapshot = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.left), Math.round(r.width)]; };
  const cards = [...document.querySelectorAll('#frames button[data-frame]')];
  return {
    stage: box(document.querySelector('#stage') || document.querySelector('.stage')),
    dock: box(document.querySelector('#dock')),
    filters: [...document.querySelectorAll('#filters .filter')].map(box),
    firstCard: cards[0] ? box(cards[0]) : null,
    cards: cards.slice(0, 6).map(box),
  };
});

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function phoneChecks(viewport, label, font = 0) {
  const page = await open(viewport, {}, font);
  const at = `${label}`;
  const start = await snapshot(page);
  for (const [photoName, w, h] of [['landscape', 4000, 3000], ['portrait', 3000, 4000]]) {
    if (!await importPhoto(page, await makePhoto(page, w, h, `${photoName}.jpg`))) {
      errors.push(`${at}: ${photoName} photo did not load`);
      continue;
    }
    const before = await snapshot(page);
    // Tap through several frames of different shapes; the box and the list must stay put.
    const ids = await page.evaluate(() => [...document.querySelectorAll('#frames button[data-frame]')].map(b => b.dataset.frame).slice(0, 6));
    for (const id of ids.slice(1).concat(ids[0])) {
      // A finger taps the card where it is; Playwright's click would scroll the page first.
      await page.evaluate(frame => document.querySelector(`#frames button[data-frame="${frame}"]`).click(), id);
      await settle(page);
      const now = await snapshot(page);
      if (!same(now.stage, before.stage)) errors.push(`${at} ${photoName}: tapping frame ${id} resized or moved the preview box ${before.stage} -> ${now.stage}`);
      if (!same(now.cards, before.cards)) errors.push(`${at} ${photoName}: tapping frame ${id} moved the frame cards`);
      if (!same(now.filters, before.filters)) errors.push(`${at} ${photoName}: tapping frame ${id} moved the category chips`);
    }
  }
  // Categories: the chips keep their size and place whichever one is chosen.
  const chips = await page.evaluate(() => [...document.querySelectorAll('#filters .filter')].length);
  let reference = null;
  for (let i = 0; i < chips; i++) {
    await page.evaluate(n => document.querySelectorAll('#filters .filter')[n].click(), i);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const now = await snapshot(page);
    const sizes = now.filters.map(([, height, , width]) => [height, width]);
    if (reference && !same(sizes, reference)) errors.push(`${at}: choosing category ${i + 1} changed the size of the category chips`);
    reference = reference || sizes;
  }
  // The address bar sliding away (taller window) and the keyboard (shorter window)
  // must not resize the pinned preview. Only the width counts.
  await page.evaluate(() => document.querySelectorAll('#filters .filter')[0].click());
  await settle(page);
  const pinned = await snapshot(page);
  for (const height of [viewport.height + 56, viewport.height + 112, Math.round(viewport.height * .58), viewport.height]) {
    const keyboard = height < viewport.height;
    if (keyboard) {
      // The keyboard opens for the blessing's words.
      const focused = await page.evaluate(() => {
        document.querySelector('#frames button[data-frame="longevity"]').click();
        document.querySelector('#words').open = true;
        document.querySelector('#caption-text').focus();
        return document.activeElement.id;
      });
      if (focused !== 'caption-text') errors.push(`${at}: could not put the cursor in the blessing words (test problem)`);
      await settle(page);
    }
    await page.setViewportSize({width: viewport.width, height});
    await settle(page);
    if (keyboard) {
      const now = await snapshot(page);
      if (now.stage[1] !== pinned.stage[1]) errors.push(`${at}: the keyboard (${height}px tall window) changed the preview height ${pinned.stage[1]} -> ${now.stage[1]}`);
      await page.setViewportSize(viewport);
      await page.evaluate(() => { document.querySelector('#caption-text').blur(); document.querySelector('#words').open = false; });
      await settle(page);
      continue;
    }
    const now = await snapshot(page);
    if (now.stage[1] !== pinned.stage[1]) errors.push(`${at}: a ${height}px tall window changed the preview height ${pinned.stage[1]} -> ${now.stage[1]}`);
  }
  // Turning the phone (a new width) may lay the page out again, once.
  await page.setViewportSize({width: viewport.height, height: viewport.width});
  await settle(page);
  await page.setViewportSize(viewport);
  // Browsers may report the new height in steps after a turn; the page re-measures for a second.
  await page.waitForTimeout(1200);
  await settle(page);
  const back = await snapshot(page);
  const seen = await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`);
  if (Math.abs(back.stage[1] - pinned.stage[1]) > 1) errors.push(`${at}: after turning the phone and back (window ${seen}) the preview is ${back.stage[1]}px, was ${pinned.stage[1]}px`);
  if (!start.stage[1]) errors.push(`${at}: no preview box on first load`);
  await page.close();
}

// Loading: the preview box keeps its height from the first paint through the sample photo.
async function loadChecks(viewport, label) {
  const page = await browser.newPage({viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true});
  await page.addInitScript(() => {
    window.__heights = [];
    const watch = () => {
      const stage = document.querySelector('.stage');
      if (stage) window.__heights.push(Math.round(stage.getBoundingClientRect().height));
      if (window.__heights.length < 200) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.goto(server.url);
  await page.locator('#preview').waitFor({state: 'visible'});
  await page.waitForTimeout(800);
  const heights = await page.evaluate(() => [...new Set(window.__heights.filter(Boolean))]);
  if (heights.length && Math.max(...heights) - Math.min(...heights) > 1) errors.push(`${label}: the preview box changed height while the page loaded: ${heights.join(' -> ')}px`);
  await page.close();
}

// Motion rules, read from the stylesheet the page really uses.
async function motionChecks() {
  const page = await open({width: 390, height: 844});
  const found = await page.evaluate(() => {
    const problems = [];
    const layoutProps = /(^|,|\s)(width|height|top|left|right|bottom|margin|padding|font-size|inset|all)(\s|,|$)/;
    const walk = rules => {
      for (const rule of rules) {
        if (rule.cssRules && !(rule instanceof CSSKeyframesRule)) walk(rule.cssRules);
        if (rule instanceof CSSKeyframesRule) {
          const text = rule.cssText;
          if (/scale|rotate|skew|width|height|top:|left:|margin/.test(text)) problems.push(`keyframes ${rule.name} animate size or scale`);
          continue;
        }
        if (!rule.style) continue;
        const property = rule.style.transitionProperty;
        if (property && layoutProps.test(property)) problems.push(`${rule.selectorText}: transition on ${property}`);
        for (const timing of [rule.style.transitionTimingFunction, rule.style.animationTimingFunction]) {
          const bezier = /cubic-bezier\(([^)]+)\)/.exec(timing || '');
          if (bezier) {
            const [, y1, , y2] = bezier[1].split(',').map(Number);
            if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) problems.push(`${rule.selectorText}: easing ${timing} overshoots (bounces)`);
          }
        }
        for (const duration of [rule.style.transitionDuration, rule.style.animationDuration]) {
          for (const part of (duration || '').split(',')) {
            const ms = part.trim().endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000;
            if (ms > 260) problems.push(`${rule.selectorText}: ${part.trim()} is slow enough to feel like waiting`);
          }
        }
        if (/infinite/.test(rule.style.animationIterationCount || '')) problems.push(`${rule.selectorText}: endless animation`);
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    const html = getComputedStyle(document.documentElement).touchAction;
    if (!/manipulation/.test(html)) problems.push(`the page allows double-tap zoom (touch-action: ${html})`);
    const button = document.querySelector('#bar-main');
    const highlight = getComputedStyle(button).webkitTapHighlightColor;
    if (highlight && !/rgba\(0, 0, 0, 0\)|transparent/.test(highlight)) problems.push(`buttons flash grey when tapped (${highlight})`);
    return problems;
  });
  for (const problem of found) errors.push(`motion: ${problem}`);
  await page.close();

  // "Reduce motion" turns every animation and transition off.
  const calm = await browser.newPage({viewport: {width: 390, height: 844}, reducedMotion: 'reduce', hasTouch: true, isMobile: true});
  await calm.goto(server.url);
  await calm.locator('#preview').waitFor({state: 'visible'});
  const moving = await calm.evaluate(() => [...document.querySelectorAll('*')]
    .filter(el => { const s = getComputedStyle(el); return s.animationName !== 'none' || parseFloat(s.transitionDuration) > 0; })
    .map(el => el.id || el.className || el.tagName).slice(0, 5));
  if (moving.length) errors.push(`reduced motion: still moving: ${moving.join(', ')}`);
  await calm.close();
}

for (const [viewport, label] of [
  [{width: 390, height: 844}, '390x844'],
  [{width: 375, height: 667}, '375x667'],
  [{width: 360, height: 780}, '360x780'],
  [{width: 320, height: 568}, '320x568'],
]) {
  await phoneChecks(viewport, label);
  await loadChecks(viewport, label);
}
// Large text (Chromium can set it), and a page zoomed to 150% (a 390px phone then has a 260px wide page).
if (engine === 'chromium') await phoneChecks({width: 390, height: 844}, '390x844-text150', 24);
await phoneChecks({width: 260, height: 562}, '390x844-zoom150');
await motionChecks();

await browser.close();
server.close();
if (errors.length) {
  console.error(`${errors.length} steadiness problem(s):\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log(`OK (${engine}): preview, chips and frame list stay put on taps, address-bar and keyboard changes; motion is calm and off with reduce motion; no double-tap zoom`);
