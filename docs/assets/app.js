import {frames, categories, byId} from './frames.js?v=11';
import {fixedLayout, layout, layoutInBox, paint, photoRatio, placement} from './render.js?v=11';
import {setupAnalytics, track} from './analytics.js?v=11';
import {openDialog} from './dialog.js?v=11';

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
const maxImportPixels = 250_000_000;
const exportEdge = 4096;
const exportPixels = 16_000_000;
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let exportNumber = 0;

// image is full resolution for export; the smaller copies keep redraws fast.
let image = null;
let previewSource = null;
let thumbSource = null;
let isUserPhoto = false;
let sampleShown = false;
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
  if (!state?.on) return '';
  if (frame.caption === 'travel') return [state.text.trim(), state.date.trim()].filter(Boolean).join('  ·  ');
  return state.text.trim();
}

// The settings a frame is drawn with: the shared adjustments plus its own words.
const look = (frame, base = options) => ({...base, text: captionFor(frame)});

const pixelRatio = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));
const clamp = value => Math.max(0, Math.min(1, value));

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
  $('retry-photo').hidden = !error;
}

function showImportError(message) {
  showStatus(message + (isUserPhoto ? ' 仍在使用上一张照片。' : ''), true);
}

function updateSave() {
  save.disabled = !isUserPhoto || reading || exporting;
  $('save-text').textContent = exporting ? '正在制作…' : '做好这张照片';
  $('save-hint').textContent = isUserPhoto ? '先看成品，再保存' : '先选一张自己的照片';
  updateBar();
}

// Phones get one bar at the bottom with the one thing to do next:
// choose a photo first, then save it. Changing the photo stays beside it.
function updateBar() {
  barMain.disabled = reading || exporting;
  barPick.hidden = !isUserPhoto;
  barPick.disabled = reading || exporting;
  $('bar-main-text').textContent = exporting ? '正在制作…'
    : reading ? '正在打开…'
    : isUserPhoto ? '保存照片' : '从相册选照片';
  $('bar-icon').firstElementChild.setAttribute('href', isUserPhoto ? '#i-save' : '#i-photo');
  const problem = $('save-status').textContent;
  const hint = $('bar-hint');
  hint.textContent = problem || (isUserPhoto ? '点下面的相框换样式，满意了就保存'
    : sampleShown ? '上面是示例。先选一张自己的照片' : '先选一张自己的照片');
  hint.classList.toggle('error', Boolean(problem));
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
  if (image && image !== photo) image.close?.();
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

function drawMini() {
  const mini = $('mini-preview');
  const ratio = preview.width / preview.height;
  const height = Math.round(48 * pixelRatio());
  mini.height = height;
  mini.width = Math.max(1, Math.round(height * Math.min(ratio, 2.5)));
  const ctx = mini.getContext('2d', {alpha: false});
  ctx.fillStyle = '#f2e9de';
  ctx.fillRect(0, 0, mini.width, mini.height);
  const scale = Math.min(mini.width / preview.width, mini.height / preview.height);
  const w = preview.width * scale;
  const h = preview.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(preview, (mini.width - w) / 2, (mini.height - h) / 2, w, h);
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
  viewFrame.disabled = dockView.disabled = false;
  $('stage-placeholder').hidden = true;
  fitPreview();
  drawMini();
}

function makeButton(className, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

for (const [id, name] of categories) {
  const button = makeButton('filter', name);
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
  updatePin();
}

function chooseFrame(frame) {
  if (frame === selected) return;
  selected = frame;
  markEdited();
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
});

grid.addEventListener('click', event => {
  const button = event.target.closest('button[data-frame]');
  if (!button || button.dataset.frame === selected.id) return;
  // The words box can appear above the frames; keep the tapped card under the finger.
  const before = button.getBoundingClientRect().top;
  chooseFrame(byId.get(button.dataset.frame));
  const shift = button.getBoundingClientRect().top - before;
  if (Math.abs(shift) > 1) window.scrollBy(0, shift);
});

more.addEventListener('click', () => {
  expanded = !expanded;
  drawGallery();
  if (expanded) grid.children[listSize]?.focus();
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
    showImportError('这张照片太大，请重新选一张较小的照片。');
    updateSave();
    return;
  }
  reading = true;
  showStatus('正在打开照片…');
  updateSave();
  try {
    const photo = await readPhoto(file);
    if (version !== importVersion) {
      photo.close?.();
      return;
    }
    setImage(photo);
    isUserPhoto = true;
    unsaved = true;
    options = {...defaults};
    adjustmentHistory.length = 0;
    syncOptions();
    $('preview-label').textContent = '我的照片';
    $('pick-text').textContent = '换一张照片';
    $('file-hint').textContent = '原照片还在';
    $('go-frames').hidden = false;
    showStatus('照片已选好。');
    requestPreview();
    refreshGalleryPreviews();
    track('photo_selected');
  } catch (error) {
    if (version !== importVersion) return;
    const heic = await isHeic(file);
    // Another photo may have been chosen while the file was checked.
    if (version !== importVersion) return;
    if (error?.name === 'TooManyPixels') {
      showImportError('这张图片的像素太多，打不开。请换一张，或先把它缩小后再选。');
    } else if (heic) {
      showImportError('这张是苹果手机常用的 HEIC 格式，这个浏览器打不开。可以先把它转成 JPG 再选：在相册里编辑后另存一份，或者给照片截个屏。在 iPhone 上用 Safari 打开本网站，也能直接选。');
    } else if (file.type && !file.type.startsWith('image/')) {
      showImportError('这不是照片文件。请选一张照片。');
    } else {
      showImportError('这张照片打不开。可以截个屏，或另存为 JPG 后再选。');
    }
  } finally {
    if (version === importVersion) {
      reading = false;
      updateSave();
    }
  }
}

$('go-frames').addEventListener('click', () => {
  const title = $('frame-title');
  title.focus({preventScroll: true});
  title.scrollIntoView({block: 'start'});
});

$('pick').addEventListener('click', () => fileInput.click());
barPick.addEventListener('click', () => fileInput.click());
barMain.addEventListener('click', () => {
  if (barMain.disabled) return;
  if (isUserPhoto) void exportPhoto(barMain);
  else fileInput.click();
});
$('retry-photo').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  void importPhoto(file);
});

