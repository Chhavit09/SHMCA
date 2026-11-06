'use strict';
/*
   Copyright (c) 2026 Chhavit (@Chhavit09), Harsh Jain (@harshj1214-hj), Satyam Kumar (@kr-Satyam09), and Sudhanshu Ojha (@sudhanshuOjha07)
   All Rights Reserved. Proprietary and confidential: see LICENSE.txt for the terms.
*/
/* ORBITAL website – js/playback.js. Playback: time, speeds, interpolation between written ticks, and the Burn focus view. */

/* --------------------------------------------------------------------------
   8. PLAYBACK AND INTERPOLATION
   -------------------------------------------------------------------------- */

// Positions of every object at the current fractional tick (reused buffers).
const interp = { sat: new Float64Array(96), deb: new Float64Array(3072) };

function ensureCapacity(arr, needed) {
  if (arr.length >= needed) return arr;
  return new Float64Array(Math.max(needed, arr.length * 2));
}

// Linear interpolation between written frame i and frame i+1.
function computeInterp() {
  const run = state.run;
  const i = state.frameIdx, fr = run.frames[i], nx = run.frames[i + 1];
  const a = nx ? clamp((state.playTick - fr.tick) / (nx.tick - fr.tick), 0, 1) : 0;
  interp.sat = ensureCapacity(interp.sat, fr.sats.length * 3);
  interp.deb = ensureCapacity(interp.deb, fr.debris.length * 3);
  lerpList(fr.sats, nx ? nx.sats : null, interp.sat, a);
  lerpList(fr.debris, nx ? nx.debris : null, interp.deb, a);
}

// position = this frame + (next frame − this frame) × a, for every object in a list
function lerpList(list, nextList, out, a) {
  for (let k = 0; k < list.length; k++) {
    const o = list[k], o3 = k * 3;
    if (nextList && o.next >= 0) {
      const p = nextList[o.next];
      out[o3] = o.x + (p.x - o.x) * a;
      out[o3 + 1] = o.y + (p.y - o.y) * a;
      out[o3 + 2] = o.z + (p.z - o.z) * a;
    } else {
      out[o3] = o.x; out[o3 + 1] = o.y; out[o3 + 2] = o.z;   // object vanishes next frame: hold still
    }
  }
}

// Find the frame and event indices for state.playTick.
function syncTime() {
  const run = state.run;
  state.frameIdx = clamp(upperBound(run.ticks, state.playTick) - 1, 0, run.frames.length - 1);
  state.eventIdx = upperBound(run.eventTicks, state.playTick);
}

function advance(wallDt) {
  const run = state.run;
  if (focus.active) { advanceBurnFocus(wallDt); return; }
  state.playTick += wallDt * UI.speeds[state.speedIndex] * run.ticksPerSecond;
  if (state.playTick >= run.lastTick) { state.playTick = run.lastTick; setPlaying(false); }
}

function setPlaying(on) {
  const run = state.run;
  if (on && run && state.playTick >= run.lastTick) state.playTick = run.firstTick;   // replay from the start
  state.playing = !!(on && run && run.frames.length > 1);
  if (!dom.playBtn) return;
  dom.playBtn.classList.toggle('playing', state.playing);
  dom.playBtn.setAttribute('aria-label', state.playing ? 'Pause (Space)' : 'Play (Space)');
}
function togglePlay() { if (state.run) setPlaying(!state.playing); }

function setPlayTick(t) {
  const run = state.run;
  if (!run) return;
  state.playTick = clamp(t, run.firstTick, run.lastTick);
  ui.dirty = true;
}

// Step to the previous / next written frame.
function stepFrame(dir) {
  const run = state.run;
  if (!run) return;
  endBurnFocus(false);
  setPlaying(false);
  syncTime();
  const i = state.frameIdx;
  const before = state.playTick;
  let target;
  if (dir < 0) target = state.playTick > run.ticks[i] + 1e-9 ? run.ticks[i] : run.ticks[Math.max(0, i - 1)];
  else target = run.ticks[Math.min(run.frames.length - 1, i + 1)];
  setPlayTick(target);
  if (dir > 0) spawnPulses(before, state.playTick, performance.now());
}

function setSpeed(index) {
  state.speedIndex = clamp(index, 0, UI.speeds.length - 1);
  if (!dom.speedButtons) return;
  dom.speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.speedIndex)));
  if (dom.speedSelect) dom.speedSelect.value = String(state.speedIndex);
}

