'use strict';
/*
   Copyright (c) 2026 Chhavit (@Chhavit09), Harsh Jain (@harshj1214-hj), Satyam Kumar (@kr-Satyam09), and Sudhanshu Ojha (@sudhanshuOjha07)
   All Rights Reserved. Proprietary and confidential: see LICENSE.txt for the terms.
*/
/* ORBITAL website – js/panels.js. Panels: stats, satellite roster, event feed, detail sheet, charts and the raw data table. */

/* --------------------------------------------------------------------------
   10. PANELS  –  stats, roster, event feed, detail sheet, charts, raw data
   -------------------------------------------------------------------------- */

function currentFrame() { return state.run.frames[state.frameIdx]; }

// Called from the loop; does real work only when something changed.
function refreshPanels(now) {
  updateTimelineUi();
  const changed = state.frameIdx !== ui.lastFrame || state.eventIdx !== ui.lastEvent || ui.dirty ||
    ui.feedPending || (ui.rawPending && state.dockTab === 'raw');                // (held back while playing)
  if (!changed || now - ui.lastRefresh < UI.panelRefreshMs) return;
  const eventsChanged = state.eventIdx !== ui.lastEvent || ui.feedDirty;
  if (eventsChanged) ui.feedPending = true;
  if (state.frameIdx !== ui.lastFrame || ui.dirty) ui.rawPending = true;
  ui.lastRefresh = now;
  ui.lastFrame = state.frameIdx;
  ui.lastEvent = state.eventIdx;
  ui.dirty = false;
  ui.feedDirty = false;
  updateStats();
  updateRoster();
  updateSheet(eventsChanged);
  updateAccuracyCursor();
  // Rebuilding these lists makes the browser lay them out again, which is costly with
  // hundreds of rows; while playing they change faster than anyone can read anyway.
  if (!state.playing || now - (ui.lastBusy || 0) >= UI.busyPanelMs) {
    ui.lastBusy = now;
    if (ui.feedPending) { ui.feedPending = false; renderFeed(); }
    if (ui.rawPending && state.dockTab === 'raw') { ui.rawPending = false; renderRaw(); }
  }
}

function updateStats() {
  const run = state.run, fr = currentFrame(), e = state.eventIdx;
  let online = 0;
  for (const s of fr.sats) if (!s.disabled) online++;
  dom.statSats.textContent = `${online} / ${fr.sats.length}`;
  dom.statDebris.textContent = `${fr.realDebris} / ${fr.synthDebris}`;
  dom.statZones.textContent = String(run.zonesPrefix[e]);
  dom.statAlerts.textContent = String(run.alertsPrefix[e]);
  dom.statBurns.textContent = String(run.burnsPrefix[e]);
  dom.statRepairs.textContent = String(run.dispatchPrefix[e]);
  dom.eventsCount.textContent = `${e} / ${run.events.length}`;
}

function updateTimelineUi() {
  const run = state.run;
  const span = run.lastTick - run.firstTick;
  const frac = span > 0 ? (state.playTick - run.firstTick) / span : 1;
  if (!ui.scrubbing) dom.scrub.value = String(state.playTick);
  const w = ui.scrubW;
  dom.scrubProgress.style.width = `${7 + frac * Math.max(0, w - 14)}px`;
  const text = `${fmtClock(state.playTick * config.dt)} / ${fmtClock(run.lastTick * config.dt)}`;
  if (text !== ui.clockText) { dom.clock.textContent = text; ui.clockText = text; }
  // how many simulated seconds pass per real second at the chosen speed
  const factor = UI.speeds[state.speedIndex] * run.ticksPerSecond * config.dt;
  const rate = focus.active ? 'Burn focus · slow motion'
    : `${factor >= 10 ? Math.round(factor).toLocaleString() : factor.toFixed(1)}× real time`;
  if (rate !== ui.rateText) { dom.rate.textContent = rate; ui.rateText = rate; }
}

