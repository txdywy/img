import {frames, categories, byId} from './frames.js?v=13';
import {fixedLayout, layout, layoutInBox, paint, photoRatio, placement} from './render.js?v=13';
import {setupAnalytics, track} from './analytics.js?v=13';
import {openDialog, pushLayer, releaseLayer} from './dialog.js?v=13';

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
const longPressSave = isWeChat || /\bQQ\/|Weibo|DingTalk|AlipayClient/i.test(navigator.userAgent);
const isAndroid = /Android|HarmonyOS|OpenHarmony/i.test(navigator.userAgent);
const coarsePointer = window.matchMedia('(pointer: coarse)');
// The phone layout: preview pinned on top, one big button at the bottom.
const phoneLayout = window.matchMedia('(max-width: 46rem)');
const pinnedPhone = window.matchMedia('(max-width: 46rem) and (min-height: 34.01rem)');
const twoColumns = window.matchMedia('(min-width: 46.01rem)');
let exportNumber = 0;

// image is full resolution for export; the smaller copies keep redraws fast.
let image = null;
let previewSource = null;
let thumbSource = null;
let isUserPhoto = false;
let selected = frames[0];
let options = {...defaults};
const adjustmentHistory = [];
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
let dragDepth = 0;
let unsaved = false;
let savedNote = false;
// A finished photo was made but not saved yet (the window was closed first).
let madeNotSaved = false;
let importProblem = '';
let zoomed = false;
const today = new Date();
const captions = {
  blessing: {on: true, text: '福如东海 · 寿比南山'},
  birthday: {on: true, text: '生日快乐'},
  travel: {on: true, text: '', date: `${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}`},
};
const captionLabels = {
  blessing: {toggle: '加一句祝福', text: '祝福语', placeholder: '福如东海 · 寿比南山'},
  birthday: {toggle: '加上祝福文字', text: '文字', placeholder: '生日快乐'},
  travel: {toggle: '写上地点和日期', text: '地点', placeholder: '例如：杭州西湖'},
};

function captionFor(frame) {
  const state = captions[frame.caption];
  if (!state || !state.on) return '';
  if (frame.caption === 'travel') return [state.text.trim(), state.date.trim()].filter(Boolean).join('  ·  ');
  return state.text.trim();
}

// The settings a frame is drawn with: the shared adjustments plus its own words.
const look = (frame, base = options) => ({...base, text: captionFor(frame)});

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
  showStatus(message, true, help + (isUserPhoto ? ' 上一张照片还在，可以接着用。' : ''));
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
    : pending ? `还没存好，再点「${make}」就能存`
    : isUserPhoto ? (direct ? '点相框换样式，满意就保存' : `点相框换样式，满意就点「${make}」`)
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

function setImage(photo) {
  if (image && image !== photo && image.close) image.close();
  image = photo;
  previewSource = downscale(photo, previewEdge);
  thumbSource = downscale(previewSource, Math.max(tileWidth, tileHeight) * 2);
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

// Scroll just enough that a frame card sits fully between the pinned preview and the bottom bar.
function revealCard(card) {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const top = pinnedPhone.matches ? $('dock').getBoundingClientRect().bottom + 8 : 8;
  const bottom = (phoneLayout.matches ? $('bar').getBoundingClientRect().top : window.innerHeight) - 8;
  if (rect.bottom > bottom) window.scrollBy(0, Math.min(rect.bottom - bottom, rect.top - top));
  else if (rect.top < top) window.scrollBy(0, rect.top - top);
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
    const rect = more.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) more.scrollIntoView({block: 'center'});
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
    const photo = await readPhoto(file);
    if (version !== importVersion) {
      if (photo.close) photo.close();
      return;
    }
    const first = !isUserPhoto;
    setImage(photo);
    isUserPhoto = true;
    unsaved = true;
    savedNote = false;
    madeNotSaved = false;
    options = {...defaults};
    adjustmentHistory.length = 0;
    syncOptions();
    $('preview-label').textContent = '我的照片';
    $('pick-text').textContent = '换一张照片';
    $('file-hint').textContent = '原照片还在';
    // On phones this message is only read out: the bar already says what to do next.
    showStatus('照片已选好。');
    previewDirty = true;
    drawPreview();
    refreshGalleryPreviews();
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
  const top = $('editor').getBoundingClientRect().top + window.scrollY;
  if (window.scrollY < top) window.scrollTo(0, top);
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
  $('undo').disabled = adjustmentHistory.length === 0;
  for (const button of $('position').querySelectorAll('button')) {
    const value = options[button.dataset.axis];
    const atEdge = Number(button.dataset.step) > 0 ? value >= 1 : value <= 0;
    button.setAttribute('aria-disabled', String(atEdge));
  }
}

function remember(previous) {
  adjustmentHistory.push(previous);
  if (adjustmentHistory.length > 30) adjustmentHistory.shift();
}

function applyAdjustment(next) {
  if (Object.keys(next).every(key => next[key] === options[key])) return;
  remember(options);
  options = {...options, ...next};
  redrawAdjustment();
}