/* ---- Burn focus: replay every evasive burn up close, in slow motion ---------
   When playback reaches an evasive burn, the camera flies to that satellite,
   playback jumps back a little and plays the moment slowly, and the scene shows:
   the threat (ringed, with the live distance), the path the satellite was on
   before the burn (dashed, worked out from its motion just before the burn with
   the same gravity as the simulation) and the path it actually took (solid). */
const BURN_FOCUS = Object.freeze({
  wallSeconds: 8,        // one focus lasts about this long
  slowTicks: 2,          // ±2 ticks around the burn are the slowest part
  slowShare: 0.45,       // ... and take this share of the time
  minPre: 8, minPost: 14,             // ticks shown before and after (at least 2 / 3 written frames)
  repeatTicks: 60,       // the same satellite is not focused again until this long after
  pauseWall: 1.5,        // seconds of normal playback between two focuses
});
const focus = {
  enabled: true, active: false, ev: -1, sat: -1, burnTick: 0, startTick: 0, endTick: 0,
  slowRate: 1, fastRate: 1, threat: null, alert: null, ghost: null, saved: null,
  skipUntil: new Map(), lastEnd: -1e9, sep: 0, maxSep: 0, cardAt: 0,
};

// What the burn avoided, from its log line ("... against debris #1234" / "... against friendly sat NAME").
function burnThreat(e) {
  let m = /against debris #(\S+)/.exec(e.text);
  if (m) return { kind: 'debris', id: m[1] };
  m = /against friendly sat (\S+)/.exec(e.text);
  return m ? { kind: 'sat', name: m[1] } : null;
}

// The collision alert that led to the burn: same satellite, same tick, just before it.
function alertFor(evIdx) {
  const run = state.run, e = run.events[evIdx];
  for (let j = evIdx - 1; j >= 0 && run.events[j].tick === e.tick; j--) {
    const a = run.events[j];
    if (a.satIdx !== e.satIdx || !/COLLISION ALERT/.test(a.tag)) continue;
    const d = /distance=([-\d.eE+]+)/.exec(a.text), k = /risk=(\w+)/.exec(a.text);
    return { dist: d ? Number(d[1]) : NaN, risk: k ? k[1] : '' };
  }
  return null;
}

// Gravity per tick² at a point, in the run's units (same rule as the simulation).
function gravityPerTick2(x, y, z, out) {
  const r = Math.sqrt(x * x + y * y + z * z) || 1, dt = config.dt || 1;
  const g = config.mode === 'real' ? (RUN_PRESETS.real.mu / (r * r)) * dt * dt : (6.5 * 6.5) / r;
  out.x = (-x / r) * g; out.y = (-y / r) * g; out.z = (-z / r) * g;
}

// The path without the burn: the satellite's motion just before it, continued tick by tick.
const ghostAcc = { x: 0, y: 0, z: 0 };
function ghostPath(t, burnTick, endTick) {
  const run = state.run, track = run.sats[t];
  let i0 = clamp(upperBound(run.ticks, burnTick) - 1, 0, run.frames.length - 1);   // last frame at or before the burn
  while (i0 > 0 && track.idx[i0] < 0) i0--;
  let im = i0 - 1;
  while (im >= 0 && track.idx[im] < 0) im--;
  if (track.idx[i0] < 0 || im < 0) return null;
  const p0 = run.frames[i0].sats[track.idx[i0]], pm = run.frames[im].sats[track.idx[im]];
  const gap = run.ticks[i0] - run.ticks[im];
  // With the simulation's stepping (velocity += gravity, then position += velocity), the
  // chord over `gap` ticks equals the latest velocity minus (gap − 1)/2 ticks of gravity.
  // With telemetry every tick (gap 1) the chord is exactly the velocity.
  gravityPerTick2(p0.x, p0.y, p0.z, ghostAcc);
  const half = (gap - 1) / 2;
  let vx = (p0.x - pm.x) / gap + ghostAcc.x * half;
  let vy = (p0.y - pm.y) / gap + ghostAcc.y * half;
  let vz = (p0.z - pm.z) / gap + ghostAcc.z * half;
  const steps = Math.max(1, Math.ceil(endTick - run.ticks[i0]));
  const pts = new Float64Array((steps + 1) * 3);
  let x = p0.x, y = p0.y, z = p0.z;
  pts[0] = x; pts[1] = y; pts[2] = z;
  for (let n = 1; n <= steps; n++) {
    gravityPerTick2(x, y, z, ghostAcc);
    vx += ghostAcc.x; vy += ghostAcc.y; vz += ghostAcc.z;           // semi-implicit Euler, as in the simulation
    x += vx; y += vy; z += vz;
    pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z;
  }
  return { pts, startTick: run.ticks[i0], frame0: i0, burnAt: { x: p0.x, y: p0.y, z: p0.z } };
}