// Accept a dropped photo anywhere, so a missed drop never opens the file and loses the work.
function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
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
  const file = Array.from(event.clipboardData?.files || []).find(item => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  void importPhoto(file);
});

const coarsePointer = window.matchMedia('(pointer: coarse)');

function syncOptions() {
  const original = options.ratio === 'original';
  $('ratio').value = options.ratio;
  $('fit').value = options.fit;
  $('fit').hidden = $('fit-label').hidden = original;
  crop = null;
  if (image && !original && options.fit === 'cover') {
    const {area} = layout(image, selected, look(selected), previewEdge);
    const difference = Math.log(photoRatio(image, options.rotation) / (area.w / area.h));
    if (Math.abs(difference) > .005) crop = {x: difference > 0, y: difference < 0};
  }
  $('crop-note').hidden = !crop;
  $('crop-hold').hidden = !(crop?.y && coarsePointer.matches);
  $('position').hidden = !crop;
  $('position-x').hidden = !crop?.x;
  $('position-y').hidden = !crop?.y;
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
  if (isUserPhoto) unsaved = true;
}

function redrawAdjustment() {
  markEdited();
  syncOptions();
  requestPreview();
  refreshGalleryPreviews();
}

$('ratio').addEventListener('change', event => applyAdjustment({ratio: event.target.value}));
$('fit').addEventListener('change', event => applyAdjustment({fit: event.target.value}));
$('position').addEventListener('click', event => {
  const button = event.target.closest('button[data-axis]');
  if (!button || button.getAttribute('aria-disabled') === 'true') return;
  const {axis, step} = button.dataset;
  const value = Math.max(0, Math.min(100, Math.round(options[axis] * 100) + Number(step)));
  applyAdjustment({[axis]: value / 100});
});
$('rotate').addEventListener('click', () => applyAdjustment({rotation: (options.rotation + 90) % 360}));
$('reset').addEventListener('click', () => applyAdjustment(defaults));
$('adjust').addEventListener('toggle', () => $('dock').classList.toggle('sheet-open', $('adjust').open));
$('adjust-done').addEventListener('click', () => {
  $('adjust').open = false;
  $('adjust').querySelector('summary').focus({preventScroll: true});
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
  preview.setPointerCapture?.(event.pointerId);
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
  if (pan?.held && event.cancelable) event.preventDefault();
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
  const canShare = Boolean(resultFile && navigator.canShare?.({files: [resultFile]}));
  // On iPhone and iPad, the share sheet is the direct way into Photos.
  const shareFirst = canShare && isApple;
  share.hidden = !canShare;
  share.className = `button ${shareFirst ? 'primary' : 'secondary'}`;
  download.className = `button ${shareFirst ? 'secondary' : 'primary'}`;
  $('share-text').textContent = shareFirst ? '保存到相册' : '发给家人或其他应用';
  $('download-text').textContent = shareFirst ? '下载到文件' : '下载照片';
  $('result-lead').textContent = shareFirst
    ? '成品做好了。点「保存到相册」，在弹出的菜单里选「存储图像」。'
    : '成品做好了。点「下载照片」，存到这台设备。';
  download.after(share);
  if (shareFirst) download.before(share);
  openDialog(resultDialog, opener);
}

save.addEventListener('click', () => {
  if (!save.disabled) void exportPhoto(save);
});

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
    $('result-image').src = resultUrl;
    download.href = resultUrl;
    const filename = exportName(frame);
    download.download = filename;
    if (typeof File === 'function') resultFile = new File([blob], filename, {type: blob.type});
    showResult(opener);
    track('photo_exported');
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
  unsaved = false;
  $('share-status').textContent = '';
  $('result-lead').textContent = `已开始下载。请到浏览器的「下载」列表找「${download.download}」${isApple ? '，或在「文件」App 的「下载项」里找' : ''}。`;
  $('download-text').textContent = '再次下载';
  track('photo_download_clicked');
});

