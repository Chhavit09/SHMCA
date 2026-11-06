'use strict';
/*
   Copyright (c) 2026 Chhavit (@Chhavit09), Harsh Jain (@harshj1214-hj), Satyam Kumar (@kr-Satyam09), and Sudhanshu Ojha (@sudhanshuOjha07)
   All Rights Reserved. Proprietary and confidential: see LICENSE.txt for the terms.
*/
/* ORBITAL website – js/ui.js. Page: notices and loading screen, page wiring (buttons, keyboard, pointer, layout), the New run form, the "How Orbital works" window, and start-up. Loaded last. */

/* --------------------------------------------------------------------------
   11. NOTICES, LOADING, MODE BADGE, INSTALLING A RUN
   -------------------------------------------------------------------------- */

function notify(message, level = 'info', list) {
  const el = document.createElement('div');
  el.className = `notice ${level}`;
  el.setAttribute('role', level === 'error' ? 'alert' : 'status');
  const title = document.createElement('p');
  title.className = 'notice-title';
  title.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn small';
  close.setAttribute('aria-label', 'Dismiss message');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', () => el.remove());
  el.append(title, close);
  if (list && list.length) {
    const ul = document.createElement('ul');
    for (const item of list) { const li = document.createElement('li'); li.textContent = item; ul.append(li); }
    el.append(ul);
  }
  dom.notices.prepend(el);
  while (dom.notices.children.length > 4) dom.notices.lastElementChild.remove();
  if (level !== 'error') setTimeout(() => el.remove(), level === 'warn' ? 16000 : 9000);
}

function reportLoad(run, notes, origin) {
  const warn = notes.some((n) => n.level === 'warn');
  const counts = `${run.frames.length} frames, ${run.sats.length} satellites, ${run.events.length} events.`;
  const title = origin === 'demo' ? `Demo run generated in the browser: ${counts}`
    : origin === 'custom' ? `Browser simulation finished: ${counts}`
    : `Loaded ${run.fileNames.join(', ')}: ${run.rows.toLocaleString()} rows, ${run.frames.length} frames, ${run.events.length} events.`;
  notify(title, warn ? 'warn' : 'info', notes.map((n) => n.text));
}

function showLoading(stage, frac) {
  dom.loading.hidden = false;
  dom.loadingStage.textContent = stage;
  const pct = Math.round(clamp(frac || 0, 0, 1) * 100);
  dom.loadingFill.style.width = `${pct}%`;
  dom.loadingPct.textContent = `${pct}%`;
}
function hideLoading() { dom.loading.hidden = true; }

function updateModeBadge() {
  const b = dom.modeBadge;
  if (!state.run) { b.dataset.mode = 'none'; b.textContent = 'No run loaded'; dom.demoTag.hidden = true; return; }
  b.dataset.mode = config.mode;
  if (config.mode !== 'real') b.textContent = 'CLASSIC SIMULATION';
  else if (state.origin === 'custom' && config.dataSource !== 'CelesTrak GP') b.textContent = 'REAL-SCALE PHYSICS · user-entered orbits';   // not real data
  else if (state.origin === 'custom') b.textContent = `REAL DATA · CelesTrak GP · epoch ${config.snapshotDate || 'not stated'}`;
  else b.textContent = `REAL DATA · ${config.dataSource || 'source not stated'} · snapshot ${config.snapshotDate || 'date not stated'}`;
  dom.demoTag.hidden = state.origin === 'files';
  dom.demoTag.textContent = 'Browser simulation';
}

// Legend text that depends on the run: thresholds, units, which rows apply.
function updateLegend() {
  const u = config.units, run = state.run;
  $('legend-safe').textContent = `${config.warnDist} ${u} or more`;
  $('legend-warning').textContent = `${config.dangerDist}–${config.warnDist} ${u}`;
  $('legend-danger').textContent = `${config.criticalDist}–${config.dangerDist} ${u}`;
  $('legend-critical').textContent = `under ${config.criticalDist} ${u}`;
  $('legend-sector').textContent = `edge ${config.sectorSize} ${u}`;
  $('legend-watch').textContent = `Line from a satellite to its nearest debris within ${config.watchDist} ${u} (the watch distance); that debris takes the same colour.`;
  $('legend-equator').hidden = config.mode !== 'real';
  $('legend-neutral').hidden = !run || run.sats.every((s) => s.cls === 'Communication' || s.cls === 'Imaging');
  $('legend-deb-real').hidden = !!run && !run.hasRealDebris;          // show only the debris kinds in this run
  $('legend-deb-synth').hidden = !!run && !run.hasSynthDebris;
  $('legend-path').textContent = 'Orbit path over the whole run';
  $('legend-trail').textContent = run && run.sats.length > UI.maxTrails
    ? 'Trail, last 40 written frames (selected satellite only)' : 'Trail, last 40 written frames';
}

// Put a freshly derived run on screen.
function installRun() {
  const run = state.run;
  resetBurnFocus();
  // Live blur behind the panels must be redone every frame the scene changes; with
  // thousands of moving objects that costs more than drawing the scene itself, so big
  // runs use solid panels from the start (small runs keep the glass look).
  const objects = run.sats.length + run.frames.reduce((m, f) => Math.max(m, f.debris.length), 0);
  document.body.classList.toggle('solid-glass', fpsGuard.done || objects > UI.heavyObjects);
  state.playTick = run.firstTick;
  state.selected = null;
  pulses.length = 0;
  syncTime();
  dom.emptyState.hidden = true;
  updateModeBadge();
  updateLegend();
  computeEarthPhase();
  buildRoster();
  buildRawHead();
  closeSheet();
  setupAccuracy();
  dom.scrub.min = String(run.firstTick);
  dom.scrub.max = String(run.lastTick);
  dom.scrub.disabled = run.frames.length < 2;
  setSpeed(UI.defaultSpeedIndex[config.mode] ?? 3);
  layoutChanged();
  cam.followSat = -1;
  resetCamera(true);
  computeInterp();
  drawMarkers();
  ui.dirty = true; ui.feedDirty = true; ui.lastFrame = -1; ui.lastEvent = -1; ui.clockText = ''; ui.rateText = '';
  ui.loadedAt = performance.now();
  setPlaying(run.frames.length > 1);
}


/* --------------------------------------------------------------------------
   12. DOM WIRING  –  buttons, keyboard, pointer, drag-and-drop, layout
   -------------------------------------------------------------------------- */

