const TAU = Math.PI * 2;
const SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", "STSong", serif';
const SANS = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

function stroke(ctx, color, width, path) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  path();
  ctx.stroke();
}

function ellipse(ctx, x, y, rx, ry, color, angle = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fill();
}

function box(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function flower(ctx, x, y, radius, frame, petals, layers = 1) {
  for (let layer = 0; layer < layers; layer++) {
    const size = radius * (1 - layer / (layers + 1));
    for (let i = 0; i < petals; i++) {
      const angle = i * TAU / petals + layer * .3;
      ellipse(ctx, x + Math.cos(angle) * size * .45, y + Math.sin(angle) * size * .45,
        size * .65, size * .33, layer % 2 ? frame.ink : frame.accent, angle);
    }
  }
  ellipse(ctx, x, y, radius * .21, radius * .21, '#ddaf60');
  ellipse(ctx, x, y, radius * .07, radius * .07, frame.paper);
}

function plum(ctx, m, frame) {
  const {ink, accent, detail} = frame;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  stroke(ctx, detail, m * .055, () => {
    ctx.moveTo(m * .12, m * 1.85);
    ctx.lineTo(m * .44, m * 1.12);
    ctx.lineTo(m * .38, m * .72);
    ctx.lineTo(m * .92, m * .36);
    ctx.lineTo(m * 1.5, m * .3);
    ctx.lineTo(m * 2.1, m * .12);
  });
  stroke(ctx, detail, m * .032, () => {
    ctx.moveTo(m * .44, m * 1.12);
    ctx.lineTo(m * .78, m * .98);
    ctx.moveTo(m * .92, m * .36);
    ctx.lineTo(m * 1.04, m * .1);
  });
  for (const [x, y, r] of [[.62, .55, .3], [1.27, .33, .24], [.42, 1.0, .23], [1.86, .17, .19], [.8, .97, .16], [.3, 1.5, .18]]) {
    for (let i = 0; i < 5; i++) {
      const angle = i * TAU / 5 - Math.PI / 2;
      ellipse(ctx, m * (x + Math.cos(angle) * r * .52), m * (y + Math.sin(angle) * r * .52), m * r * .42, m * r * .42, accent);
    }
    ellipse(ctx, m * x, m * y, m * r * .3, m * r * .3, '#f6d27a');
    for (let i = 0; i < 5; i++) {
      const angle = i * TAU / 5 - Math.PI / 2 + .6;
      ellipse(ctx, m * (x + Math.cos(angle) * r * .26), m * (y + Math.sin(angle) * r * .26), m * r * .05, m * r * .05, ink);
    }
  }
}

function cloud(ctx, m, color) {
  ctx.lineCap = 'round';
  stroke(ctx, color, m * .045, () => {
    ctx.arc(m * .62, m * .62, m * .2, Math.PI * .1, Math.PI * 1.75);
    ctx.moveTo(m * .62 + m * .09, m * .62);
    ctx.arc(m * .62, m * .62, m * .09, 0, Math.PI * 1.5);
  });
  stroke(ctx, color, m * .035, () => {
    ctx.moveTo(m * .8, m * .48);
    ctx.quadraticCurveTo(m * 1.15, m * .3, m * 1.5, m * .45);
    ctx.moveTo(m * .48, m * .8);
    ctx.quadraticCurveTo(m * .3, m * 1.15, m * .45, m * 1.5);
  });
}

function botanical(ctx, m, frame) {
  const {motif, detail} = frame;
  if (motif === 'plum') {
    plum(ctx, m, frame);
    return;
  }
  const sizes = { peony: [5, 3, 1], rose: [6, 3, .9], lotus: [8, 1, .88], blossom: [5, 1, .65], osmanthus: [4, 1, .49] };
  ctx.lineCap = 'round';
  stroke(ctx, detail, m * .036, () => {
    ctx.moveTo(m * .17, m * 1.79);
    ctx.bezierCurveTo(m * .82, m * .8, m * .51, m * .42, m * 2.18, m * .19);
  });
  for (const [x, y, angle] of [[.37, 1.38, -.9], [.33, .88, -.55], [.77, .56, -.56], [1.53, .37, .48], [1.92, .19, -.45]]) {
    ellipse(ctx, m * x, m * y, m * .27, m * .083, detail, angle);
  }
  if (motif === 'bamboo') {
    for (const [x, y, angle] of [[.49, .69, -.9], [1.2, .3, -.55], [1.71, .37, .52], [.47, 1.67, .75]]) {
      ellipse(ctx, m * x, m * y, m * .34, m * .06, frame.accent, angle);
    }
    return;
  }
  const [petals, layers, size] = sizes[motif];
  flower(ctx, m * .65, m * .56, m * .43 * size, frame, petals, layers);
  flower(ctx, m * 1.31, m * .43, m * .28 * size, frame, petals, layers);
  flower(ctx, m * .43, m * 1.13, m * .27 * size, frame, petals);
  if (motif === 'osmanthus' || motif === 'blossom') {
    flower(ctx, m * 1.76, m * .23, m * .24 * size, frame, petals);
    flower(ctx, m * .29, m * 1.53, m * .22 * size, frame, petals);
  }
}

function corners(ctx, w, h, m, frame) {
  const {motif, ink, accent, paper} = frame;
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    if (['peony', 'rose', 'lotus', 'blossom', 'plum', 'osmanthus', 'bamboo'].includes(motif)) {
      if (sx === sy) botanical(ctx, m, frame);
    } else if (motif === 'lattice' || motif === 'gilt') {
      for (let i = 0; i < 3; i++) {
        const edge = m * (.23 + i * .12);
        stroke(ctx, i === 1 ? ink : accent, m * .046, () => {
          ctx.moveTo(edge, m * 1.34);
          ctx.lineTo(edge, edge);
          if (motif === 'gilt') ctx.quadraticCurveTo(m * .88, edge - m * .16, m * 1.34, edge);
          else ctx.lineTo(m * 1.34, edge);
        });
      }
      if (motif === 'gilt') ellipse(ctx, m * .36, m * .36, m * .13, m * .13, ink);
    } else if (motif === 'album') {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(m * .53, m * 1.72);
      ctx.lineTo(m * .53, m * .53);
      ctx.lineTo(m * 1.72, m * .53);
      ctx.closePath();
      ctx.fill();
      stroke(ctx, paper, m * .03, () => {
        ctx.moveTo(m * .66, m * 1.38);
        ctx.lineTo(m * .66, m * .66);
        ctx.lineTo(m * 1.38, m * .66);
      });
    } else if (motif === 'lace') {
      flower(ctx, m * .5, m * .5, m * .31, frame, 6);
      ellipse(ctx, m * .49, m * 1.12, m * .095, m * .095, ink);
      ellipse(ctx, m * 1.12, m * .49, m * .095, m * .095, ink);
    } else if (motif === 'longevity') {
      cloud(ctx, m, ink);
    } else if (motif === 'confetti' && sy < 0) {
      for (let i = 0; i < 7; i++) {
        ellipse(ctx, m * (.15 + i * .22), m * (.22 + i % 3 * .19), m * .081, m * .048,
          [accent, ink, frame.detail][i % 3], i);
      }
    }
    ctx.restore();
  }
}

