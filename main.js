/* 메인 스크린: 게이지 계산(대표 화면 1대가 맡음) + 연출 */
(function () {
  'use strict';
  const { CFG, ROOM, rid, createBus, fmt, wonText, clamp, Sound, FX, qrSvg, runSim, pageUrl, applyBrand } = window.EVG;
  const $ = id => document.getElementById(id);
  const stage = $('stage');
  applyBrand();

  /* 화면 맞춤 (1920x1080 고정 무대를 창 크기에 맞춤) */
  stage.style.marginLeft = '-960px'; stage.style.marginTop = '-540px'; stage.style.transformOrigin = '50% 50%';
  const fit = () => { const s = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `scale(${s})`; };
  fit(); addEventListener('resize', fit);

  /* QR */
  const joinUrl = pageUrl('join.html');
  $('qr').innerHTML = qrSvg(joinUrl, { fg: '#0b1020' });
  $('joinShort').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '');

  /* 눈금 */
  const G = CFG.goal, STOP = CFG.stopAt, DUR = CFG.durationSec;
  const tickVals = [0, G * .25, G * .5, G * .75, G];
  $('ticks').innerHTML = tickVals.map(v => `<div class="tick" style="left:${v / G * 100}%">${v === 0 ? '0' : fmt(v) + '억'}</div>`).join('');
  const tickEls = [...$('ticks').children];

  /* 숫자 굴림판 */
  const odo = $('odo');
  const SLOTS = 4; const slotEls = []; const strips = [];
  for (let i = SLOTS - 1; i >= 0; i--) {
    const s = document.createElement('div'); s.className = 'slot';
    const st = document.createElement('div'); st.className = 'strip';
    st.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(d => `<span>${d}</span>`).join('');
    s.appendChild(st); odo.appendChild(s); slotEls[i] = s; strips[i] = st;
    if (i === 3) { const c = document.createElement('div'); c.className = 'slot comma'; c.innerHTML = '<span>,</span>'; odo.appendChild(c); slotEls.comma = c; }
  }
  function setOdo(v, speed) {
    let lower = 0;
    for (let i = 0; i < SLOTS; i++) {
      let pos;
      if (i === 0) {
        /* 자릿수가 바뀌는 순간에만 휙 굴러가도록 (반쯤 걸친 숫자 방지) */
        const w = ((v % 10) + 10) % 10, b = Math.floor(w + 1e-9), f = w - b;
        const u = clamp((f - .55) / .45, 0, 1); pos = b + u * u * (3 - 2 * u);
      }
      else { const base = Math.floor(v / Math.pow(10, i) + 1e-9) % 10; pos = base + clamp(lower - 9, 0, 1); }
      lower = pos;
      strips[i].style.transform = `translateY(${-pos}em)`;
      const blur = i === 0 ? clamp(speed * .05, 0, 9) : i === 1 ? clamp(speed * .006, 0, 4) : 0;
      strips[i].style.filter = blur > .3 ? `blur(${blur.toFixed(1)}px)` : '';
      const show = i === 0 || v >= Math.pow(10, i) - .5;
      slotEls[i].classList.toggle('hide', !show);
    }
    slotEls.comma.classList.toggle('hide', v < 999.5);
  }

  /* ---------- 상태 ---------- */
  const ME = rid(8), START = Date.now() + Math.random();
  const ease = p => 1 - Math.pow(1 - p, 1.55);                   /* 처음엔 빠르게, 끝에서 숨 고르기 */
  const invEase = a => 1 - Math.pow(1 - clamp(a / STOP, 0, 1), 1 / 1.55);
  const S = { ph: 'ready', p: 0, t: 0, v: 0, ep: Date.now(), taps: 0, peopleBase: 0, stall: false, lastTap: 0, a: 0 };
  const ids = new Map(); let simPeople = 0; const tapLog = [];
  let leader = false, booted = false; const mains = new Map(); let mirror = null;
  let net = 'connecting';

  function people() { return S.peopleBase + ids.size + simPeople; }
  function reset() {
    Object.assign(S, { ph: 'ready', p: 0, t: 0, v: 0, ep: Date.now(), taps: 0, peopleBase: 0, stall: false, lastTap: 0, a: 0 });
    ids.clear(); simPeople = 0; tapLog.length = 0; stopLocalSim();
  }
  function addTaps(n) {
    if (S.ph !== 'ready' && S.ph !== 'run') return;
    n = clamp(n | 0, 0, 5000); if (!n) return;
    tapLog.push([performance.now(), n]); S.taps += n; S.lastTap = performance.now();
    if (S.ph === 'ready') S.ph = 'run';
  }
  function handleIn(m) {
    if (!leader) return;
    switch (m.t) {
      case 'hi': if (m.id) ids.set(String(m.id).slice(0, 20), 1); break;
      case 'tap': if (m.id) ids.set(String(m.id).slice(0, 20), 1); addTaps(Math.min(m.n, 60)); break;
      case 'sim': simPeople = Math.max(simPeople, clamp(m.n | 0, 0, 2000)); addTaps(m.taps); break;
      case 'cmd':
        if (m.c === 'reset') reset();
        else if (m.c === 'fill999') { if (S.ph === 'ready' || S.ph === 'run') { S.ph = 'hold'; S.p = 1; } }
        else if (m.c === 'fill1000') { if (S.ph !== 'done') S.ph = 'done'; }
        else if (m.c === 'ceo') { if (S.ph === 'hold') S.ph = 'done'; }
        else if (m.c === 'simStart') { if (S.ph === 'hold' || S.ph === 'done') reset(); if (!stopSim) stopSim = runSim(bus, { onEnd: () => { stopSim = null; } }); }
        else if (m.c === 'simStop') stopLocalSim();
        break;
    }
  }

  const bus = createBus({
    subs: ['in', 'state', 'hb'],
    onStatus: s => { net = s; },
    onMessage: (k, m) => {
      if (k === 'in') handleIn(m);
      else if (k === 'hb') { if (m.id && m.id !== ME) mains.set(m.id, { start: m.start, seen: Date.now() }); }
      else if (k === 'state') { if (m.ld !== ME) mirror = m; }
    }
  });
  setInterval(() => bus.send('hb', { t: 'hb', id: ME, start: START }), 1000);

  function electLeader() {
    const now = Date.now(); let best = { id: ME, start: START };
    for (const [id, v] of mains) { if (now - v.seen > 3500) { mains.delete(id); continue; } if (v.start < best.start || (v.start === best.start && id < best.id)) best = { id, start: v.start }; }
    const was = leader; leader = best.id === ME;
    if (leader && !was) {
      /* 이어받기: 최근 상태가 있으면 그대로 이어서 */
      if (mirror && Math.abs(now - mirror.ts) < 15 * 60 * 1000) {
        S.ph = mirror.ph; S.ep = mirror.ep; S.taps = mirror.tp || 0; S.peopleBase = mirror.pp || 0;
        S.p = S.ph === 'hold' || S.ph === 'done' ? 1 : invEase(mirror.a || 0); S.t = S.p * DUR;
      }
    }
  }
  setTimeout(() => { booted = true; electLeader(); }, 1600);
  setInterval(() => { if (booted) electLeader(); }, 1000);

  /* 게이지 계산 (리더) */
  function simulate(dt) {
    const now = performance.now();
    while (tapLog.length && now - tapLog[0][0] > 1200) tapLog.shift();
    const rate = tapLog.reduce((s, x) => s + x[1], 0) / 1.2;
    S.rate = rate;
    if (S.ph === 'run') {
      const active = now - S.lastTap < 2000;
      let vt = 0;
      if (active) {
        const f = .85 + .3 * clamp(Math.log10(1 + rate) / 3, 0, 1);       /* 탭이 많을수록 조금 빠르게 (0.85~1.15배) */
        const lag = S.t / DUR - S.p;                                     /* 10초 시계에서 뒤처진 만큼 따라잡기 */
        vt = Math.max(.35, f * (1 + 1.4 * lag)) / DUR;
        S.t += dt;
      }
      S.v += (vt - S.v) * Math.min(1, dt * (active ? 5 : 3));
      S.p += S.v * dt;
      S.stall = !active;
      if (S.p >= 1) { S.p = 1; S.ph = 'hold'; S.stall = false; }
    }
    if (S.ph === 'ready') { S.p = 0; S.v = 0; }
    S.a = S.ph === 'done' ? G : S.ph === 'hold' ? STOP : STOP * ease(S.p);
  }
  setInterval(() => {
    if (!leader || !booted) return;
    bus.send('state', { t: 'st', sim: stopSim ? 1 : 0, ph: S.ph, a: +S.a.toFixed(3), pp: people(), tp: S.taps, ep: S.ep, st: S.stall ? 1 : 0, ld: ME, ts: Date.now() }, { retain: true });
  }, 300);

  /* ---------- 그리기 ---------- */
  const fx = new FX($('fx'), { w: 1920, h: 1080, dpr: 1 });
  let shown = 0, shownPhase = null, doneAnim = null, lastShown = 0;
  const view = () => leader && booted ? { ph: S.ph, a: S.a, pp: people(), tp: S.taps, st: S.stall, rate: S.rate || 0 }
    : mirror ? { ph: mirror.ph, a: mirror.a, pp: mirror.pp, tp: mirror.tp, st: !!mirror.st, rate: 0 } : { ph: 'ready', a: 0, pp: 0, tp: 0, st: false, rate: 0 };

  /* 계산은 화면 그리기와 따로, 실제 시간 기준으로 (창이 가려져도 10초 유지) */
  let lastSim = performance.now();
  setInterval(() => { const now = performance.now(), dt = Math.min(.5, (now - lastSim) / 1000); lastSim = now; if (leader && booted) simulate(dt); }, 33);

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(.25, (now - lastFrame) / 1000); lastFrame = now;
    const V = view();

    if (V.ph !== shownPhase) { onPhase(V.ph, shownPhase, shownPhase === null || now < 2600); shownPhase = V.ph; }

    /* 숫자 부드럽게 따라가기 */
    let target = V.a;
    if (doneAnim) {
      const u = clamp((now - doneAnim.t0) / doneAnim.dur, 0, 1);
      target = doneAnim.from + (G - doneAnim.from) * (1 - Math.pow(1 - u, 4));
      if (u >= 1) doneAnim = null;
      shown = target;
    } else if (V.ph === 'done') {
      /* 대표 버튼 직후 잠깐 999억에서 숨 고르기 → celebrate()가 굴려 올림 */
    } else {
      shown += (target - shown) * Math.min(1, dt * 7);
      if (Math.abs(target - shown) < .002) shown = target;
    }
    if (V.ph === 'ready') shown = Math.min(shown, target);
    const speed = Math.abs(shown - lastShown) / Math.max(dt, .001); lastShown = shown;
    setOdo(shown, speed);
    $('won').textContent = wonText(shown);

    const frac = clamp(shown / G, 0, 1);
    $('fill').style.transform = `scaleX(${frac})`;
    $('head').style.transform = `translateX(${frac * 1440}px)`;
    $('pct').textContent = (Math.floor(frac * 1000) / 10).toFixed(1) + '%';
    tickEls.forEach((el, i) => el.classList.toggle('on', shown >= tickVals[i] - .01 && tickVals[i] > 0));
    $('people').textContent = fmt(V.pp);
    $('live').classList.toggle('off', net !== 'online');

    if (V.ph === 'run') {
      const m = $('msg');
      if (V.st) { m.classList.add('urge'); m.innerHTML = '조금만 더! <b>손을 멈추지 마세요</b>'; }
      else { m.classList.remove('urge'); m.innerHTML = `지금까지 <b>${fmt(V.tp)}</b>번의 탭이 모였어요`; }
      /* 게이지 끝 불꽃 */
      const hx = 240 + frac * 1440, hy = 712 + 13;
      const n = speed > 1 ? Math.min(6, 1 + Math.floor(speed / 25)) : 0;
      if (n) fx.spark(hx, hy, { n, speed: 260, dir: Math.PI, spread: 1.6, colors: ['#ffffff', getVar('--accent'), getVar('--brand')], life: .7, size: 2.2, g: 260 });
    }
    requestAnimationFrame(frame);
  }
  const cssVars = {}; const getVar = n => cssVars[n] || (cssVars[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#fff');

  function onPhase(ph, prev, initial) {
    document.body.dataset.phase = ph;
    const m = $('msg'); m.classList.remove('urge');
    $('eyebrow').textContent = ph === 'done' ? '목표 달성' : '2027 목표 달성까지';
    if (ph === 'ready') { shown = 0; $('doneTxt').classList.remove('show'); doneAnim = null; m.innerHTML = ''; }
    if (ph === 'hold') {
      m.textContent = '대표님, 마지막 1억을 채워주세요';
      if (!initial) { Sound.hold(); fx.spark(240 + STOP / G * 1440, 725, { n: 80, speed: 420, colors: [getVar('--gold-1'), getVar('--gold-2'), '#fff'], life: 1.1, size: 2.4, g: 200 }); }
    }
    if (ph === 'done') {
      if (initial) { shown = G; $('doneTxt').classList.add('show'); fx.confetti(60, { colors: confColors() }); }
      else celebrate();
    }
  }
  const confColors = () => [getVar('--gold-1'), getVar('--gold-2'), getVar('--gold-3'), getVar('--brand'), getVar('--brand-2'), getVar('--accent'), '#ffffff'];

  function celebrate() {
    const gold = [getVar('--gold-1'), getVar('--gold-2'), getVar('--gold-3'), '#ffffff'];
    const mix = [getVar('--brand'), getVar('--brand-2'), getVar('--accent'), '#ffffff'];
    Sound.riser(.65);
    fx.spark(240 + 1440 * .999, 725, { n: 140, speed: 600, colors: gold, life: 1.2, size: 2.6, g: 120 });
    setTimeout(() => {
      Sound.boom(); Sound.chord();
      $('flash').classList.remove('go'); void $('flash').offsetWidth; $('flash').classList.add('go');
      stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
      const am = $('amount'); am.classList.remove('punch'); void am.offsetWidth; am.classList.add('punch');
      doneAnim = { t0: performance.now(), dur: 1500, from: Math.max(shown, STOP) };
      fx.burst(960, 420, gold, 1.6);
      fx.confetti(160, { x: 0, y: 1080, vx: 900, vy: -1250, spread: 1.6, colors: confColors() });
      fx.confetti(160, { x: 1920, y: 1080, vx: -900, vy: -1250, spread: 1.6, colors: confColors() });
      setTimeout(() => $('doneTxt').classList.add('show'), 700);
      let k = 0;
      const show = () => {
        if (document.body.dataset.phase !== 'done' || k > 22) return;
        const x = 260 + Math.random() * 1400, y = 140 + Math.random() * 360, cols = k % 3 === 0 ? mix : gold;
        fx.rocket(x + (Math.random() - .5) * 300, x, y, cols, .8 + Math.random() * .6, () => Sound.pop());
        k++; setTimeout(show, k < 8 ? 330 : 620 + Math.random() * 400);
      };
      setTimeout(show, 450);
      [2600, 5200, 8000].forEach(t => setTimeout(() => { if (document.body.dataset.phase === 'done') fx.confetti(140, { colors: confColors() }); }, t));
    }, 650);
  }

  requestAnimationFrame(frame);

  /* ---------- 소리·전체화면 / 비상 단축키 ---------- */
  stage.addEventListener('pointerdown', () => {
    Sound.unlock(); $('soundPill').classList.add('gone');
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { });
  });
  let stopSim = null;
  function stopLocalSim() { if (stopSim) { const s = stopSim; stopSim = null; s(); } }
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 's') bus.send('in', { t: 'cmd', c: stopSim ? 'simStop' : 'simStart' }, { local: true });
    else if (k === '9') bus.send('in', { t: 'cmd', c: 'fill999' }, { local: true });
    else if (k === '0' || k === 'enter') bus.send('in', { t: 'cmd', c: 'fill1000' }, { local: true });
    else if (k === 'r' && e.shiftKey) bus.send('in', { t: 'cmd', c: 'reset' }, { local: true });
    else if (k === 'f') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { });
  });
  setInterval(() => { if (stopSim && view().ph !== 'run' && view().ph !== 'ready') stopLocalSim(); }, 300);

  window.__evg = { S, view, get leader() { return leader; } };
})();
