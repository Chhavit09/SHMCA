'use strict';
/*
   Copyright (c) 2026 Chhavit (@Chhavit09), Harsh Jain (@harshj1214-hj), Satyam Kumar (@kr-Satyam09), and Sudhanshu Ojha (@sudhanshuOjha07)
   All Rights Reserved. Proprietary and confidential: see LICENSE.txt for the terms.
*/
/* ==========================================================================
   ORBITAL – Phase III frontend. The code is split into seven files, loaded in
   this order by index.html (they share one global scope; ui.js starts the app):
     js/core.js       configuration, helpers, application state
     js/data.js       file loading, parsers, derived data
     js/simulator.js  browser simulator (port of orbital.cpp), CelesTrak import
     js/render.js     camera, projection, Canvas 2D rendering, Earth map
     js/playback.js   playback, interpolation, Burn focus
     js/panels.js     stats, roster, events, detail sheet, charts, raw data
     js/ui.js         notices, page wiring, New run form, info window, start
   Team Sentra · DSCPP-III-2026-T004 · Graphic Era (Deemed to be University)

   DATA FLOW
   1. load      Files arrive from the "Load files" button or drag-and-drop,
                or from the browser simulation (the demos and the "New run"
                form), which writes the same text formats as orbital.cpp.
   2. identify  Each file is recognised by its name; if the name is unusual we
                sniff its first line ("Tick,..." means telemetry, and so on).
   3. config    run_info.txt is read into ONE config object. If it is missing we
                use CLASSIC_DEFAULTS. No other line hard-codes a scale value
                (Earth radius, dt, sector size, distance thresholds).
   4. parse     telemetry.csv is parsed in chunks so the page stays responsive;
                the header is read by NAME, so column order does not matter.
                blackbox.txt is parsed line by line; validation.csv if present.
   5. index     Rows are grouped into frames (one frame per written tick) and
                each object is linked to itself in the next frame.
   6. derive    Done ONCE after loading: nearest debris / satellite distances,
                risk classes, satellite tracks, repair intervals, red-zone cubes
                and running counters (prefix sums, so lookups are O(log n)).
   7. render    requestAnimationFrame loop: advance time → interpolate between
                written frames → rotate → project → depth-sort → draw.
                DOM panels refresh only when the frame or event index changes.

   ASSUMPTIONS ABOUT THE FILE FORMATS
   - CSV fields are plain (the C++ never quotes them); quoted fields still work.
   - Satellite names contain no spaces (orbital.cpp reads them with cin >>), so
     "first word after the tag" is a name. For CHAOS lines ("Solar flare on
     NAME") we take the first word that matches a satellite in telemetry.csv.
   - Satellite names and debris ids are unique for the whole run.
   - blackbox t is simulated seconds; tick = t / dt (rounded if within float error).
   - "Alerts" = WARNING, COLLISION ALERT, SAT-WARNING and SAT-COLLISION ALERT
     lines. WARNING lines count as risk WARNING; COLLISION ALERT lines use risk=.
   - Red zones are never cleared (the C++ activeRedZones list only grows), so
     "active red zones" = sectors declared so far, each key counted once.
   - A satellite is UNDER REPAIR from its DISPATCH tick until (not including)
     its REPAIR tick. If the Disabled column exists, it wins.
   - Distances and risk classes are computed at written frames only; between
     frames, positions are interpolated linearly for display.
   - Sector keys without bx/by/bz are matched with the AVL_Tree.h formula
     using config.sectorSize; keys are never decoded back into indices.
   - Without run_info.txt, write_interval is taken as 1 (the classic C++
     writes every tick). Interpolation always uses the real tick spacing.
   - validation.csv Elapsed_s uses the same clock as blackbox t.
   - An object missing from a frame is not drawn in that frame.
   - Real runs: positions are Earth-centred inertial (SGP4 output is close to this),
     and t = 0 is run_info start_utc if given, otherwise 00:00 UTC on snapshot_date.
     The Earth image is turned by Greenwich sidereal time so continents sit under
     the orbits roughly correctly. Classic runs use the same rotation rate with
     ticks treated as seconds, which is almost no visible rotation.
   ========================================================================== */


/* ORBITAL website – js/core.js. Core: configuration, small helpers and application state. Loaded first; every other file uses these. */

