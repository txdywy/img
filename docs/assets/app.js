import {frames, categories, byId} from './frames.js?v=20';
import {fixedLayout, layout, layoutInBox, paint, photoRatio, placement} from './render.js?v=20';
import {setupAnalytics, track} from './analytics.js?v=20';
import {openDialog, pushLayer, releaseLayer} from './dialog.js?v=20';
import {photoDate} from './photo-date.js?v=20';

const $ = id => document.getElementById(id);
const stage = $('stage');
const preview = $('preview');
const grid = $('frames');
const filters = $('filters');
const more = $('more');
const fileInput = $('file');
const save = $('save');
const status = $('status');
const resultDialog = $('result-dialog');
const download = $('result-download');
const share = $('share');
const viewFrame = $('view-frame');
const dockView = $('dock-view');
const barMain = $('bar-main');
const barPick = $('bar-pick');
const defaults = {ratio: 'original', fit: 'contain', rotation: 0, x: .5, y: .5};
const tileWidth = 184;
const tileHeight = 116;
const listSize = 6;
const previewEdge = 1200;
const maxImportSize = 50 * 1024 * 1024;
// A small file can still hold an enormous picture; decoding it could run a phone
// out of memory. 250 million pixels leaves room for 200-megapixel camera photos.
const maxImportPixels = 250000000;
const exportEdge = 4096;
const exportPixels = 16000000;
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// WeChat's own browser usually cannot download files; a long press on the picture saves it.
// QQ, Weibo, DingTalk and Alipay open links in similar built-in browsers.
const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
// Inside WeChat the phone's share menu cannot send to a WeChat friend: WeChat's own
// 转发给朋友 there has to switch to the WeChat app to pick a friend, but WeChat is
// already the app on screen, so the menu just closes and the page comes back without
// anything sent. WeChat's own long-press menu on the photo has 发送给朋友 instead.
const longPressSave = isWeChat || /\bQQ\/|Weibo|DingTalk|AlipayClient/i.test(navigator.userAgent);
const isAndroid = /Android|HarmonyOS|OpenHarmony/i.test(navigator.userAgent);
const coarsePointer = window.matchMedia('(pointer: coarse)');
// The phone layout: preview pinned on top, one big button at the bottom.
const phoneLayout = window.matchMedia('(max-width: 46rem)');
// The preview stays pinned on phones tall enough for it (layoutPage decides, see steadyHeight).
const pinnedPhone = {get matches() { return phoneLayout.matches && !document.documentElement.classList.contains('short-phone'); }};
const twoColumns = window.matchMedia('(min-width: 46.01rem)');
let exportNumber = 0;

// image is full resolution for export; the smaller copies keep redraws fast.
let image = null;
let previewSource = null;
let thumbSource = null;
let isUserPhoto = false;
let selected = frames[0];
let options = {...defaults};
let category = 'all';
let expanded = false;
let importVersion = 0;
let reading = false;
let exporting = false;
let animation = 0;
let previewDirty = true;
let previewLayout = null;
let crop = null;
let pan = null;
let resultUrl = '';
let resultFile = null;
// On iPhone (iOS 15 and 16, WebKit bug 231995), choosing 存储图像 in the share
// sheet saves the photo but the share never finishes, and every later share fails
// until the page is reloaded; iOS 14 had a similar fault (bug 216913). So the
// first photo saves and the second cannot. Once that happens the page stops
// offering the share sheet and asks for a long press on the photo instead.
let sharePending = false;
let shareBroken = false;
let dragDepth = 0;
let unsaved = false;
let savedNote = false;
// A finished photo was made but not saved yet (the window was closed first).
let madeNotSaved = false;
let importProblem = '';
let zoomed = false;
// What the date switch just did, said once in the bar on phones.
let stampNote = '';
const today = new Date();
const captions = {
  blessing: {on: true, text: '福如东海 · 寿比南山'},
  birthday: {on: true, text: '生日快乐'},
  travel: {on: true, text: ''},
};
// The date on the frame, shared by every frame. Wanted: off until someone turns it on,
// except on 出游纪念, which has always shown one. The date itself is one someone wrote
// on 出游纪念 (typed; empty: no date at all), else the day the photo was taken (from the
// photo itself), else today, but only once someone chose today for this photo (useToday):
// a photo without a taken date never gets today printed on it by itself.
// The sample photo shows today, as before.
const stamp = {on: null, taken: null, typed: null, useToday: true};
const todayParts = {year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate()};
const stampWanted = frame => stamp.on === null ? frame.caption === 'travel' : stamp.on;
const stampHasDate = () => stamp.typed !== null || Boolean(stamp.taken) || stamp.useToday;
const stampOn = frame => stampWanted(frame) && stampHasDate();
function stampText() {
  if (stamp.typed !== null) return stamp.typed.trim();
  if (!stamp.taken && !stamp.useToday) return '';
  const {year, month, day} = stamp.taken || todayParts;
  return `${year}.${month}.${day}`;
}
const captionLabels = {
  blessing: {toggle: '加一句祝福', text: '祝福语', placeholder: '福如东海 · 寿比南山'},
  birthday: {toggle: '加上祝福文字', text: '文字', placeholder: '生日快乐'},
  travel: {toggle: '写上地点', text: '地点', placeholder: '例如：杭州西湖'},
};

function captionFor(frame) {
  const state = captions[frame.caption];
  const date = stampOn(frame) ? stampText() : '';
  // 出游纪念 keeps its one line: place and date side by side, as before.
  if (frame.caption === 'travel') return [state.on ? state.text.trim() : '', date].filter(Boolean).join('  ·  ');
  if (!state || !state.on) return '';
  return state.text.trim();
}

// The settings a frame is drawn with: the shared adjustments plus its own words and date.
const look = (frame, base = options) => ({
  ...base, text: captionFor(frame), date: stampOn(frame) && frame.caption !== 'travel' ? stampText() : '',
});

const pixelRatio = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));
const clamp = value => Math.max(0, Math.min(1, value));

// One short sentence; the longer how-to waits behind 怎么办？
function showStatus(message, error = false, help = '') {
  status.textContent = message;
  status.classList.toggle('error', error);
  $('status-box').classList.toggle('error', error);
  importProblem = error ? message : '';
  $('status-help').hidden = !help;
  $('status-help').open = false;
  $('status-help-text').textContent = help;
  updateBar();
  scheduleLayout();
}

function showImportError(message, help = '') {
  // The last photo is still in the preview, and 做好照片 would make that one: say so in sight.
  if (isUserPhoto) showStatus('这张没打开，现在还是上一张。', true, `${message}${help} 想用上一张，接着做就行。`);
  else showStatus(message, true, help);
  // Keep the message, the preview and the frames on screen together.
  showFrames();
}

function clearImportError() {
  if (importProblem) showStatus('');
}

