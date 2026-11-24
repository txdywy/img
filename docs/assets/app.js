import {frames, categories, byId} from './frames.js?v=8';
import {fixedLayout, layout, layoutInBox, paint, photoRatio, placement} from './render.js?v=8';
import {setupAnalytics, track} from './analytics.js?v=8';
import {openDialog} from './dialog.js?v=8';

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
const defaults = {ratio: 'original', fit: 'contain', rotation: 0, x: .5, y: .5};
const tileWidth = 184;
const tileHeight = 116;
const listSize = 6;
const previewEdge = 1200;
const maxImportSize = 50 * 1024 * 1024;
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
  previewLayout = layout(image, selected, options, previewEdge);
  paint(preview, previewSource, selected, options, previewLayout);
  preview.setAttribute('aria-label', `${isUserPhoto ? '照片' : '示例照片'}预览，${selected.name}相框`);
  preview.hidden = false;
  viewFrame.disabled = false;
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
    paint(canvas, thumbSource, frame, {...defaults, rotation: options.rotation},
      fixedLayout(frame, tileWidth * scale, tileHeight * scale));
    return;
  }
  const tile = layoutInBox(thumbSource, frame, options, tileWidth * scale, tileHeight * scale);
  canvas.style.width = `${100 * tile.width / (tileWidth * scale)}%`;
  paint(canvas, thumbSource, frame, options, tile);
}

