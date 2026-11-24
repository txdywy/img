const TAU = Math.PI * 2;

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

function botanical(ctx, m, frame) {
  const {motif, detail} = frame;
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
    if (['peony', 'rose', 'lotus', 'blossom', 'osmanthus', 'bamboo'].includes(motif)) {
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
    } else if (motif === 'confetti') {
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
  corners(ctx, w, h, m, frame);
}

export function aspectRatio(image, options) {
  if (options.ratio !== 'original') return Number(options.ratio);
  return options.rotation % 180 === 0 ? image.width / image.height : image.height / image.width;
}

export function dimensions(image, options, limit, maxPixels = Infinity) {
  const ratio = aspectRatio(image, options);
  const big = Math.max(ratio, 1 / ratio);
  const longest = Math.min(limit, Math.max(1, Math.ceil(Math.max(image.width, image.height) / .80)), Math.floor(Math.sqrt(maxPixels * big)));
  return ratio >= 1
    ? [longest, Math.max(1, Math.round(longest / ratio))]
    : [Math.max(1, Math.round(longest * ratio)), longest];
}

export function paint(canvas, image, frame, options, width, height) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Canvas unavailable');
  const margin = frame.motif === 'plain' ? .071 : .098;
  const m = Math.min(width, height) * margin;
  const innerScale = 1 - margin * (frame.motif === 'instant' ? 2.54 : 2);
  // Scale both axes together so an original-ratio photo fills the opening.
  const area = {x: width * (1 - innerScale) / 2, y: height * margin, w: width * innerScale, h: height * innerScale};
  box(ctx, 0, 0, width, height, frame.paper);
  ctx.save();
  ctx.globalAlpha = .40;
  box(ctx, area.x - m * .055, area.y - m * .055, area.w + m * .11, area.h + m * .11, frame.ink);
  ctx.restore();
  box(ctx, area.x, area.y, area.w, area.h, frame.paper);
  if (image) {
    const rotated = options.rotation % 180 !== 0;
    const iw = rotated ? image.height : image.width;
    const ih = rotated ? image.width : image.height;
    const zoom = (options.fit === 'cover' ? Math.max : Math.min)(area.w / iw, area.h / ih);
    const dx = area.x + iw * zoom / 2 + (area.w - iw * zoom) * (options.fit === 'cover' ? options.x : .5);
    const dy = area.y + ih * zoom / 2 + (area.h - ih * zoom) * (options.fit === 'cover' ? options.y : .5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(dx, dy);
    ctx.rotate(options.rotation * Math.PI / 180);
    ctx.drawImage(image, -image.width * zoom / 2, -image.height * zoom / 2, image.width * zoom, image.height * zoom);
    ctx.restore();
  }
  ctx.strokeStyle = frame.accent;
  ctx.lineWidth = Math.max(.1, m * .025);
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  motifs(ctx, width, height, m, frame);
}