// --- roster ---
let rosterRefs = [];
let rosterObserver = null;
function buildRoster() {
  const run = state.run, cols = run.cols;
  dom.rosterCount.textContent = run.sats.length.toLocaleString();
  const compact = run.sats.length > UI.compactRoster;               // many satellites: one line each
  const bar = (key, label) => `
    <span class="bar-label">${label}</span>
    <span class="bar-track"><span class="bar-fill" data-bar="${key}"></span></span>
    <span class="bar-val" data-val="${key}">–</span>`;
  const anyBars = cols.fuel || cols.battery || cols.software;
  dom.roster.innerHTML = compact ? run.sats.map((s, t) => `
    <button type="button" class="sat-card compact" data-sat="${t}" aria-pressed="false" style="--c:${classVar(s.cls)}">
      <span class="sat-dot" aria-hidden="true"></span><span class="sat-name">${escapeHtml(s.name)}</span>
      <span class="near-val" data-f="near">–</span><span class="risk-tag" data-f="risk" hidden></span>
      <span class="status-tag" data-f="status">ONLINE</span>
    </button>`).join('') : run.sats.map((s, t) => `
    <button type="button" class="sat-card" data-sat="${t}" aria-pressed="false" style="--c:${classVar(s.cls)}">
      <span class="sat-row">
        <span class="sat-dot" aria-hidden="true"></span>
        <span class="sat-name">${escapeHtml(s.name)}</span>
        <span class="status-tag" data-f="status">ONLINE</span>
      </span>
      <span class="sat-class">${escapeHtml(s.cls || 'Class not recorded')}</span>
      <span class="sat-near"><span>Nearest debris</span><span class="near-val" data-f="near">–</span><span class="risk-tag" data-f="risk"></span></span>
      ${anyBars ? `<span class="bars">${cols.fuel ? bar('fuel', 'Fuel') : ''}${cols.battery ? bar('battery', 'Battery') : ''}${cols.software ? bar('software', 'Software') : ''}</span>` : ''}
    </button>`).join('') || '<p class="empty-note">telemetry.csv has no satellite rows.</p>';
  rosterRefs = Array.from(dom.roster.querySelectorAll('.sat-card')).map((card) => ({
    card,
    status: card.querySelector('[data-f="status"]'),
    near: card.querySelector('[data-f="near"]'),
    risk: card.querySelector('[data-f="risk"]'),
    bars: Object.fromEntries(['fuel', 'battery', 'software'].map((k) => [k, { fill: card.querySelector(`[data-bar="${k}"]`), val: card.querySelector(`[data-val="${k}"]`) }])),
    visible: true,
  }));
  // update only the cards that are on screen (matters with thousands of satellites)
  if (rosterObserver) rosterObserver.disconnect();
  if ('IntersectionObserver' in window && rosterRefs.length > 30) {
    const byCard = new Map(rosterRefs.map((ref) => [ref.card, ref]));
    rosterRefs.forEach((ref, i) => { ref.visible = i < 30; });
    rosterObserver = new IntersectionObserver((entries) => {
      for (const e of entries) byCard.get(e.target).visible = e.isIntersecting;
      ui.dirty = true;
    }, { root: dom.roster, rootMargin: '300px 0px' });
    rosterRefs.forEach((ref) => rosterObserver.observe(ref.card));
  }
}

function setBar(ref, value, max, text) {
  if (!ref.fill) return;
  const pct = value === null || !Number.isFinite(value) || !max ? 0 : clamp(value / max, 0, 1) * 100;
  ref.fill.style.width = `${pct}%`;
  ref.fill.style.setProperty('--bc', pct < 25 ? 'var(--critical)' : pct < 50 ? 'var(--warning)' : 'var(--accent)');
  ref.val.textContent = value === null ? '–' : text;
}

function updateRoster() {
  const run = state.run, fr = currentFrame(), i = state.frameIdx;
  for (let t = 0; t < rosterRefs.length; t++) {
    const ref = rosterRefs[t], k = run.sats[t].idx[i];
    if (!ref.visible) continue;                                     // off screen: skip
    if (k < 0) {
      ref.status.textContent = 'NOT IN FRAME'; ref.status.className = 'status-tag absent';
      ref.near.textContent = '–'; ref.risk.textContent = '';
      ref.card.classList.remove('under-repair');
      continue;
    }
    const s = fr.sats[k];
    ref.status.textContent = s.disabled ? 'UNDER REPAIR' : 'ONLINE';
    ref.status.className = `status-tag${s.disabled ? ' repair' : ''}`;
    ref.card.classList.toggle('under-repair', !!s.disabled);
    ref.near.textContent = fmtDist(s.nearDeb);
    const rv = Number.isFinite(s.nearDeb) ? `var(${RISK_VARS[s.risk]})` : 'var(--text-dim)';
    ref.near.style.setProperty('--rc', rv);
    ref.risk.style.setProperty('--rc', rv);
    ref.risk.textContent = Number.isFinite(s.nearDeb) ? RISK_NAMES[s.risk] : '';
    setBar(ref.bars.fuel, s.fuel, run.sats[t].maxFuel || 1, `${fmt2(s.fuel)} kg`);
    setBar(ref.bars.battery, s.battery, 100, `${fmt2(s.battery)}%`);
    setBar(ref.bars.software, s.software, 100, `${fmt2(s.software)}%`);
  }
}