function updateSave() {
  save.disabled = !isUserPhoto || reading || exporting;
  $('save-text').textContent = exporting ? '正在制作…' : '做好这张照片';
  const hint = $('save-hint');
  hint.textContent = savedNote ? '✓ 已保存。还可以再换个相框，或换一张照片'
    : madeNotSaved && !resultDialog.open ? '还没存好。点「做好这张照片」接着存'
    : isUserPhoto ? '先看成品，再保存' : '先选一张自己的照片';
  hint.classList.toggle('saved', savedNote);
  hint.classList.toggle('pending', madeNotSaved && !resultDialog.open);
  updateBar();
}

// Phones get one bar at the bottom with the one thing to do next:
// choose a photo first, then save it. Changing the photo stays beside it.
function updateBar() {
  barMain.disabled = reading || exporting;
  barPick.hidden = !isUserPhoto;
  barPick.disabled = reading || exporting;
  // Android phones save at the first tap. Elsewhere the first tap makes the photo
  // and a second one saves it, so the button says so instead of promising a save.
  const direct = savesDirectly();
  const make = direct ? '保存照片' : '做好照片';
  $('bar-main-text').textContent = exporting ? '正在制作…'
    : reading ? '正在打开…'
    : isUserPhoto ? make : '从相册选照片';
  $('bar-icon').firstElementChild.setAttribute('href', isUserPhoto ? '#i-save' : '#i-photo');
  // Short enough to stay on one line, even with large text.
  const problem = $('save-status').textContent ? '没做好，请再点一次保存' : importProblem;
  const hint = $('bar-hint');
  const pending = madeNotSaved && !resultDialog.open;
  hint.textContent = problem || (savedNote ? '✓ 已保存，还可以再换相框'
    : pending ? `还没存好，再点「${make}」`
    // What the date switch just did, until the next change.
    : stampNote ? stampNote
    : isUserPhoto ? '点相框，换个样式'
    // Said before the first tap, for people who worry about their original photo.
    : '会另存一张，原照片还在');
  hint.classList.toggle('error', Boolean(problem));
  hint.classList.toggle('pending', !problem && pending);
  hint.classList.toggle('saved', !problem && savedNote);
}

function downscale(source, longest) {
  const scale = Math.min(1, longest / Math.max(source.width, source.height));
  if (scale === 1) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// iPhones cap the memory all canvases may use together, and a dropped canvas
// keeps its share until the browser gets round to freeing it. A full-size photo
// takes about 50 MB, so each new photo frees the old copies straight away.
function release(source, keep) {
  if (!source || keep.includes(source)) return;
  if (source.close) source.close();
  else if (typeof HTMLCanvasElement === 'function' && source instanceof HTMLCanvasElement) {
    source.width = 1;
    source.height = 1;
  }
}

function setImage(photo) {
  const old = [image, previewSource, thumbSource];
  image = photo;
  previewSource = downscale(photo, previewEdge);
  thumbSource = downscale(previewSource, Math.max(tileWidth, tileHeight) * 2);
  const keep = [image, previewSource, thumbSource];
  for (const source of new Set(old)) release(source, keep);
}

function fitPreview() {
  if (!image) return;
  const style = getComputedStyle(stage);
  const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const scale = Math.max(0, Math.min(width / preview.width, height / preview.height));
  preview.style.width = `${preview.width * scale}px`;
  preview.style.height = `${preview.height * scale}px`;
}

function requestPreview() {
  previewDirty = true;
  if (animation) return;
  animation = requestAnimationFrame(() => {
    animation = 0;
    drawPreview();
  });
}

function drawPreview() {
  if (!image || !previewDirty) return;
  previewDirty = false;
  const settings = look(selected);
  previewLayout = layout(image, selected, settings, previewEdge);
  paint(preview, previewSource, selected, settings, previewLayout);
  preview.setAttribute('aria-label', `${isUserPhoto ? '照片' : '示例照片'}预览，${selected.name}相框`);
  $('stage-badge').textContent = (isUserPhoto ? '' : '示例 · ') + selected.name;
  preview.hidden = false;
  // Adjusting or enlarging the sample would look like editing one's own photo.
  viewFrame.disabled = dockView.disabled = !isUserPhoto;
  $('dock-tools').hidden = !isUserPhoto;
  $('stage-placeholder').hidden = true;
  layoutPage();
  fitPreview();
}

function makeButton(className, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

// Each category shows how many frames it holds, so nobody misses the ones further down.
for (const [id, name] of categories) {
  const count = id === 'all' ? frames.length : frames.filter(frame => frame.category === id).length;
  const button = makeButton('filter', name);
  const number = document.createElement('span');
  number.className = 'count';
  number.textContent = String(count);
  button.append(' ', number);
  button.setAttribute('aria-label', `${name}，${count} 款`);
  button.dataset.category = id;
  button.setAttribute('aria-pressed', String(id === category));
  filters.append(button);
}

function updateFrameSelection() {
  $('current-frame').textContent = '当前相框：' + selected.name;
  for (const button of grid.children) {
    const chosen = button.dataset.frame === selected.id;
    button.setAttribute('aria-pressed', String(chosen));
    button.lastElementChild.hidden = !chosen;
  }
}

function drawTile(canvas, frame) {
  const scale = pixelRatio();
  if (!isUserPhoto) {
    canvas.style.width = '';
    const text = captionFor(frame);
    paint(canvas, thumbSource, frame, {...defaults, rotation: options.rotation, text},
      fixedLayout(frame, tileWidth * scale, tileHeight * scale, text));
    return;
  }
  const settings = look(frame);
  const tile = layoutInBox(thumbSource, frame, settings, tileWidth * scale, tileHeight * scale);
  canvas.style.width = `${100 * tile.width / (tileWidth * scale)}%`;
  paint(canvas, thumbSource, frame, settings, tile);
}

function refreshGalleryPreviews(kind = '') {
  for (const button of grid.children) {
    const frame = byId.get(button.dataset.frame);
    if (!kind || frame.caption === kind) drawTile(button.querySelector('canvas'), frame);
  }
}

function visibleFrames() {
  const items = category === 'all' ? frames : frames.filter(frame => frame.category === category);
  if (expanded || items.length <= listSize) return [items, items];
  const shown = items.slice(0, listSize);
  // Keep the chosen frame in view after collapsing or switching categories.
  if (items.includes(selected) && !shown.includes(selected)) shown[listSize - 1] = selected;
  return [items, shown];
}

function drawGallery() {
  const [items, shown] = visibleFrames();
  $('frame-count').textContent = `${items.length} 款相框`;
  more.hidden = items.length <= listSize;
  more.setAttribute('aria-expanded', String(expanded));
  more.firstChild.textContent = expanded ? '收起相框 ' : `查看更多相框（还有 ${items.length - shown.length} 款） `;
  const entries = document.createDocumentFragment();
  for (const frame of shown) {
    const button = makeButton('frame', '');
    button.dataset.frame = frame.id;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    drawTile(canvas, frame);
    const thumbnail = document.createElement('span');
    thumbnail.className = 'thumbnail';
    thumbnail.append(canvas);
    const caption = document.createElement('span');
    caption.textContent = frame.name;
    const mark = document.createElement('span');
    mark.className = 'chosen';
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = '<svg class="icon"><use href="#i-check"/></svg>';
    button.append(thumbnail, caption, mark);
    entries.append(button);
  }
  grid.replaceChildren(entries);
  updateFrameSelection();
  scheduleLayout();
}

function chooseFrame(frame) {
  if (frame === selected) return;
  selected = frame;
  markEdited();
  clearImportError();
  updateFrameSelection();
  syncCaption();
  syncStamp();
  syncOptions();
  requestPreview();
  track('frame_selected');
}

// A category is a quick way to try a style: tapping one puts its first frame
// on the photo straight away, unless the current frame already belongs to it.
filters.addEventListener('click', event => {
  const button = event.target.closest('button[data-category]');
  if (!button || category === button.dataset.category) return;
  category = button.dataset.category;
  expanded = false;
  for (const filter of filters.children) filter.setAttribute('aria-pressed', String(filter === button));
  if (category !== 'all' && selected.category !== category) {
    chooseFrame(frames.find(frame => frame.category === category));
  }
  drawGallery();
  // Show this category's frames: the first card must be in sight, not under the bar.
  requestAnimationFrame(() => revealCard(grid.firstElementChild));
});

// The page glides to where it needs to be instead of jumping there, so the eye can
// follow it; with "reduce motion", or in browsers without smooth scrolling, it moves at once.
const calmMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function glideBy(top) {
  if (Math.abs(top) < 1) return;
  if ('scrollBehavior' in document.documentElement.style && !calmMotion.matches) window.scrollBy({top, behavior: 'smooth'});
  else window.scrollBy(0, top);
}

// Scroll just enough that a frame card sits fully between the pinned preview and the bottom bar.
function revealCard(card) {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const top = pinnedPhone.matches ? $('dock').getBoundingClientRect().bottom + 8 : 8;
  const bottom = (phoneLayout.matches ? $('bar').getBoundingClientRect().top : window.innerHeight) - 8;
  if (rect.bottom > bottom) glideBy(Math.min(rect.bottom - bottom, rect.top - top));
  else if (rect.top < top) glideBy(rect.top - top);
}

grid.addEventListener('click', event => {
  const button = event.target.closest('button[data-frame]');
  if (!button || button.dataset.frame === selected.id) return;
  chooseFrame(byId.get(button.dataset.frame));
});

more.addEventListener('click', () => {
  expanded = !expanded;
  drawGallery();
  if (expanded && grid.children[listSize]) grid.children[listSize].focus();
  else {
    // Collapsing shortens the page: glide back to the button instead of jumping.
    const rect = more.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) glideBy(rect.top + rect.height / 2 - window.innerHeight / 2);
  }
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const photo = new Image();
    photo.onload = () => photo.naturalWidth && photo.naturalHeight ? resolve(photo) : reject(new Error('Empty image'));
    photo.onerror = () => reject(new Error('Unsupported image'));
    photo.src = src;
  });
}