/* --------------------------------------------------------------------------
   1. CONFIGURATION  –  the single config object and every constant
   -------------------------------------------------------------------------- */

// Used when run_info.txt is missing. These match the classic C++ build:
// FlightComputer.h thresholds 15/10/5 and AVL_Tree.h sectors of 100 units.
const CLASSIC_DEFAULTS = Object.freeze({
  mode: 'classic', units: 'units', earthRadius: 4000, dt: 1, writeInterval: 1,
  sectorSize: 100, watchDist: 15, warnDist: 15, dangerDist: 10, criticalDist: 5,
  dataSource: '', snapshotDate: '', startUtc: '',
});

// run_info.txt key  →  property name in the config object
const RUN_INFO_KEYS = Object.freeze({
  mode: 'mode', units: 'units', earth_radius: 'earthRadius', dt: 'dt',
  write_interval: 'writeInterval', sector_size: 'sectorSize',
  watch_dist: 'watchDist', warn_dist: 'warnDist', danger_dist: 'dangerDist',
  critical_dist: 'criticalDist', data_source: 'dataSource', snapshot_date: 'snapshotDate',
  start_utc: 'startUtc',
});
const NUMERIC_PROPS = new Set(['earthRadius', 'dt', 'writeInterval', 'sectorSize',
  'watchDist', 'warnDist', 'dangerDist', 'criticalDist']);
const REAL_REQUIRED_KEYS = ['units', 'earth_radius', 'dt', 'sector_size',
  'warn_dist', 'danger_dist', 'critical_dist'];

// The ONE live config object. The renderer and the panels read only from here.
// The loading pipeline builds a fresh copy and swaps it in only on success.
const config = { ...CLASSIC_DEFAULTS, fromFile: false };

// Weights of AVL_Tree.h getSectorKey(): bx*1000000 + by*1000 + bz.
// Used only to MATCH a classic key against debris positions.
const CLASSIC_KEY_WEIGHTS = Object.freeze({ x: 1000000, y: 1000, z: 1 });

// Interface settings (not simulation values).
const UI = Object.freeze({
  speeds: [0.1, 0.25, 0.5, 1, 2, 4, 8, 32], // multiples of the 1× rate (keys 1–8)
  defaultSpeedIndex: { classic: 3, real: 3 },  // start at 1× (index of 1 in speeds)
  orbitSecondsAt1x: 150,                    // at 1× a typical satellite takes ~2½ minutes per orbit
  pathPoints: 360,                          // points per dotted orbit path
  pathBudget: 60000,                        // most path points projected per frame, shared by all satellites
  trailFrames: 40,                          // trail length in written frames
  feedLimit: 150,                           // newest events rendered in the feed
  tableLimit: 200,                          // raw-data rows rendered
  logLimit: 400,                            // raw log lines rendered
  sheetEventLimit: 60,
  pulseMs: 900,                             // evasive-burn pulse duration
  chunkRows: 25000,                         // telemetry rows parsed per chunk
  panelRefreshMs: 80,                       // DOM panels refresh at most ~12×/s
  busyPanelMs: 250,                         // while playing, the events list and raw table at most 4×/s
  followWatchMultiple: 12,                  // follow camera: 12 × watch_dist ...
  followSectorMultiple: 4,                  // ... or 4 × sector_size, whichever is larger
  stars: 900,
  minFps: 40,                               // below this for 2 s of playback → solid panels instead of live blur
  heavyObjects: 1500,                       // runs with more objects than this start with solid panels
  compactRoster: 150,                       // with more satellites, roster cards shrink to one line
  maxGlows: 0,                              // no glow halos around satellites (flat style); >0 brings them back
  maxTrails: 60,                            // with more satellites, only the selected one gets a trail
});