function updateRosterSelection() {
  const sel = state.selected;
  for (const ref of rosterRefs) {
    ref.card.setAttribute('aria-pressed', String(!!sel && sel.kind === 'sat' && Number(ref.card.dataset.sat) === sel.sat));
  }
}

// --- event feed ---
function eventColourVar(e) { return `var(${e.risk >= 0 ? RISK_VARS[e.risk] : TAGS[e.tag].colour})`; }

function eventItemHtml(e, i) {
  return `<li><button type="button" class="ev" data-ev="${i}" style="--c:${eventColourVar(e)}" title="Line ${e.lineNo} – jump to this moment">
    <span class="ev-time">${fmtClock(e.t)}</span><span class="ev-tag">${escapeHtml(e.tag)}</span>
    <span class="ev-text">${escapeHtml(e.text)}</span></button></li>`;
}

function renderFeed() {
  const run = state.run;
  let html = '', shown = 0, matching = 0;
  for (let i = state.eventIdx - 1; i >= 0; i--) {
    const e = run.events[i];
    if (!state.feedFilters[e.cat]) continue;
    matching++;
    if (shown < UI.feedLimit) { html += eventItemHtml(e, i); shown++; }
  }
  dom.feed.innerHTML = html || `<li class="feed-empty">${run.events.length ? 'No matching events yet at this time.' : 'No events: blackbox.txt was not loaded or is empty.'}</li>`;
  dom.feedNote.textContent = matching > shown ? `Showing the newest ${shown} of ${matching} matching events.` : '';
}

// Jump to an event's time and focus its satellite.
function jumpToEvent(i) {
  const e = state.run.events[i];
  if (!e) return;
  if (e.burn && startBurnFocus(i, true)) return;      // an evasive burn: replay it up close
  endBurnFocus(false);
  setPlaying(false);
  setPlayTick(e.tick);
  if (e.satIdx >= 0) focusSat(e.satIdx);
}

// --- selection ---
function focusSat(t) {
  state.selected = { kind: 'sat', sat: t };
  if (cam.mode === 'follow') { cam.followSat = t; cam.lastAlong = null; cam.easeUntil = performance.now() + 500; }
  updateRosterSelection();
  openSheet(t);
  ui.scrollRawToSelection = true;
  ui.dirty = true;
}

function selectDebris(idKey) {
  state.selected = { kind: 'debris', idKey };
  updateRosterSelection();
  closeSheet();
  ui.scrollRawToSelection = true;
  ui.dirty = true;
}

function clearSelection() {
  state.selected = null;
  updateRosterSelection();
  closeSheet();
  ui.dirty = true;
}

// --- detail sheet ---
const charts = { earth: null, debris: null, acc: null };
let sheetSat = -1;

function openSheet(t) {
  const track = state.run.sats[t];
  sheetSat = t;
  dom.sheet.style.setProperty('--c', classVar(track.cls));
  dom.sheetTitle.textContent = track.name;
  dom.sheetClass.textContent = track.cls || 'Class not recorded';
  dom.sheetClass.style.setProperty('--c', classVar(track.cls));
  dom.sheet.classList.add('open');
  dom.sheet.removeAttribute('inert');
  dom.sheet.setAttribute('aria-hidden', 'false');
  layoutChanged();
  buildSheetCharts();
  updateSheet(true);
}

function closeSheet() {
  sheetSat = -1;
  dom.sheet.classList.remove('open');
  dom.sheet.setAttribute('inert', '');
  dom.sheet.setAttribute('aria-hidden', 'true');
  layoutChanged();
}