// Called while playing: start a focus for the first burn crossed in (fromTick, toTick].
function maybeStartBurnFocus(fromTick, toTick, now) {
  const run = state.run;
  if (!focus.enabled || !run || !run.burnEv || now / 1000 - focus.lastEnd < BURN_FOCUS.pauseWall) return;
  const a = upperBound(run.burnTicks, fromTick), b = upperBound(run.burnTicks, toTick);
  for (let i = a; i < b; i++) {
    if ((focus.skipUntil.get(run.burnSat[i]) ?? -Infinity) >= run.burnTicks[i]) continue;
    if (startBurnFocus(run.burnEv[i], false)) return;
  }
}

// fromClick: started from the events list (works even when Burn focus is turned off).
function startBurnFocus(evIdx, fromClick) {
  const run = state.run, e = run && run.events[evIdx];
  if (!e || !e.burn || e.satIdx < 0) return false;
  const track = run.sats[e.satIdx];
  const iB = clamp(upperBound(run.ticks, e.tick) - 1, 0, run.frames.length - 1);
  if (track.idx[iB] < 0) return false;
  const gap = iB + 1 < run.ticks.length ? run.ticks[iB + 1] - run.ticks[iB] : (iB > 0 ? run.ticks[iB] - run.ticks[iB - 1] : 1);
  const pre = Math.max(BURN_FOCUS.minPre, 2 * gap), post = Math.max(BURN_FOCUS.minPost, 3 * gap);
  const startTick = Math.max(run.firstTick, e.tick - pre), endTick = Math.min(run.lastTick, e.tick + post);
  if (endTick <= startTick) return false;
  if (!focus.active) {
    focus.saved = {
      mode: cam.mode, followSat: cam.followSat, followAz: cam.followAz, followEl: cam.followEl,
      yaw: cam.yaw, tilt: cam.tilt, distGoal: cam.distGoal, selected: state.selected,
    };
  }
  // slow-motion rates: the ±slowTicks around the burn take slowShare of the time
  const slowSpan = Math.min(2 * BURN_FOCUS.slowTicks, endTick - startTick);
  const rest = Math.max(1, endTick - startTick - slowSpan);
  Object.assign(focus, {
    active: true, ev: evIdx, sat: e.satIdx, burnTick: e.tick, startTick, endTick,
    slowRate: slowSpan / (BURN_FOCUS.wallSeconds * BURN_FOCUS.slowShare),
    fastRate: rest / (BURN_FOCUS.wallSeconds * (1 - BURN_FOCUS.slowShare)),
    threat: burnThreat(e), alert: alertFor(evIdx), ghost: ghostPath(e.satIdx, e.tick, endTick),
    sep: 0, maxSep: 0, cardAt: 0, samples: [],
  });
  focus.skipUntil.set(e.satIdx, endTick + BURN_FOCUS.repeatTicks);
  // camera: follow the satellite, close enough to see the threat inside the watch distance
  cam.mode = 'follow'; cam.followSat = e.satIdx; cam.followAz = 0.5; cam.followEl = 0.75; cam.lastAlong = null;
  const near = focus.alert && Number.isFinite(focus.alert.dist) ? focus.alert.dist : config.dangerDist;
  cam.distGoal = clamp(near * 4, config.criticalDist * 6, config.watchDist * 3.2);   // threat comfortably in view
  cam.easeUntil = performance.now() + 700;
  updateViewButtons();
  state.selected = { kind: 'sat', sat: e.satIdx };
  updateRosterSelection();
  setPlayTick(startTick);
  syncTime();
  showBurnCard(fromClick);
  setPlaying(true);
  return true;
}