async function readPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const photo = await loadImage(url);
    if (photo.naturalWidth * photo.naturalHeight > maxImportPixels) {
      const error = new Error('Too many pixels');
      error.name = 'TooManyPixels';
      throw error;
    }
    const scale = Math.min(1, exportEdge / Math.max(photo.naturalWidth, photo.naturalHeight),
      Math.sqrt(exportPixels / (photo.naturalWidth * photo.naturalHeight)));
    const width = Math.max(1, Math.round(photo.naturalWidth * scale));
    const height = Math.max(1, Math.round(photo.naturalHeight * scale));
    if (scale < 1 && typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(photo, {
          imageOrientation: 'from-image', resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
        });
      } catch {
        // Older browsers reject these options; the Canvas copy below keeps the photo upright.
      }
    }
    // Copy into a canvas so the photo stays drawable after its URL is revoked.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// HEIC and HEIF photos start with an ISO media box whose brand names the format.
async function isHeic(file) {
  if (/\.(heic|heif)$/i.test(file.name || '') || /image\/hei[cf]/.test(file.type)) return true;
  try {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const text = String.fromCharCode(...bytes);
    return text.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(text.slice(8, 12));
  } catch {
    return false;
  }
}

async function importPhoto(file) {
  if (!file) return;
  const version = ++importVersion;
  $('save-status').textContent = '';
  if (file.size > maxImportSize) {
    reading = false;
    showImportError('这张照片太大，换一张试试。', '可以在相册里把照片另存一份小一点的，或者给照片截个屏，再选截屏。');
    updateSave();
    return;
  }
  reading = true;
  showStatus('正在打开照片…');
  updateSave();
  try {
    const [photo, taken] = await Promise.all([readPhoto(file), photoDate(file)]);
    if (version !== importVersion) {
      if (photo.close) photo.close();
      return;
    }
    const first = !isUserPhoto;
    setImage(photo);
    stamp.taken = taken;
    stamp.typed = null;
    stamp.useToday = false;
    // The date was wanted, but this photo does not say when it was taken: say so once,
    // instead of printing today on it.
    stampNote = !taken && stampWanted(selected) ? '这张没有拍照日期，先不印' : '';
    isUserPhoto = true;
    unsaved = true;
    savedNote = false;
    madeNotSaved = false;
    options = {...defaults};
    syncOptions();
    $('preview-label').textContent = '我的照片';
    $('pick-text').textContent = '换一张照片';
    $('file-hint').textContent = '原照片还在';
    // On phones this message is only read out: the bar already says what to do next.
    showStatus(stampNote ? `照片已选好。${stampNote}。` : '照片已选好。');
    previewDirty = true;
    drawPreview();
    refreshGalleryPreviews();
    // 改字 shows the new photo's date, not one written for the last photo.
    syncCaption();
    syncStamp();
    if (first) showFrames();
    track('photo_selected');
  } catch (error) {
    if (version !== importVersion) return;
    const heic = await isHeic(file);
    // Another photo may have been chosen while the file was checked.
    if (version !== importVersion) return;
    if (error && error.name === 'TooManyPixels') {
      showImportError('这张图太大，换一张试试。', '这张图片的像素太多，手机打不开。可以先把它缩小，或者截个屏，再选截屏。');
    } else if (heic) {
      showImportError('这张打不开，换一张试试。', '这张是苹果手机常用的 HEIC 格式，这个浏览器打不开。可以在相册里编辑后另存一份，或者给照片截个屏，再选。在 iPhone 上用 Safari 打开本网站，也能直接选。');
    } else if (file.type && !file.type.startsWith('image/')) {
      showImportError('这不是照片，换一张试试。', '这里只能选照片。请从相册里选一张照片。');
    } else {
      showImportError('这张打不开，换一张试试。', '可以给照片截个屏，或者在相册里另存为 JPG，再选一次。');
    }
  } finally {
    if (version === importVersion) {
      reading = false;
      updateSave();
    }
  }
}

