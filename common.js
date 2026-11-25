/* 공통: 실시간 연결(MQTT + 같은 기기 BroadcastChannel), 효과음, 파티클, QR, 시뮬레이션 */
(function () {
  'use strict';
  const CFG = window.EVENT_CONFIG;
  const qs = new URLSearchParams(location.search);
  const ROOM = String(qs.get('r') || CFG.room).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'demo';
  const BASE = CFG.topicPrefix + '/' + ROOM;
  const TOPICS = { in: BASE + '/in', state: BASE + '/state', hb: BASE + '/hb' };
  const ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ABC[b % 36]).join('');

  /* ---------- 실시간 버스 ---------- */
  function createBus({ subs = [], onMessage, onStatus }) {
    const seen = new Set(), order = [];
    const mark = id => { seen.add(id); order.push(id); if (order.length > 4000) seen.delete(order.shift()); };
    const deliver = (k, m, src) => {
      if (!m || typeof m !== 'object') return;
      if (m.m) { if (seen.has(m.m)) return; mark(m.m); }
      onMessage && onMessage(k, m, src);
    };
    let bc = null;
    if (!qs.has('nobc')) try { /* ?nobc=1 : 인터넷 경로만 시험할 때 */
      bc = new BroadcastChannel(BASE);
      bc.onmessage = e => { const d = e.data || {}; if (subs.includes(d.k)) deliver(d.k, d.m, 'local'); };
    } catch (e) { }
    let client = null, online = false;
    const status = s => onStatus && onStatus(s);
    status('connecting');
    try {
      client = window.mqtt.connect(CFG.broker, {
        clientId: 'evg_' + rid(10), keepalive: 20, reconnectPeriod: 1500,
        connectTimeout: 8000, clean: true, queueQoSZero: false
      });
      client.on('connect', () => { online = true; status('online'); client.subscribe(subs.map(k => TOPICS[k]), { qos: 0 }); });
      client.on('reconnect', () => status('connecting'));
      client.on('offline', () => { online = false; status('offline'); });
      client.on('close', () => { online = false; status('offline'); });
      client.on('error', () => { });
      client.on('message', (topic, payload) => {
        let m; try { m = JSON.parse(payload.toString()); } catch (e) { return; }
        const k = Object.keys(TOPICS).find(x => TOPICS[x] === topic);
        if (k) deliver(k, m, 'net');
      });
    } catch (e) { status('offline'); }

    function send(k, m, { retain = false, local = false } = {}) {
      m.m = m.m || rid(10);
      if (local) deliver(k, m, 'self'); else mark(m.m);
      if (bc) { try { bc.postMessage({ k, m }); } catch (e) { } }
      if (client && online) { try { client.publish(TOPICS[k], JSON.stringify(m), { qos: 0, retain }); } catch (e) { } }
      else if (k === 'in' && m.t === 'cmd') queue.push({ k, m, at: Date.now() }); /* 연결 전 누른 버튼은 연결되면 보냄 */
    }
    const queue = [];
    if (client) client.on('connect', () => {
      while (queue.length) { const q = queue.shift(); if (Date.now() - q.at < 15000) client.publish(TOPICS[q.k], JSON.stringify(q.m), { qos: 0 }); }
    });
    return { send, get online() { return online; } };
  }

  /* ---------- 숫자 ---------- */
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  function wonText(eok) { /* 억 단위 실수 -> "99,900,000,000원" */
    const won = Math.round(eok * 1e4) * 1e4; /* 만원 단위로 반올림 */
    return won.toLocaleString('ko-KR') + '원';
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 효과음 (파일 없이 직접 합성) ---------- */
  const Sound = {
    ctx: null, master: null, _noise: null,
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        this.master = this.ctx.createGain(); this.master.gain.value = .9;
        this.master.connect(comp); comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    get ok() { return !!this.ctx && this.ctx.state === 'running'; },
    noise() {
      if (this._noise) return this._noise;
      const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return (this._noise = b);
    },
    env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); },
    tone(freq, { type = 'sine', t = 0, a = .005, dec = .2, vol = .2, to = null, dest = null } = {}) {
      if (!this.ok) return;
      const c = this.ctx, now = c.currentTime + t, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + a + dec);
      this.env(g, now, a, vol, dec); o.connect(g); g.connect(dest || this.master);
      o.start(now); o.stop(now + a + dec + .05);
    },
    hiss({ t = 0, dec = .3, vol = .3, f = 2000, q = .7, type = 'bandpass', fTo = null, a = .003 } = {}) {
      if (!this.ok) return;
      const c = this.ctx, now = c.currentTime + t, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noise(); fl.type = type; fl.frequency.setValueAtTime(f, now); fl.Q.value = q;
      if (fTo) fl.frequency.exponentialRampToValueAtTime(fTo, now + a + dec);
      this.env(g, now, a, vol, dec); s.connect(fl); fl.connect(g); g.connect(this.master);
      s.start(now, Math.random()); s.stop(now + a + dec + .05);
    },
    tap() { this.tone(660 + Math.random() * 120, { type: 'triangle', dec: .07, vol: .08, to: 420 }); },
    hold() {
      this.tone(55, { type: 'sine', a: .02, dec: 1.6, vol: .5 });
      this.tone(110, { type: 'triangle', a: .02, dec: 1.2, vol: .12 });
      [880, 1318.5, 1760].forEach((f, i) => this.tone(f, { type: 'sine', t: .05 + i * .09, a: .02, dec: 1.4, vol: .05 }));
    },
    riser(d = .7) {
      this.hiss({ dec: d, vol: .25, f: 400, fTo: 6000, type: 'bandpass', q: 1.2, a: d * .9 });
      this.tone(120, { type: 'sawtooth', a: d * .9, dec: .05, vol: .06, to: 880 });
    },
    boom() {
      this.tone(140, { type: 'sine', a: .004, dec: 1.4, vol: .9, to: 32 });
      this.hiss({ dec: .9, vol: .5, f: 900, type: 'lowpass', fTo: 120 });
      this.hiss({ dec: .25, vol: .35, f: 5000, type: 'highpass' });
    },
    chord() {
      if (!this.ok) return;
      const c = this.ctx, now = c.currentTime, bus = c.createGain(), fl = c.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(800, now); fl.frequency.exponentialRampToValueAtTime(5200, now + .6); fl.frequency.exponentialRampToValueAtTime(1400, now + 4);
      bus.gain.value = .9; bus.connect(fl); fl.connect(this.master);
      [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach(f => [-6, 6].forEach(dt => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt;
        g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(.035, now + .06); g.gain.exponentialRampToValueAtTime(0.0001, now + 4.2);
        o.connect(g); g.connect(bus); o.start(now); o.stop(now + 4.3);
      }));
      [1046.5, 1318.5, 1568, 2093, 2637, 3136].forEach((f, i) => this.tone(f, { type: 'sine', t: .15 + i * .07, a: .01, dec: 1.2, vol: .06 }));
    },
    crackle(t = 0) {
      for (let i = 0; i < 14; i++) this.hiss({ t: t + Math.random() * .6, dec: .03 + Math.random() * .05, vol: .12 + Math.random() * .12, f: 3000 + Math.random() * 5000, type: 'bandpass', q: 3 });
    },
    pop(t = 0) {
      this.tone(90 + Math.random() * 40, { type: 'sine', t, a: .003, dec: .5, vol: .35, to: 40 });
      this.hiss({ t, dec: .35, vol: .2, f: 1200, type: 'lowpass', fTo: 200 });
      this.crackle(t + .12);
    }
  };

  /* ---------- 파티클 ---------- */
  class FX {
    constructor(canvas, { w, h, dpr } = {}) {
      this.c = canvas; this.g = canvas.getContext('2d'); this.ps = []; this.fixed = !!w;
      this.dpr = dpr || Math.min(2, window.devicePixelRatio || 1);
      if (this.fixed) { this.w = w; this.h = h; this.apply(); }
      else { this.fit(); addEventListener('resize', () => this.fit()); }
      this.last = performance.now();
      const loop = now => { const dt = Math.min(.05, (now - this.last) / 1000); this.last = now; this.step(dt); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    apply() { this.c.width = this.w * this.dpr; this.c.height = this.h * this.dpr; this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
    fit() { const r = this.c.getBoundingClientRect(); this.w = r.width || innerWidth; this.h = r.height || innerHeight; this.apply(); }
    add(p) { if (this.ps.length < 3200) this.ps.push(p); }
    spark(x, y, { n = 10, speed = 300, spread = Math.PI * 2, dir = 0, colors = ['#fff'], life = .9, size = 2, g = 380, drag = 1.6 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = dir + (Math.random() - .5) * spread, s = speed * (.35 + Math.random() * .75);
        this.add({ t: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (.6 + Math.random() * .6), age: 0, size: size * (.6 + Math.random() * .8), color: colors[(Math.random() * colors.length) | 0], g, drag });
      }
    }
    glow(x, y, r, color, life = .7) { this.add({ t: 'glow', x, y, r, color, life, age: 0, vx: 0, vy: 0 }); }
    burst(x, y, colors, scale = 1) {
      const n = Math.round(110 * scale);
      this.glow(x, y, 220 * scale, colors[0], .6);
      this.spark(x, y, { n, speed: 520 * scale, colors, life: 1.5, size: 2.6 * scale, g: 160, drag: 1.25 });
      this.spark(x, y, { n: n / 3, speed: 260 * scale, colors: ['#ffffff'], life: 1.1, size: 1.8 * scale, g: 120, drag: 1.4 });
    }
    rocket(x, tx, ty, colors, scale = 1, onBurst) {
      const dur = .9 + Math.random() * .3;
      this.add({ t: 'rocket', x, y: this.h + 10, sx: x, sy: this.h + 10, tx, ty, dur, age: 0, life: dur, colors, scale, onBurst });
    }
    confetti(n, { x = null, y = -20, vx = 0, vy = 0, spread = 1, colors }) {
      for (let i = 0; i < n; i++) {
        const px = x == null ? Math.random() * this.w : x;
        this.add({
          t: 'conf', x: px, y: y + (x == null ? -Math.random() * 200 : 0),
          vx: vx + (Math.random() - .5) * 420 * spread, vy: vy + (Math.random() - .5) * 300 * spread,
          w: 9 + Math.random() * 9, h: 5 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - .5) * 12,
          ph: Math.random() * 6.28, life: 6 + Math.random() * 3, age: 0, color: colors[(Math.random() * colors.length) | 0]
        });
      }
    }
    step(dt) {
      const g = this.g; g.clearRect(0, 0, this.w, this.h);
      const keep = [];
      g.globalCompositeOperation = 'source-over';
      for (const p of this.ps) {
        p.age += dt; if (p.age >= p.life) { if (p.t === 'rocket') this.burst(p.tx, p.ty, p.colors, p.scale), p.onBurst && p.onBurst(p); continue; }
        if (p.t === 'conf') {
          p.vx *= Math.exp(-1.6 * dt); p.vy = p.vy * Math.exp(-1.6 * dt) + 520 * dt; if (p.vy > 170) p.vy = 170;
          p.x += (p.vx + Math.sin(p.age * 3 + p.ph) * 60) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          if (p.y > this.h + 40) continue;
          const a = Math.min(1, (p.life - p.age) / .8);
          g.save(); g.globalAlpha = a; g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.age * 6 + p.ph));
          g.fillStyle = p.color; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
        }
        keep.push(p);
      }
      g.globalCompositeOperation = 'lighter';
      for (const p of keep) {
        const k = 1 - p.age / p.life;
        if (p.t === 'spark') {
          const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy = p.vy * d + p.g * dt;
          const ox = p.x, oy = p.y; p.x += p.vx * dt; p.y += p.vy * dt;
          const tw = k < .3 ? (Math.random() < .5 ? 1 : .3) : 1;
          g.globalAlpha = Math.min(1, k * 1.4) * tw; g.strokeStyle = p.color; g.lineWidth = p.size; g.lineCap = 'round';
          g.beginPath(); g.moveTo(ox - p.vx * .025, oy - p.vy * .025); g.lineTo(p.x, p.y); g.stroke();
        } else if (p.t === 'glow') {
          const r = p.r * (0.6 + .4 * (1 - k)), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          gr.addColorStop(0, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.globalAlpha = k * .55; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, 6.29); g.fill();
        } else if (p.t === 'rocket') {
          const u = p.age / p.dur, e = 1 - Math.pow(1 - u, 2.2);
          const ox = p.x, oy = p.y; p.x = p.sx + (p.tx - p.sx) * e; p.y = p.sy + (p.ty - p.sy) * e;
          g.globalAlpha = .9; g.strokeStyle = '#fff3d6'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(ox, oy); g.lineTo(p.x, p.y); g.stroke();
          if (Math.random() < .8) this.add({ t: 'spark', x: p.x, y: p.y, vx: (Math.random() - .5) * 40, vy: 40 + Math.random() * 60, life: .5, age: 0, size: 1.6, color: '#ffcf7a', g: 60, drag: 2 });
        }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      this.ps = keep;
    }
  }

  /* ---------- QR (둥근 점 SVG) ---------- */
  function qrSvg(text, { fg = '#0b1020', bg = 'transparent' } = {}) {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2, size = n + m * 2;
    let dots = '';
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c) || finder(r, c)) continue;
      dots += `<circle cx="${c + m + .5}" cy="${r + m + .5}" r=".44"/>`;
    }
    const eye = (x, y) => `<rect x="${x + .5}" y="${y + .5}" width="6" height="6" rx="1.8" fill="none" stroke="${fg}" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision"><rect width="${size}" height="${size}" fill="${bg}"/><g fill="${fg}">${dots}${eye(m, m)}${eye(m + n - 7, m)}${eye(m, m + n - 7)}</g></svg>`;
  }

  /* ---------- 가짜 직원 시뮬레이션 ---------- */
  function runSim(bus, { people = 300, maxMs = 20000, onTick, onEnd } = {}) {
    const t0 = performance.now(); let stopped = false;
    const iv = setInterval(() => {
      const el = performance.now() - t0;
      const n = Math.min(people, Math.round(people * Math.min(1, el / 2200)));
      const rate = 5.5 + 2.2 * Math.sin(el / 800) + Math.random();
      const taps = Math.max(0, Math.round(n * rate * .2));
      bus.send('in', { t: 'sim', n, taps }, { local: true });
      onTick && onTick(n, el);
      if (el > maxMs) stop();
    }, 200);
    function stop() { if (stopped) return; stopped = true; clearInterval(iv); onEnd && onEnd(); }
    return stop;
  }

  function pageUrl(file) {
    const u = new URL(file, location.href); u.search = ''; u.hash = '';
    u.searchParams.set('r', ROOM); return u.toString();
  }

  function applyBrand() {
    document.querySelectorAll('[data-cfg]').forEach(el => { const v = CFG[el.dataset.cfg]; if (v != null) el.textContent = v; });
    document.querySelectorAll('.logo-slot').forEach(el => {
      if (CFG.logoUrl) { el.innerHTML = `<img src="${CFG.logoUrl}" alt="">`; el.classList.add('has-img'); }
    });
    document.querySelectorAll('.sian').forEach(el => { el.textContent = CFG.draftLabel; el.hidden = !CFG.draftLabel; });
  }

  window.EVG = { CFG, ROOM, rid, createBus, fmt, wonText, clamp, Sound, FX, qrSvg, runSim, pageUrl, applyBrand };
})();