function advanceBurnFocus(wallDt) {
  const near = Math.abs(state.playTick - focus.burnTick) <= BURN_FOCUS.slowTicks;
  state.playTick += wallDt * (near ? focus.slowRate : focus.fastRate);
  if (state.playTick >= focus.endTick) { state.playTick = focus.endTick; endBurnFocus(true); }
}

// keepView: the user picked a view themselves, so the old camera is not restored.
function endBurnFocus(finished, keepView) {
  if (!focus.active) return;
  focus.active = false;
  focus.lastEnd = performance.now() / 1000;
  const s = focus.saved;
  if (s && !keepView) {
    cam.mode = s.mode; cam.followAz = s.followAz; cam.followEl = s.followEl;
    cam.yaw = s.yaw; cam.tilt = s.tilt; cam.distGoal = s.distGoal;
    cam.followSat = s.mode === 'follow' ? s.followSat : -1;
    if (s.mode !== 'follow') { cam.targetGoal.x = 0; cam.targetGoal.y = 0; cam.targetGoal.z = 0; }
    cam.lastAlong = null;
    cam.easeUntil = performance.now() + 700;
    updateViewButtons();
  }
  if (s) { state.selected = s.selected; updateRosterSelection(); }
  dom.burnCard.hidden = true;
  if (!finished) setPlaying(false);
  ui.dirty = true;
}

// The burn card can be dragged by its header and made see-through. Its position
// (as a share of the window, so it survives resizing) and opacity are remembered.
const BURN_CARD_KEY = 'orbital.burnCard';
function loadBurnCardPrefs() {
  try { return JSON.parse(localStorage.getItem(BURN_CARD_KEY)) || {}; } catch (err) { return {}; }
}
function saveBurnCardPrefs(p) {
  try { localStorage.setItem(BURN_CARD_KEY, JSON.stringify(p)); } catch (err) { /* storage off: not remembered */ }
}
function placeBurnCard(fx, fy) {
  const card = dom.burnCard, w = card.offsetWidth, h = card.offsetHeight;
  const x = clamp(fx * window.innerWidth, 8, Math.max(8, window.innerWidth - w - 8));
  const y = clamp(fy * window.innerHeight, 8, Math.max(8, window.innerHeight - h - 8));
  card.style.left = `${x}px`; card.style.top = `${y}px`;
  card.classList.add('moved');
}
function bindBurnCardMove() {
  const card = dom.burnCard, head = document.getElementById('burn-head'), fade = document.getElementById('burn-opacity');
  const prefs = loadBurnCardPrefs();
  const setAlpha = (pct) => { card.style.setProperty('--card-alpha', String(pct / 100)); };
  if (Number.isFinite(prefs.opacity)) fade.value = String(prefs.opacity);
  setAlpha(Number(fade.value));
  fade.addEventListener('input', () => {
    setAlpha(Number(fade.value));
    saveBurnCardPrefs({ ...loadBurnCardPrefs(), opacity: Number(fade.value) });
  });
  // keep it where the user put it, also after the window changes size
  const restore = () => {
    const p = loadBurnCardPrefs();
    if (Number.isFinite(p.fx) && Number.isFinite(p.fy)) placeBurnCard(p.fx, p.fy);
  };
  new MutationObserver(() => { if (!card.hidden) restore(); }).observe(card, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => { if (card.classList.contains('moved')) restore(); });

  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('input, button, label')) return;
    const r = card.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    card.classList.add('dragging');
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    placeBurnCard((e.clientX - drag.dx) / window.innerWidth, (e.clientY - drag.dy) / window.innerHeight);
  });
  const stop = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    card.classList.remove('dragging');
    const r = card.getBoundingClientRect();
    saveBurnCardPrefs({ ...loadBurnCardPrefs(), fx: r.left / window.innerWidth, fy: r.top / window.innerHeight });
  };
  head.addEventListener('pointerup', stop);
  head.addEventListener('pointercancel', stop);
  head.addEventListener('dblclick', (e) => {               // back to the default place
    if (e.target.closest('input, label')) return;
    card.classList.remove('moved');
    card.style.left = ''; card.style.top = '';
    const p = loadBurnCardPrefs(); delete p.fx; delete p.fy; saveBurnCardPrefs(p);
  });
}

function bindBurnFocus() {
  bindBurnCardMove();
  dom.burnToggle.addEventListener('click', () => setBurnFocusEnabled(!focus.enabled));
  dom.burnSkip.addEventListener('click', () => endBurnFocus(true));
  dom.burnOff.addEventListener('click', () => setBurnFocusEnabled(false));
}