function buildSheetCharts() {
  if (sheetSat < 0) return;
  const run = state.run, track = run.sats[sheetSat];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < track.earth.length; i++) {
    const v = track.earth[i];
    if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const pad = Math.max((hi - lo) * 0.08, 1e-6 * hi, 0.5);
  dom.sparkEarthRange.textContent = `${lo.toFixed(1)}–${hi.toFixed(1)} ${config.units}`;
  charts.earth = buildLineChart(dom.sparkEarth, {
    x0: run.firstTick, x1: run.lastTick, y0: lo - pad, y1: hi + pad,
    series: [{ xs: run.ticks, ys: track.earth, colour: classColour(track.cls) }],
  });
  const yMax = config.warnDist * 2;
  dom.sparkDebrisRange.textContent = `0–${yMax} ${config.units}, clipped`;
  charts.debris = buildLineChart(dom.sparkDebris, {
    x0: run.firstTick, x1: run.lastTick, y0: 0, y1: yMax,
    thresholds: [
      { value: config.warnDist, colour: colours['--warning'], label: `warn ${config.warnDist}` },
      { value: config.dangerDist, colour: colours['--danger'], label: `danger ${config.dangerDist}` },
      { value: config.criticalDist, colour: colours['--critical'], label: `critical ${config.criticalDist}` },
    ],
    series: [{ xs: run.ticks, ys: track.nearDeb, colourOf: (v) => riskColour(riskOf(v, config)) }],
  });
}

function statHtml(label, value, colourVar, sub) {
  return `<div><dt>${label}</dt><dd${colourVar ? ` style="--vc:${colourVar}"` : ''} title="${escapeHtml(value + (sub ? ` ${sub}` : ''))}">${escapeHtml(value)}${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ''}</dd></div>`;
}

function updateSheet(eventsChanged) {
  if (sheetSat < 0) return;
  const run = state.run, track = run.sats[sheetSat], i = state.frameIdx, k = track.idx[i];
  const fr = currentFrame();
  if (k < 0) {
    dom.sheetStatus.textContent = 'NOT IN FRAME'; dom.sheetStatus.className = 'status-tag absent';
    dom.sheetStats.innerHTML = statHtml('At this time', 'not in telemetry');
  } else {
    const s = fr.sats[k];
    dom.sheetStatus.textContent = s.disabled ? 'UNDER REPAIR' : 'ONLINE';
    dom.sheetStatus.className = `status-tag${s.disabled ? ' repair' : ''}`;
    const r = track.earth[i];
    const other = s.nearSatIdx >= 0 ? fr.sats[s.nearSatIdx] : null;
    let html = statHtml('Distance to Earth', fmtDist(r)) + statHtml('Altitude', fmtDist(r - config.earthRadius));
    html += statHtml('Nearest debris', fmtDist(s.nearDeb), Number.isFinite(s.nearDeb) ? `var(${RISK_VARS[s.risk]})` : '');
    html += statHtml('Nearest satellite', other ? fmtDist(s.nearSat) : '–', '', other ? other.name : '');
    if (run.cols.fuel) html += statHtml('Fuel', s.fuel === null ? '–' : `${fmt2(s.fuel)} kg`);
    if (run.cols.battery) html += statHtml('Battery', s.battery === null ? '–' : `${fmt2(s.battery)}%`);
    if (run.cols.software) html += statHtml('Software', s.software === null ? '–' : `${fmt2(s.software)}%`);
    dom.sheetStats.innerHTML = html;
  }
  paintChart(charts.earth, state.playTick);
  paintChart(charts.debris, state.playTick);
  if (eventsChanged) {
    const evs = track.events;
    const upto = lowerBound(evs, state.eventIdx);   // this satellite's events that already happened
    let html = '';
    for (let j = upto - 1, n = 0; j >= 0 && n < UI.sheetEventLimit; j--, n++) html += eventItemHtml(run.events[evs[j]], evs[j]);
    dom.sheetEvents.innerHTML = html || '<li class="feed-empty">No events for this satellite yet.</li>';
  }
}

// --- charts (drawn once into an off-screen canvas; only the cursor is redrawn) ---
function sizeCanvas(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  canvas.width = Math.round(w * view.dpr);
  canvas.height = Math.round(h * view.dpr);
  const g = canvas.getContext('2d');
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  return { g, w, h };
}

