/*
 * Схема переводов: force-directed граф на canvas.
 * Центральный узел — исследуемый кошелёк, вокруг — контрагенты.
 * Толщина ребра пропорциональна обороту, цвет — направлению.
 */
class TransferGraph {
  constructor(canvas, tipEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tipEl;
    this.nodes = [];
    this.edges = [];
    this.view = { x: 0, y: 0, scale: 1 };
    this.hover = null;
    this.raf = null;
    this._bindEvents();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement);
  }

  colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return {
      self: v('--map-self'), selfText: v('--map-self-text'),
      in: v('--map-in'), out: v('--map-out'),
      text: v('--text'), dim: v('--text-dim'), line: v('--map-line'), bg: v('--bg-sunk')
    };
  }

  /** data: { self, peers: [{addr, in, out, txs, symbols}] } */
  setData(data) {
    const peers = data.peers.slice(0, 60);
    const max = Math.max(1, ...peers.map(p => p.in + p.out));
    const cx = 0, cy = 0;

    this.nodes = [{ id: data.self, self: true, x: cx, y: cy, vx: 0, vy: 0, r: 20, peer: null }];
    this.edges = [];

    peers.forEach((p, i) => {
      const a = (i / peers.length) * Math.PI * 2;
      const ring = 150 + (i % 4) * 55;
      const weight = (p.in + p.out) / max;
      this.nodes.push({
        id: p.addr, self: false, peer: p,
        x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring,
        vx: 0, vy: 0, r: 6 + Math.sqrt(weight) * 14,
        dir: p.out > p.in ? 'out' : 'in'
      });
      this.edges.push({ a: 0, b: this.nodes.length - 1, w: weight, peer: p });
    });

    this.resize();
    this.fit();
    this.simulate(240);
  }

  simulate(steps) {
    const n = this.nodes;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < n.length; i++) {
        for (let j = i + 1; j < n.length; j++) {
          let dx = n[j].x - n[i].x, dy = n[j].y - n[i].y;
          let d2 = dx * dx + dy * dy || 0.01;
          const min = (n[i].r + n[j].r + 26);
          if (d2 < min * min * 9) {
            const d = Math.sqrt(d2);
            const f = (2600 / d2);
            const ux = dx / d, uy = dy / d;
            n[i].vx -= ux * f; n[i].vy -= uy * f;
            n[j].vx += ux * f; n[j].vy += uy * f;
          }
        }
      }
      for (const e of this.edges) {
        const a = n[e.a], b = n[e.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const target = 130 + (1 - e.w) * 130;
        const f = (d - target) * 0.02;
        const ux = dx / d, uy = dy / d;
        b.vx -= ux * f; b.vy -= uy * f;
      }
      for (let i = 1; i < n.length; i++) {
        n[i].vx *= 0.82; n[i].vy *= 0.82;
        n[i].x += n[i].vx; n[i].y += n[i].vy;
      }
    }
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

  fit() {
    if (!this.nodes.length) return;
    const pad = 60;
    const xs = this.nodes.map(n => n.x), ys = this.nodes.map(n => n.y);
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const scale = Math.min((this.w || 600) / (maxX - minX), (this.h || 400) / (maxY - minY), 2);
    this.view.scale = Math.max(0.15, scale);
    this.view.x = (this.w || 600) / 2 - ((minX + maxX) / 2) * this.view.scale;
    this.view.y = (this.h || 400) / 2 - ((minY + maxY) / 2) * this.view.scale;
    this.draw();
  }

  toScreen(n) {
    return { x: n.x * this.view.scale + this.view.x, y: n.y * this.view.scale + this.view.y };
  }

  draw() {
    const ctx = this.ctx, c = this.colors();
    if (!ctx || !this.w) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    for (const e of this.edges) {
      const a = this.toScreen(this.nodes[e.a]), b = this.toScreen(this.nodes[e.b]);
      const node = this.nodes[e.b];
      const hot = this.hover === node;
      ctx.beginPath();
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.strokeStyle = node.dir === 'out' ? c.out : c.in;
      ctx.globalAlpha = hot ? 1 : 0.28 + e.w * 0.35;
      ctx.lineWidth = Math.max(0.8, (0.6 + e.w * 2.4) * this.view.scale);
      // исходящие — пунктир, направление читается без цвета
      ctx.setLineDash(node.dir === 'out' ? [6 * this.view.scale, 4 * this.view.scale] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    for (const n of this.nodes) {
      const p = this.toScreen(n);
      const r = Math.max(3, n.r * this.view.scale);
      const col = n.self ? c.self : (n.dir === 'out' ? c.out : c.in);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = this.hover && this.hover !== n && !n.self ? 0.45 : 1;
      // получатели — полый кружок, отправители — залитый
      if (n.dir === 'out' && !n.self) {
        ctx.fillStyle = c.bg;
        ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.stroke();
      } else {
        ctx.fillStyle = col;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (n === this.hover || n.self) {
        ctx.lineWidth = 1.4; ctx.strokeStyle = c.text; ctx.globalAlpha = 0.55;
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (n.self || r > 9) {
        ctx.fillStyle = c.text;
        ctx.font = `${n.self ? 600 : 400} ${n.self ? 12 : 11}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(shortAddr(n.id, n.self ? 8 : 5, 4), p.x, p.y + r + 13);
      }
    }
  }

  nodeAt(mx, my) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i], p = this.toScreen(n);
      const r = Math.max(6, n.r * this.view.scale) + 3;
      if ((mx - p.x) ** 2 + (my - p.y) ** 2 <= r * r) return n;
    }
    return null;
  }

  _bindEvents() {
    const cv = this.canvas;
    let drag = null;

    cv.addEventListener('mousedown', e => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const node = this.nodeAt(mx, my);
      drag = node ? { node, ox: mx, oy: my } : { pan: true, ox: mx, oy: my, vx: this.view.x, vy: this.view.y };
    });

    window.addEventListener('mouseup', () => { drag = null; });

    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag?.pan) {
        this.view.x = drag.vx + (mx - drag.ox);
        this.view.y = drag.vy + (my - drag.oy);
        this.draw();
        return;
      }
      if (drag?.node) {
        drag.node.x = (mx - this.view.x) / this.view.scale;
        drag.node.y = (my - this.view.y) / this.view.scale;
        this.draw();
        return;
      }
      const node = this.nodeAt(mx, my);
      if (node !== this.hover) { this.hover = node; this.draw(); }
      this._showTip(node, mx, my);
    });

    cv.addEventListener('mouseleave', () => {
      this.hover = null; this.tip.hidden = true; this.draw();
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

    cv.addEventListener('contextmenu', e => {
      const r = cv.getBoundingClientRect();
      const node = this.nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (!node || node.self) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('peerhide', { detail: node.id }));
    });

    cv.addEventListener('dblclick', e => {
      const r = cv.getBoundingClientRect();
      const node = this.nodeAt(e.clientX - r.left, e.clientY - r.top);
      if (node && !node.self) {
        document.dispatchEvent(new CustomEvent('peerpick', { detail: node.id }));
      }
    });
  }

  _showTip(node, mx, my) {
    if (!node) { this.tip.hidden = true; return; }
    const p = node.peer;
    this.tip.hidden = false;
    this.tip.style.left = Math.min(mx + 14, this.w - 290) + 'px';
    this.tip.style.top = Math.max(8, my - 10) + 'px';
    if (node.self) {
      this.tip.innerHTML = `<b>${shortAddr(node.id, 10, 8)}</b><br>${t('legend.self')}`;
    } else {
      this.tip.innerHTML =
        `<b>${shortAddr(node.id, 10, 8)}</b><br>` +
        `${t('dir.in')}: ${fmtUsd(p.in)} · ${t('dir.out')}: ${fmtUsd(p.out)}<br>` +
        `${p.txs} ${t('peers.txs')} · ${[...p.symbols].slice(0, 4).join(', ')}`;
    }
  }

  exportPng() {
    const link = document.createElement('a');
    link.download = 'mmap-graph.png';
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width; tmp.height = this.canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = this.colors().bg;
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(this.canvas, 0, 0);
    link.href = tmp.toDataURL('image/png');
    document.body.appendChild(link); link.click(); link.remove();
  }
}
