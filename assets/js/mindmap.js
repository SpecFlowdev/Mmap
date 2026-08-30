/*
 * Майндмап переводов: корень (кошелёк) слева, ветки растут вправо.
 * Уровни: кошелёк → группа (актив или направление) → контрагент.
 * Ветки сворачиваются кружком «−/+», как в обычных майндмапах.
 */
class MindMap {
  constructor(canvas, tipEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tipEl;
    this.root = null;
    this.nodes = [];
    this.view = { x: 0, y: 0, scale: 1 };
    this.hover = null;
    this.collapsed = new Set();
    this._bind();
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

  /** tree: { label, sub, kind, children: [...] } */
  setData(tree) {
    this.root = tree;
    this.resize();
    this.layout();
    this.fit();
  }

  /* ------------------------------------------------------------ раскладка */
  layout() {
    const ctx = this.ctx;
    if (!this.root || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const GAP_X = 56, ROW = 34, PAD = 11, MAXW = 250;
    const measure = node => {
      ctx.font = `${node.depth === 0 ? '600 13px' : node.depth === 1 ? '600 12px' : '400 12px'} ui-sans-serif, system-ui, sans-serif`;
      const wLabel = ctx.measureText(node.label).width;
      ctx.font = '400 11px ui-monospace, Menlo, monospace';
      const wSub = node.sub ? ctx.measureText(node.sub).width : 0;
      node.w = Math.min(MAXW, Math.max(wLabel, wSub) + PAD * 2);
      node.h = node.sub ? 36 : 26;
    };

    // 1. плоский список видимых узлов с глубиной
    this.nodes = [];
    const visit = (node, depth, parent) => {
      node.depth = depth;
      node.parent = parent;
      node.hidden = false;
      measure(node);
      this.nodes.push(node);
      const kids = node.children || [];
      node.hasKids = kids.length > 0;
      node.open = !this.collapsed.has(node.key);
      if (node.hasKids && node.open) kids.forEach(k => visit(k, depth + 1, node));
    };
    visit(this.root, 0, null);

    // 2. x по колонкам: ширина колонки = самый широкий узел на этом уровне
    const colW = [];
    for (const n of this.nodes) colW[n.depth] = Math.max(colW[n.depth] || 0, n.w);
    const colX = [];
    colW.forEach((w, i) => { colX[i] = i === 0 ? 0 : colX[i - 1] + colW[i - 1] + GAP_X; });
    for (const n of this.nodes) n.x = colX[n.depth];

    // 3. y: лист занимает следующую строку, родитель встаёт по центру детей
    let cursor = 0;
    const place = node => {
      const kids = (node.open && node.children) || [];
      if (!kids.length) { node.y = cursor; cursor += ROW; return; }
      kids.forEach(place);
      node.y = (kids[0].y + kids[kids.length - 1].y) / 2;
    };
    place(this.root);

    this.bounds = this.nodes.reduce((b, n) => ({
      x0: Math.min(b.x0, n.x), x1: Math.max(b.x1, n.x + n.w),
      y0: Math.min(b.y0, n.y - n.h / 2), y1: Math.max(b.y1, n.y + n.h / 2)
    }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });

    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.w = rect.width; this.h = rect.height; this.dpr = dpr;
    this.draw();
  }

  /*
   * Вписываем карту в панель, но не мельче MIN_FIT — иначе подписи
   * превращаются в нечитаемые полоски. Что не влезло, доступно панорамой.
   */
  fit() {
    const b = this.bounds;
    if (!b || !this.w) return;
    const pad = 28, MIN_FIT = 0.7;
    const raw = Math.min(
      this.w / (b.x1 - b.x0 + pad * 2),
      this.h / (b.y1 - b.y0 + pad * 2), 1.4);
    this.view.scale = Math.max(MIN_FIT, raw);
    const s = this.view.scale;
    this.view.x = pad * s - b.x0 * s;
    // корень всегда виден: высокое дерево центрируем по корню, а не по всей высоте
    const contentH = (b.y1 - b.y0) * s;
    this.view.y = contentH > this.h - pad * 2
      ? this.h / 2 - this.root.y * s
      : this.h / 2 - ((b.y0 + b.y1) / 2) * s;
    this.draw();
  }

  /* -------------------------------------------------------------- отрисовка */
  draw() {
    const ctx = this.ctx, c = this.colors();
    if (!ctx || !this.w || !this.root) return;
    const S = this.view.scale, OX = this.view.x, OY = this.view.y;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(OX, OY);
    ctx.scale(S, S);

    // связи
    for (const n of this.nodes) {
      if (!n.parent) continue;
      const p = n.parent;
      const x1 = p.x + p.w, y1 = p.y;
      const x2 = n.x, y2 = n.y;
      const mid = x1 + (x2 - x1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x1 + 14, y1);
      ctx.bezierCurveTo(mid, y1, mid, y2, x2, y2);
      ctx.strokeStyle = n.color || c.line;
      ctx.globalAlpha = this.hover && !this._isKin(n) ? 0.25 : 0.75;
      ctx.lineWidth = n.depth === 1 ? 2 : 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // узлы
    for (const n of this.nodes) {
      const dim = this.hover && !this._isKin(n);
      ctx.globalAlpha = dim ? 0.4 : 1;
      const x = n.x, y = n.y - n.h / 2, r = 8;
      const accent = n.color || (n.depth === 0 ? c.self : c.dim);

      ctx.beginPath();
      this._roundRect(ctx, x, y, n.w, n.h, r);
      ctx.fillStyle = n.depth === 0 ? c.self : c.elev;
      ctx.fill();
      ctx.lineWidth = n === this.hover ? 2 : 1;
      ctx.strokeStyle = n === this.hover ? c.accent : (n.depth === 1 ? accent : c.line);
      ctx.stroke();

      // цветная полоска слева — направление или актив
      if (n.depth > 0 && n.color) {
        ctx.save();
        ctx.beginPath();
        this._roundRect(ctx, x, y, n.w, n.h, r);
        ctx.clip();
        ctx.fillStyle = n.color;
        ctx.fillRect(x, y, 3, n.h);
        ctx.restore();
      }

      const cx = x + 11;
      ctx.textAlign = 'left';
      ctx.fillStyle = n.depth === 0 ? '#fff' : c.text;
      ctx.font = `${n.depth === 0 ? '600 13px' : n.depth === 1 ? '600 12px' : '400 12px'} ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(this._clip(ctx, n.label, n.w - 22), cx, n.sub ? n.y - 3 : n.y + 4);
      if (n.sub) {
        ctx.font = '400 11px ui-monospace, Menlo, monospace';
        ctx.fillStyle = n.depth === 0 ? 'rgba(255,255,255,.8)' : c.dim;
        ctx.fillText(this._clip(ctx, n.sub, n.w - 22), cx, n.y + 12);
      }

      // кружок сворачивания
      if (n.hasKids) {
        const tx = x + n.w + 9, ty = n.y;
        n.toggle = { x: tx, y: ty, r: 7 };
        ctx.beginPath();
        ctx.arc(tx, ty, 7, 0, Math.PI * 2);
        ctx.fillStyle = c.bg;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = n.color || c.line;
        ctx.stroke();
        ctx.strokeStyle = c.text;
        ctx.beginPath();
        ctx.moveTo(tx - 3.5, ty); ctx.lineTo(tx + 3.5, ty);
        if (!n.open) { ctx.moveTo(tx, ty - 3.5); ctx.lineTo(tx, ty + 3.5); }
        ctx.stroke();
        if (!n.open) {
          ctx.font = '400 10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = c.dim;
          ctx.fillText(String(n.children.length), tx + 12, ty + 3.5);
        }
      } else {
        n.toggle = null;
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
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

  /** Узел «в родстве» с наведённым: он сам, его предки или потомки. */
  _isKin(n) {
    const h = this.hover;
    if (!h) return true;
    for (let p = n; p; p = p.parent) if (p === h) return true;
    for (let p = h; p; p = p.parent) if (p === n) return true;
    return false;
  }

  /* ---------------------------------------------------------------- события */
  _toWorld(mx, my) {
    return { x: (mx - this.view.x) / this.view.scale, y: (my - this.view.y) / this.view.scale };
  }

  nodeAt(mx, my) {
    const p = this._toWorld(mx, my);
    for (const n of this.nodes) {
      if (p.x >= n.x && p.x <= n.x + n.w && Math.abs(p.y - n.y) <= n.h / 2) return n;
    }
    return null;
  }

  toggleAt(mx, my) {
    const p = this._toWorld(mx, my);
    for (const n of this.nodes) {
      const tg = n.toggle;
      if (tg && (p.x - tg.x) ** 2 + (p.y - tg.y) ** 2 <= (tg.r + 4) ** 2) return n;
    }
    return null;
  }

  _bind() {
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
      const node = this.nodeAt(mx, my);
      cv.style.cursor = this.toggleAt(mx, my) ? 'pointer' : node ? 'pointer' : 'grab';
      if (node !== this.hover) { this.hover = node; this.draw(); }
      this._showTip(node, mx, my);
    });

    cv.addEventListener('mouseleave', () => {
      this.hover = null; this.tip.hidden = true; this.draw();
    });

    cv.addEventListener('click', e => {
      if (drag?.moved) return;
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const tg = this.toggleAt(mx, my);
      if (tg) {
        if (this.collapsed.has(tg.key)) this.collapsed.delete(tg.key); else this.collapsed.add(tg.key);
        this.layout();
        return;
      }
      const node = this.nodeAt(mx, my);
      if (node?.addr) document.dispatchEvent(new CustomEvent('peerpick', { detail: node.addr }));
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

  _showTip(node, mx, my) {
    if (!node || !node.tip) { this.tip.hidden = true; return; }
    this.tip.hidden = false;
    this.tip.style.left = Math.min(mx + 14, this.w - 290) + 'px';
    this.tip.style.top = Math.max(8, my - 10) + 'px';
    this.tip.innerHTML = node.tip;
  }

  exportPng() {
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width; tmp.height = this.canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = this.colors().bg;
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(this.canvas, 0, 0);
    const a = document.createElement('a');
    a.download = 'mmap-mindmap.png';
    a.href = tmp.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  }
}