function motifs(ctx, w, h, m, frame) {
  const {motif, ink, accent, detail, paper} = frame;
  const edge = m * .32;
  if (['lattice', 'gilt', 'double', 'wood', 'paper', 'lace', 'postmark'].includes(motif)) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = m * .045;
    ctx.strokeRect(edge, edge, w - edge * 2, h - edge * 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = m * .016;
    ctx.strokeRect(edge * 1.43, edge * 1.43, w - edge * 2.86, h - edge * 2.86);
  }
  if (motif === 'wood' || motif === 'paper') {
    for (let i = 0; i < 17; i++) {
      ctx.globalAlpha = .13;
      stroke(ctx, i % 2 ? detail : ink, m * .02, () => {
        const y = m * (i + 2) / 23;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * .31, y * .77, w * .56, y * 1.17, w, y);
        ctx.moveTo(0, h - y);
        ctx.bezierCurveTo(w * .41, h - y * 1.19, w * .68, h - y * .75, w, h - y);
      });
    }
    ctx.globalAlpha = 1;
  }
  if (motif === 'mountain') {
    for (const [offset, color] of [[0, detail], [.17, accent], [.34, ink]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 12; i++) {
        ctx.lineTo(w * i / 12, h - m * (.21 + ((i * 7 + 2) % 9) * .062 + offset));
      }
      ctx.lineTo(w, h);
      ctx.fill();
    }
  }
  if (motif === 'waves') {
    for (let i = 0; i < 3; i++) {
      stroke(ctx, [detail, accent, ink][i], m * .07, () => {
        const y = h - m * (.22 + i * .22);
        ctx.moveTo(0, y);
        for (let x = 0; x < w; x += m * 2.1) {
          ctx.bezierCurveTo(x + m * .65, y - m * .25, x + m * 1.42, y + m * .25, x + m * 2.1, y);
        }
      });
    }
  }
  if (motif === 'lantern') {
    for (const [x, y, size] of [[m * .55, m * .77, .28], [w - m * .55, m * .57, .31]]) {
      stroke(ctx, ink, m * .034, () => { ctx.moveTo(x, 0); ctx.lineTo(x, y + m * .48); });
      ellipse(ctx, x, y, m * size, m * .26, accent);
      ellipse(ctx, x, y, m * size * .49, m * .25, detail);
      box(ctx, x - m * .13, y - m * .29, m * .26, m * .07, ink);
    }
  }
  if (motif === 'moon') {
    ellipse(ctx, w - m * .6, m * .55, m * .29, m * .29, accent);
    ellipse(ctx, w - m * .48, m * .46, m * .24, m * .24, paper);
    for (let i = 0; i < 8; i++) {
      ellipse(ctx, w * (i + 1) / 10, m * (.35 + i % 3 * .13), m * .036, m * .036, ink);
    }
  }
  if (motif === 'postmark') {
    ctx.save();
    ctx.translate(w - m * .85, h - m * .63);
    ctx.rotate(-.18);
    ctx.globalAlpha = .82;
    stroke(ctx, ink, m * .033, () => {
      ctx.arc(0, 0, m * .36, 0, TAU);
    });
    for (let i = -1; i <= 1; i++) {
      stroke(ctx, detail, m * .027, () => {
        ctx.moveTo(-m * 1.2, m * i * .12);
        ctx.quadraticCurveTo(-m * .73, m * (i * .12 - .24), -m * .24, m * i * .12);
      });
    }
    ctx.restore();
  }
  if (motif === 'film') {
    for (let x = m * .3; x + m * .4 < w; x += m * .69) {
      box(ctx, x, m * .25, m * .39, m * .32, ink);
      box(ctx, x, h - m * .57, m * .39, m * .32, ink);
    }
  }
  if (motif === 'family') {
    const strip = m * .2;
    box(ctx, 0, 0, w, strip, ink);
    box(ctx, 0, h - strip, w, strip, ink);
    box(ctx, 0, 0, strip, h, ink);
    box(ctx, w - strip, 0, strip, h, ink);
    ctx.strokeStyle = accent;
    ctx.lineWidth = m * .035;
    ctx.strokeRect(strip + m * .07, strip + m * .07, w - 2 * strip - m * .14, h - 2 * strip - m * .14);
  }
  if (motif === 'longevity') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = m * .06;
    ctx.strokeRect(m * .2, m * .2, w - m * .4, h - m * .4);
    ctx.strokeStyle = ink;
    ctx.lineWidth = m * .02;
    ctx.strokeRect(m * .33, m * .33, w - m * .66, h - m * .66);
    const radius = m * .34;
    ellipse(ctx, w / 2, m * .5, radius, radius, accent);
    ellipse(ctx, w / 2, m * .5, radius * .84, radius * .84, paper);
    ctx.fillStyle = ink;
    ctx.font = `700 ${radius * 1.12}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('寿', w / 2, m * .52);
  }
  if (motif === 'trip') {
    const strip = m * .16;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(strip, strip, w - strip * 2, h - strip * 2);
    ctx.clip('evenodd');
    const step = m * .34;
    for (let x = -h, i = 0; x < w + h; x += step, i++) {
      ctx.fillStyle = i % 2 ? detail : accent;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + step * .5, 0);
      ctx.lineTo(x + step * .5 - h, h);
      ctx.lineTo(x - h, h);
      ctx.fill();
    }
    ctx.restore();
    const sw = m * .5;
    const sh = m * .6;
    const sx = w - m * .32 - sw;
    const sy = m * .24;
    box(ctx, sx, sy, sw, sh, '#fffaf0');
    for (let i = 0; i <= 6; i++) {
      ellipse(ctx, sx + sw * i / 6, sy, m * .025, m * .025, paper);
      ellipse(ctx, sx + sw * i / 6, sy + sh, m * .025, m * .025, paper);
    }
    box(ctx, sx + sw * .14, sy + sh * .14, sw * .72, sh * .72, accent);
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.moveTo(sx + sw * .2, sy + sh * .8);
    ctx.lineTo(sx + sw * .45, sy + sh * .42);
    ctx.lineTo(sx + sw * .6, sy + sh * .6);
    ctx.lineTo(sx + sw * .72, sy + sh * .5);
    ctx.lineTo(sx + sw * .8, sy + sh * .8);
    ctx.fill();
  }
  if (motif === 'confetti') {
    const count = Math.max(4, Math.floor((w - m * .6) / (m * .5)));
    const span = (w - m * .6) / count;
    const sag = Math.min(m * .14, span * .3);
    stroke(ctx, ink, m * .02, () => {
      ctx.moveTo(m * .3, m * .2);
      for (let i = 0; i < count; i++) ctx.quadraticCurveTo(m * .3 + span * (i + .5), m * .2 + sag, m * .3 + span * (i + 1), m * .2);
    });
    const colors = [accent, detail, '#e9b949', '#7fa7a0'];
    for (let i = 0; i < count; i++) {
      const left = m * .3 + span * (i + .18);
      const right = m * .3 + span * (i + .82);
      const top = m * .2 + sag * .55;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(right, top);
      ctx.lineTo((left + right) / 2, top + m * .5);
      ctx.fill();
    }
  }
  corners(ctx, w, h, m, frame);
}

// One line of words in the bottom border: a blessing, a greeting or a place and date.
// With a date under it (raised), the words move up a little to make room.
function caption(ctx, width, height, m, area, frame, text, raised = false) {
  const top = area.y + area.h;
  const band = height - top;
  const left = frame.caption === 'travel';
  const family = left ? SANS : SERIF;
  const weight = left ? 600 : 700;
  const room = left ? area.w * .72 : Math.max(area.w * .5, area.w - m * 3.2);
  let size = raised ? Math.min(band * .36, m * .7) : Math.min(band * .5, m * .78);
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > room) {
    size *= room / measured;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  ctx.fillStyle = frame.ink;
  ctx.textAlign = left ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left ? area.x : width / 2, top + band * (raised ? .4 : .5));
  ctx.restore();
}

// Frames whose bottom border is covered in pattern get a small paper label under the date.
const busyBottom = ['mountain', 'waves', 'film'];

// The date sits in the middle of the bottom border, clear of the corner decorations.
// It never changes the frame's size, so turning it on or off does not move anything.
function dateStamp(ctx, width, height, m, area, frame, text, under) {
  const top = area.y + area.h;
  const band = height - top;
  const size = under ? Math.min(band * .2, m * .42) : Math.min(band * .44, m * .44);
  const y = top + band * (under ? .79 : .5);
  ctx.save();
  ctx.font = `600 ${size}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (busyBottom.includes(frame.motif)) {
    const w = ctx.measureText(text).width + size * 1.2;
    const h = size * 1.5;
    ctx.globalAlpha = .92;
    box(ctx, width / 2 - w / 2, y - h / 2, w, h, frame.paper);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = frame.ink;
  ctx.fillText(text, width / 2, y);
  ctx.restore();
}

