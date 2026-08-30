/*
 * Ещё два вида схемы поверх общей основы CanvasView:
 *   FlowMap  — «откуда пришло → кошелёк → куда ушло», ширина ленты = сумма;
 *   Timeline — переводы во времени: входящие сверху оси, исходящие снизу.
 */

/** Общая основа: размер, панорама, зум, подсказка, экспорт. */
class CanvasView {
  constructor(canvas, tipEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tipEl;
    this.view = { x: 0, y: 0, scale: 1 };
    this.hover = null;
    this.items = [];
    this._bindBase();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return {
      self: v('--node-self'), in: v('--node-in'), out: v('--node-out'),
      text: v('--text'), dim: v('--text-dim'), line: v('--line'),
      bg: v('--bg-sunk'), elev: v('--bg-elev'), accent: v('--accent')
    };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.w = rect.width; this.h = rect.height; this.dpr = dpr;
    this.layout?.();
    this.draw();
  }

  toWorld(mx, my) {
    return { x: (mx - this.view.x) / this.view.scale, y: (my - this.view.y) / this.view.scale };
  }

  hitTest(mx, my) {
    const p = this.toWorld(mx, my);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.r !== undefined) {
        if ((p.x - it.x) ** 2 + (p.y - it.y) ** 2 <= (it.r + 3) ** 2) return it;
      } else if (p.x >= it.x && p.x <= it.x + it.w && p.y >= it.y && p.y <= it.y + it.h) {
        return it;
      }
    }
    return null;
  }

  _bindBase() {
    const cv = this.canvas;
    let drag = null;
    cv.addEventListener('mousedown', e => {
      const r = cv.getBoundingClientRect();
      drag = { ox: e.clientX - r.left, oy: e.clientY - r.top, vx: this.view.x, vy: this.view.y, moved: false };
    });
    window.addEventListener('mouseup', () => { drag = null; });
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        if (Math.abs(mx - drag.ox) + Math.abs(my - drag.oy) > 3) drag.moved = true;
        this.view.x = drag.vx + (mx - drag.ox);
        this.view.y = drag.vy + (my - drag.oy);
        this.draw();
        return;
      }
      const it = this.hitTest(mx, my);
      cv.style.cursor = it ? 'pointer' : 'grab';
      if (it !== this.hover) { this.hover = it; this.draw(); }
      if (it?.tip) {
        this.tip.hidden = false;
        this.tip.style.left = Math.min(mx + 14, this.w - 290) + 'px';
        this.tip.style.top = Math.max(8, my - 10) + 'px';
        this.tip.innerHTML = it.tip;
      } else {
        this.tip.hidden = true;
      }
    });
    cv.addEventListener('mouseleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    cv.addEventListener('click', e => {
      if (drag?.moved) return;
      const r = cv.getBoundingClientRect();
      const it = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (it?.addr) document.dispatchEvent(new CustomEvent('peerpick', { detail: it.addr }));
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.min(4, Math.max(0.1, this.view.scale * k));
      this.view.x = mx - (mx - this.view.x) * (next / this.view.scale);
      this.view.y = my - (my - this.view.y) * (next / this.view.scale);
      this.view.scale = next;
      this.draw();
    }, { passive: false });
  }

  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _clip(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  exportPng(name) {
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width; tmp.height = this.canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = this.colors().bg;
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(this.canvas, 0, 0);
    const a = document.createElement('a');
    a.download = name; a.href = tmp.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  }
}

/* ------------------------------------------------------------------ поток */
/*
 * Три колонки: отправители слева, кошелёк в центре, получатели справа.
 * Высота узла и ширина ленты пропорциональны сумме, так что сразу видно,
 * откуда пришла основная масса денег и куда она ушла.
 */
class FlowMap extends CanvasView {
  setData(data) {
    this.data = data;
    this.resize();
    this.fit();
  }

  layout() {
    const d = this.data;
    if (!d || !this.w) return;
    const COLW = 210, GAP = 130, MINH = 16, PAD = 6;
    const bodyH = Math.max(340, this.h - 90);

    const side = (list, total) => {
      const sum = Math.max(total, 1e-9);
      const flex = Math.max(0, bodyH - list.length * (MINH + PAD));
      let y = 0;
      return list.map(p => {
        const h = MINH + (p.value / sum) * flex;
        const box = { ...p, y, h };
        y += h + PAD;
        return box;
      });
    };

    this.left = side(d.sources, d.totalIn);
    this.right = side(d.dests, d.totalOut);
    const leftH = this.left.length ? this.left.at(-1).y + this.left.at(-1).h : 0;
    const rightH = this.right.length ? this.right.at(-1).y + this.right.at(-1).h : 0;
    const maxH = Math.max(leftH, rightH, 120);

    this.left.forEach(b => { b.x = 0; b.w = COLW; b.y += (maxH - leftH) / 2; });
    this.right.forEach(b => { b.x = COLW + GAP * 2 + 130; b.w = COLW; b.y += (maxH - rightH) / 2; });

    this.center = { x: COLW + GAP, y: maxH / 2 - 34, w: 130, h: 68 };
    this.bounds = { x0: -10, x1: COLW * 2 + GAP * 2 + 140, y0: -34, y1: maxH + 10 };
    this.items = [...this.left, ...this.right];
  }