function cacheDom() {
  dom = {
    scene: $('scene'), topbar: $('topbar'), dock: $('dock'),
    modeBadge: $('mode-badge'), demoTag: $('demo-tag'),
    statSats: $('stat-sats'), statDebris: $('stat-debris'), statZones: $('stat-zones'),
    statAlerts: $('stat-alerts'), statBurns: $('stat-burns'), statRepairs: $('stat-repairs'),

    panelsBtn: $('panels-btn'), fullscreenBtn: $('fullscreen-btn'),
    viewButtons: Array.from(document.querySelectorAll('[data-view]')),
    burnToggle: $('burn-toggle'), burnCard: $('burn-card'), burnWhat: $('burn-what'), burnDetail: $('burn-detail'),
    burnPhase: $('burn-phase'), burnSep: $('burn-sep'), burnChart: $('burn-chart'), burnSkip: $('burn-skip'), burnOff: $('burn-off'),
    rosterPanel: $('roster-panel'), roster: $('roster'), rosterCount: $('roster-count'),
    leftCol: $('left-col'), legendPanel: $('legend-panel'), rate: $('rate'), hoverTip: $('hover-tip'),
    rightCol: $('right-col'), eventsPanel: $('events-panel'), eventsCount: $('events-count'),
    feed: $('feed'), feedNote: $('feed-note'),
    accPanel: $('accuracy-panel'), accChart: $('acc-chart'), accLegend: $('acc-legend'),
    sheet: $('sheet'), sheetTitle: $('sheet-title'), sheetClass: $('sheet-class'), sheetStatus: $('sheet-status'),
    sheetStats: $('sheet-stats'), sheetEvents: $('sheet-events'), sheetClose: $('sheet-close'),
    sparkEarth: $('spark-earth'), sparkDebris: $('spark-debris'),
    sparkEarthRange: $('spark-earth-range'), sparkDebrisRange: $('spark-debris-range'),
    playBtn: $('play-btn'), stepBack: $('step-back'), stepFwd: $('step-fwd'),
    scrub: $('scrub'), scrubProgress: $('scrub-progress'), markers: $('markers'),
    speedGroup: $('speed-group'), clock: $('clock'),
    tabTimeline: $('tab-btn-timeline'), tabRaw: $('tab-btn-raw'), rawPanel: $('tab-raw'),
    rawFilter: $('raw-filter'), rawFilterWrap: $('raw-filter-wrap'), rawSearch: $('raw-search'), rawCount: $('raw-count'),
    rawTableWrap: $('raw-table-wrap'), rawLogWrap: $('raw-log-wrap'), rawHead: $('raw-head'), rawBody: $('raw-body'),
    rawLog: $('raw-log'), downloadBtn: $('download-btn'), rawViewButtons: Array.from(document.querySelectorAll('[data-raw]')),
    emptyState: $('empty-state'), loading: $('loading'), loadingStage: $('loading-stage'),
    loadingFill: $('loading-fill'), loadingPct: $('loading-pct'), loadingCancel: $('loading-cancel'),
    notices: $('notices'), dropOverlay: $('drop-overlay'),
    infoBtn: $('info-btn'), infoDialog: $('info-dialog'), infoRunBody: $('info-run-body'),
    newRunBtn: $('new-run-btn'), runDialog: $('run-dialog'), runForm: $('run-form'), runSats: $('run-sats'),
    runSatCount: $('run-sat-count'), runAdd: $('run-add'), runAddCount: $('run-add-count'), runClear: $('run-clear'),
    runEstimate: $('run-estimate'), runErrors: $('run-errors'), runSubmit: $('run-submit'),
    runSub: $('run-sub'), runStatus: document.querySelector('#run-dialog .run-status'), runChaosNote: $('run-chaos-note'),
    runSatZone: $('run-sat-zone'), runDebZone: $('run-deb-zone'), runSatPick: $('run-sat-pick'), runDebPick: $('run-deb-pick'),
    runSatFiles: $('run-sat-files'), runDebFiles: $('run-deb-files'), runSatList: $('run-sat-list'), runDebList: $('run-deb-list'),
    runSatTotal: $('run-sat-total'), runDebTotal: $('run-deb-total'), runRealNote: $('run-real-note'),
  };
}