// After the first photo on a phone, move the page title out of the way so the
// frames sit right under the preview. Nothing moves if the page is already further down.
function showFrames() {
  if (!pinnedPhone.matches) return;
  const top = $('editor').getBoundingClientRect().top;
  if (top > 0) glideBy(top);
}

// Android phones, and WeChat or QQ there, open the photo album only for a plain
// "image/*"; adding .heic to the list makes many of them open a file manager instead.
if (isAndroid || (longPressSave && !isApple)) fileInput.accept = 'image/*';

$('pick').addEventListener('click', () => fileInput.click());
barPick.addEventListener('click', () => fileInput.click());
barMain.addEventListener('click', () => {
  if (barMain.disabled) return;
  if (isUserPhoto) void exportPhoto(barMain);
  else fileInput.click();
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  void importPhoto(file);
});

// Accept a dropped photo anywhere, so a missed drop never opens the file and loses the work.
function isFileDrag(event) {
  return Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
}

function endDrag() {
  dragDepth = 0;
  document.body.classList.remove('dragging');
}

document.addEventListener('dragenter', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragover', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', event => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) endDrag();
});
document.addEventListener('drop', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  endDrag();
  void importPhoto(event.dataTransfer.files[0]);
});
document.addEventListener('paste', event => {
  const file = Array.from((event.clipboardData && event.clipboardData.files) || []).find(item => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  void importPhoto(file);
});

function syncOptions() {
  const original = options.ratio === 'original';
  for (const button of $('ratio-choices').children) button.setAttribute('aria-pressed', String(button.dataset.ratio === options.ratio));
  for (const button of $('fit-choices').children) button.setAttribute('aria-pressed', String(button.dataset.fit === options.fit));
  $('fit-area').hidden = original;
  crop = null;
  if (image && !original && options.fit === 'cover') {
    const {area} = layout(image, selected, look(selected), previewEdge);
    const difference = Math.log(photoRatio(image, options.rotation) / (area.w / area.h));
    if (Math.abs(difference) > .005) crop = {x: difference > 0, y: difference < 0};
  }
  // Say plainly which part of the photo is cut off, so nobody loses a person without noticing.
  $('crop-side').textContent = crop && crop.x ? '照片左右两边被剪掉了一些。' : '照片上下被剪掉了一些。';
  $('crop-note').hidden = !crop;
  $('crop-hold').hidden = !(crop && crop.y && coarsePointer.matches);
  $('position').hidden = !crop;
  $('position-x').hidden = !(crop && crop.x);
  $('position-y').hidden = !(crop && crop.y);
  stage.classList.toggle('can-pan', Boolean(crop));
  for (const button of $('position').querySelectorAll('button')) {
    const value = options[button.dataset.axis];
    const atEdge = Number(button.dataset.step) > 0 ? value >= 1 : value <= 0;
    button.setAttribute('aria-disabled', String(atEdge));
  }
}

function applyAdjustment(next) {
  if (Object.keys(next).every(key => next[key] === options[key])) return;
  options = {...options, ...next};
  redrawAdjustment();
}

// Any change to the user's photo after saving it needs saving again.
function markEdited() {
  if (!isUserPhoto) return;
  unsaved = true;
  if (stampNote) {
    stampNote = '';
    updateBar();
  }
  // "照片已选好" has done its job once something else happens.
  if (!importProblem && !reading && status.textContent) showStatus('');
  if (savedNote || madeNotSaved) {
    savedNote = false;
    madeNotSaved = false;
    updateSave();
  }
}

function redrawAdjustment() {
  markEdited();
  syncOptions();
  requestPreview();
  refreshGalleryPreviews();
}

$('ratio-choices').addEventListener('click', event => {
  const button = event.target.closest('button[data-ratio]');
  if (button) applyAdjustment({ratio: button.dataset.ratio});
});
$('fit-choices').addEventListener('click', event => {
  const button = event.target.closest('button[data-fit]');
  if (button) applyAdjustment({fit: button.dataset.fit});
});
$('position').addEventListener('click', event => {
  const button = event.target.closest('button[data-axis]');
  if (!button || button.getAttribute('aria-disabled') === 'true') return;
  const {axis, step} = button.dataset;
  const value = Math.max(0, Math.min(100, Math.round(options[axis] * 100) + Number(step)));
  applyAdjustment({[axis]: value / 100});
});
$('rotate').addEventListener('click', () => applyAdjustment({rotation: (options.rotation + 90) % 360}));
$('reset').addEventListener('click', () => applyAdjustment(defaults));

// On phones 调整 and 改字 open as sheets over the lower half of the screen.
// A tap outside, Esc, the Back button or the button at the bottom closes them.
const sheets = [$('adjust'), $('words')];

function closeSheet(sheet, focus = true) {
  if (!sheet.open) return;
  sheet.open = false;
  if (focus) sheet.querySelector('summary').focus({preventScroll: true});
}

for (const sheet of sheets) {
  sheet.addEventListener('toggle', () => {
    if (sheet.open) {
      for (const other of sheets) if (other !== sheet) closeSheet(other, false);
      sheet.layer = pushLayer(() => closeSheet(sheet));
    } else {
      releaseLayer(sheet.layer);
      sheet.layer = null;
    }
    const open = sheets.some(item => item.open);
    $('dock').classList.toggle('sheet-open', open);
    $('sheet-backdrop').hidden = !open;
  });
  sheet.querySelector('[data-close-sheet]').addEventListener('click', () => closeSheet(sheet));
}
$('sheet-backdrop').addEventListener('click', () => sheets.forEach(sheet => closeSheet(sheet)));
document.addEventListener('keydown', event => {
  const open = sheets.find(sheet => sheet.open);
  if (event.key === 'Escape' && open && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    closeSheet(open);
  }
});

// Drag the photo inside the frame when part of it is cropped. The preview allows
// vertical page scrolling on touch screens, so an up-and-down crop on a phone
// starts after holding the finger still for a moment.
const holdDelay = 350;
const holdSlop = 10;
let hold = null;

function startPan(event) {
  const {area} = previewLayout;
  const place = placement(image, options, area);
  const scale = preview.getBoundingClientRect().width / preview.width;
  if (preview.setPointerCapture) preview.setPointerCapture(event.pointerId);
  pan = {
    id: event.pointerId, x: event.clientX, y: event.clientY, start: options,
    rangeX: crop.x ? (place.w - area.w) * scale : 0,
    rangeY: crop.y ? (place.h - area.h) * scale : 0,
  };
  stage.classList.add('panning');
}

function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold = null;
}

