import {frames, categories, byId} from './frames.js';
import {aspectRatio, dimensions, paint} from './render.js?v=2';
import {setupAnalytics, track} from './analytics.js';

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
const defaults = {ratio: 'original', fit: 'contain', rotation: 0, x: .5, y: .5};
const thumbnailOptions = {...defaults, fit: 'cover'};
const tileWidth = 184;
const tileHeight = 116;
const listSize = 6;
const maxImportSize = 50 * 1024 * 1024;
const exportEdge = 4096;
const exportPixels = 16_000_000;
let exportNumber = 0;

let image = null;
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
let resultUrl = '';
let resultFile = null;
let dragDepth = 0;

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
  $('save-hint').textContent = isUserPhoto ? '先看成品，再下载保存' : '先选一张自己的照片';
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
  const [width, height] = dimensions(image, options, 1200);
  paint(preview, image, selected, options, width, height);
  preview.setAttribute('aria-label', `${isUserPhoto ? '照片' : '示例照片'}预览，${selected.name}相框`);
  preview.hidden = false;
  $('view-frame').disabled = false;
  $('stage-placeholder').hidden = true;
  fitPreview();
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
  if (!isUserPhoto) {
    canvas.style.width = '';
    paint(canvas, image, frame, {...thumbnailOptions, rotation: options.rotation}, tileWidth, tileHeight);
    return;
  }
  const ratio = aspectRatio(image, options);
  const width = Math.max(1, Math.round(Math.min(tileWidth, tileHeight * ratio)));
  const height = Math.max(1, Math.round(Math.min(tileHeight, tileWidth / ratio)));
  canvas.style.width = `${100 * width / tileWidth}%`;
  paint(canvas, image, frame, options, width, height);
}

function refreshGalleryPreviews() {
  for (const button of grid.children) {
    drawTile(button.querySelector('canvas'), byId.get(button.dataset.frame));
  }
}

function drawGallery() {
  const items = category === 'all' ? frames : frames.filter(frame => frame.category === category);
  $('frame-count').textContent = `${items.length} 款相框`;
  more.hidden = items.length <= listSize;
  more.setAttribute('aria-expanded', String(expanded));
  more.firstChild.textContent = expanded ? '收起相框 ' : '查看更多相框 ';
  const entries = document.createDocumentFragment();
  for (const frame of expanded ? items : items.slice(0, listSize)) {
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
}

filters.addEventListener('click', event => {
  const button = event.target.closest('button[data-category]');
  if (!button || category === button.dataset.category) return;
  category = button.dataset.category;
  expanded = false;
  for (const filter of filters.children) filter.setAttribute('aria-pressed', String(filter === button));
  drawGallery();
});

grid.addEventListener('click', event => {
  const button = event.target.closest('button[data-frame]');
  if (!button) return;
  selected = byId.get(button.dataset.frame);
  updateFrameSelection();
  requestPreview();
  track('frame_selected');
});

more.addEventListener('click', () => {
  expanded = !expanded;
  drawGallery();
  if (expanded) grid.children[listSize]?.focus({preventScroll: false});
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
    const scale = Math.min(1, exportEdge / Math.max(photo.naturalWidth, photo.naturalHeight),
      Math.sqrt(exportPixels / (photo.naturalWidth * photo.naturalHeight)));
    if (scale === 1) return photo;
    const width = Math.max(1, Math.round(photo.naturalWidth * scale));
    const height = Math.max(1, Math.round(photo.naturalHeight * scale));
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(photo, {resizeWidth: width, resizeHeight: height, resizeQuality: 'high'});
      } catch {
        // Some browsers support Canvas without bitmap resizing options.
      }
    }
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
    image?.close?.();
    image = photo;
    isUserPhoto = true;
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
  } catch {
    if (version === importVersion) showImportError('这张照片打不开。请试试另一张。');
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
$('retry-photo').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  void importPhoto(file);
});

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

stage.addEventListener('dragenter', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  stage.classList.add('dragging');
});
stage.addEventListener('dragover', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
stage.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) stage.classList.remove('dragging');
});
stage.addEventListener('drop', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  stage.classList.remove('dragging');
  void importPhoto(event.dataTransfer.files[0]);
});

function syncOptions() {
  $('ratio').value = options.ratio;
  $('fit').value = options.fit;
  const photoRatio = image && aspectRatio(image, {...options, ratio: 'original'});
  const frameRatio = image && aspectRatio(image, options);
  const crop = options.fit === 'cover' && photoRatio && Math.abs(Math.log(photoRatio / frameRatio)) > .001;
  $('crop-note').hidden = !crop;
  $('position').hidden = !crop;
  $('position-x').hidden = !crop || photoRatio < frameRatio;
  $('position-y').hidden = !crop || photoRatio > frameRatio;
  $('undo').disabled = adjustmentHistory.length === 0;
  for (const button of $('position').querySelectorAll('button')) {
    const value = options[button.dataset.axis];
    const atEdge = Number(button.dataset.step) > 0 ? value >= 1 : value <= 0;
    button.setAttribute('aria-disabled', String(atEdge));
  }
}