function bindUi() {


  dom.panelsBtn.addEventListener('click', togglePanels);
  // Cancel a load or browser simulation: the running pipeline sees it is stale and stops.
  dom.loadingCancel.addEventListener('click', () => {
    state.pipelineGen++;
    hideLoading();
    notify(state.run ? 'Cancelled. The previous run is still on screen.' : 'Cancelled.', 'info');
  });
  dom.fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    dom.fullscreenBtn.setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen');
  });

  dom.viewButtons.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // collapse buttons on the side panels
  document.querySelectorAll('.collapse-btn').forEach((btn) => btn.addEventListener('click', () => {
    const panel = btn.closest('.panel');
    const collapsed = panel.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    const name = panel.querySelector('h2').textContent.toLowerCase();
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name} panel`);
    if (panel === dom.accPanel && !collapsed) requestAnimationFrame(buildAccuracyChart);
    layoutChanged();
  }));

  dom.roster.addEventListener('click', (e) => {
    const card = e.target.closest('.sat-card');
    if (card) focusSat(Number(card.dataset.sat));
  });
  const onEventClick = (e) => { const b = e.target.closest('.ev'); if (b) jumpToEvent(Number(b.dataset.ev)); };
  dom.feed.addEventListener('click', onEventClick);
  dom.sheetEvents.addEventListener('click', onEventClick);
  document.querySelectorAll('.chip[data-cat]').forEach((chip) => chip.addEventListener('click', () => {
    const on = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', String(on));
    state.feedFilters[chip.dataset.cat] = on;
    ui.feedDirty = true; ui.dirty = true;
  }));
  dom.sheetClose.addEventListener('click', clearSelection);

  // transport
  dom.playBtn.addEventListener('click', togglePlay);
  dom.stepBack.addEventListener('click', () => stepFrame(-1));
  dom.stepFwd.addEventListener('click', () => stepFrame(1));
  // buttons on wide screens; one compact drop-down on phones (CSS shows one or the other)
  dom.speedGroup.innerHTML = UI.speeds.map((s, i) =>
    `<button type="button" class="seg" data-speed="${i}" aria-pressed="false" title="Speed ${s}× (key ${i + 1})">${s}×</button>`).join('') +
    `<select class="speed-select" aria-label="Playback speed">${UI.speeds.map((s, i) => `<option value="${i}">${s}×</option>`).join('')}</select>`;
  dom.speedButtons = Array.from(dom.speedGroup.querySelectorAll('button'));
  dom.speedSelect = dom.speedGroup.querySelector('select');
  dom.speedButtons.forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
  dom.speedSelect.addEventListener('change', () => setSpeed(Number(dom.speedSelect.value)));
  setSpeed(state.speedIndex);
  dom.scrub.addEventListener('input', () => { endBurnFocus(false); setPlayTick(Number(dom.scrub.value)); });
  dom.scrub.addEventListener('pointerdown', () => { ui.scrubbing = true; });
  window.addEventListener('pointerup', () => { ui.scrubbing = false; });

  // dock tabs
  const setTab = (tab) => {
    state.dockTab = tab;
    dom.tabTimeline.setAttribute('aria-selected', String(tab === 'timeline'));
    dom.tabRaw.setAttribute('aria-selected', String(tab === 'raw'));
    dom.tabTimeline.tabIndex = tab === 'timeline' ? 0 : -1;
    dom.tabRaw.tabIndex = tab === 'raw' ? 0 : -1;
    dom.rawPanel.hidden = tab !== 'raw';
    if (tab === 'raw' && state.run) { ui.scrollRawToSelection = true; renderRaw(); }
  };
  dom.tabTimeline.addEventListener('click', () => setTab('timeline'));
  dom.tabRaw.addEventListener('click', () => setTab('raw'));
  [dom.tabTimeline, dom.tabRaw].forEach((t) => t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      const next = state.dockTab === 'raw' ? 'timeline' : 'raw';
      setTab(next); (next === 'raw' ? dom.tabRaw : dom.tabTimeline).focus();
    }
  }));

  // raw data controls
  dom.rawViewButtons.forEach((b) => b.addEventListener('click', () => {
    state.rawView = b.dataset.raw;
    dom.rawViewButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    dom.rawTableWrap.hidden = state.rawView !== 'telemetry';
    dom.rawLogWrap.hidden = state.rawView !== 'log';
    dom.rawFilterWrap.hidden = state.rawView !== 'telemetry';
    dom.rawSearch.hidden = state.rawView !== 'telemetry';
    dom.downloadBtn.hidden = state.rawView !== 'telemetry';
    if (state.run) renderRaw();
  }));
  dom.rawFilter.addEventListener('change', () => { state.rawFilter = dom.rawFilter.value; if (state.run) renderRaw(); });
  dom.rawSearch.addEventListener('input', () => { state.rawSearch = dom.rawSearch.value.trim().toLowerCase(); if (state.run) renderRaw(); });
  dom.downloadBtn.addEventListener('click', downloadFrameCsv);
  const selectRow = (tr) => {
    if (!tr || !tr.dataset.kind) return;
    const fr = currentFrame(), k = Number(tr.dataset.k);
    if (tr.dataset.kind === 's') focusSat(fr.sats[k].ti); else selectDebris(fr.debris[k].idKey);
    ui.scrollRawToSelection = false;
    renderRaw();
  };
  dom.rawBody.addEventListener('click', (e) => selectRow(e.target.closest('tr')));
  dom.rawBody.closest('.raw-scroll').addEventListener('scroll', () => { if (rawDom.data.length) fillRawRows(); }, { passive: true });
  dom.rawBody.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectRow(e.target.closest('tr')); });
}

function togglePanels() {
  state.panelsHidden = !state.panelsHidden;
  document.body.classList.toggle('panels-hidden', state.panelsHidden);
  dom.panelsBtn.setAttribute('aria-pressed', String(state.panelsHidden));
  const text = state.panelsHidden ? 'Show panels (H)' : 'Hide panels (H)';
  dom.panelsBtn.setAttribute('aria-label', text);
  dom.panelsBtn.title = text;
  layoutChanged();
  if (!state.panelsHidden && sheetSat >= 0) requestAnimationFrame(buildSheetCharts);
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (dom.runDialog.open || dom.infoDialog.open) return;   // dialogs handle their own keys (Esc closes them)
    const t = e.target;
    const typing = (t.tagName === 'INPUT' && t.type !== 'range') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
    if (e.key === 'Escape') {
      clearSelection();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= UI.speeds.length) setSpeed(Number(e.key) - 1);
    else if (e.key === 'h' || e.key === 'H') togglePanels();
    else if (e.key === 'b' || e.key === 'B') setBurnFocusEnabled(!focus.enabled);
    else if (e.key === 'i' || e.key === 'I') openInfo();
  });
}

// Drag to rotate, wheel / pinch to zoom, click to select, double-click to reset.
function bindCanvas() {
  const c = dom.scene;
  const pointers = new Map();
  let drag = null, pinch = null;
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
    else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, dist0: cam.distGoal };
      drag = null;
    }
  });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      hover.mouse = true; hover.x = e.clientX; hover.y = e.clientY; hover.pinId = '';
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const [lo, hi] = zoomLimits();
      cam.distGoal = clamp(pinch.dist0 * (pinch.d0 / d), lo, hi);
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4) { c.classList.add('dragging'); ui.dragging = true; rotateBy(dx, dy); }
    }
  });
  const end = (e) => {
    if (drag && drag.moved <= 4 && pointers.size === 1 && state.run) {
      const it = pickAt(e.clientX, e.clientY);
      const fr = currentFrame();
      if (it) {
        if (it.kind === 0) focusSat(fr.sats[it.k].ti); else selectDebris(fr.debris[it.k].idKey);
      }
      if (e.pointerType === 'touch') {                 // no hover on touch: tapping shows the card
        hover.pinKind = it ? it.kind : -1;
        hover.pinId = it ? (it.kind === 0 ? fr.sats[it.k].name : fr.debris[it.k].idKey) : '';
        hover.pinUntil = performance.now() + TIP_PIN_MS;
      }
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; ui.dragging = false; c.classList.remove('dragging'); }
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; ui.dragging = false; c.classList.remove('dragging'); });
  c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hover.mouse = false; });
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomBy(Math.exp(clamp(dy, -200, 200) * 0.0015));
  }, { passive: false });
  c.addEventListener('dblclick', () => { cam.followSat = -1; resetCamera(false); });
}

function bindDrop() {
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; dom.dropOverlay.hidden = false; });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dom.dropOverlay.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    dom.dropOverlay.hidden = true;
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    if (dom.runDialog.open) {                      // New run form: CelesTrak files into its loaders
      const zone = e.target.closest && e.target.closest('.loader');
      if (runForm.tab !== 'real') setRunTab('real');
      addRealFiles(zone ? zone.dataset.kind : null, e.dataTransfer.files);
      return;
    }
    handleFiles(e.dataTransfer.files);
  });
}

// Canvas size follows the window; drawn at devicePixelRatio for sharp lines.
function resizeCanvas() {
  const c = dom.scene;
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  c.width = Math.round(view.w * view.dpr);
  c.height = Math.round(view.h * view.dpr);
  c.style.width = `${view.w}px`;
  c.style.height = `${view.h}px`;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  cam.f = Math.min(view.w, view.h) * 1.25;
  layoutChanged();
  drawMarkers();
  if (sheetSat >= 0) buildSheetCharts();
  buildAccuracyChart();
}

// Keep CSS variables and the scene centre in step with the panels.
function layoutChanged() {
  const root = document.documentElement.style;
  root.setProperty('--top-h', `${dom.topbar.offsetHeight}px`);
  root.setProperty('--dock-h', `${dom.dock.offsetHeight}px`);
  const wide = view.w > 768;
  const leftAny = !dom.rosterPanel.classList.contains('collapsed') || !dom.legendPanel.classList.contains('collapsed');
  const rosterOpen = !state.panelsHidden && leftAny;
  dom.leftCol.classList.toggle('expanded', leftAny);
  const rightOpen = !state.panelsHidden && (!dom.eventsPanel.classList.contains('collapsed') ||
    (!dom.accPanel.hidden && !dom.accPanel.classList.contains('collapsed')));
  dom.rightCol.classList.toggle('expanded', !dom.eventsPanel.classList.contains('collapsed'));
  root.setProperty('--left-w', wide && rosterOpen ? `${dom.leftCol.offsetWidth}px` : '0px');
  root.setProperty('--right-w', wide && rightOpen ? `${dom.rightCol.offsetWidth}px` : '0px');

  const topBottom = dom.topbar.getBoundingClientRect().bottom;
  let dockTop = dom.dock.getBoundingClientRect().top;
  // an open detail sheet covers the lower middle: centre the scene above it
  if (sheetSat >= 0 && !state.panelsHidden) dockTop = Math.min(dockTop, dom.sheet.offsetTop - 8);
  let left = 0, right = view.w;
  if (view.w > 900) {
    if (rosterOpen) left = dom.leftCol.getBoundingClientRect().right;
    if (rightOpen) right = dom.rightCol.getBoundingClientRect().left;
  }
  view.cxGoal = (left + right) / 2;
  view.cyGoal = (topBottom + dockTop) / 2;
  view.availMin = Math.max(160, Math.min(right - left, dockTop - topBottom));
  ui.scrubW = dom.scrub.clientWidth;
  if (!view.cx) { view.cx = view.cxGoal; view.cy = view.cyGoal; }
}

function observeLayout() {
  if (!('ResizeObserver' in window)) return;
  const ro = new ResizeObserver(() => { layoutChanged(); drawMarkers(); });
  ro.observe(dom.topbar);
  ro.observe(dom.dock);
  ro.observe(dom.markers);
  let queued = false;
  const charts = new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (sheetSat >= 0) buildSheetCharts(); buildAccuracyChart(); });
  });
  charts.observe(dom.accChart);
  charts.observe(dom.sparkEarth);
}

function init() {
  cacheDom();
  ctx = dom.scene.getContext('2d');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.reducedMotion = motion.matches;
  motion.addEventListener('change', (e) => { state.reducedMotion = e.matches; });
  readColours();
  buildStars();
  loadEarthTexture();
  updateLegend();
  bindUi();
  bindRunForm();
  bindInfo();
  bindBurnFocus();
  bindKeys();
  bindCanvas();
  bindDrop();
  const startCollapsed = window.matchMedia('(max-width: 768px)').matches
    ? [dom.rosterPanel, dom.eventsPanel, dom.accPanel, dom.legendPanel]
    : window.innerHeight < 760 ? [dom.legendPanel] : [];                // short screens: legend starts folded
  {
    for (const panel of startCollapsed) {
      panel.classList.add('collapsed');
      const btn = panel.querySelector('.collapse-btn');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', `Expand ${panel.querySelector('h2').textContent.toLowerCase()} panel`);
    }
  }
  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
  });
  resizeCanvas();
  observeLayout();
  resetCamera(true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layoutChanged(); drawMarkers(); });
  requestAnimationFrame(loop);
  openInfo();                                  // the website opens with "How Orbital works"
}


/* --------------------------------------------------------------------------
   14. NEW RUN FORM  –  the user types in satellites, ticks and debris
   There is no fixed cap on satellites, ticks or debris (orbital.cpp allows
   1–6 satellites). The only limit is what one browser tab can hold, so the
   form estimates the size of the run and refuses runs that would freeze it.
   -------------------------------------------------------------------------- */

const RUN_LIMITS = Object.freeze({
  rows: 1500000,      // telemetry rows one tab can hold comfortably
  seconds: 120,       // refuse runs estimated to take longer than this
  warnSeconds: 8,     // above this, say how long it will take
  addAtOnce: 500,     // rows added per click of "Add satellites"
});
const NAME_RULE = /^[A-Za-z0-9_.-]{1,24}$/;
const INCLINATIONS = [28.5, 45, 51.6, 53, 70, 86.4, 97.4];
const runForm = {
  rnd: mulberry32((Date.now() % 2147483647) >>> 0), queued: false, showingErrors: false,
  started: false,          // the "own satellites" table is filled the first time the form opens
  tab: 'real',             // 'real' | 'own'
  settingsMode: null,      // which mode's defaults the settings boxes currently hold
  satFiles: [], debFiles: [],                       // real-data tab: one entry per loaded CSV file
  real: { sats: [], debris: [], dupSats: 0, dupDebris: 0, epochMs: 0, docked: new Map() },   // combined, from the files
  realNotes: [],
};

// The kind of physics: real-data runs are always kilometres; own runs use the Units choice.
function formMode() {
  return runForm.tab === 'real' ? 'real' : dom.runForm.querySelector('input[name="run-mode"]:checked').value;
}
function setField(id, v) { $(id).value = String(v); }

// Settings fields get the defaults of the chosen mode (from RUN_PRESETS).
function fillRunSettings(mode) {
  const P = RUN_PRESETS[mode], ri = P.runInfo;
  setField('run-ticks', P.ticks);
  setField('run-repair', P.repairTicks);
  setField('run-debris', P.debrisPerSat);
  setField('run-catalog', P.catalogDebris);
  setField('run-chaos', P.chaosEvery);
  setField('run-write', ri.write_interval);
  setField('run-seed', Math.floor(runForm.rnd() * 1e9));
  setField('run-sector', ri.sector_size);
  setField('run-watch', ri.watch_dist);
  setField('run-warn', ri.warn_dist);
  setField('run-danger', ri.danger_dist);
  setField('run-critical', ri.critical_dist);
  dom.runDialog.classList.toggle('mode-real', mode === 'real');
  dom.runDialog.querySelectorAll('.unit-label').forEach((el) => { el.textContent = ri.units; });
  runForm.settingsMode = mode;
}

// Show one of the two tabs: Real data or Your own satellites.
function setRunTab(tab) {
  runForm.tab = tab;
  dom.runDialog.querySelectorAll('[role="tab"]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  dom.runDialog.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  if (formMode() !== runForm.settingsMode) fillRunSettings(formMode());
  else dom.runDialog.classList.toggle('mode-real', formMode() === 'real');
  dom.runChaosNote.textContent = tab === 'real' ? '0 = off · faults only, no debris' : '0 = off · faults and new debris';
  dom.runSub.textContent = {
    real: 'Simulate real satellites and debris from CelesTrak CSV files. Only the objects in your files are used.',
    own: 'Type in your own satellites. Debris around them is generated automatically.',
  }[tab];
  runForm.showingErrors = false;
  dom.runErrors.innerHTML = '';
  updateEstimate();
}

// A new satellite row with a unique name and a random (editable) orbit.
function newSatSpec(taken, index) {
  const cls = index % 2 === 0 ? 'Communication' : 'Imaging';
  const prefix = cls === 'Communication' ? 'CommSat' : 'ImageSat';
  let n = index + 1, name = `${prefix}-${n}`;
  while (taken.has(name)) name = `${prefix}-${++n}`;
  taken.add(name);
  const r = runForm.rnd;
  return {
    name, cls,
    alt: String(Math.round(400 + r() * 800)),
    inc: String(INCLINATIONS[Math.floor(r() * INCLINATIONS.length)]),
    raan: String(Math.round(r() * 360)),
    u: String(Math.round(r() * 360)),
  };
}

// Current table rows as plain values (kept as typed text, so mistakes survive a redraw).
function readFormSats() {
  return Array.from(dom.runSats.rows).map((tr) => {
    const v = (f) => tr.querySelector(`[data-f="${f}"]`).value;
    return { name: v('name'), cls: v('cls'), alt: v('alt'), inc: v('inc'), raan: v('raan'), u: v('u') };
  });
}

function renderFormSats(list) {
  const opt = (cls, cur, label = cls) => `<option value="${cls}"${cls === cur ? ' selected' : ''}>${label}</option>`;
  const numCell = (f, value, label, i) => `<td class="real-only"><input class="input" type="number" step="any" data-f="${f}" value="${escapeHtml(value)}" aria-label="Satellite ${i + 1} ${label}"></td>`;
  dom.runSats.innerHTML = list.map((s, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><input class="input" data-f="name" value="${escapeHtml(s.name)}" maxlength="24" spellcheck="false" autocomplete="off" aria-label="Satellite ${i + 1} name"></td>
      <td><select class="input" data-f="cls" aria-label="Satellite ${i + 1} type">${opt('Communication', s.cls)}${opt('Imaging', s.cls)}${opt('', s.cls, 'Not recorded')}</select></td>
      ${numCell('alt', s.alt, 'altitude in km', i)}${numCell('inc', s.inc, 'inclination in degrees', i)}
      ${numCell('raan', s.raan, 'RAAN in degrees', i)}${numCell('u', s.u, 'phase in degrees', i)}
      <td><button type="button" class="icon-btn small" data-remove="${i}" aria-label="Remove satellite ${i + 1}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></td>
    </tr>`).join('');
  dom.runSatCount.textContent = String(list.length);
  queueEstimate();
}