preview.addEventListener('pointerdown', event => {
  if (!crop || !previewLayout || event.button > 0 || pan) return;
  if (event.pointerType === 'touch' && crop.y) {
    cancelHold();
    const down = {pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY};
    hold = {id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      hold = null;
      if (!crop || !previewLayout) return;
      startPan(down);
      pan.held = true;
      stage.classList.add('held');
    }, holdDelay)};
    return;
  }
  event.preventDefault();
  startPan(event);
});
preview.addEventListener('pointermove', event => {
  if (hold && event.pointerId === hold.id) {
    if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > holdSlop) cancelHold();
    return;
  }
  if (!pan || event.pointerId !== pan.id) return;
  const next = {...options};
  if (pan.rangeX > 1) next.x = clamp(pan.start.x - (event.clientX - pan.x) / pan.rangeX);
  if (pan.rangeY > 1) next.y = clamp(pan.start.y - (event.clientY - pan.y) / pan.rangeY);
  options = next;
  requestPreview();
});
// Once a held drag has started, keep the finger from scrolling the page.
preview.addEventListener('touchmove', event => {
  if (pan && pan.held && event.cancelable) event.preventDefault();
}, {passive: false});
// A long press would otherwise open the image menu on phones.
preview.addEventListener('contextmenu', event => {
  if (crop) event.preventDefault();
});
function endPan(event) {
  if (hold && event.pointerId === hold.id) cancelHold();
  if (!pan || event.pointerId !== pan.id) return;
  const {start} = pan;
  pan = null;
  stage.classList.remove('panning', 'held');
  // The browser took the gesture over for scrolling: undo any small shift.
  if (event.type === 'pointercancel') {
    options = start;
    requestPreview();
    return;
  }
  if (start.x === options.x && start.y === options.y) return;
  redrawAdjustment();
}
preview.addEventListener('pointerup', endPan);
preview.addEventListener('pointercancel', endPan);

// Resolves after the browser has drawn the page once more.
function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function encode(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Empty output')), 'image/jpeg', .94);
  });
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  $('result-image').removeAttribute('src');
  download.removeAttribute('href');
  $('share-status').textContent = '';
  resultUrl = '';
  resultFile = null;
}

// Frame name, local date and a number, so the file is easy to recognise in Downloads.
function exportName(frame) {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `拾光相框-${frame.name}-${date}-${++exportNumber}.jpg`;
}

// Saving by a long press on the photo: WeChat and similar apps always, and
// iPhone Safari once its share sheet has stopped working.
function holdToSave() {
  return longPressSave || (isApple && shareBroken);
}

// What a long press offers is called differently on each phone and iOS version.
function holdLead() {
  if (isWeChat) return '用手指按住下面的照片不放，选「发送给朋友」就能发给家人；选「保存图片」就存进相册。';
  return longPressSave
    ? '用手指按住下面的照片不放，选「保存图片」，就存进相册了。'
    : '用手指按住下面的照片不放，选「存储到“照片”」或「存储图像」，就存进相册了。也可以点「下载到文件」。';
}

function showResult(opener) {
  // A share that never finished means the next one would fail (see sharePending).
  if (sharePending) shareBroken = true;
  const hold = holdToSave();
  const canShare = !shareBroken && !isWeChat && Boolean(resultFile && navigator.canShare && navigator.canShare({files: [resultFile]}));
  // On iPhone and iPad, the share sheet is the direct way into Photos.
  const shareFirst = canShare && isApple && !longPressSave;
  share.hidden = !canShare;
  // WeChat and the like cannot download, and the page cannot tell when a download
  // fails there, so they get one way only: the long press.
  download.hidden = longPressSave;
  $('result-close').className = 'button secondary';
  share.className = `button ${shareFirst ? 'primary' : 'secondary'}`;
  download.className = `button ${shareFirst || hold ? 'secondary' : 'primary'}`;
  $('share-text').textContent = shareFirst ? '保存到相册' : '发给家人或其他应用';
  $('download-text').textContent = shareFirst || (hold && isApple) ? '下载到文件' : '下载照片';
  $('share-status').textContent = '';
  const lead = $('result-lead');
  lead.classList.remove('saved');
  // Honest about the one step that is left: the photo is made, not yet saved.
  $('result-title').textContent = isWeChat ? '按住照片，发给家人或保存'
    : hold ? '还差一步：按住照片保存' : '还差一步：把照片存好';
  lead.textContent = hold ? holdLead()
    : shareFirst ? '点下面的「保存到相册」，在弹出的菜单里选「存储图像」。'
    : '点下面的「下载照片」，存到这台设备。';
  // After a long press nothing tells the page whether the photo was saved, so it never claims either.
  madeNotSaved = !hold;
  $('result-close').textContent = madeNotSaved ? '先不存，返回' : '返回挑相框';
  download.after(share);
  if (shareFirst) download.before(share);
  showResultHelp(hold, shareFirst);
  openDialog(resultDialog, opener);
}

// The folded help under the window answers the question this way of saving raises.
function showResultHelp(hold, shareFirst) {
  const [title, text] = longPressSave
    ? ['按住照片没反应？', '点右上角的「···」，选「在浏览器打开」（iPhone 上是「在 Safari 中打开」），再选一次照片，做好后保存。']
    : hold ? ['按住照片没反应？', '点「下载到文件」，照片会存进「文件」App 的「下载项」。']
    : shareFirst ? ['找不到照片？', '选了「存储图像」的，在「照片」App 里。点「下载到文件」存的，在「文件」App 的「下载项」里，名字以「拾光相框」开头。']
    : isApple ? ['找不到照片？', '在「文件」App 的「下载项」里，名字以「拾光相框」开头。']
    : ['找不到照片？', '在浏览器的「下载」里，或手机「文件管理」的「下载」文件夹里，名字以「拾光相框」开头。手机相册里一般也能看到。'];
  $('result-help').open = false;
  $('result-help-title').textContent = title;
  $('result-help-text').textContent = text;
}

// Saved: say so in the window and keep saying it on the page after it closes.
// Not sure (iPhone downloads ask once more, and the page never hears the answer):
// the window says what to tap, and the page claims nothing afterwards.
function markSaved(message, title = '✓ 照片已保存', sure = true) {
  unsaved = false;
  savedNote = sure;
  madeNotSaved = false;
  $('result-title').textContent = title;
  $('result-close').textContent = '返回挑相框';
  // Done: going back is the next step now; saving again stays possible but quieter.
  $('result-close').className = 'button primary';
  download.className = 'button secondary';
  share.className = 'button secondary';
  const lead = $('result-lead');
  lead.textContent = message;
  lead.classList.add('saved');
  updateSave();
}