function buildLineChart(canvas, spec) {
  const size = sizeCanvas(canvas);
  if (!size) return null;
  const { w, h } = size;
  const cache = document.createElement('canvas');
  cache.width = canvas.width; cache.height = canvas.height;
  const g = cache.getContext('2d');
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const L = spec.padL ?? 6, Rp = spec.padR ?? 6, Tp = spec.padT ?? 8, B = spec.padB ?? 8;
  const X = (x) => L + ((x - spec.x0) / ((spec.x1 - spec.x0) || 1)) * (w - L - Rp);
  const Y = (y) => Tp + (1 - (clamp(y, spec.y0, spec.y1) - spec.y0) / ((spec.y1 - spec.y0) || 1)) * (h - Tp - B);

  g.font = '10px JetBrains Mono, ui-monospace, monospace';
  g.textBaseline = 'middle';
  if (spec.yTicks) {
    g.strokeStyle = 'rgba(190, 210, 255, 0.10)'; g.lineWidth = 1;
    for (const v of spec.yTicks) {
      g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rp, Y(v)); g.stroke();
      g.fillStyle = colours['--text-dim']; g.textAlign = 'right';
      g.fillText(spec.yFormat(v), L - 5, Y(v));
    }
  }
  if (spec.xLabels) {
    g.fillStyle = colours['--text-dim']; g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.fillText(spec.xLabels[0], L, h - 3);
    g.textAlign = 'right'; g.fillText(spec.xLabels[1], w - Rp, h - 3);
    g.textBaseline = 'middle';
  }
  let lastLabelY = -Infinity;
  for (const th of spec.thresholds || []) {
    const y = Y(th.value);
    g.strokeStyle = withAlpha(th.colour, 0.7); g.setLineDash([3, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y); g.lineTo(w - Rp, y); g.stroke();
    g.setLineDash([]);
    if (Math.abs(y - lastLabelY) >= 10) {                 // skip a label that would overlap
      g.fillStyle = withAlpha(th.colour, 0.95); g.textAlign = 'right';
      g.fillText(th.label, w - Rp - 2, y - 5);
      lastLabelY = y;
    }
  }
  g.lineWidth = 1.5; g.lineJoin = 'round';
  for (const s of spec.series) {
    // consecutive segments of the same colour are stroked as one path; NaN = gap
    let havePrev = false, path = false, colour = null, px = 0, py = 0;
    for (let i = 0; i < s.xs.length; i++) {
      const v = s.ys[i];
      if (Number.isNaN(v)) { if (path) g.stroke(); path = false; havePrev = false; continue; }
      const x = X(s.xs[i]), y = Y(v);
      if (havePrev) {
        const c = s.colourOf ? s.colourOf(v) : s.colour;
        if (!path || c !== colour) {
          if (path) g.stroke();
          g.strokeStyle = c; colour = c;
          g.beginPath(); g.moveTo(px, py); path = true;
        }
        g.lineTo(x, y);
      }
      px = x; py = y; havePrev = true;
    }
    if (path) g.stroke();
  }
  return { canvas, cache, g: size.g, w, h, X };
}

function paintChart(chart, cursorX) {
  if (!chart) return;
  const g = chart.g;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, chart.canvas.width, chart.canvas.height);
  g.drawImage(chart.cache, 0, 0);
  g.restore();
  if (cursorX === null || cursorX === undefined) return;
  const x = chart.X(cursorX);
  g.strokeStyle = withAlpha(colours['--text'], 0.75);
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, 3); g.lineTo(x, chart.h - 3); g.stroke();
}

// --- model accuracy panel ---
const SERIES_PALETTE = ['#4fd8f5', '#b694ff', '#ff7ac6', '#8fb4ff', '#7ee0c3', '#e2c799', '#d6b8ff', '#9be7ff'];

function setupAccuracy() {
  const acc = state.run.accuracy;
  dom.accPanel.hidden = !acc;
  if (!acc) { charts.acc = null; return; }
  dom.accLegend.innerHTML = acc.series.map((s, i) =>
    `<span style="--c:${SERIES_PALETTE[i % SERIES_PALETTE.length]}"><i></i>${escapeHtml(s.sat)}</span>`).join('');
  buildAccuracyChart();
}