// Fill the "own satellites" tab with the preset example satellites of the chosen units.
function resetOwnSatellites(mode) {
  dom.runForm.querySelector(`input[name="run-mode"][value="${mode}"]`).checked = true;
  const taken = new Set();
  renderFormSats(RUN_PRESETS[mode].sats.map((t, i) => {
    const s = newSatSpec(taken, i);
    s.name = t.name; s.cls = t.cls;
    if (t.alt !== undefined) { s.alt = String(t.alt); s.inc = String(t.inc); s.raan = String(t.raan); s.u = String(t.u); }
    return s;
  }));
}

// tab: which tab to show ('real' or 'own'); without it, the last one used.
function openRunForm(tab) {
  if (!runForm.started) {
    runForm.started = true;
    resetOwnSatellites('classic');
    renderRealFiles();
  }
  if (!dom.runDialog.open) dom.runDialog.showModal();
  setRunTab(tab || runForm.tab);
}

/* ---- Real data tab: CelesTrak CSV files ---------------------------------- */

// All loaded files combined. A NORAD number listed twice is used once (satellite files win).
function combineRealFiles() {
  const seen = new Set(), sats = [], debris = [];
  let dupSats = 0, dupDebris = 0, epochMs = 0;
  for (const f of runForm.satFiles) for (const o of f.objects) {
    if (seen.has(o.norad)) { dupSats++; continue; }
    seen.add(o.norad); sats.push(o);
    if (o.epochMs > epochMs) epochMs = o.epochMs;
  }
  for (const f of runForm.debFiles) for (const o of f.objects) {
    if (seen.has(o.norad)) { dupDebris++; continue; }
    seen.add(o.norad); debris.push(o);
    if (o.epochMs > epochMs) epochMs = o.epochMs;
  }
  const { kept, docked } = joinDockedSatellites(sats, epochMs);
  runForm.real = { sats: kept, debris, dupSats, dupDebris, epochMs, docked };
}