  fit() {
    const b = this.bounds;
    if (!b || !this.w) return;
    const pad = 26;
    const s = Math.min(this.w / (b.x1 - b.x0 + pad * 2), this.h / (b.y1 - b.y0 + pad * 2), 1.2);
    this.view.scale = Math.max(0.18, s);
    this.view.x = pad * this.view.scale - b.x0 * this.view.scale;
    this.view.y = this.h / 2 - ((b.y0 + b.y1) / 2) * this.view.scale;
    this.draw();
  }

  draw() {
    const ctx = this.ctx, c = this.colors(), d = this.data;
    if (!ctx || !this.w || !d) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);

    const cn = this.center;
    // ленты: слева входящие в кошелёк, справа исходящие из него
    const ribbon = (box, toCenter, color) => {
      const dim = this.hover && this.hover !== box;
      const x1 = toCenter ? box.x + box.w : cn.x + cn.w;
      const x2 = toCenter ? cn.x : box.x;
      const share = box.h;
      const y1 = box.y, y1b = box.y + share;
      const anchor = toCenter ? box.centerY : box.centerY;
      const y2 = anchor - share / 2, y2b = anchor + share / 2;
      const mid = (x1 + x2) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(mid, y1, mid, y2, x2, y2);
      ctx.lineTo(x2, y2b);
      ctx.bezierCurveTo(mid, y2b, mid, y1b, x1, y1b);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.12 : 0.34;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    // точки входа/выхода на центральном узле распределяем пропорционально
    const spread = (list, top, height) => {
      const tot = list.reduce((s, b) => s + b.h, 0) || 1;
      let y = top + (height - Math.min(height, tot)) / 2;
      const k = Math.min(1, height / tot);
      for (const b of list) { b.centerY = y + (b.h * k) / 2; y += b.h * k; }
    };
    spread(this.left, cn.y - 6, cn.h + 12);
    spread(this.right, cn.y - 6, cn.h + 12);

    this.left.forEach(b => ribbon(b, true, c.in));
    this.right.forEach(b => ribbon(b, false, c.out));

    // боковые узлы
    const drawSide = (list, color, alignRight) => {
      for (const b of list) {
        const dim = this.hover && this.hover !== b;
        ctx.globalAlpha = dim ? 0.45 : 1;
        ctx.beginPath();
        this._roundRect(ctx, b.x, b.y, b.w, b.h, 6);
        ctx.fillStyle = c.elev;
        ctx.fill();
        ctx.lineWidth = b === this.hover ? 2 : 1;
        ctx.strokeStyle = b === this.hover ? c.accent : c.line;
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        this._roundRect(ctx, b.x, b.y, b.w, b.h, 6);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(alignRight ? b.x + b.w - 3 : b.x, b.y, 3, b.h);
        ctx.restore();

        const tx = b.x + 10, cy = b.y + b.h / 2;
        ctx.textAlign = 'left';
        ctx.fillStyle = c.text;
        ctx.font = '500 12px ui-monospace, Menlo, monospace';
        ctx.fillText(this._clip(ctx, b.label, b.w - 20), tx, b.h > 30 ? cy - 3 : cy + 4);
        if (b.h > 30) {
          ctx.font = '400 11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = c.dim;
          ctx.fillText(this._clip(ctx, b.sub, b.w - 20), tx, cy + 12);
        }
        ctx.globalAlpha = 1;
      }
    };
    drawSide(this.left, c.in, true);
    drawSide(this.right, c.out, false);

    // центральный узел — кошелёк
    ctx.beginPath();
    this._roundRect(ctx, cn.x, cn.y, cn.w, cn.h, 10);
    ctx.fillStyle = c.self;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '600 12px ui-monospace, Menlo, monospace';
    ctx.fillText(this._clip(ctx, d.selfLabel, cn.w - 16), cn.x + cn.w / 2, cn.y + 26);
    ctx.font = '400 11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText(d.chainLabel, cn.x + cn.w / 2, cn.y + 44);

    // заголовки колонок с итогами
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = c.in;
    ctx.fillText(d.labelIn, this.left[0]?.x ?? 0, this.bounds.y0 - 6);
    ctx.fillStyle = c.out;
    ctx.fillText(d.labelOut, this.right[0]?.x ?? cn.x + cn.w + 40, this.bounds.y0 - 6);
    ctx.restore();
  }
}