function applyAdjustment(next) {
  if (Object.keys(next).every(key => next[key] === options[key])) return;
  adjustmentHistory.push(options);
  if (adjustmentHistory.length > 30) adjustmentHistory.shift();
  options = {...options, ...next};
  redrawAdjustment();
}

function redrawAdjustment() {
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
$('undo').addEventListener('click', () => {
  options = adjustmentHistory.pop();
  redrawAdjustment();
  if ($('undo').disabled) $('rotate').focus();
});

function encode(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Empty output')), 'image/jpeg', .94);
  });
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  $('result-image').removeAttribute('src');
  $('result-download').removeAttribute('href');
  $('share-status').textContent = '';
  resultUrl = '';
  resultFile = null;
}

save.addEventListener('click', async () => {
  if (save.disabled || !image) return;
  exporting = true;
  $('save-status').textContent = '';
  updateSave();
  const version = importVersion;
  const photo = image;
  const frame = selected;
  const settings = {...options};
  const canvas = document.createElement('canvas');
  try {
    const [width, height] = dimensions(photo, settings, exportEdge, exportPixels);
    paint(canvas, photo, frame, settings, width, height);
    const blob = await encode(canvas);
    if (version !== importVersion) return;
    clearResult();
    resultUrl = URL.createObjectURL(blob);
    $('result-image').src = resultUrl;
    $('result-download').href = resultUrl;
    const filename = `拾光相框-${new Date().toISOString().replace(/[:.]/g, '-')}-${++exportNumber}.jpg`;
    $('result-download').download = filename;
    if (typeof File === 'function') resultFile = new File([blob], filename, {type: blob.type});
    $('share').hidden = !(resultFile && navigator.canShare?.({files: [resultFile]}));
    if (typeof resultDialog.showModal === 'function') resultDialog.showModal();
    else resultDialog.setAttribute('open', '');
    track('photo_exported');
  } catch {
    if (version === importVersion) $('save-status').textContent = '这次没做好。可以点上方按钮再试一次，或换一张较小的照片。';
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    exporting = false;
    updateSave();
  }
});

$('result-download').addEventListener('click', () => {
  $('share-status').textContent = '请打开浏览器的「下载」列表查看进度和文件。';
  track('photo_download_clicked');
});

$('share').addEventListener('click', async () => {
  const message = $('share-status');
  try {
    await navigator.share({files: [resultFile]});
    track('photo_share_completed');
  } catch (error) {
    if (error.name === 'AbortError') return;
    message.textContent = '无法打开分享菜单。请试试下载或长按照片。';

  }
});
resultDialog.querySelector('form').addEventListener('submit', event => {
  if (typeof resultDialog.close === 'function') return;
  event.preventDefault();
  resultDialog.removeAttribute('open');
  save.focus();
});
resultDialog.addEventListener('close', () => {
  save.focus({preventScroll: true});
});

const frameDialog = $('frame-dialog');
const viewFrame = $('view-frame');
viewFrame.addEventListener('click', () => {
  if (!image) return;
  const canvas = $('frame-preview');
  const [width, height] = dimensions(image, options, 1200);
  paint(canvas, image, selected, options, width, height);
  canvas.setAttribute('aria-label', selected.name + '相框全图预览');
  const detail = $('frame-detail');
  detail.hidden = Math.max(width / height, height / width) < 3;
  detail.open = false;
  if (!detail.hidden) {
    const swatch = document.createElement('canvas');
    paint(swatch, null, selected, defaults, 600, 600);
    const corner = $('corner-preview');
    corner.width = corner.height = 180;
    corner.getContext('2d').drawImage(swatch, 0, 0, 180, 180, 0, 0, 180, 180);
  }
  if (typeof frameDialog.showModal === 'function') frameDialog.showModal();
  else {
    frameDialog.setAttribute('open', '');
    frameDialog.querySelector('button').focus();
  }
});
frameDialog.querySelector('form').addEventListener('submit', event => {
  if (typeof frameDialog.close === 'function') return;
  event.preventDefault();
  frameDialog.removeAttribute('open');
  viewFrame.focus();
});
frameDialog.addEventListener('close', () => viewFrame.focus({preventScroll: true}));

const help = $('help-dialog');
$('help-open').addEventListener('click', () => {
  if (typeof help.showModal === 'function') help.showModal();
  else {
    help.setAttribute('open', '');
    help.querySelector('button').focus();
  }
});
help.querySelector('form').addEventListener('submit', event => {
  if (typeof help.close === 'function') return;
  event.preventDefault();
  help.removeAttribute('open');
  $('help-open').focus();
});
help.addEventListener('close', () => $('help-open').focus({preventScroll: true}));

if ('ResizeObserver' in window) new ResizeObserver(fitPreview).observe(stage);
else window.addEventListener('resize', fitPreview);
drawGallery();
preview.hidden = true;
$('stage-placeholder').hidden = false;
loadImage(new URL('./example.webp', import.meta.url).href).then(sample => {
  if (isUserPhoto) return;
  image = sample;
  syncOptions();
  refreshGalleryPreviews();
  requestPreview();
}).catch(() => {
  $('preview-label').textContent = '等待选图';
});
setupAnalytics();