// Station modules and visiting spacecraft (e.g. POISK on the ISS, WENTIAN on Tiangong)
// are listed by CelesTrak as separate objects with the station's orbit. Simulated
// separately they sit at distance 0 and raise a CRITICAL satellite alert every tick, so
// objects that start within 1 km of another and move within 1 m/s of it are treated as
// docked: the first one listed stays, the others are recorded as its docked modules.
const DOCKED = Object.freeze({ km: 1, kmPerS: 0.001 });
function joinDockedSatellites(sats, epochMs) {
  const kept = [], docked = new Map();            // norad of kept object → names docked to it
  const cell = new Map(), size = 2 * DOCKED.km;
  const states = sats.map((o) => elementsToState(o, epochMs, RUN_PRESETS.real.mu).state);
  for (let i = 0; i < sats.length; i++) {
    const p = states[i];
    const cx = Math.floor(p.x / size), cy = Math.floor(p.y / size), cz = Math.floor(p.z / size);
    let host = -1;
    for (let dx = -1; dx <= 1 && host < 0; dx++) for (let dy = -1; dy <= 1 && host < 0; dy++) for (let dz = -1; dz <= 1 && host < 0; dz++) {
      const list = cell.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (list) for (const j of list) {
        const q = states[j];
        if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < DOCKED.km &&
            Math.hypot(p.vx - q.vx, p.vy - q.vy, p.vz - q.vz) < DOCKED.kmPerS) { host = j; break; }
      }
    }
    if (host >= 0) {
      const key = sats[host].norad;
      if (!docked.has(key)) docked.set(key, { host: sats[host].name, names: [] });
      docked.get(key).names.push(sats[i].name);
      continue;
    }
    kept.push(sats[i]);
    const key = `${cx},${cy},${cz}`;
    if (!cell.has(key)) cell.set(key, []);
    cell.get(key).push(i);
  }
  return { kept, docked };
}

function renderRealFiles() {
  combineRealFiles();
  const r = runForm.real;
  const item = (kind, f, i) => `<li>
      <span class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="fcount">${f.objects.length.toLocaleString()} ${kind === 'sats' ? 'satellites' : 'debris'}${f.skipped ? ` · ${f.skipped.toLocaleString()} skipped` : ''}</span>
      <button type="button" class="icon-btn small" data-remove-file="${kind}:${i}" aria-label="Remove ${escapeHtml(f.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </li>`;
  dom.runSatList.innerHTML = runForm.satFiles.map((f, i) => item('sats', f, i)).join('');
  dom.runDebList.innerHTML = runForm.debFiles.map((f, i) => item('debris', f, i)).join('');
  const total = (n, dup, word) => `${n.toLocaleString()} ${word}${dup ? ` (${dup.toLocaleString()} repeated, used once)` : ''}`;
  let dockedCount = 0;
  for (const g of r.docked.values()) dockedCount += g.names.length;
  dom.runSatTotal.textContent = runForm.satFiles.length
    ? total(r.sats.length, r.dupSats, 'satellites') + (dockedCount ? ` + ${dockedCount} docked` : '') : 'None loaded';
  dom.runDebTotal.textContent = runForm.debFiles.length ? total(r.debris.length, r.dupDebris, 'debris') : 'None loaded';
  const lines = [];
  if (r.epochMs) lines.push(`All orbits start together at the newest epoch in the files: ${new Date(r.epochMs).toISOString().replace('T', ' ').slice(0, 16)} UTC.`);
  else lines.push('Only the objects in your files are simulated: no debris is invented in real-data runs.');
  if (r.docked.size) {
    const groups = Array.from(r.docked.values()).map((g) => `${g.host} with ${g.names.join(', ')}`);
    lines.push(`Docked together, so simulated as one spacecraft (they share one orbit): ${groups.join('; ')}.`);
  }
  for (const n of runForm.realNotes) lines.push(`<span class="${n.error ? 'note-error' : 'note-warn'}">${escapeHtml(n.text)}</span>`);
  dom.runRealNote.innerHTML = lines.join('<br>');
  queueEstimate();
}