// Starting settings for browser runs (the New run form copies these; formerly the two demos). The demo generator (section 13) is a small
// JavaScript port of orbital.cpp that writes the same four files. These play
// the role of the C++ program's own constants; the viewer still reads every
// value back from the generated run_info.txt like any other run.
// Differences from orbital.cpp are deliberate and marked "demo".
const RUN_PRESETS = Object.freeze({
  classic: {
    seed: 20260917,
    runInfo: {
      mode: 'classic', units: CLASSIC_DEFAULTS.units, earth_radius: CLASSIC_DEFAULTS.earthRadius,
      dt: 1, write_interval: 1, sector_size: CLASSIC_DEFAULTS.sectorSize,
      watch_dist: CLASSIC_DEFAULTS.watchDist, warn_dist: CLASSIC_DEFAULTS.warnDist,
      danger_dist: CLASSIC_DEFAULTS.dangerDist, critical_dist: CLASSIC_DEFAULTS.criticalDist,
    },
    ticks: 240,
    gravity: 'classic', classicK: 6.5 * 6.5,    // orbital.cpp: accel = 6.5² / r
    keyStyle: 'classic',
    chaosEvery: 1, spawnSpread: 45, fragmentChance: 0, fragmentSpread: 0,
    repairTicks: 20, debrisPerSat: 5, debrisSpread: 60, debrisRelSpeed: 0.35,
    catalogDebris: 0, decay: [],
    batteryDrain: 0.02, fuelDrain: 0.01, burnDv: 0.08, burnCooldown: 0,
    freezeWhenDisabled: true,                   // as orbital.cpp: no motion while under repair
    satSource: 'synthetic', catalogSource: 'synthetic', validationStep: 0,
    sats: [
      { name: 'CommSat-1', cls: 'Communication' },
      { name: 'ImageSat-2', cls: 'Imaging' },
      { name: 'CommSat-3', cls: 'Communication' },
      { name: 'ImageSat-4', cls: 'Imaging' },
    ],
  },
  real: {
    seed: 20261028,
    runInfo: {
      mode: 'real', units: 'km', earth_radius: 6371, dt: 1, write_interval: 10, sector_size: 10,
      watch_dist: 10, warn_dist: 10, danger_dist: 5, critical_dist: 2,
      data_source: 'CelesTrak GP', snapshot_date: '2026-10-28',
    },
    ticks: 6000,                                 // ≈ 1 orbit at 400–1000 km altitude
    gravity: 'newton', mu: 398600.4418,          // km³/s²
    keyStyle: 'indexed',
    chaosEvery: 30, spawnSpread: 45, fragmentChance: 0.45, fragmentSpread: 3,
    repairTicks: 300, debrisPerSat: 2, debrisSpread: 40, debrisRelSpeed: 0.05,
    catalogDebris: 36, decay: [{ tick: 2400, count: 2 }, { tick: 4200, count: 2 }],
    batteryDrain: 0.004, fuelDrain: 0.001,
    burnDv: 0.01, burnCooldown: 60,              // demo: 10 m/s, one burn per minute
    freezeWhenDisabled: false,                   // demo: a satellite under repair keeps orbiting
    satSource: 'real', catalogSource: 'real', validationStep: 60,
    syntheticNearReal: true,                     // demo: invent debris near its "real" satellites to show alerts
    sats: [
      { name: 'COMM-A53', cls: 'Communication', alt: 550, inc: 53.0, raan: 15, u: 0 },
      { name: 'IMG-B97', cls: 'Imaging', alt: 705, inc: 97.4, raan: 40, u: 35 },
      { name: 'COMM-C86', cls: 'Communication', alt: 780, inc: 86.4, raan: 125, u: 200 },
      { name: 'IMG-D52', cls: 'Imaging', alt: 420, inc: 51.6, raan: 210, u: 300 },
      { name: 'COMM-E28', cls: 'Communication', alt: 1000, inc: 28.5, raan: 300, u: 120 },
    ],
  },
});

const RISK_NAMES = ['SAFE', 'WARNING', 'DANGER', 'CRITICAL'];
const RISK_VARS = ['--safe', '--warning', '--danger', '--critical'];

// Every blackbox tag we recognise: its filter category and colour token.
const TAGS = Object.freeze({
  'CHAOS':               { cat: 'chaos',     colour: '--tag-chaos' },
  'WARNING':             { cat: 'collision', colour: '--warning', alert: true, risk: 1 },
  'COLLISION ALERT':     { cat: 'collision', colour: '--danger',  alert: true },
  'SAT-WARNING':         { cat: 'collision', colour: '--warning', alert: true, risk: 1 },
  'SAT-COLLISION ALERT': { cat: 'collision', colour: '--danger',  alert: true },
  'DECISION':            { cat: 'collision', colour: '--tag-decision' },
  'DISPATCH':            { cat: 'repair',    colour: '--tag-repair' },
  'REPAIR':              { cat: 'repair',    colour: '--safe' },
  'PATCH':               { cat: 'health',    colour: '--tag-health' },
  'HEALTH':              { cat: 'health',    colour: '--tag-health' },
  'RED ZONE DECLARED':   { cat: 'redzone',   colour: '--critical' },
  'RED ZONE ALERT':      { cat: 'redzone',   colour: '--danger' },
  'RED ZONE AVOIDANCE':  { cat: 'redzone',   colour: '--warning' },
});