// Any change to the user's photo after saving it needs saving again.
function markEdited() {
  if (!isUserPhoto) return;
  unsaved = true;
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
$('undo').addEventListener('click', () => {
  options = adjustmentHistory.pop();
  redrawAdjustment();
  if ($('undo').disabled) $('rotate').focus();
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
  remember(start);
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

function showResult(opener) {
  const canShare = Boolean(resultFile && navigator.canShare && navigator.canShare({files: [resultFile]}));
  // On iPhone and iPad, the share sheet is the direct way into Photos.
  const shareFirst = canShare && isApple && !longPressSave;
  share.hidden = !canShare;
  share.className = `button ${shareFirst ? 'primary' : 'secondary'}`;
  download.className = `button ${shareFirst || longPressSave ? 'secondary' : 'primary'}`;
  $('share-text').textContent = shareFirst ? '保存到相册' : '发给家人或其他应用';
  $('download-text').textContent = shareFirst ? '下载到文件' : '下载照片';
  const lead = $('result-lead');
  lead.classList.remove('saved');
  // Honest about the one step that is left: the photo is made, not yet saved.
  $('result-title').textContent = longPressSave ? '还差一步：按住照片保存' : '还差一步：把照片存好';
  lead.textContent = longPressSave
    ? `${isWeChat ? '在微信里' : '在这里'}：用手指按住下面的照片不放，选「保存图片」，就存进相册了。也可以选「发送给朋友」。`
    : shareFirst ? '点下面的「保存到相册」，在弹出的菜单里选「存储图像」。'
    : '点下面的「下载照片」，存到这台设备。';
  // In WeChat nothing tells the page whether the photo was saved, so it never claims either.
  madeNotSaved = !longPressSave;
  $('result-close').textContent = madeNotSaved ? '先不存，返回' : '返回挑相框';
  download.after(share);
  if (shareFirst) download.before(share);
  openDialog(resultDialog, opener);
}

// Saved: say so in the window and keep saying it on the page after it closes.
function markSaved(message, title = '✓ 照片已保存') {
  unsaved = false;
  savedNote = true;
  madeNotSaved = false;
  $('result-title').textContent = title;
  $('result-close').textContent = '返回挑相框';
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
    $('result-image').src = longPressSave ? await dataUrl(blob) : resultUrl;
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
  markSaved(isApple
    ? `已存好。在「文件」App 的「下载项」里，名字是「${download.download}」。`
    : `已存到这台设备的「下载」里，名字是「${download.download}」。手机相册里一般也能看到。`);
  $('download-text').textContent = '再存一次';
  track('photo_download_clicked');
});

share.addEventListener('click', async () => {
  const message = $('share-status');
  try {
    await navigator.share({files: [resultFile]});
    message.textContent = '';
    if (isApple) markSaved('如果选了「存储图像」，照片就在相册里了。', '✓ 好了');
    else {
      unsaved = false;
      madeNotSaved = false;
      updateSave();
    }
    track('photo_share_completed');
  } catch (error) {
    if (error.name === 'AbortError') return;
    message.textContent = '无法打开分享菜单。请试试下载或长按照片。';
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
  $('caption-date').value = state.date || '';
  $('caption-date-row').hidden = kind !== 'travel';
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
  captionChanged(shared);
});
$('caption-date').addEventListener('input', event => {
  captions[selected.caption].date = event.target.value;
  captionChanged();
});

// Phones: the preview shrinks to leave room under it for the categories and a whole
// row of frame cards above the bottom bar, also on small screens and with large text.
// Wider screens: the photo column stays in view beside the frames when it fits.
let layoutFrame = 0;
const framesPanel = document.querySelector('.frames-panel');
const photoPanel = document.querySelector('.photo-panel');

function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    layoutPage();
  });
}

function layoutPage() {
  const root = document.documentElement;
  const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
  const bar = $('bar');
  root.style.setProperty('--bar-h', `${phoneLayout.matches ? bar.offsetHeight : 0}px`);
  const shape = image ? preview.width / preview.height : 1.38;
  if (!pinnedPhone.matches) {
    stage.style.height = '';
    if (phoneLayout.matches) {
      // Short or zoomed phones: the box is never taller than the photo needs.
      const style = getComputedStyle(stage);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const natural = (stage.clientWidth - padX) / shape + padY;
      if (natural < stage.offsetHeight) stage.style.height = `${Math.round(Math.max(7 * rem, natural))}px`;
    }
  } else {
    const dock = $('dock');
    const style = getComputedStyle(stage);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const card = grid.firstElementChild;
    const panelTop = framesPanel.getBoundingClientRect().top;
    const reserve = card ? card.getBoundingClientRect().bottom - panelTop : 15 * rem;
    const chrome = dock.offsetHeight - stage.offsetHeight;
    const room = window.innerHeight - bar.offsetHeight - chrome - reserve - .5 * rem;
    // Panoramas and long screenshots get a shorter box instead of empty space.
    const natural = (stage.clientWidth - padX) / shape + padY;
    const height = Math.max(7 * rem, Math.min(room, natural, window.innerHeight * .5));
    stage.style.height = `${Math.round(height)}px`;
    root.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  }
  // Keep the photo beside the frames on tablets and computers, if the whole column fits.
  const fits = twoColumns.matches && photoPanel.offsetHeight + 24 <= window.innerHeight;
  photoPanel.classList.toggle('stick', fits);
}

window.addEventListener('resize', scheduleLayout);
// Safari before 14 and old Android browsers only know addListener.
function onMediaChange(query, run) {
  if (query.addEventListener) query.addEventListener('change', run);
  else if (query.addListener) query.addListener(run);
}
for (const query of [phoneLayout, pinnedPhone, twoColumns]) onMediaChange(query, scheduleLayout);
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

$('help-open').addEventListener('click', event => openDialog($('help-dialog'), event.currentTarget));

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