function setBurnFocusEnabled(on) {
  focus.enabled = on;
  if (on) focus.skipUntil.clear();
  dom.burnToggle.setAttribute('aria-pressed', String(on));
  if (!on) endBurnFocus(true);
}

function resetBurnFocus() {
  focus.active = false; focus.skipUntil.clear(); focus.lastEnd = -1e9;
  if (dom.burnCard) dom.burnCard.hidden = true;
}

function showBurnCard(fromClick) {
  const run = state.run, e = run.events[focus.ev], name = run.sats[focus.sat].name, th = focus.threat;
  const what = th ? (th.kind === 'debris' ? `debris #${th.id}` : `satellite ${th.name}`) : 'a threat';
  dom.burnWhat.textContent = `${name} avoids ${what}`;
  const al = focus.alert;
  dom.burnDetail.textContent = al && Number.isFinite(al.dist)
    ? `Alert at ${fmtDist(al.dist)} (${al.risk}) · burn uses 2.5 kg of fuel · ${fmtClock(e.t)}`
    : `Burn uses 2.5 kg of fuel · ${fmtClock(e.t)}`;
  dom.burnOff.hidden = !focus.enabled || fromClick;
  dom.burnCard.hidden = false;
  updateBurnCard(performance.now());
}

// Live part of the card: phase and how far the satellite now is from its old path.
function updateBurnCard(now) {
  if (!focus.active || now - focus.cardAt < 120) return;
  focus.cardAt = now;
  const t = state.playTick;
  dom.burnPhase.textContent = t < focus.burnTick - 0.5 ? 'Approaching…' : t <= focus.burnTick + 0.5 ? 'Burn!' : 'After the burn';
  dom.burnSep.textContent = focus.ghost
    ? (t > focus.burnTick ? `The burn has moved it ${fmtDist(focus.sep)} off its old path so far.` : 'Watch the distance to the threat fall.')
    : 'Old path not available (too few frames before the burn).';
  drawBurnCharts();
}

// One sample per ~0.2 tick of the focus window: distance to the threat and from the old path.
function recordBurnSample(threatDist) {
  const t = state.playTick, list = focus.samples, last = list[list.length - 1];
  if (last && t < last.t + 0.2) return;
  if (last && t < last.t) list.length = 0;              // jumped back: start again
  list.push({ t, d: threatDist, sep: t > focus.burnTick ? focus.sep : 0 });
}