function refreshGalleryPreviews() {
  for (const button of grid.children) {
    drawTile(button.querySelector('canvas'), byId.get(button.dataset.frame));
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
  more.firstChild.textContent = expanded ? '收起相框 ' : '查看更多相框 ';
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
  syncOptions();
  requestPreview();
  track('frame_selected');
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
    const scale = Math.min(1, exportEdge / Math.max(photo.naturalWidth, photo.naturalHeight),
      Math.sqrt(exportPixels / (photo.naturalWidth * photo.naturalHeight)));
    const width = Math.max(1, Math.round(photo.naturalWidth * scale));
    const height = Math.max(1, Math.round(photo.naturalHeight * scale));
    if (scale < 1 && typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(photo, {resizeWidth: width, resizeHeight: height, resizeQuality: 'high'});
      } catch {
        // Some browsers support Canvas without bitmap resizing options.
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

function syncOptions() {
  const original = options.ratio === 'original';
  $('ratio').value = options.ratio;
  $('fit').value = options.fit;
  $('fit').hidden = $('fit-label').hidden = original;
  crop = null;
  if (image && !original && options.fit === 'cover') {
    const {area} = layout(image, selected, options, previewEdge);
    const difference = Math.log(photoRatio(image, options.rotation) / (area.w / area.h));
    if (Math.abs(difference) > .005) crop = {x: difference > 0, y: difference < 0};
  }
  $('crop-note').hidden = !crop;
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

// Drag the photo inside the frame when part of it is cropped.
preview.addEventListener('pointerdown', event => {
  if (!crop || !previewLayout || event.button > 0) return;
  event.preventDefault();
  preview.setPointerCapture(event.pointerId);
  const {area} = previewLayout;
  const place = placement(image, options, area);
  const scale = preview.getBoundingClientRect().width / preview.width;
  pan = {
    id: event.pointerId, x: event.clientX, y: event.clientY, start: options,
    rangeX: crop.x ? (place.w - area.w) * scale : 0,
    rangeY: crop.y ? (place.h - area.h) * scale : 0,
  };
  stage.classList.add('panning');
});
preview.addEventListener('pointermove', event => {
  if (!pan || event.pointerId !== pan.id) return;
  const next = {...options};
  if (pan.rangeX > 1) next.x = clamp(pan.start.x - (event.clientX - pan.x) / pan.rangeX);
  if (pan.rangeY > 1) next.y = clamp(pan.start.y - (event.clientY - pan.y) / pan.rangeY);
  options = next;
  requestPreview();
});
function endPan(event) {
  if (!pan || event.pointerId !== pan.id) return;
  const {start} = pan;
  pan = null;
  stage.classList.remove('panning');
  if (start.x === options.x && start.y === options.y) return;
  remember(start);
  redrawAdjustment();
}
preview.addEventListener('pointerup', endPan);
preview.addEventListener('pointercancel', endPan);

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

function exportName() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `拾光相框-${date}-${time}-${++exportNumber}.jpg`;
}

function showResult() {
  const canShare = Boolean(resultFile && navigator.canShare?.({files: [resultFile]}));
  // On iPhone and iPad, the share sheet is the direct way into Photos.
  const shareFirst = canShare && isApple;
  share.hidden = !canShare;
  share.className = `button ${shareFirst ? 'primary' : 'secondary'}`;
  download.className = `button ${shareFirst ? 'secondary' : 'primary'}`;
  $('share-text').textContent = shareFirst ? '保存到相册' : '发给家人或其他应用';
  $('download-text').textContent = shareFirst ? '下载到文件' : '下载照片';
  $('result-lead').textContent = shareFirst
    ? '还差一步。点「保存到相册」，在弹出的菜单里选「存储图像」。'
    : '还差一步。点「下载照片」，把成品存到设备。';
  download.after(share);
  if (shareFirst) download.before(share);
  openDialog(resultDialog, save);
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
    paint(canvas, photo, frame, settings, layout(photo, frame, settings, exportEdge, exportPixels));
    const blob = await encode(canvas);
    if (version !== importVersion) return;
    clearResult();
    resultUrl = URL.createObjectURL(blob);
    $('result-image').src = resultUrl;
    download.href = resultUrl;
    const filename = exportName();
    download.download = filename;
    if (typeof File === 'function') resultFile = new File([blob], filename, {type: blob.type});
    showResult();
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

download.addEventListener('click', () => {
  $('share-status').textContent = '请打开浏览器的「下载」列表查看进度和文件。';
  track('photo_download_clicked');
});

share.addEventListener('click', async () => {
  const message = $('share-status');
  try {
    await navigator.share({files: [resultFile]});
    message.textContent = isApple ? '好了。如果选了「存储图像」，照片就在相册里。' : '';
    track('photo_share_completed');
  } catch (error) {
    if (error.name === 'AbortError') return;
    message.textContent = '无法打开分享菜单。请试试下载或长按照片。';
  }
});

viewFrame.addEventListener('click', () => {
  if (!image) return;
  const canvas = $('frame-preview');
  const view = layout(image, selected, options, previewEdge);
  paint(canvas, previewSource, selected, options, view);
  canvas.setAttribute('aria-label', selected.name + '相框全图预览');
  const detail = $('frame-detail');
  detail.hidden = Math.max(view.width / view.height, view.height / view.width) < 3;
  detail.open = false;
  if (!detail.hidden) {
    const swatch = document.createElement('canvas');
    paint(swatch, null, selected, defaults, fixedLayout(selected, 600, 600));
    const corner = $('corner-preview');
    corner.width = corner.height = 180;
    corner.getContext('2d').drawImage(swatch, 0, 0, 180, 180, 0, 0, 180, 180);
  }
  openDialog($('frame-dialog'), viewFrame);
});

$('help-open').addEventListener('click', event => openDialog($('help-dialog'), event.currentTarget));

if ('ResizeObserver' in window) new ResizeObserver(fitPreview).observe(stage);
else window.addEventListener('resize', fitPreview);
drawGallery();
preview.hidden = true;
$('stage-placeholder').hidden = false;
loadImage(new URL('./example.webp', import.meta.url).href).then(sample => {
  if (isUserPhoto) return;
  setImage(sample);
  syncOptions();
  refreshGalleryPreviews();
  requestPreview();
}).catch(() => {
  $('preview-label').textContent = '等待选图';
});
setupAnalytics();