function buildAccuracyChart() {
  const acc = state.run && state.run.accuracy;
  if (!acc || dom.accPanel.hidden || dom.accPanel.classList.contains('collapsed')) { charts.acc = null; return; }
  const yMax = acc.maxE > 0 ? acc.maxE * 1.1 : 1;
  charts.acc = buildLineChart(dom.accChart, {
    x0: 0, x1: acc.maxT || 1, y0: 0, y1: yMax, padL: 54, padB: 16, padT: 8,
    yTicks: [0, yMax / 2, yMax], yFormat: (v) => `${v.toFixed(v >= 10 ? 0 : 1)} km`,
    xLabels: ['00:00:00', fmtClock(acc.maxT)],
    series: acc.series.map((s, i) => ({ xs: s.xs, ys: s.ys, colour: SERIES_PALETTE[i % SERIES_PALETTE.length] })),
  });
  updateAccuracyCursor();
}

function updateAccuracyCursor() {
  if (!charts.acc) return;
  const elapsed = state.playTick * config.dt;
  paintChart(charts.acc, clamp(elapsed, 0, state.run.accuracy.maxT));
}

// --- timeline markers: alerts (risk colours), repairs, red zones ---
function drawMarkers() {
  const c = dom.markers;
  const size = sizeCanvas(c);
  if (!size) return;
  const { g, w } = size;
  g.clearRect(0, 0, w, size.h);
  g.fillStyle = 'rgba(255, 255, 255, 0.10)';
  g.fillRect(7, 16, Math.max(0, w - 14), 4);
  const run = state.run;
  if (!run) return;
  const span = run.lastTick - run.firstTick || 1;
  const xOf = (t) => Math.round(7 + ((t - run.firstTick) / span) * (w - 14));
  const maxRisk = new Int8Array(Math.ceil(w) + 1).fill(-1);   // strongest alert per pixel column
  for (const e of run.events) {
    const x = clamp(xOf(e.tick), 0, maxRisk.length - 1);
    if (e.alert && e.risk > maxRisk[x]) maxRisk[x] = e.risk;
  }
  for (let x = 0; x < maxRisk.length; x++) {
    const r = maxRisk[x];
    if (r < 1) continue;
    g.fillStyle = riskColour(r);
    const hgt = 3 + r * 2;
    g.fillRect(x - 0.5, 15 - hgt, 1.5, hgt);
  }
  for (const e of run.events) {
    if (!e.dispatch && !e.repair) continue;
    g.fillStyle = e.repair ? colours['--safe'] : colours['--sat-neutral'];
    g.fillRect(xOf(e.tick) - 1, 23, 2, 6);
  }
  g.fillStyle = withAlpha(colours['--critical'], 0.55);
  for (const z of run.zones) g.fillRect(xOf(z.tick), 31, 1, 4);   // red-zone declarations
}

// --- raw data tab ---
function rawColumns() {
  const cols = state.run.cols, u = config.units;
  const list = [
    { h: 'Type', l: true }, { h: 'ID / name', l: true },
  ];
  if (cols.cls) list.push({ h: 'Class', l: true });
  if (cols.src) list.push({ h: 'Source', l: true });
  list.push({ h: `X (${u})` }, { h: `Y (${u})` }, { h: `Z (${u})` }, { h: `|r| (${u})` },
    { h: `Nearest (${u})`, title: 'Satellites: nearest debris. Debris: nearest satellite.' }, { h: 'Risk', l: true });
  if (cols.battery) list.push({ h: 'Battery %' });
  if (cols.fuel) list.push({ h: 'Fuel kg' });
  if (cols.software) list.push({ h: 'Software %' });
  if (cols.disabled) list.push({ h: 'Disabled' });
  return list;
}

function buildRawHead() {
  dom.rawHead.innerHTML = `<tr>${rawColumns().map((c) =>
    `<th scope="col" class="${c.l ? 'l' : ''}"${c.title ? ` title="${escapeHtml(c.title)}"` : ''}>${escapeHtml(c.h)}</th>`).join('')}</tr>`;
}