// bottom is the bottom border's depth relative to the other three sides.
function frameShape(frame, text) {
  let bottom = {instant: 1.9, family: 1.45}[frame.motif] || 1;
  if (text) bottom = Math.max(bottom, 2.1);
  return {margin: frame.motif === 'plain' ? .071 : .098, bottom};
}

export function photoRatio(image, rotation = 0) {
  return rotation % 180 === 0 ? image.width / image.height : image.height / image.width;
}

// Size-free layout whose short side is 1. Borders are equally wide on every side
// (an instant frame has a deeper bottom), so long panoramas keep a slim frame.
// A preset ratio fixes the finished picture; "original" fixes the photo opening.
function shape(image, frame, options) {
  const {margin, bottom} = frameShape(frame, options.text);
  if (options.ratio !== 'original') {
    const ratio = Number(options.ratio);
    return {width: Math.max(ratio, 1), height: Math.max(1 / ratio, 1), border: margin, bottom};
  }
  const ratio = photoRatio(image, options.rotation);
  const border = margin / (1 - 2 * margin);
  return {width: Math.max(ratio, 1) + 2 * border, height: Math.max(1 / ratio, 1) + border * (1 + bottom), border, bottom};
}

function build(width, height, border, bottom) {
  return {
    width, height, m: border,
    area: {x: border, y: border, w: Math.max(1, width - 2 * border), h: Math.max(1, height - border * (1 + bottom))},
  };
}