// Closing the window before saving leaves a note on the page that the photo is not saved yet.
resultDialog.addEventListener('close', updateSave);

save.addEventListener('click', () => {
  if (!save.disabled) void exportPhoto(save);
});

// On Android phones the photo downloads straight away, so 保存照片 is one tap.
// The window then only says where to find it. iPhone, iPad and WeChat need a tap of their own.
function savesDirectly() {
  return coarsePointer.matches && phoneLayout.matches && !isApple && !longPressSave;
}

async function exportPhoto(opener) {
  if (!isUserPhoto || reading || exporting || !image) return;
  exporting = true;
  $('save-status').textContent = '';
  updateSave();
  const version = importVersion;
  const photo = image;
  const frame = selected;
  const settings = look(frame);
  const canvas = document.createElement('canvas');
  try {
    // Painting the full-size photo blocks the page, so show "正在制作…" first.
    await nextPaint();
    if (version !== importVersion) return;
    paint(canvas, photo, frame, settings, layout(photo, frame, settings, exportEdge, exportPixels));
    const blob = await encode(canvas);
    if (version !== importVersion) return;
    clearResult();
    resultUrl = URL.createObjectURL(blob);
    // WeChat's long-press menu cannot save a blob: picture, so give it the image data itself.
    if (sharePending) shareBroken = true;
    $('result-image').src = holdToSave() ? await dataUrl(blob) : resultUrl;
    if (version !== importVersion) return;
    download.href = resultUrl;
    const filename = exportName(frame);
    download.download = filename;
    if (typeof File === 'function') resultFile = new File([blob], filename, {type: blob.type});
    showResult(opener);
    track('photo_exported');
    if (opener === barMain && savesDirectly()) download.click();
  } catch {
    if (version === importVersion) $('save-status').textContent = '这次没做好。可以再点一次保存试试，或换一张较小的照片。';
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    exporting = false;
    updateSave();
  }
}

download.addEventListener('click', () => {
  $('share-status').textContent = '';
  // iPhone and iPad Safari ask first whether to download, and say nothing back if not.
  if (isApple) markSaved('点了「下载」，照片就存进「文件」App 的「下载项」。', '请在弹出的窗口里点「下载」', false);
  else markSaved(isAndroid ? '已存进手机的「下载」，相册里一般也能看到。'
    : '已存进这台设备的「下载」文件夹。');
  $('download-text').textContent = '再存一次';
  track('photo_download_clicked');
});

// The share sheet stopped working (see sharePending): switch this window to a
// long press on the photo, and say that the last 存储图像 most likely worked.
async function shareStuck() {
  shareBroken = true;
  share.hidden = true;
  madeNotSaved = false;
  $('result-close').textContent = '返回挑相框';
  const file = resultFile;
  $('share-status').textContent = '';
  $('result-title').textContent = '换个方法：按住照片保存';
  $('result-lead').textContent = `${sharePending ? '刚才如果选了「存储图像」，那张已经存进相册了。' : ''}${holdLead()}`;
  $('result-lead').classList.remove('saved');
  download.className = 'button primary';
  $('download-text').textContent = '下载到文件';
  showResultHelp(true, false);
  updateSave();
  track('photo_share_stuck');
  try {
    const data = await dataUrl(file);
    if (file === resultFile) $('result-image').src = data;
  } catch {
    // The blob: picture stays; Safari can usually save that too.
  }
}

share.addEventListener('click', async () => {
  const message = $('share-status');
  if (isApple && sharePending) {
    void shareStuck();
    return;
  }
  sharePending = true;
  // The answer belongs to this photo; one that comes back late must not mark a newer one.
  const file = resultFile;
  try {
    await navigator.share({files: [file]});
    sharePending = false;
    if (file !== resultFile) return;
    message.textContent = '';
    if (isApple) markSaved('如果选了「存储图像」，照片就在相册里了。', '✓ 好了');
    else {
      unsaved = false;
      madeNotSaved = false;
      updateSave();
    }
    track('photo_share_completed');
  } catch (error) {
    sharePending = false;
    if (file !== resultFile || (error && error.name === 'AbortError')) return;
    if (isApple) {
      void shareStuck();
      return;
    }
    shareBroken = true;
    share.hidden = true;
    message.textContent = '无法打开分享菜单。请点「下载照片」，或按住照片保存。';
  }
});

viewFrame.addEventListener('click', () => openFrameView(viewFrame));
dockView.addEventListener('click', () => openFrameView(dockView));

function openFrameView(opener) {
  if (!image) return;
  const view = drawFramePreview(false);
  const long = Math.max(view.width / view.height, view.height / view.width);
  const detail = $('frame-detail');
  detail.hidden = long < 3;
  detail.open = false;
  if (!detail.hidden) {
    const swatch = document.createElement('canvas');
    paint(swatch, null, selected, defaults, fixedLayout(selected, 600, 600));
    const corner = $('corner-preview');
    corner.width = corner.height = 180;
    corner.getContext('2d').drawImage(swatch, 0, 0, 180, 180, 0, 0, 180, 180);
  }
  openDialog($('frame-dialog'), opener);
}

// Long panoramas and tall photos: draw a sharper copy and let people scroll along it.
function drawFramePreview(zoom) {
  const canvas = $('frame-preview');
  const viewport = $('zoom-view');
  const settings = look(selected);
  const view = zoom
    ? layout(image, selected, settings, 8192, 12000000)
    : layout(image, selected, settings, previewEdge);
  paint(canvas, zoom ? image : previewSource, selected, settings, view);
  canvas.setAttribute('aria-label', selected.name + (zoom ? '相框放大预览' : '相框全图预览'));
  zoomed = zoom;
  const wide = view.width >= view.height;
  // Long panoramas and tall photos scroll one way; other photos get twice as big
  // and can be moved around with a finger to check faces.
  const long = Math.max(view.width / view.height, view.height / view.width) >= 2.2;
  viewport.classList.toggle('zoomed', zoom);
  viewport.classList.toggle('tall', zoom && long && !wide);
  viewport.classList.toggle('both', zoom && !long);
  viewport.tabIndex = zoom ? 0 : -1;
  canvas.style.width = '';
  canvas.style.height = '';
  if (zoom && long && wide) canvas.style.height = `${Math.min(window.innerHeight * .5, view.height / pixelRatio())}px`;
  if (zoom && !long) canvas.style.width = `${Math.round(viewport.clientWidth * 2)}px`;
  viewport.scrollTo(0, 0);
  if (zoom && !long) viewport.scrollTo((viewport.scrollWidth - viewport.clientWidth) / 2, (viewport.scrollHeight - viewport.clientHeight) / 2);
  const toggle = $('zoom-toggle');
  toggle.setAttribute('aria-pressed', String(zoom));
  toggle.textContent = zoom ? '看整张' : long ? '放大看清两端' : '放大看清楚';
  $('zoom-hint').hidden = !zoom;
  $('zoom-prev').hidden = $('zoom-next').hidden = !zoom || !long;
  $('zoom-prev').textContent = wide ? '往左看' : '往上看';
  $('zoom-next').textContent = wide ? '往右看' : '往下看';
  $('zoom-hint').textContent = !long ? '用手指按住照片拖动，看看各处。点一下照片，回到整张。'
    : wide ? '可以左右滑动查看照片两端的人。' : '可以上下滑动查看整张照片。';
  return view;
}