// CSS tokens the canvas needs (read once from :root at start-up).
const COLOUR_TOKENS = ['--text', '--text-dim', '--safe', '--warning', '--danger', '--critical',
  '--comm', '--imaging', '--sat-neutral', '--debris-real', '--debris-synthetic',
  '--tag-decision', '--accent', '--text-faint'];

const TAU = Math.PI * 2;
const EARTH_ROTATION_RATE = 7.2921159e-5;   // rad per second: one turn per sidereal day


/* --------------------------------------------------------------------------
   2. SMALL HELPERS
   -------------------------------------------------------------------------- */

// An error caused by the input files. Its message is shown to the user as is.
class DataError extends Error {}

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "1234.5678" → "1234.57"; non-numbers become an en dash.
function fmt2(n) { return Number.isFinite(n) ? n.toFixed(2) : '–'; }

// A distance with the unit from run_info ("units" or "km").
function fmtDist(n) { return Number.isFinite(n) ? `${n.toFixed(2)} ${config.units}` : '–'; }

// Simulated seconds → "hh:mm:ss".
function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Binary search: number of entries in a sorted array that are <= value.
function upperBound(arr, value) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= value) lo = mid + 1; else hi = mid; }
  return lo;
}
// Binary search: number of entries in a sorted array that are < value.
function lowerBound(arr, value) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
}

// Let the browser paint between chunks of heavy work.
function yieldToBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }

// Risk class from the run_info thresholds: 0 SAFE, 1 WARNING, 2 DANGER, 3 CRITICAL.
function riskOf(distance, cfg) {
  if (distance >= cfg.warnDist) return 0;
  if (distance >= cfg.dangerDist) return 1;
  if (distance >= cfg.criticalDist) return 2;
  return 3;
}

// Small seeded random generator, so the demos are identical every time.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "#4fd8f5" + 0.3 → "rgba(79,216,245,0.3)"
function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Split one CSV line. Fast path when there are no quotes (the normal case).
function splitCsvLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Text → number, but blank text becomes NaN (Number('') would give 0).
function toNum(s) {
  if (s === undefined || s === null) return NaN;
  const t = String(s).trim();
  return t === '' ? NaN : Number(t);
}


/* --------------------------------------------------------------------------
   3. APPLICATION STATE
   -------------------------------------------------------------------------- */

const state = {
  run: null,                // everything parsed and derived for the loaded run
  sources: {},              // { telemetry, blackbox, runinfo, validation } → { name, text }
  origin: 'files',          // 'files' | 'custom' (browser simulation from the New run form)
  pipelineGen: 0,           // increases on every load; an older load stops itself
  playTick: 0,              // current time in ticks (fractional between frames)
  playing: false,
  speedIndex: 3,
  frameIdx: 0,              // last written frame at or before playTick
  eventIdx: 0,              // number of events with tick <= playTick
  selected: null,           // { kind: 'sat', sat: trackIndex } | { kind: 'debris', idKey }
  feedFilters: { collision: true, health: true, chaos: true, redzone: true, repair: true },
  dockTab: 'timeline',
  rawView: 'telemetry',
  rawFilter: 'all',
  rawSearch: '',
  reducedMotion: false,
  panelsHidden: false,
};

// Bookkeeping for the throttled DOM refresh.
const ui = { dirty: true, feedDirty: true, lastFrame: -1, lastEvent: -1, lastRefresh: 0,
  scrubbing: false, dragging: false, clockText: '', rateText: '', scrollRawToSelection: false, scrubW: 0, loadedAt: 0 };

let dom = {};               // element references, filled by cacheDom()
const colours = {};         // CSS colour tokens, filled by readColours()
const glowSprites = new Map();