// Two small charts in the card: distance to the threat, and distance from the old path.
function drawBurnCharts() {
  const c = dom.burnChart, g = c.getContext('2d');
  const W = c.clientWidth, H = c.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const list = focus.samples, t0 = focus.startTick, t1 = focus.endTick;
  const X = (t) => 4 + ((t - t0) / Math.max(1e-9, t1 - t0)) * (W - 8);
  const rowH = (H - 8) / 2;
  const plot = (y0, key, top, colourFn, title, valueText, guides) => {
    g.fillStyle = colours['--text-faint']; g.font = '600 10.5px Inter, system-ui, sans-serif'; g.textBaseline = 'top';
    g.fillText(title, 4, y0);
    g.textAlign = 'right'; g.fillStyle = colours['--text']; g.fillText(valueText, W - 4, y0); g.textAlign = 'left';
    const yb = y0 + rowH - 2, ya = y0 + 14, Y = (v) => yb - (clamp(v, 0, top) / top) * (yb - ya);
    for (const [v, col] of guides) {                           // risk thresholds
      if (v > top) continue;
      g.strokeStyle = withAlpha(col, 0.5); g.setLineDash([2, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(4, Y(v)); g.lineTo(W - 4, Y(v)); g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = withAlpha(colours['--text'], 0.25); g.beginPath(); g.moveTo(4, yb); g.lineTo(W - 4, yb); g.stroke();
    g.lineWidth = 2; g.lineJoin = 'round';
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (!Number.isFinite(a[key]) || !Number.isFinite(b[key])) continue;
      g.strokeStyle = colourFn(b[key]);
      g.beginPath(); g.moveTo(X(a.t), Y(a[key])); g.lineTo(X(b.t), Y(b[key])); g.stroke();
    }
    const xb = X(focus.burnTick);                              // burn moment
    g.strokeStyle = colours['--tag-decision']; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(xb, ya - 2); g.lineTo(xb, yb); g.stroke();
  };
  const last = list[list.length - 1] || { d: NaN, sep: 0 };
  const dTop = Math.max(config.watchDist * 1.2, ...list.map((s) => (Number.isFinite(s.d) ? s.d : 0)));
  const riskOf = (d) => riskColour(d >= config.warnDist ? 0 : d >= config.dangerDist ? 1 : d >= config.criticalDist ? 2 : 3);
  plot(0, 'd', dTop, riskOf, 'Distance to the threat', Number.isFinite(last.d) ? fmtDist(last.d) : '–',
    [[config.warnDist, riskColour(1)], [config.dangerDist, riskColour(2)], [config.criticalDist, riskColour(3)]]);
  const sTop = Math.max(1e-6, ...list.map((s) => s.sep)) * 1.15;
  plot(rowH + 8, 'sep', sTop, () => colours['--accent'], 'Distance from the old path', fmtDist(last.sep), []);
}

// Where the threat object is now (interpolated), or null.
function threatPosition(out) {
  const run = state.run, th = focus.threat, i = state.frameIdx, fr = run.frames[i];
  if (!th) return false;
  if (th.kind === 'sat') {
    const t = run.satIndex.get(th.name);
    const k = t === undefined ? -1 : run.sats[t].idx[i];
    if (k < 0) return false;
    out.x = interp.sat[k * 3]; out.y = interp.sat[k * 3 + 1]; out.z = interp.sat[k * 3 + 2];
    return true;
  }
  for (let k = 0; k < fr.debris.length; k++) {
    if (String(fr.debris[k].idKey) === th.id) {
      out.x = interp.deb[k * 3]; out.y = interp.deb[k * 3 + 1]; out.z = interp.deb[k * 3 + 2];
      return true;
    }
  }
  return false;
}

const ghostA = { x: 0, y: 0, z: 0 }, ghostB = { x: 0, y: 0, z: 0 };
const bfSat = { x: 0, y: 0, z: 0 }, bfThreat = { x: 0, y: 0, z: 0 };
const bfP = { x: 0, y: 0, depth: 0, s: 0 }, bfQ = { x: 0, y: 0, depth: 0, s: 0 };
function drawBurnFocus(now) {
  if (!focus.active) return;
  const run = state.run, i = state.frameIdx, track = run.sats[focus.sat], k = track.idx[i];
  if (k < 0) return;
  bfSat.x = interp.sat[k * 3]; bfSat.y = interp.sat[k * 3 + 1]; bfSat.z = interp.sat[k * 3 + 2];
  const col = classColour(track.cls);
  const line = (pts, n, dashed, colour, width) => {
    ctx.setLineDash(dashed ? [7, 6] : []);
    ctx.strokeStyle = colour; ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let j = 0; j < n; j++) {
      const x = pts[j * 3], y = pts[j * 3 + 1], z = pts[j * 3 + 2];
      if (!project(x, y, z, bfP) || hiddenByEarth(x, y, z)) { pen = false; continue; }
      if (pen) ctx.lineTo(bfP.x, bfP.y); else { ctx.moveTo(bfP.x, bfP.y); pen = true; }
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const g = focus.ghost;
  if (g) {
    // dashed: where it was heading without the burn (whole window)
    line(g.pts, g.pts.length / 3, true, withAlpha(colours['--text'], 0.8), 1.6);
    // solid: where it actually went, from the burn frame up to now
    const n = Math.max(0, i - g.frame0);
    const act = new Float64Array((n + 2) * 3);
    let m = 0;
    for (let f = g.frame0; f <= i; f++) {
      const kk = track.idx[f];
      if (kk < 0) continue;
      const p = run.frames[f].sats[kk];
      act[m * 3] = p.x; act[m * 3 + 1] = p.y; act[m * 3 + 2] = p.z; m++;
    }
    act[m * 3] = bfSat.x; act[m * 3 + 1] = bfSat.y; act[m * 3 + 2] = bfSat.z; m++;
    line(act, m, false, col, 2.6);
    // burn point
    if (project(g.burnAt.x, g.burnAt.y, g.burnAt.z, bfP)) {
      ctx.setLineDash([]);
      ctx.fillStyle = colours['--tag-decision'];
      ctx.beginPath(); ctx.moveTo(bfP.x, bfP.y - 6); ctx.lineTo(bfP.x + 6, bfP.y); ctx.lineTo(bfP.x, bfP.y + 6); ctx.lineTo(bfP.x - 6, bfP.y); ctx.closePath(); ctx.fill();
      label('burn', bfP.x + 9, bfP.y + 10, colours['--tag-decision'], '650 11px');
    }
    // Gap between the two paths at this moment. Between written frames the satellite is
    // drawn moving in a straight line, so the old path is sampled at the same two frame
    // ticks and blended the same way; otherwise that straight-line shortcut (up to ~0.1 km
    // over 10 s in low orbit) would show up as a false wobble in the separation.
    const nPts = g.pts.length / 3;
    const ghostAt = (tick, out) => {
      const tt = clamp(tick - g.startTick, 0, nPts - 1), j0 = Math.floor(tt), f = tt - j0, j1 = Math.min(j0 + 1, nPts - 1);
      out.x = g.pts[j0 * 3] + (g.pts[j1 * 3] - g.pts[j0 * 3]) * f;
      out.y = g.pts[j0 * 3 + 1] + (g.pts[j1 * 3 + 1] - g.pts[j0 * 3 + 1]) * f;
      out.z = g.pts[j0 * 3 + 2] + (g.pts[j1 * 3 + 2] - g.pts[j0 * 3 + 2]) * f;
    };
    const ta = run.ticks[i], tb = i + 1 < run.ticks.length ? run.ticks[i + 1] : ta;
    const w = tb > ta ? clamp((state.playTick - ta) / (tb - ta), 0, 1) : 0;
    ghostAt(ta, ghostA); ghostAt(tb, ghostB);
    const gx = ghostA.x + (ghostB.x - ghostA.x) * w, gy = ghostA.y + (ghostB.y - ghostA.y) * w, gz = ghostA.z + (ghostB.z - ghostA.z) * w;
    focus.sep = state.playTick > focus.burnTick ? Math.hypot(bfSat.x - gx, bfSat.y - gy, bfSat.z - gz) : 0;
    focus.maxSep = Math.max(focus.maxSep, focus.sep);
    if (state.playTick > focus.burnTick && project(gx, gy, gz, bfP)) {
      ctx.setLineDash([]); ctx.strokeStyle = withAlpha(colours['--text'], 0.9); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(bfP.x, bfP.y, 4, 0, TAU); ctx.stroke();
      if (project(bfSat.x, bfSat.y, bfSat.z, bfQ) && Math.hypot(bfP.x - bfQ.x, bfP.y - bfQ.y) > 24) {
        label('old path', bfP.x - 58, bfP.y + 14, colours['--text-dim'], '600 11px');   // only once visibly apart
      }
    }
  }
  // the threat: ring, link and live distance
  if (threatPosition(bfThreat) && project(bfThreat.x, bfThreat.y, bfThreat.z, bfQ) && project(bfSat.x, bfSat.y, bfSat.z, bfP)) {
    const d = Math.hypot(bfSat.x - bfThreat.x, bfSat.y - bfThreat.y, bfSat.z - bfThreat.z);
    const risk = d >= config.warnDist ? 0 : d >= config.dangerDist ? 1 : d >= config.criticalDist ? 2 : 3;
    const rc = riskColour(risk);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = rc; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(bfP.x, bfP.y); ctx.lineTo(bfQ.x, bfQ.y); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bfQ.x, bfQ.y, 9 + 2 * Math.sin(now / 160), 0, TAU); ctx.stroke();
    const th = focus.threat;
    label(th.kind === 'debris' ? `debris #${th.id}` : th.name, bfQ.x + 13, bfQ.y + 14, rc, '650 11.5px');
    label(fmtDist(d), (bfP.x + bfQ.x) / 2 + 8, (bfP.y + bfQ.y) / 2 - 8, rc, '650 12px');
    recordBurnSample(d);
  } else recordBurnSample(NaN);
  ctx.restore();
  updateBurnCard(now);
}

// Evasive-burn pulses: started when playback crosses a burn tick.
const pulses = [];
function spawnPulses(fromTick, toTick, now) {
  const run = state.run;
  if (!run || toTick <= fromTick) return;
  const a = upperBound(run.burnTicks, fromTick), b = upperBound(run.burnTicks, toTick);
  for (let i = a; i < b && pulses.length < 24; i++) pulses.push({ sat: run.burnSat[i], start: now });
}