// The enlarged picture can take 50 MB; iPhones cap all canvases together, so let it go on close.
$('frame-dialog').addEventListener('close', () => {
  const canvas = $('frame-preview');
  canvas.width = 1;
  canvas.height = 1;
  zoomed = false;
});

// A tap on the picture zooms in and out too, the way photo apps do.
$('frame-preview').addEventListener('click', () => drawFramePreview(!zoomed));

$('zoom-toggle').addEventListener('click', () => drawFramePreview(!zoomed));
for (const [id, direction] of [['zoom-prev', -1], ['zoom-next', 1]]) {
  $(id).addEventListener('click', () => {
    const viewport = $('zoom-view');
    const tall = viewport.classList.contains('tall');
    const step = (tall ? viewport.clientHeight : viewport.clientWidth) * .8 * direction;
    viewport.scrollBy({left: tall ? 0 : step, top: tall ? step : 0, behavior: 'smooth'});
  });
}

// Words on frames that carry a caption.
function syncCaption() {
  const kind = selected.caption;
  $('words').hidden = !kind;
  if (!kind) {
    closeSheet($('words'), false);
    return;
  }
  const state = captions[kind];
  const labels = captionLabels[kind];
  $('caption-on').checked = state.on;
  $('caption-on-text').textContent = labels.toggle;
  $('caption-text-label').textContent = labels.text;
  $('caption-text').placeholder = labels.placeholder;
  $('caption-text').value = state.text;
  $('caption-clear').disabled = !state.text;
  $('caption-date').value = stampText();
  // 出游纪念: a photo without a taken date can still get one written here.
  $('caption-date-row').hidden = !(kind === 'travel' && stampWanted(selected));
  $('caption-fields').hidden = !state.on;
  $('words-summary').textContent = kind === 'travel' ? '写地点和日期' : '改相框上的祝福语';
}

function captionChanged(kinds = [selected.caption]) {
  markEdited();
  syncOptions();
  requestPreview();
  for (const kind of kinds) refreshGalleryPreviews(kind);
}

$('caption-on').addEventListener('change', event => {
  captions[selected.caption].on = event.target.checked;
  $('caption-fields').hidden = !event.target.checked;
  captionChanged();
});
// A blessing someone typed goes along to every frame with a blessing, so changing
// the frame never throws their words away (place names on travel frames stay apart).
$('caption-text').addEventListener('input', event => {
  const kind = selected.caption;
  const shared = kind === 'travel' ? [kind] : Object.keys(captions).filter(item => item !== 'travel');
  for (const item of shared) captions[item].text = event.target.value;
  $('caption-clear').disabled = !event.target.value;
  captionChanged(shared);
});
// The words come filled in; one tap clears them for one's own, instead of deleting letter by letter.
$('caption-clear').addEventListener('click', () => {
  const field = $('caption-text');
  field.value = '';
  field.dispatchEvent(new Event('input'));
  field.focus();
});
// The keyboard's 完成 (Enter) key puts the keyboard away.
for (const id of ['caption-text', 'caption-date']) {
  $(id).addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      event.target.blur();
    }
  });
}
// On 出游纪念 the date can be written by hand; it is the same date every frame shows.
$('caption-date').addEventListener('input', event => {
  stamp.typed = event.target.value;
  // A date written for a photo without one turns the switch on.
  $('date-on').checked = stampOn(selected);
  markEdited();
  syncOptions();
  requestPreview();
  refreshGalleryPreviews();
});

// The date switch beside 点一下，换相框: one tap puts the date on or takes it off.
// It shows once the user's own photo is in, and stays in the same place on every frame.
function syncStamp() {
  $('date-switch').hidden = !isUserPhoto;
  $('date-on').checked = stampOn(selected);
  // On phones the switch takes the place of the frame count (each category shows its own).
  const head = $('frame-title').parentElement;
  if (head.classList.contains('with-date') !== isUserPhoto) {
    head.classList.toggle('with-date', isUserPhoto);
    fitFrameHead();
    scheduleLayout();
  }
}

// The heading and the date switch share one line. If large text or zoom would push the
// switch onto a line of its own (and the frames further down), the heading is shortened.
function fitFrameHead() {
  const title = $('frame-title');
  const head = title.parentElement;
  head.classList.remove('tight', 'stacked');
  if (!isUserPhoto) return;
  const wrapped = () => {
    const titleBox = title.getBoundingClientRect();
    return $('date-switch').getBoundingClientRect().top >= titleBox.top + titleBox.height / 2;
  };
  if (!wrapped()) return;
  head.classList.add('tight');
  if (!wrapped()) return;
  // Even 换相框 leaves no room (very large text): the switch gets a line of its own,
  // under the whole heading, without reaching up over it.
  head.classList.remove('tight');
  head.classList.add('stacked');
}

$('date-on').addEventListener('change', event => {
  stamp.on = event.target.checked;
  // Turned on for a photo without a taken date: the person chose today, and is told so.
  if (stamp.on && !stampHasDate()) stamp.useToday = true;
  markEdited();
  syncCaption();
  syncOptions();
  requestPreview();
  refreshGalleryPreviews();
  const {year, month, day} = stamp.taken || todayParts;
  stampNote = !stamp.on ? '日期去掉了'
    : stamp.typed !== null ? (stampText() ? `印上了：${stampText()}` : '日期是空的，在「改字」里写上')
    : stamp.taken ? `印上了拍照那天：${year}年${month}月${day}日` : '照片里没有拍照日期，印的是今天';
  showStatus(stampNote);
  track('date_toggled');
});

// Phones: the preview shrinks to leave room under it for the categories and a whole
// row of frame cards above the bottom bar, also on small screens and with large text.
// Wider screens: the photo column stays in view beside the frames when it fits.
let layoutFrame = 0;
// The sample photo is 960 x 720: before it arrives the box already has its size.
const sampleShape = 4 / 3;
let steadyWidth = 0;
let steadyHeight = 0;
let steadySince = 0;
let stageFor;
let stageWidth = 0;
let stageRem = 0;
let stageView = 0;
const framesPanel = document.querySelector('.frames-panel');
const photoPanel = document.querySelector('.photo-panel');