/* -------------------------------------------------------------- хронология */
/*
 * Ось времени: входящие пузырьки над осью, исходящие под ней,
 * радиус пропорционален корню из суммы в USD.
 */
class Timeline extends CanvasView {
  setData(data) {
    this.data = data;
    this.resize();
    this.fit();
  }

  layout() {
    const d = this.data;
    if (!d || !this.w || !d.points.length) return;
    const W = Math.max(900, d.points.length * 6);
    const ts = d.points.map(p => p.ts);
    const t0 = Math.min(...ts), t1 = Math.max(...ts) || t0 + 1;
    const maxUsd = Math.max(...d.points.map(p => p.usd || 0), 1);
    const maxAmt = Math.max(...d.points.map(p => p.amount), 1);
    const AXIS_GAP = 26; // полоса вокруг оси, свободная под даты

    const pts = d.points.map(p => {
      const k = (p.ts - t0) / Math.max(1, t1 - t0);
      const size = (p.usd || 0) > 0 ? Math.sqrt(p.usd / maxUsd) : Math.sqrt(p.amount / maxAmt) * 0.6;
      return { ...p, x: k * W, r: 3 + size * 20 };
    }).sort((a, b) => a.x - b.x);

    /*
     * «Рой»: пузырёк отодвигается от оси, пока не перестанет задевать уже
     * поставленные соседи по своей стороне. Иначе всё сваливается на ось.
     */
    const placed = { in: [], out: [] };
    for (const p of pts) {
      const side = p.dir === 'out' ? 'out' : 'in';
      const near = placed[side].filter(q => Math.abs(q.x - p.x) < q.r + p.r + 2);
      let off = AXIS_GAP + p.r;
      for (let guard = 0; guard < 400; guard++) {
        const hit = near.some(q => {
          const dy = Math.abs(q.off - off);
          const dx = Math.abs(q.x - p.x);
          return Math.hypot(dx, dy) < q.r + p.r + 2;
        });
        if (!hit) break;
        off += 3;
      }
      p.off = off;
      p.y = (side === 'out' ? 1 : -1) * off;
      placed[side].push(p);
    }

    this.items = pts;
    const top = Math.min(...pts.map(p => p.y - p.r));
    const bottom = Math.max(...pts.map(p => p.y + p.r));
    this.span = { t0, t1, W, axisGap: AXIS_GAP };
    this.bounds = { x0: -20, x1: W + 20, y0: top - 26, y1: bottom + 26 };
  }

  fit() {
    const b = this.bounds;
    if (!b || !this.w) return;
    const pad = 24;
    const s = Math.min(this.w / (b.x1 - b.x0 + pad * 2), this.h / (b.y1 - b.y0 + pad * 2), 1.4);
    this.view.scale = Math.max(0.15, s);
    this.view.x = pad * this.view.scale - b.x0 * this.view.scale;
    this.view.y = this.h / 2 - ((b.y0 + b.y1) / 2) * this.view.scale;
    this.draw();
  }

  draw() {
    const ctx = this.ctx, c = this.colors(), d = this.data;
    if (!ctx || !this.w || !d || !this.span) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);

    const { t0, t1, W } = this.span;

    // ось и отметки дат
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(W, 0);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = c.in;
    ctx.fillText(d.labelIn, 0, this.bounds.y0 + 12);
    ctx.fillStyle = c.out;
    ctx.fillText(d.labelOut, 0, this.bounds.y1 - 4);

    for (const p of this.items) {
      const dim = this.hover && this.hover !== p;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.dir === 'out' ? c.out : c.in;
      ctx.globalAlpha = dim ? 0.18 : 0.55;
      ctx.fill();
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.lineWidth = p === this.hover ? 2 : 1;
      ctx.strokeStyle = p === this.hover ? c.accent : (p.dir === 'out' ? c.out : c.in);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // даты — поверх пузырьков, с подложкой, чтобы всегда читались
    ctx.font = '400 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const x = (W / 4) * i;
      const at = t0 + ((t1 - t0) / 4) * i;
      const label = fmtDate(at).split(',')[0];
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = c.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - tw / 2, -8, tw, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.dim;
      ctx.fillText(label, x, 4);
    }
    ctx.restore();
  }
}