function scaled(form, k) {
  return build(Math.max(1, Math.round(form.width * k)), Math.max(1, Math.round(form.height * k)), form.border * k, form.bottom);
}

export function fixedLayout(frame, width, height, text = '') {
  const {margin, bottom} = frameShape(frame, text);
  return build(width, height, Math.min(width, height) * margin, bottom);
}

// Largest layout that does not enlarge the photo, within limit and maxPixels.
export function layout(image, frame, options, limit, maxPixels = Infinity) {
  const form = shape(image, frame, options);
  const opening = Math.max(form.width - 2 * form.border, form.height - form.border * (1 + form.bottom));
  const k = Math.min(Math.max(image.width, image.height) / opening, limit / Math.max(form.width, form.height),
    Math.sqrt(maxPixels / (form.width * form.height)));
  return scaled(form, k);
}

export function layoutInBox(image, frame, options, boxWidth, boxHeight) {
  const form = shape(image, frame, options);
  return scaled(form, Math.min(boxWidth / form.width, boxHeight / form.height));
}

// Where the photo sits inside the opening, in canvas pixels.
export function placement(image, options, area) {
  const rotated = options.rotation % 180 !== 0;
  const iw = rotated ? image.height : image.width;
  const ih = rotated ? image.width : image.height;
  const original = options.ratio === 'original';
  const cover = original || options.fit === 'cover';
  const zoom = (cover ? Math.max : Math.min)(area.w / iw, area.h / ih);
  const w = iw * zoom;
  const h = ih * zoom;
  const x = cover && !original ? options.x : .5;
  const y = cover && !original ? options.y : .5;
  return {zoom, w, h, cx: area.x + w / 2 + (area.w - w) * x, cy: area.y + h / 2 + (area.h - h) * y};
}

export function paint(canvas, image, frame, options, {width, height, m, area}) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Canvas unavailable');
  box(ctx, 0, 0, width, height, frame.paper);
  ctx.save();
  ctx.globalAlpha = .40;
  box(ctx, area.x - m * .055, area.y - m * .055, area.w + m * .11, area.h + m * .11, frame.ink);
  ctx.restore();
  box(ctx, area.x, area.y, area.w, area.h, frame.paper);
  if (image) {
    const {zoom, cx, cy} = placement(image, options, area);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cx, cy);
    ctx.rotate(options.rotation * Math.PI / 180);
    ctx.drawImage(image, -image.width * zoom / 2, -image.height * zoom / 2, image.width * zoom, image.height * zoom);
    ctx.restore();
  }
  ctx.strokeStyle = frame.accent;
  ctx.lineWidth = Math.max(.1, m * .025);
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  motifs(ctx, width, height, m, frame);
  const under = Boolean(options.text && options.date);
  if (options.text) caption(ctx, width, height, m, area, frame, options.text, under);
  if (options.date) dateStamp(ctx, width, height, m, area, frame, options.date, under);
}
