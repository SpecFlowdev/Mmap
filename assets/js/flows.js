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
      self: v('--map-self'), selfText: v('--map-self-text'),
      in: v('--map-in'), out: v('--map-out'),
      text: v('--text'), dim: v('--text-dim'), line: v('--map-line'),
      bg: v('--bg-sunk'), elev: v('--map-node'), accent: v('--map-hi')
    };
  }

  /*
   * Пока пользователь сам не двигал и не масштабировал схему, она вписывается
   * заново на каждое изменение размера: иначе карта, посчитанная под ещё не
   * разложенную панель, остаётся крохотной в пустом поле.
   */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.w = rect.width; this.h = rect.height; this.dpr = dpr;
    this.layout?.();
    if (this.touched) this.draw(); else this.fit();
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
        if (Math.abs(mx - drag.ox) + Math.abs(my - drag.oy) > 3) { drag.moved = true; this.touched = true; }
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
    // правый клик по узлу или стрелке убирает этого контрагента со схемы
    cv.addEventListener('contextmenu', e => {
      const r = cv.getBoundingClientRect();
      const it = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (!it?.addr) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('peerhide', { detail: it.addr }));
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.touched = true;
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
    this.touched = false;
    this.resize();
    this.fit();
  }

  layout() {
    const d = this.data;
    if (!d || !this.w) return;
    const few = Math.max(d.sources.length, d.dests.length) <= 6;
    const CARD_W = 236, CARD_H = 46, ROW_GAP = 13, LINK_W = few ? 104 : 168;
    const CENTER_W = 158, CENTER_H = 168;

    const column = (list, x) => {
      const total = Math.max(1e-9, list.reduce((sum, b) => sum + b.value, 0));
      const height = list.length * CARD_H + Math.max(0, list.length - 1) * ROW_GAP;
      return list.map((b, i) => ({
        ...b, x, w: CARD_W, h: CARD_H,
        y: i * (CARD_H + ROW_GAP),
        share: b.value / total,
        colH: height
      }));
    };

    // пустая сторона не занимает место: иначе кошелёк уезжает вбок от пустой колонки
    const leftW = d.sources.length ? CARD_W : 0;
    const rightW = d.dests.length ? CARD_W : 0;
    const leftGap = leftW ? LINK_W : 0;
    const rightGap = rightW ? LINK_W : 0;
    const centerX = leftW + leftGap;
    const rightX = centerX + CENTER_W + rightGap;
    this.left = column(d.sources, 0);
    this.right = column(d.dests, rightX);

    const leftH = this.left[0]?.colH || 0;
    const rightH = this.right[0]?.colH || 0;
    const maxH = Math.max(leftH, rightH, CENTER_H);
    this.left.forEach(b => { b.y += (maxH - leftH) / 2; });
    this.right.forEach(b => { b.y += (maxH - rightH) / 2; });

    this.center = { x: centerX, y: (maxH - CENTER_H) / 2, w: CENTER_W, h: CENTER_H };

    /*
     * Каждая связь приходит в собственную точку на грани центрального узла:
     * так веер остаётся разборчивым, а не сливается в одно пятно.
     */
    const anchors = (list, edgeX) => {
      const inner = this.center.h - 24;
      const step = list.length > 1 ? inner / (list.length - 1) : 0;
      const top = this.center.y + 12;
      list.forEach((b, i) => {
        b.ax = edgeX;
        b.ay = list.length > 1 ? top + step * i : this.center.y + this.center.h / 2;
        b.lw = Math.max(1, Math.min(6, 1 + b.share * 13));
      });
    };
    anchors(this.left, this.center.x);
    anchors(this.right, this.center.x + this.center.w);

    this.bounds = { x0: -12, x1: rightX + rightW + 12, y0: -30, y1: maxH + 12 };
    this.items = [...this.left, ...this.right];
  }

  /*
   * Показываем всех контрагентов, поэтому схема часто выше экрана.
   * Ужимаем только до предела читаемости, дальше — панорама и полный экран,
   * а кошелёк держим по центру, чтобы он всегда был виден.
   */
  fit() {
    const b = this.bounds;
    if (!b || !this.w) return;
    const pad = 22, MIN_FIT = 0.5, MAX_FIT = 1.35;
    const raw = Math.min(this.w / (b.x1 - b.x0 + pad * 2), this.h / (b.y1 - b.y0 + pad * 2), MAX_FIT);
    this.view.scale = Math.max(MIN_FIT, raw);
    const s = this.view.scale;
    this.view.x = this.w / 2 - ((b.x0 + b.x1) / 2) * s;
    const contentH = (b.y1 - b.y0) * s;
    this.view.y = contentH > this.h - pad * 2
      ? this.h / 2 - (this.center.y + this.center.h / 2) * s
      : this.h / 2 - ((b.y0 + b.y1) / 2) * s;
    this.draw();
  }

  draw() {
    const ctx = this.ctx, c = this.colors(), d = this.data;
    if (!ctx || !this.w || !d || !this.center) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);

    const cn = this.center;

    // связи: тонкие кривые с градиентом от цвета стороны к цвету кошелька
    const link = (b, fromCard, color) => {
      const x1 = fromCard ? b.x + b.w : b.x;
      const y1 = b.y + b.h / 2;
      const x2 = b.ax, y2 = b.ay;
      const mid = (x1 + x2) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(mid, y1, mid, y2, x2, y2);
      ctx.strokeStyle = this.hover === b ? c.accent : color;
      ctx.lineWidth = b.lw;
      ctx.lineCap = 'round';
      // исходящие — пунктир: направление читается без цвета
      ctx.setLineDash(fromCard ? [] : [7, 5]);
      ctx.globalAlpha = this.hover ? (this.hover === b ? 1 : 0.16) : 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };
    this.left.forEach(b => link(b, true, c.in));
    this.right.forEach(b => link(b, false, c.out));

    // карточки контрагентов
    const card = (b, color, alignRight) => {
      const dim = this.hover && this.hover !== b;
      ctx.globalAlpha = dim ? 0.4 : 1;
      ctx.beginPath();
      this._roundRect(ctx, b.x, b.y, b.w, b.h, 9);
      ctx.fillStyle = c.elev;
      ctx.fill();
      ctx.lineWidth = b === this.hover ? 1.6 : 1;
      ctx.strokeStyle = b === this.hover ? c.accent : c.line;
      ctx.stroke();

      // полоска доли внизу карточки — сколько эта сторона весит в общем объёме
      ctx.save();
      ctx.beginPath();
      this._roundRect(ctx, b.x, b.y, b.w, b.h, 9);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.globalAlpha = (dim ? 0.4 : 1) * 0.28;
      ctx.fillRect(alignRight ? b.x + b.w - b.w * b.share : b.x, b.y + b.h - 3, b.w * b.share, 3);
      ctx.globalAlpha = dim ? 0.4 : 1;
      ctx.fillRect(alignRight ? b.x + b.w - 2.5 : b.x, b.y, 2.5, b.h);
      ctx.restore();

      const pad = 13;
      const left = b.x + pad, right = b.x + b.w - pad;
      ctx.textAlign = 'left';
      ctx.fillStyle = c.text;
      ctx.font = '500 12.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(this._clip(ctx, b.label, b.w - pad * 2 - 40), left, b.y + 19);

      ctx.font = '400 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = c.dim;
      ctx.fillText(b.sub, left, b.y + 34);

      // доля справа крупной цифрой
      ctx.textAlign = 'right';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillStyle = c.dim;
      ctx.fillText(Math.round(b.share * 100) + '%', right, b.y + 19);
      ctx.globalAlpha = 1;
    };
    this.left.forEach(b => card(b, c.in, true));
    this.right.forEach(b => card(b, c.out, false));

    // центральный узел — кошелёк с итогами по обеим сторонам
    ctx.beginPath();
    this._roundRect(ctx, cn.x, cn.y, cn.w, cn.h, 14);
    ctx.fillStyle = c.self;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.stroke();
    const cx = cn.x + cn.w / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = c.selfText;
    ctx.font = '600 12.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(this._clip(ctx, d.selfLabel, cn.w - 20), cx, cn.y + 34);
    ctx.font = '400 11px Inter, system-ui, sans-serif';
    ctx.globalAlpha = 0.7;
    ctx.fillText(this._clip(ctx, d.chainLabel, cn.w - 20), cx, cn.y + 52);
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(cn.x + 18, cn.y + 70); ctx.lineTo(cn.x + cn.w - 18, cn.y + 70);
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;

    const money = (label, value, y) => {
      ctx.textAlign = 'center';
      ctx.font = '400 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = c.selfText;
      ctx.globalAlpha = 0.7;
      ctx.fillText(label, cx, y);
      ctx.globalAlpha = 1;
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillText(value, cx, y + 17);
    };
    money(d.inWord, d.inTotal, cn.y + 90);
    money(d.outWord, d.outTotal, cn.y + 130);

    // заголовки колонок
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = c.dim;
    ctx.fillText(d.labelIn, this.left[0]?.x ?? 0, this.bounds.y0 + 14);
    ctx.textAlign = 'right';
    ctx.fillStyle = c.dim;
    const rEdge = (this.right[0]?.x ?? cn.x + cn.w) + (this.right[0]?.w ?? 0);
    ctx.fillText(d.labelOut, rEdge, this.bounds.y0 + 14);
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
    this.touched = false;
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
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = c.dim;
    ctx.fillText(d.labelIn, 0, this.bounds.y0 + 12);
    ctx.fillText(d.labelOut, 0, this.bounds.y1 - 4);

    for (const p of this.items) {
      const dim = this.hover && this.hover !== p;
      const out = p.dir === 'out';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      // входящие — залитый круг, исходящие — контур: направление без цвета
      if (!out) {
        ctx.fillStyle = c.in;
        ctx.globalAlpha = dim ? 0.14 : 0.4;
        ctx.fill();
      }
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.lineWidth = p === this.hover ? 1.8 : 1.2;
      ctx.strokeStyle = p === this.hover ? c.accent : (out ? c.out : c.in);
      ctx.setLineDash(out ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // даты — поверх пузырьков, с подложкой, чтобы всегда читались
    ctx.font = '400 11px Inter, system-ui, sans-serif';
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