// Read CelesTrak CSV files into the satellite or debris list.
// kind 'sats' or 'debris'; null decides per file (names with DEB or R/B → debris).
async function addRealFiles(kind, files) {
  runForm.realNotes = [];
  for (const file of Array.from(files)) {
    try {
      const head = await readFileText(file.slice(0, 4096), file.name);
      const k = kindFromSnippet(head);
      if (k === 'satcat') throw new DataError(`${file.name} is the satellite catalogue (SATCAT), which has no orbits. Download “GP data” in CSV format instead.`);
      if (k === 'tle') throw new DataError(`${file.name} is in TLE format. Download the same group in CSV format (FORMAT=csv).`);
      if (k !== 'celestrak') throw new DataError(`${file.name} is not CelesTrak GP data in CSV format (its first line should start with OBJECT_NAME).`);
      const parsed = parseCelestrakCsv(await readFileText(file, file.name), file.name);
      const debrisLike = looksLikeDebris(parsed.objects);
      const as = kind || (debrisLike ? 'debris' : 'sats');
      const list = as === 'debris' ? runForm.debFiles : runForm.satFiles;
      const other = as === 'debris' ? runForm.satFiles : runForm.debFiles;
      const entry = { name: file.name, objects: parsed.objects, skipped: parsed.skipped };
      const i = list.findIndex((f) => f.name === file.name);
      if (i >= 0) list[i] = entry; else list.push(entry);              // the same file again replaces it
      const j = other.findIndex((f) => f.name === file.name);
      if (j >= 0) other.splice(j, 1);                                  // a file is either satellites or debris
      if (!kind) runForm.realNotes.push({ text: `${file.name} was added to ${as === 'debris' ? 'Debris' : 'Satellite'} files${debrisLike ? ' (most names contain DEB or R/B)' : ''}.` });
      else if (as === 'sats' && debrisLike) runForm.realNotes.push({ text: `${file.name} looks like debris (most names contain DEB or R/B). If it is, remove it here and add it under Debris files.` });
      else if (as === 'debris' && !debrisLike) runForm.realNotes.push({ text: `${file.name} does not look like debris (few names contain DEB or R/B). If these are working satellites, add it under Satellite files instead.` });
    } catch (err) {
      runForm.realNotes.push({ error: true, text: err instanceof DataError ? err.message : `Could not read ${file.name}: ${err.message}` });
    }
  }
  renderRealFiles();
}

/* ---- Size estimate and checks -------------------------------------------- */

// Settings as numbers (NaN when a box is empty or not a number).
function readRunSettings() {
  const n = (id) => { const t = $(id).value.trim(); return t === '' ? NaN : Number(t); };
  return {
    ticks: n('run-ticks'), repair: n('run-repair'), debris: n('run-debris'), catalog: n('run-catalog'),
    chaos: n('run-chaos'), write: n('run-write'), seed: n('run-seed'), sector: n('run-sector'),
    watch: n('run-watch'), warn: n('run-warn'), danger: n('run-danger'), critical: n('run-critical'),
  };
}

// Problems that are allowed but worth knowing about.
function softWarnings(v, e) {
  const out = [];
  if (v.sector < v.watch) out.push(`Sector size is smaller than the watch distance, so the 3×3×3 sector search can miss debris (as it would in orbital.cpp).`);
  if (v.watch < v.warn) out.push('Watch distance is below the warning distance, so some WARNING events can never happen.');
  if (e && e.seconds > RUN_LIMITS.warnSeconds) {
    out.push(`This run will take roughly ${formatDuration(e.seconds)} to simulate and load. You can cancel it while it runs.`);
  }
  return out;
}

// Which browser limit (if any) the run would break, with a way to fix it.
function limitProblem(e) {
  const fix = 'Raise “Write telemetry every N ticks” (in Advanced), or use fewer ticks, satellites or debris.';
  if (e.rows > RUN_LIMITS.rows) return `About ${e.rows.toLocaleString()} telemetry rows is more than one browser tab can hold comfortably (${RUN_LIMITS.rows.toLocaleString()}). ${fix}`;
  if (e.seconds > RUN_LIMITS.seconds) return `This run would take roughly ${formatDuration(e.seconds)} in the browser. ${fix}`;
  return null;
}

// The smallest change that makes a too-big run fit: write telemetry less often first
// (the run itself is unchanged), otherwise run fewer ticks.
function suggestFix(params, S, typed) {
  const fits = (p) => !limitProblem(estimateRun(p, S, typed));
  const withWrite = (wi) => ({ ...params, runInfo: { write_interval: wi } });
  const w0 = params.runInfo.write_interval;
  for (let wi = w0 + 1; wi <= params.ticks && wi <= w0 + 5000; wi++) {
    if (fits(withWrite(wi))) return { field: 'run-write', value: wi, label: `Fix: write telemetry every ${wi} ticks` };
  }
  // too slow even when written rarely: largest number of ticks that fits
  let lo = 0, hi = params.ticks - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits({ ...params, ticks: mid })) lo = mid; else hi = mid - 1;
  }
  return lo >= 1 ? { field: 'run-ticks', value: lo, label: `Fix: run ${lo.toLocaleString()} ticks instead` } : null;
}