function rowMatches(o) {
  const f = state.rawFilter;
  if (f === 'sat' && o.kind !== 'sat') return false;
  if (f === 'debris' && o.kind !== 'debris') return false;
  if (f === 'real' && o.src !== 'real') return false;
  if (f === 'synthetic' && o.src !== 'synthetic') return false;
  const q = state.rawSearch;
  if (q) {
    const label = o.kind === 'sat' ? o.name : o.idKey;
    if (!label.toLowerCase().includes(q)) return false;
  }
  return true;
}

// The table keeps its row elements and only rewrites cells whose text changed; it is
// rebuilt from scratch only when the number of rows or columns changes.
const rawDom = { rows: [], cells: [], ncols: -1, data: [], shown: [], riskCol: -1, rowH: 0 };
function renderRaw() {
  if (state.rawView === 'log') { renderRawLog(); rawDom.rows = []; return; }
  const run = state.run, fr = currentFrame(), cols = run.cols, sel = state.selected;
  const data = [];
  let total = 0;
  const addRow = (o, idx) => {
    if (!rowMatches(o)) return;
    total++;
    if (data.length >= UI.tableLimit) return;
    const isSat = o.kind === 'sat';
    const selected = sel && (isSat ? sel.kind === 'sat' && sel.sat === o.ti : sel.kind === 'debris' && sel.idKey === o.idKey);
    const near = isSat ? o.nearDeb : o.nearSat;
    const risk = isSat ? (Number.isFinite(o.nearDeb) ? o.risk : -1) : o.risk;
    const r = Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z);
    const t = [isSat ? 'Sat' : 'Debris', isSat ? o.name : String(o.idKey)];
    if (cols.cls) t.push(isSat ? (o.cls || '') : '');
    if (cols.src) t.push(o.src);
    t.push(fmt2(o.x), fmt2(o.y), fmt2(o.z), fmt2(r), fmt2(near), risk >= 0 ? RISK_NAMES[risk] : '–');
    if (cols.battery) t.push(isSat ? fmt2(o.battery ?? NaN) : '');
    if (cols.fuel) t.push(isSat ? fmt2(o.fuel ?? NaN) : '');
    if (cols.software) t.push(isSat ? fmt2(o.software ?? NaN) : '');
    if (cols.disabled) t.push(isSat ? (o.disabled ? '1' : '0') : '');
    data.push({ kind: isSat ? 's' : 'd', k: idx, selected, risk, t });
  };
  fr.sats.forEach(addRow);
  fr.debris.forEach(addRow);
  const heads = rawColumns(), ncols = heads.length, riskCol = heads.findIndex((c) => c.h === 'Risk');
  if (!data.length) {
    dom.rawBody.innerHTML = `<tr><td class="l" colspan="${ncols}">No rows match.</td></tr>`;
    rawDom.rows = []; rawDom.data = []; rawDom.shown = [];
  } else {
    if (rawDom.rows.length !== data.length || rawDom.ncols !== ncols) {     // shape changed: build once
      // (a no-break space keeps not-yet-filled rows as tall as filled ones)
      dom.rawBody.innerHTML = data.map(() => `<tr tabindex="0">${heads.map((c) => `<td${c.l ? ' class="l"' : ''}>&nbsp;</td>`).join('')}</tr>`).join('');
      rawDom.rowH = 0;
      rawDom.rows = Array.from(dom.rawBody.rows);
      rawDom.cells = rawDom.rows.map((tr) => Array.from(tr.cells));
      rawDom.ncols = ncols;
    }
    rawDom.data = data; rawDom.riskCol = riskCol;
    rawDom.shown = new Array(data.length).fill(false);              // rows filled with the current frame
    fillRawRows();
  }
  const shown = data.length;
  dom.rawCount.textContent = `${shown < total ? `Showing ${shown} of ${total}` : `${total}`} rows at tick ${fr.tick}`;
  if (ui.scrollRawToSelection) {
    ui.scrollRawToSelection = false;
    const i = data.findIndex((d) => d.selected);
    if (i >= 0) { fillRawRow(i); rawDom.rows[i].scrollIntoView({ block: 'nearest' }); fillRawRows(); }
  }
}