function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    layoutPage();
  });
}

// The window gets taller when a phone's address bar slides away and shorter when the
// keyboard opens. Neither should resize or unpin the preview, so the layout follows
// the window's height only when the phone is turned (a new width) or the window
// really changes size (split screen), not while someone is typing. Right after a turn
// the browser may report the height in steps, so for a moment every new value counts.
// The page's own size is used, not the visible part of it, so pinching to zoom in
// (which shrinks the visible part) never resizes anything either.
function steadyViewHeight() {
  const root = document.documentElement;
  const width = root.clientWidth || window.innerWidth;
  const height = root.clientHeight || window.innerHeight;
  const now = Date.now();
  const field = document.activeElement;
  const typing = field && field.tagName === 'INPUT' && field.type === 'text';
  if (width !== steadyWidth) {
    steadySince = now;
    setTimeout(scheduleLayout, 300);
    setTimeout(scheduleLayout, 900);
  }
  if (!steadyHeight || now - steadySince < 1000 || (!typing && Math.abs(height - steadyHeight) > steadyHeight * .3)) {
    steadyWidth = width;
    steadyHeight = height;
  }
  return steadyHeight;
}

function layoutPage() {
  const root = document.documentElement;
  const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
  const view = steadyViewHeight();
  fitFrameHead();
  root.classList.toggle('short-phone', phoneLayout.matches && view <= 34 * rem);
  const bar = $('bar');
  root.style.setProperty('--bar-h', `${phoneLayout.matches ? bar.offsetHeight : 0}px`);
  // The box takes the photo's shape, not the frame's, so trying frames never resizes it.
  const shape = image && image.width && image.height ? image.width / image.height : sampleShape;
  const style = getComputedStyle(stage);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  // Panoramas and long screenshots get a shorter box instead of empty space.
  let natural = (stage.clientWidth - padX) / shape + padY;
  // On phones 调整, 改字 and 看大图 sit on the corners of the box. Over a normal photo
  // they cover only the frame's corners, but a wide, low photo (a panorama) would
  // disappear under them, so it gets a strip above and below for the buttons.
  const tool = phoneLayout.matches && isUserPhoto ? $('adjust').firstElementChild.offsetHeight : 0;
  // The frame's border makes the picture up to about 40% taller than such a photo.
  if (tool && natural - padY < 10 * rem) natural = Math.max(natural, (natural - padY) * 1.4 + 2 * (tool + .6 * rem));
  if (!pinnedPhone.matches) stageWidth = 0;
  if (!phoneLayout.matches) {
    stage.style.height = '';
  } else if (!pinnedPhone.matches) {
    // Short or zoomed phones: the box scrolls with the page and is never taller than the photo needs.
    stage.style.height = `${Math.round(Math.max(7 * rem, Math.min(natural, view * .6)))}px`;
  } else {
    const dock = $('dock');
    const card = grid.firstElementChild;
    const panelTop = framesPanel.getBoundingClientRect().top;
    const reserve = card ? card.getBoundingClientRect().bottom - panelTop : 15 * rem;
    const chrome = dock.offsetHeight - stage.offsetHeight;
    const room = view - bar.offsetHeight - chrome - reserve - .5 * rem;
    const height = Math.round(Math.max(7 * rem, Math.min(room, natural, view * .5)));
    // The box is sized again only for a new photo, a turned phone or another text size.
    // Otherwise it may only get smaller, when that is what keeps a row of frames in sight:
    // picking frames, categories or saving never makes it grow and shrink.
    const current = parseFloat(stage.style.height) || 0;
    const fresh = stageFor !== image || stageWidth !== steadyWidth || stageView !== view || stageRem !== rem;
    if (fresh || !current || height < current - 1) {
      stage.style.height = `${height}px`;
      stageFor = image;
      stageWidth = steadyWidth;
      stageView = view;
      stageRem = rem;
    }
    root.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  }
  // Keep the photo beside the frames on tablets and computers, if the whole column fits.
  const fits = twoColumns.matches && photoPanel.offsetHeight + 24 <= window.innerHeight;
  photoPanel.classList.toggle('stick', fits);
}

window.addEventListener('resize', scheduleLayout);
// iPhone Safari shows the pressed look of buttons (:active) only when the page listens to touches.
document.addEventListener('touchstart', () => {}, {passive: true});
// Safari before 14 and old Android browsers only know addListener.
function onMediaChange(query, run) {
  if (query.addEventListener) query.addEventListener('change', run);
  else if (query.addListener) query.addListener(run);
}
for (const query of [phoneLayout, twoColumns]) onMediaChange(query, scheduleLayout);
// Turning a tablet can switch between one-tap and two-tap saving.
for (const query of [phoneLayout, coarsePointer]) onMediaChange(query, updateBar);
if ('ResizeObserver' in window) {
  const watch = new ResizeObserver(scheduleLayout);
  for (const element of [$('bar'), $('dock'), filters, photoPanel]) watch.observe(element);
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLayout);

// The brand link only scrolls to the top, and leaving with unsaved work asks first.
window.addEventListener('beforeunload', event => {
  if (!unsaved) return;
  event.preventDefault();
  event.returnValue = '';
});

// The help names the buttons this device shows.
function helpSave() {
  const make = savesDirectly() ? '保存照片' : phoneLayout.matches ? '做好照片' : '做好这张照片';
  $('help-save').textContent = savesDirectly() ? `满意了就点「${make}」，照片会存进手机的「下载」。`
    : isWeChat ? `满意了就点「${make}」，再用手指按住照片，选「发送给朋友」或「保存图片」。`
    : longPressSave ? `满意了就点「${make}」，再用手指按住照片，选「保存图片」。`
    : isApple ? `满意了就点「${make}」，再按提示存进相册。`
    : `满意了就点「${make}」，再点「下载照片」。`;
}
$('help-open').addEventListener('click', event => {
  helpSave();
  openDialog($('help-dialog'), event.currentTarget);
});

if ('ResizeObserver' in window) new ResizeObserver(fitPreview).observe(stage);
else window.addEventListener('resize', fitPreview);
drawGallery();
updateBar();
syncCaption();
layoutPage();
preview.hidden = true;
$('stage-placeholder').hidden = false;
loadImage('./assets/example.webp').then(sample => {
  if (isUserPhoto) return;
  setImage(sample);
  updateBar();
  syncOptions();
  refreshGalleryPreviews();
  requestPreview();
}).catch(() => {
  $('preview-label').textContent = '等待选图';
});
setupAnalytics();
// Tells old.js that the page started; very old browsers never get here and see its note.
window.frameAppReady = true;

// Keep the page's files on the phone so the next visit opens without downloading
// them again (see sw.js). WeChat on iPhone has no service workers and skips this.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const register = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