share.addEventListener('click', async () => {
  const message = $('share-status');
  try {
    await navigator.share({files: [resultFile]});
    unsaved = false;
    message.textContent = '';
    if (isApple) $('result-lead').textContent = '好了。如果选了「存储图像」，照片就在相册里。';
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
  $('zoom-actions').hidden = long < 2.2;
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
    ? layout(image, selected, settings, 8192, 12_000_000)
    : layout(image, selected, settings, previewEdge);
  paint(canvas, zoom ? image : previewSource, selected, settings, view);
  canvas.setAttribute('aria-label', selected.name + (zoom ? '相框放大预览' : '相框全图预览'));
  zoomed = zoom;
  const wide = view.width >= view.height;
  viewport.classList.toggle('zoomed', zoom);
  viewport.classList.toggle('tall', zoom && !wide);
  viewport.tabIndex = zoom ? 0 : -1;
  canvas.style.width = '';
  canvas.style.height = '';
  if (zoom && wide) canvas.style.height = `${Math.min(window.innerHeight * .5, view.height / pixelRatio())}px`;
  viewport.scrollTo(0, 0);
  const toggle = $('zoom-toggle');
  toggle.setAttribute('aria-pressed', String(zoom));
  toggle.textContent = zoom ? '看整张' : '放大看清两端';
  $('zoom-prev').hidden = $('zoom-next').hidden = $('zoom-hint').hidden = !zoom;
  $('zoom-prev').textContent = wide ? '往左看' : '往上看';
  $('zoom-next').textContent = wide ? '往右看' : '往下看';
  $('zoom-hint').textContent = wide ? '可以左右滑动查看照片两端的人。' : '可以上下滑动查看整张照片。';
  return view;
}

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
  $('caption').hidden = !kind;
  if (!kind) return;
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
}

function captionChanged() {
  markEdited();
  syncOptions();
  requestPreview();
  refreshGalleryPreviews(selected.caption);
}

$('caption-on').addEventListener('change', event => {
  captions[selected.caption].on = event.target.checked;
  $('caption-fields').hidden = !event.target.checked;
  captionChanged();
});
$('caption-text').addEventListener('input', event => {
  captions[selected.caption].text = event.target.value;
  captionChanged();
});
$('caption-date').addEventListener('input', event => {
  captions[selected.caption].date = event.target.value;
  captionChanged();
});

// Pin the frame actions on narrow screens only while they leave room for a whole frame card.
const saveArea = document.querySelector('.save-area');
const framesPanel = document.querySelector('.frames-panel');
const singleColumn = window.matchMedia('(max-width: 72rem)');

function updatePin() {
  const bar = saveArea.offsetHeight;
  const card = grid.firstElementChild?.offsetHeight || 0;
  // On phones the bar is hidden: saving lives in the bottom bar instead.
  const pin = singleColumn.matches && bar > 0 && bar <= window.innerHeight * .35 && bar + card + 32 <= window.innerHeight;
  framesPanel.classList.toggle('pin-actions', pin);
  framesPanel.style.setProperty('--frame-scroll-margin', pin ? `${bar + 12}px` : '0px');
}

// Keep keyboard focus clear of the pinned bar, also when moving backwards.
framesPanel.addEventListener('focusin', event => {
  if (!framesPanel.classList.contains('pin-actions') || saveArea.contains(event.target)) return;
  const covered = saveArea.getBoundingClientRect().bottom + 8 - event.target.getBoundingClientRect().top;
  if (covered > 0 && saveArea.getBoundingClientRect().top <= 1) window.scrollBy(0, -covered);
});
window.addEventListener('resize', updatePin);
singleColumn.addEventListener?.('change', updatePin);
if ('ResizeObserver' in window) new ResizeObserver(updatePin).observe(saveArea);

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
preview.hidden = true;
$('stage-placeholder').hidden = false;
loadImage(new URL('./example.webp', import.meta.url).href).then(sample => {
  if (isUserPhoto) return;
  setImage(sample);
  sampleShown = true;
  updateBar();
  syncOptions();
  refreshGalleryPreviews();
  requestPreview();
}).catch(() => {
  $('preview-label').textContent = '等待选图';
});
setupAnalytics();