// Only rows on screen (and a few around them) are written; the rest are filled when
// scrolled to. Changing hundreds of off-screen cells made the browser re-measure the
// whole table four times a second.
function fillRawRows() {
  const n = rawDom.data.length;
  if (!n) return;
  const sc = dom.rawBody.closest('.raw-scroll');
  if (!rawDom.rowH) rawDom.rowH = rawDom.rows[0].offsetHeight || 24;
  const head = dom.rawBody.offsetTop;
  const first = Math.max(0, Math.floor((sc.scrollTop - head) / rawDom.rowH) - 6);
  const last = Math.min(n - 1, Math.ceil((sc.scrollTop - head + sc.clientHeight) / rawDom.rowH) + 6);
  for (let i = first; i <= last; i++) if (!rawDom.shown[i]) fillRawRow(i);
}

function fillRawRow(i) {
  const d = rawDom.data[i], tr = rawDom.rows[i], tds = rawDom.cells[i], ncols = rawDom.ncols, riskCol = rawDom.riskCol;
  rawDom.shown[i] = true;
  if (tr.dataset.kind !== d.kind) tr.dataset.kind = d.kind;
  if (tr.dataset.k !== String(d.k)) tr.dataset.k = String(d.k);
  if (tr.classList.contains('selected') !== !!d.selected) {
    tr.classList.toggle('selected', !!d.selected);
    if (d.selected) tr.setAttribute('aria-selected', 'true'); else tr.removeAttribute('aria-selected');
  }
  for (let j = 0; j < ncols; j++) if (tds[j].textContent !== d.t[j]) tds[j].textContent = d.t[j];
  if (riskCol >= 0) {
    const td = tds[riskCol], rc = d.risk >= 0 ? `var(${RISK_VARS[d.risk]})` : '';
    if (td.dataset.rc !== rc) { td.dataset.rc = rc; td.classList.toggle('rc', !!rc); td.style.setProperty('--rc', rc || 'inherit'); }
  }
}

// Raw log lines that fall inside the current written frame's time window.
function renderRawLog() {
  const run = state.run, i = state.frameIdx;
  const from = run.ticks[i], to = i + 1 < run.ticks.length ? run.ticks[i + 1] : Infinity;
  const a = lowerBound(run.eventTicks, from), b = to === Infinity ? run.events.length : lowerBound(run.eventTicks, to);
  let html = '';
  for (let j = a; j < Math.min(b, a + UI.logLimit); j++) {
    const e = run.events[j];
    html += `<li><span class="ln">${e.lineNo}</span><span class="tx" style="--c:${eventColourVar(e)}">${escapeHtml(e.raw)}</span></li>`;
  }
  const span = to === Infinity ? `t ≥ ${fmt2(from * config.dt)} s` : `${fmt2(from * config.dt)} s ≤ t < ${fmt2(to * config.dt)} s`;
  dom.rawLog.innerHTML = html || `<li><span class="ln"></span><span class="tx">No log lines for ${window}.</span></li>`;
  dom.rawCount.textContent = `${b - a} log lines for ${span}`;
}

// CSV of the current written frame, in the same column order as telemetry.csv.
function downloadFrameCsv() {
  const run = state.run;
  if (!run) return;
  const fr = currentFrame(), cols = run.cols;
  const header = ['Tick', 'Type', 'ID_or_Name'];
  if (cols.cls) header.push('Class');
  if (cols.src) header.push('Source');
  header.push('X', 'Y', 'Z');
  if (cols.battery) header.push('Battery');
  if (cols.fuel) header.push('Fuel');
  if (cols.software) header.push('Software');
  if (cols.disabled) header.push('Disabled');
  const v = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '' : String(n));
  const lines = [header.join(',')];
  for (const o of fr.sats.concat(fr.debris)) {
    const sat = o.kind === 'sat';
    const row = [fr.tick, sat ? 'Sat' : 'Debris', sat ? o.name : o.idKey];
    if (cols.cls) row.push(sat ? (o.cls || '') : '');
    if (cols.src) row.push(o.src);
    row.push(o.x, o.y, o.z);
    if (cols.battery) row.push(sat ? v(o.battery) : '');
    if (cols.fuel) row.push(sat ? v(o.fuel) : '');
    if (cols.software) row.push(sat ? v(o.software) : '');
    if (cols.disabled) row.push(sat ? (o.disabled ? 1 : 0) : '');
    lines.push(row.join(','));
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orbital_frame_tick_${fr.tick}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