function formatDuration(sec) {
  return sec < 90 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`;
}

function queueEstimate() {
  if (runForm.queued) return;
  runForm.queued = true;
  requestAnimationFrame(() => { runForm.queued = false; updateEstimate(); });
}

// What the current tab would simulate: satellite count, how many are typed, starting debris.
function runShape(v) {
  if (runForm.tab === 'real') {
    const r = runForm.real;
    return { S: r.sats.length, typed: 0, perSat: 0, ownOrbit: r.debris.length, empty: 'Add at least one satellite CSV file.' };
  }
  const S = dom.runSats.rows.length;
  return { S, typed: S, perSat: v.debris, ownOrbit: formMode() === 'real' && Number.isFinite(v.catalog) ? v.catalog : 0, empty: 'Add at least one satellite.' };
}

// Live line under the form: size of the run, warnings, and whether it can run.
function updateEstimate() {
  const v = readRunSettings(), shape = runShape(v), base = RUN_PRESETS[formMode()];
  const usable = [v.ticks, v.write, v.chaos, shape.perSat].every((x) => Number.isFinite(x) && x >= 0) && v.ticks >= 1 && v.write >= 1;
  let html = '';
  if (!shape.S || !usable) {
    dom.runEstimate.textContent = shape.S ? 'Fill in the run settings to see how big this run is.' : shape.empty;
    dom.runSubmit.disabled = !shape.S;
  } else {
    const params = {
      ticks: v.ticks, chaosEvery: v.chaos, fragmentChance: base.fragmentChance, debrisPerSat: shape.perSat,
      catalogDebris: shape.ownOrbit, runInfo: { write_interval: v.write },
      closestApproach: $('run-cpa').checked,
    };
    const e = estimateRun(params, shape.S, shape.typed);
    dom.runEstimate.textContent = `${shape.S.toLocaleString()} satellite${shape.S === 1 ? '' : 's'}, ${e.frames.toLocaleString()} frames, about ${e.rows.toLocaleString()} telemetry rows (${e.mb.toFixed(1)} MB) and ${e.endDebris.toLocaleString()} debris by the end. Roughly ${formatDuration(e.seconds)}.`;
    const limit = limitProblem(e);
    if (limit) {
      const fix = suggestFix(params, shape.S, shape.typed);
      html += `<li>${escapeHtml(limit)}${fix ? ` <button type="button" class="btn fix-btn" data-fix-field="${fix.field}" data-fix-value="${fix.value}">${escapeHtml(fix.label)}</button>` : ''}</li>`;
    }
    for (const w of softWarnings(v, limit ? null : e)) html += `<li class="warn">${escapeHtml(w)}</li>`;   // no "it will take" note for a run that cannot start
    dom.runSubmit.disabled = !!limit;
  }
  if (!runForm.showingErrors) dom.runErrors.innerHTML = html;
}

// Check every input (like the cin validation loops in orbital.cpp) and build the run settings.
function validateRunForm() {
  const errors = [];
  dom.runForm.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const own = runForm.tab === 'own', mode = formMode(), v = readRunSettings();
  const bad = (id, msg) => errors.push({ el: typeof id === 'string' ? $(id) : id, msg });
  const whole = (id, value, min, label) => { if (!Number.isInteger(value) || value < min) bad(id, `${label} must be a whole number of at least ${min}.`); };
  const positive = (id, value, label) => { if (!(Number.isFinite(value) && value > 0)) bad(id, `${label} must be a number above 0.`); };

  whole('run-ticks', v.ticks, 1, 'Ticks to run');
  whole('run-repair', v.repair, 1, 'Repair duration');
  whole('run-chaos', v.chaos, 0, 'Chaos event every N ticks');
  if (own) whole('run-debris', v.debris, 0, 'Starting debris near each satellite');
  if (own && mode === 'real') whole('run-catalog', v.catalog, 0, 'Debris on their own orbits');
  whole('run-write', v.write, 1, 'Write telemetry every N ticks');
  whole('run-seed', v.seed, 0, 'Random seed');
  positive('run-sector', v.sector, 'Sector size');
  positive('run-watch', v.watch, 'Watch distance');
  positive('run-warn', v.warn, 'Warning distance');
  positive('run-danger', v.danger, 'Danger distance');
  positive('run-critical', v.critical, 'Critical distance');
  if (v.warn > 0 && v.danger > 0 && v.critical > 0 && !(v.warn >= v.danger && v.danger >= v.critical)) {
    bad('run-warn', 'Distances must satisfy warning ≥ danger ≥ critical.');
  }

  let sats = [];
  if (own) {
    const rows = Array.from(dom.runSats.rows);
    if (!rows.length) bad('run-add-count', 'Add at least one satellite.');
    const seen = new Map();
    sats = rows.map((tr, i) => {
      const field = (f) => tr.querySelector(`[data-f="${f}"]`);
      const name = field('name').value.trim();
      if (!NAME_RULE.test(name)) bad(field('name'), `Satellite ${i + 1}: use 1–24 letters, digits, _ . or - (no spaces).`);
      else if (seen.has(name)) bad(field('name'), `Satellite ${i + 1}: the name “${name}” is already used by satellite ${seen.get(name) + 1}.`);
      else seen.set(name, i);
      const spec = { name, cls: field('cls').value };
      if (mode === 'real') {
        const num = (f) => { const t = field(f).value.trim(); return t === '' ? NaN : Number(t); };
        spec.alt = num('alt'); spec.inc = num('inc'); spec.raan = num('raan'); spec.u = num('u');
        if (!(spec.alt >= 100)) bad(field('alt'), `Satellite ${i + 1}: altitude must be at least 100 km.`);
        if (!(spec.inc >= 0 && spec.inc <= 180)) bad(field('inc'), `Satellite ${i + 1}: inclination must be between 0° and 180°.`);
        if (!Number.isFinite(spec.raan)) bad(field('raan'), `Satellite ${i + 1}: RAAN must be a number of degrees.`);
        if (!Number.isFinite(spec.u)) bad(field('u'), `Satellite ${i + 1}: phase must be a number of degrees.`);
      }
      return spec;
    });
  } else if (!runForm.real.sats.length) {
    bad(dom.runSatPick, 'Add at least one satellite CSV file.');
  }
  if (errors.length) return { errors };

  const base = RUN_PRESETS[mode];
  const runInfo = {
    ...base.runInfo, write_interval: v.write, sector_size: v.sector,
    watch_dist: v.watch, warn_dist: v.warn, danger_dist: v.danger, critical_dist: v.critical,
  };
  let realDebris = [];
  if (!own) {
    // Real data: every object from the files, all starting at one time (the newest epoch)
    const r = runForm.real, t0 = r.epochMs, taken = new Set();
    runInfo.data_source = 'CelesTrak GP';
    runInfo.snapshot_date = new Date(t0).toISOString().slice(0, 10);
    runInfo.start_utc = new Date(t0).toISOString();
    sats = r.sats.map((o) => ({ name: cleanSatName(o.name, taken), cls: '', el: o, src: 'real', state: elementsToState(o, t0, base.mu).state }));
    realDebris = r.debris.map((o) => ({ id: o.norad, state: elementsToState(o, t0, base.mu).state }));
  } else if (mode === 'real') {
    runInfo.data_source = 'User input';
    runInfo.snapshot_date = new Date().toISOString().slice(0, 10);
  }
  const P = {
    ...base, runInfo, seed: v.seed, ticks: v.ticks, repairTicks: v.repair, chaosEvery: v.chaos,
    debrisPerSat: own ? v.debris : 0,                       // invented debris only for typed satellites
    catalogDebris: own && mode === 'real' ? v.catalog : 0,
    decay: [], validationStep: 0,
    satSource: 'synthetic', catalogSource: 'synthetic', sats, realDebris,   // only CelesTrak objects are marked real
    syntheticNearReal: false,          // the demo switch copied from RUN_PRESETS.real must not apply to user runs
    closestApproach: $('run-cpa').checked,
  };
  const limit = limitProblem(estimateRun(P, sats.length, own ? sats.length : 0));
  if (limit) bad('run-write', limit);
  return { errors, P };
}

function showFormErrors(errors) {
  const shown = errors.slice(0, 6).map((e) => `<li>${escapeHtml(e.msg)}</li>`).join('');
  const more = errors.length > 6 ? `<li>…and ${errors.length - 6} more.</li>` : '';
  dom.runErrors.innerHTML = shown + more;
  runForm.showingErrors = true;
  for (const e of errors) e.el.setAttribute('aria-invalid', 'true');
  const first = errors[0].el;
  const adv = first.closest('details');
  if (adv) adv.open = true;
  first.focus();
}

async function submitRunForm(e) {
  e.preventDefault();
  const { errors, P } = validateRunForm();
  if (errors.length) { showFormErrors(errors); return; }
  dom.runDialog.close();
  runForm.lastRun = {
    tab: runForm.tab, closestApproach: !!P.closestApproach,
    satFiles: runForm.tab === 'real' ? runForm.satFiles.map((f) => f.name) : [],
    debFiles: runForm.tab === 'real' ? runForm.debFiles.map((f) => f.name) : [],
  };
  await runPipeline((stale) => simulateRun(P, (p) => showLoading('Simulating in the browser', p), stale), 'custom');
}

function bindRunForm() {
  dom.newRunBtn.addEventListener('click', () => openRunForm());
  dom.emptyState.querySelector('[data-action="new-run"]').addEventListener('click', () => openRunForm('own'));
  dom.emptyState.querySelector('[data-action="real-run"]').addEventListener('click', () => openRunForm('real'));
  dom.runDialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dom.runDialog.close()));
  dom.runForm.addEventListener('submit', submitRunForm);

  // tabs: click, or arrow keys between them
  const tabs = Array.from(dom.runDialog.querySelectorAll('[role="tab"]'));
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => setRunTab(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      setRunTab(next.dataset.tab);
    });
  });

  // Real data tab: two separate loaders, each taking several files (button or drop)
  dom.runSatPick.addEventListener('click', () => dom.runSatFiles.click());
  dom.runDebPick.addEventListener('click', () => dom.runDebFiles.click());
  for (const [input, kind] of [[dom.runSatFiles, 'sats'], [dom.runDebFiles, 'debris']]) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files);
      input.value = '';
      if (files.length) addRealFiles(kind, files);
    });
  }
  for (const zone of [dom.runSatZone, dom.runDebZone]) {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag'); });
    zone.addEventListener('drop', () => zone.classList.remove('drag'));   // the files are taken by the page's drop handler
  }
  dom.runDialog.querySelector('#panel-real').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-file]');
    if (!b) return;
    const [kind, i] = b.dataset.removeFile.split(':');
    (kind === 'sats' ? runForm.satFiles : runForm.debFiles).splice(Number(i), 1);
    runForm.realNotes = [];
    renderRealFiles();
  });

  // Own satellites tab
  dom.runForm.querySelectorAll('input[name="run-mode"]').forEach((radio) => radio.addEventListener('change', () => {
    fillRunSettings(formMode());     // satellites are kept; their orbit columns appear in kilometre mode
    runForm.showingErrors = false;
    updateEstimate();
  }));
  dom.runForm.addEventListener('change', (e) => { if (e.target.id === 'run-cpa') queueEstimate(); });
  dom.runForm.addEventListener('input', (e) => {
    if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid');
    runForm.showingErrors = false;
    queueEstimate();
  });
  dom.runAdd.addEventListener('click', () => {
    const count = clamp(Math.floor(Number(dom.runAddCount.value)) || 1, 1, RUN_LIMITS.addAtOnce);
    const list = readFormSats();
    const taken = new Set(list.map((x) => x.name.trim()));
    for (let i = 0; i < count; i++) list.push(newSatSpec(taken, list.length));
    renderFormSats(list);
    const wrap = dom.runSats.closest('.run-table-wrap');
    wrap.scrollTop = wrap.scrollHeight;
  });
  dom.runClear.addEventListener('click', () => renderFormSats([]));
  dom.runSats.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const list = readFormSats();
    list.splice(Number(b.dataset.remove), 1);
    renderFormSats(list);
  });

  // one-click fix for a run that is too big
  dom.runErrors.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fix-field]');
    if (!b) return;
    const field = $(b.dataset.fixField);
    field.value = b.dataset.fixValue;
    const adv = field.closest('details');
    if (adv) adv.open = true;                      // show the setting that was changed
    field.removeAttribute('aria-invalid');
    runForm.showingErrors = false;
    updateEstimate();
    field.focus();
  });
}


/* --------------------------------------------------------------------------
   17. "HOW ORBITAL WORKS" WINDOW
   The explanation text lives in index.html. This code fills in the numbers
   that depend on the loaded run (thresholds, units, sizes) and the
   "This run" summary each time the window opens.
   -------------------------------------------------------------------------- */
function infoRunHtml() {
  const run = state.run;
  if (!run) return '<p>No run is loaded yet. Start one with New run. The numbers below show the classic C++ values until then.</p>';
  const u = config.units, n = run.events.length;
  const origin = {
    files: 'Files from orbital.cpp (the project’s results)',
    custom: config.dataSource === 'CelesTrak GP' ? 'Browser simulation from real CelesTrak starting orbits' : 'Browser simulation from the New run form',
  }[state.origin];
  const last = run.frames[run.frames.length - 1];
  const classes = {};
  for (const s of run.sats) { const k = s.cls || 'not recorded'; classes[k] = (classes[k] || 0) + 1; }
  const gap = run.frames.length > 1 ? run.ticks[1] - run.ticks[0] : 1;
  const factor = UI.speeds[state.speedIndex] * run.ticksPerSecond * config.dt;
  const th = state.sources.telemetry && state.sources.telemetry.thinned;
  const made = state.origin === 'custom' ? runForm.lastRun : null;
  const rows = [['Source', origin]];
  if (made && made.satFiles.length) {
    rows.push(['Satellite files', made.satFiles.join(', ')]);
    rows.push(['Debris files', made.debFiles.length ? made.debFiles.join(', ') : 'none']);
  }
  rows.push(
    ['Files', run.fileNames.join(', ')],
    ['Mode', config.mode === 'real' ? `Real data, ${u}` : `Classic, ${u}`],
  );
  if (made) rows.push(['Collision check', made.closestApproach ? 'closest approach during each tick' : 'distance at each tick (as orbital.cpp)']);
  if (config.mode === 'real') rows.push(['Data', `${config.dataSource || 'not stated'}, ${config.snapshotDate || 'date not stated'}`]);
  rows.push(
    ['Earth radius', `${config.earthRadius} ${u}`],
    ['Time step', `${config.dt} s per tick`],
    ['Ticks', `${run.firstTick} to ${run.lastTick}, ${run.frames.length.toLocaleString()} written frames (every ${gap} tick${gap === 1 ? '' : 's'})`],
    ['Satellites', `${run.sats.length} (${Object.entries(classes).map(([k, v]) => `${v} ${k}`).join(', ')})`],
    ['Debris at the end', `${last.debris.length.toLocaleString()} (${last.realDebris} real, ${last.synthDebris} synthetic)`],
    ['Events', `${n.toLocaleString()}: ${run.alertsPrefix[n]} alerts, ${run.burnsPrefix[n]} evasive burns, ${run.dispatchPrefix[n]} repairs, ${run.zonesPrefix[n]} red zones`],
    ['Thresholds', `watch ${config.watchDist}, warning ${config.warnDist}, danger ${config.dangerDist}, critical ${config.criticalDist} ${u}`],
    ['Sector size', `${config.sectorSize} ${u}`],
    ['Playback now', `${UI.speeds[state.speedIndex]}× speed = ${factor >= 10 ? Math.round(factor) : factor.toFixed(1)}× real time`],
  );
  if (th && th.every > 1) rows.push(['Thinned', `1 in ${th.every} written ticks loaded (${th.keptRows.toLocaleString()} of ${th.totalRows.toLocaleString()} rows)`]);
  return `<dl class="info-run">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

function openInfo() {
  if (dom.runDialog.open) return;
  dom.infoRunBody.innerHTML = infoRunHtml();
  // numbers in the text that come from the run's settings
  dom.infoDialog.querySelectorAll('[data-info]').forEach((el) => {
    const v = config[el.dataset.info];
    el.textContent = el.hasAttribute('data-unit') ? `${v} ${config.units}` : String(v);
  });
  dom.infoDialog.querySelectorAll('[data-info-plural]').forEach((el) => {
    el.textContent = config[el.dataset.infoPlural] === 1 ? '' : 's';
  });
  // with no run loaded there is nothing to summarise: hide "This run" and its link
  const hasRun = !!state.run;
  dom.infoDialog.querySelector('#info-run').hidden = !hasRun;
  dom.infoDialog.querySelector('.info-toc a[href="#info-run"]').hidden = !hasRun;
  document.getElementById('info-close').textContent = hasRun ? 'Close' : 'Start';
  if (!dom.infoDialog.open) dom.infoDialog.showModal();
  dom.infoDialog.querySelector('.info-body').scrollTop = 0;
}

function bindInfo() {
  dom.infoBtn.addEventListener('click', openInfo);
  dom.emptyState.querySelector('[data-action="info"]').addEventListener('click', openInfo);
  document.querySelectorAll('[data-action="license"]').forEach((b) => b.addEventListener('click', () => {
    openInfo();
    dom.infoDialog.querySelector('#info-license').scrollIntoView({ block: 'start' });
  }));
  dom.infoDialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dom.infoDialog.close()));
  // contents links scroll inside the window instead of changing the page address
  dom.infoDialog.querySelectorAll('.info-toc a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = dom.infoDialog.querySelector(a.getAttribute('href'));
    if (target) target.scrollIntoView({ block: 'start', behavior: state.reducedMotion ? 'auto' : 'smooth' });
  }));
}

/* --------------------------------------------------------------------------
   START
   -------------------------------------------------------------------------- */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
