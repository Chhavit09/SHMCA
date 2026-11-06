'use strict';
/*
   Copyright (c) 2026 Chhavit (@Chhavit09), Harsh Jain (@harshj1214-hj), Satyam Kumar (@kr-Satyam09), and Sudhanshu Ojha (@sudhanshuOjha07)
   All Rights Reserved. Proprietary and confidential: see LICENSE.txt for the terms.
*/
/* ORBITAL website – js/data.js. Data: reading files, parsing telemetry.csv / blackbox.txt / run_info.txt, and the values derived once per run. */

/* --------------------------------------------------------------------------
   4. FILE LOADING  –  button, drag-and-drop, identification
   -------------------------------------------------------------------------- */

// Read a File/Blob as text with FileReader (fetch() does not work on file://).
function readFileText(blob, name, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new DataError(readErrorMessage(reader.error, name)));
    reader.onabort = () => reject(new DataError(`Reading ${name} was interrupted. Load it again.`));
    if (onProgress) reader.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    reader.readAsText(blob);
  });
}

// Turn the browser's read error into a cause and a fix. The browser only says *that*
// it failed, so each message names the likely reasons for that error type.
function readErrorMessage(error, name) {
  const kind = error && error.name;
  if (kind === 'NotReadableError') {
    return `Could not read ${name}: the file changed or was locked after you chose it. ` +
      'If orbital.cpp is still running, wait until it finishes (it asks “Do you want to search for a satellite’s final status?”). ' +
      'Close the file in Excel or any other program, then load it again.';
  }
  if (kind === 'NotFoundError') return `Could not read ${name}: it was moved, renamed or deleted after you chose it. Choose it again.`;
  if (kind === 'SecurityError') {
    return `The browser blocked reading ${name}. If it is in a cloud folder (OneDrive “online-only”, Google Drive), ` +
      'copy it to a normal local folder such as Desktop and load it again.';
  }
  return `Could not read ${name}${kind ? ` (${kind})` : ''}. Copy it to a local folder and load it again.`;
}

// Size limits. A browser cannot hold one text string much above ~500 MB, and the
// viewer keeps every row in memory. A big telemetry.csv is therefore read in pieces
// and thinned (readTelemetryThinned); other files above refuseBytes are skipped.
const FILE_LIMITS = Object.freeze({
  refuseBytes: 250e6,     // blackbox / run_info / validation larger than this are skipped
  warnBytes: 80e6,        // say "may take a while" above this
  thinBytes: 120e6,       // telemetry larger than this is read in pieces and thinned
  targetRows: 1000000,    // thinning keeps about this many telemetry rows
  chunkBytes: 16 << 20,   // piece size when reading in pieces
});
// Returns 'ok', or 'skip' for a non-telemetry file too big to load.
function checkFileSize(file, kind) {
  const mb = Math.round(file.size / 1e6).toLocaleString();
  if (file.size === 0) throw new DataError(`${file.name} is empty (0 bytes). If orbital.cpp is still running, wait for it to finish.`);
  if (kind !== 'telemetry' && file.size > FILE_LIMITS.refuseBytes) {
    notify(`${file.name} is ${mb} MB, too large to load in a browser tab, so it was skipped. The rest of the run is loaded without it.`, 'warn');
    return 'skip';
  }
  if (file.size > FILE_LIMITS.warnBytes) notify(`${file.name} is ${mb} MB: loading may take a while. You can cancel it.`, 'info');
  return 'ok';
}

// Very large telemetry.csv: read it in 16 MB pieces and keep only 1 in every N written
// ticks (plus the last one), with N chosen to keep about FILE_LIMITS.targetRows rows.
// Rows of one tick are written together by orbital.cpp, so whole frames are kept or dropped.
async function readTelemetryThinned(file, onProgress, stale) {
  const piece = async (start, end) => {
    try { return await file.slice(start, end).arrayBuffer(); }
    catch (err) { throw new DataError(readErrorMessage(err, file.name)); }
  };
  const lines = (text) => { const out = text.split('\n'); out.pop(); return out; };   // complete lines only

  // 1. header, average row size and tick spacing from the first MB; last tick from the last MB
  const head = new TextDecoder().decode(await piece(0, Math.min(file.size, 1 << 20)));
  const nl = head.indexOf('\n');
  if (nl < 0) throw new DataError(`${file.name} has no complete header line.`);
  const header = head.slice(0, nl).replace(/\r$/, '').replace(/^\uFEFF/, '');
  const tickCol = splitCsvLine(header).map((h) => h.trim().toLowerCase()).indexOf('tick');
  if (tickCol < 0) throw new DataError(`${file.name} is missing the Tick column. Its header is "${header.slice(0, 100)}".`);
  // read the Tick field of the line text[s..e) without making a substring (digits fast path)
  const tickAt = (text, s, e) => {
    for (let c = 0; c < tickCol; c++) { s = text.indexOf(',', s) + 1; if (s === 0 || s > e) return NaN; }
    let v = 0, i = s, ok = i < e;
    for (; i < e; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 44 || ch === 13) break;                                   // ',' or '\r'
      if (ch < 48 || ch > 57) { ok = false; break; }
      v = v * 10 + (ch - 48);
    }
    if (ok && i > s) return v;
    const comma = text.indexOf(',', s);
    return toNum(text.slice(s, comma < 0 || comma > e ? e : comma));        // decimals, signs; blank → NaN (not 0)
  };
  const sample = lines(head.slice(nl + 1));
  const distinct = (rows) => { const t = []; for (const L of rows) { const v = tickAt(L, 0, L.length); if (Number.isFinite(v) && v !== t[t.length - 1]) t.push(v); } return t; };
  const headTicks = distinct(sample);
  const tail = lines(new TextDecoder().decode(await piece(Math.max(0, file.size - (1 << 20)), file.size)) + '\n');
  const tailTicks = distinct(tail.slice(1));                                 // first tail line may be partial
  if (!headTicks.length || !tailTicks.length) throw new DataError(`${file.name}: could not find tick numbers in its first and last rows.`);
  const firstTick = headTicks[0], lastTick = tailTicks[tailTicks.length - 1];
  const spacing = headTicks.length > 1 ? headTicks[1] - headTicks[0] : tailTicks.length > 1 ? tailTicks[1] - tailTicks[0] : 1;
  const bytesPerRow = sample.length ? sample.reduce((n, L) => n + L.length + 1, 0) / sample.length : 50;
  const estRows = (file.size - nl - 1) / bytesPerRow;
  const every = Math.max(1, Math.ceil(estRows / FILE_LIMITS.targetRows));
  const keep = (t) => t === lastTick || Math.round((t - firstTick) / spacing) % every === 0;

  // 2. stream through the file, keeping whole frames
  const decoder = new TextDecoder();
  const kept = [header];
  let carry = '', pos = 0, totalRows = 0, lastT = NaN, keepCur = false, skipHeader = true;
  const scan = (text, final) => {
    let start = 0;
    if (skipHeader) { start = text.indexOf('\n') + 1; skipHeader = false; if (start === 0) return text; }
    for (;;) {
      let e = text.indexOf('\n', start);
      if (e < 0) { if (!final) break; e = text.length; if (e <= start) break; }
      if (e > start) {
        const t = tickAt(text, start, e);
        totalRows++;
        if (t !== lastT) { lastT = t; keepCur = Number.isFinite(t) && keep(t); }
        if (keepCur) kept.push(text.slice(start, e));
      }
      start = e + 1;
      if (start > text.length) break;
    }
    return final ? '' : text.slice(start);
  };
  while (pos < file.size) {
    if (stale()) return null;
    const end = Math.min(file.size, pos + FILE_LIMITS.chunkBytes);
    const buf = await piece(pos, end);
    if (stale()) return null;                                          // cancelled while reading
    const text = carry + decoder.decode(buf, { stream: end < file.size });
    pos = end;
    carry = scan(text, pos >= file.size);
    onProgress(pos / file.size);
  }
  return {
    name: file.name,
    text: kept.join('\n') + '\n',
    thinned: { every, keptRows: kept.length - 1, totalRows, mb: Math.round(file.size / 1e6) },
  };
}

// Identify a file from its name alone.
function kindFromName(name) {
  const n = name.toLowerCase();
  if (/run[_-]?info/.test(n)) return 'runinfo';
  if (/telemetry/.test(n)) return 'telemetry';
  if (/black[_-]?box/.test(n)) return 'blackbox';
  if (/validation/.test(n)) return 'validation';
  return null;
}

// Identify a file from the start of its contents.
function kindFromSnippet(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  if (/^tick\s*,/i.test(first)) return 'telemetry';
  if (/^elapsed_s\s*,/i.test(first)) return 'validation';
  if (/ORBITAL BLACKBOX/i.test(first) || lines.slice(0, 5).some((l) => /^\[t=/.test(l))) return 'blackbox';
  if (/^[a-z_]+\s*=/i.test(first)) return 'runinfo';
  if (/OBJECT_NAME/i.test(first) && /MEAN_MOTION/i.test(first)) return 'celestrak';       // CelesTrak GP data (CSV)
  if (/OBJECT_NAME/i.test(first) && /NORAD_CAT_ID|OPS_STATUS_CODE/i.test(first)) return 'satcat';
  if (lines.length >= 2 && /^1 [ 0-9]{5}[A-Z ]/.test(lines[1]) || /^1 [ 0-9]{5}[A-Z ]/.test(first)) return 'tle';
  return null;
}

async function identifyFile(file) {
  const byName = kindFromName(file.name);
  if (byName) return byName;
  const head = await readFileText(file.slice(0, 4096), file.name);
  return kindFromSnippet(head);
}

// Entry point for the file button and for drops.
// Replaying files written by orbital.cpp (telemetry.csv, blackbox.txt, run_info.txt,
// validation.csv) is switched off for now: the Load files button and start-screen card
// are removed, and dropped run files are refused with a message. The reading code is
// kept (the browser simulation uses the same formats), so turning this back on means
// setting it to true and restoring the button.
const CPP_REPLAY = false;

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const found = {};
  const skipped = [];
  const celestrak = [];                           // CelesTrak files: several are allowed
  for (const file of files) {
    let kind = null;
    try { kind = await identifyFile(file); } catch (err) { kind = null; }
    if (kind === 'celestrak') celestrak.push(file);
    else if (kind) found[kind] = file; else skipped.push(file.name);
  }
  if (skipped.length) {
    notify(CPP_REPLAY
      ? `Skipped ${skipped.join(', ')}: not recognised as telemetry, blackbox, run_info, validation or CelesTrak data.`
      : `Skipped ${skipped.join(', ')}: not CelesTrak GP data in CSV format.`, 'warn');
  }
  const runFiles = Object.keys(found).filter((k) => k !== 'satcat' && k !== 'tle');
  if (!CPP_REPLAY && runFiles.length) {
    notify(`${runFiles.map((k) => found[k].name).join(', ')}: replaying files written by orbital.cpp is switched off for now. Start a run with New run instead.`, 'info');
    for (const k of runFiles) delete found[k];
  }
  // CelesTrak files are orbits, not a finished run: they go into the New run form.
  if (found.satcat) {
    notify(`${found.satcat.name} looks like the CelesTrak satellite catalogue (SATCAT), which has no orbits. Download “GP data” in CSV format instead.`, 'warn');
    delete found.satcat;
  }
  if (found.tle) {
    notify(`${found.tle.name} is in TLE format. Download the same group from CelesTrak in CSV format (FORMAT=csv) and load that.`, 'warn');
    delete found.tle;
  }
  if (celestrak.length) {
    if (Object.keys(found).length) {
      notify(`${celestrak.map((f) => f.name).join(', ')}: CelesTrak orbits, not run output. Load them on their own, or add them in New run → Real data.`, 'info');
    } else {
      openRunForm('real');
      await addRealFiles(null, celestrak);     // each file goes to Satellite or Debris files by its names
      return;
    }
  }
  if (!Object.keys(found).length) return;

  const texts = {};
  try {
    for (const [kind, file] of Object.entries(found)) if (checkFileSize(file, kind) === 'skip') delete found[kind];
    const gen = state.pipelineGen;                         // the loading Cancel button bumps this
    const stale = () => gen !== state.pipelineGen;
    for (const [kind, file] of Object.entries(found)) {
      if (kind === 'telemetry' && file.size > FILE_LIMITS.thinBytes) {
        texts[kind] = await readTelemetryThinned(file, (p) => { if (!stale()) showLoading(`Reading ${file.name} in pieces`, p); }, stale);
        if (!texts[kind]) return;                          // cancelled
        continue;
      }
      showLoading(`Reading ${file.name}`, 0);
      texts[kind] = { name: file.name, text: await readFileText(file, file.name, (p) => { if (!stale()) showLoading(`Reading ${file.name}`, p); }) };
      if (stale()) return;
    }
  } catch (err) {
    hideLoading();
    notify(err.message, 'error');
    return;
  }

  // A drop that includes telemetry starts a new run. A drop without it adds
  // files (e.g. a forgotten blackbox.txt) to the run already on screen.
  const sources = texts.telemetry || state.origin !== 'files' ? texts : { ...state.sources, ...texts };
  if (!sources.telemetry) {
    hideLoading();
    state.sources = sources;
    notify('Add telemetry.csv as well – it holds the positions the scene needs.', 'warn');
    return;
  }
  await runPipeline(sources, 'files');
}

// load → config → parse → index → derive → install. Errors never leave a half-loaded run.
// `input` is either the file texts, or a function that produces them (a browser simulation).
async function runPipeline(input, origin) {
  const gen = ++state.pipelineGen;
  const stale = () => gen !== state.pipelineGen;
  const notes = [];
  try {
    const sources = typeof input === 'function' ? await input(stale) : input;
    if (!sources || stale()) return;
    showLoading('Reading run settings', 0);
    const cfg = buildConfig(sources.runinfo, notes);
    if (origin === 'custom' && cfg.dataSource === 'CelesTrak GP') {
      notes.push({ level: 'info', text: 'Starting orbits are real CelesTrak data, converted with two-body formulas plus Earth-flattening drift (not SGP4), so they can be several km off at the start. The browser then simulates with GM/r² gravity, not your C++.' });
    }
    const th = sources.telemetry.thinned;
    if (th && th.every > 1) {
      notes.push({ level: 'warn', text: `${sources.telemetry.name} is ${th.mb.toLocaleString()} MB (${th.totalRows.toLocaleString()} rows), so 1 in every ${th.every} written ticks was loaded (${th.keptRows.toLocaleString()} rows). Positions between loaded ticks are interpolated, so close approaches between them are not drawn; the event log still lists every alert.` });
    }

    const tele = await parseTelemetry(sources.telemetry.text, sources.telemetry.name,
      (p) => showLoading(`Parsing ${sources.telemetry.name}`, p), stale);
    if (!tele) return;

    showLoading('Reading the event log', 1);
    await yieldToBrowser();
    const log = sources.blackbox ? parseBlackbox(sources.blackbox.text) : null;
    const validation = sources.validation ? parseValidation(sources.validation.text, sources.validation.name, notes) : null;

    const run = await deriveRun(cfg, tele, log, validation, notes,
      (p) => showLoading('Computing distances and risk', p), stale);
    if (!run) return;

    // Success: swap the new config and run in together.
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, cfg);
    state.sources = sources;
    state.origin = origin;
    state.run = run;
    run.fileNames = Object.values(sources).map((s) => s.name);
    installRun();
    hideLoading();
    reportLoad(run, notes, origin);
  } catch (err) {
    if (stale()) return;
    hideLoading();
    if (err instanceof DataError) notify(err.message, 'error');
    else { console.error(err); notify(`Unexpected error while loading: ${err.message}`, 'error'); }
  }
}


/* --------------------------------------------------------------------------
   5. PARSERS
   -------------------------------------------------------------------------- */

// run_info.txt → config. Missing file → classic defaults with a notice.
function buildConfig(src, notes) {
  const cfg = { ...CLASSIC_DEFAULTS, fromFile: false };
  if (!src) {
    const d = CLASSIC_DEFAULTS;
    notes.push({ level: 'info', text: `run_info.txt not loaded, so this is treated as a CLASSIC run with the classic defaults (Earth radius ${d.earthRadius}, sector ${d.sectorSize}, thresholds ${d.watchDist}/${d.warnDist}/${d.dangerDist}/${d.criticalDist}).` });
    return cfg;
  }
  const seen = {};
  const unknown = [];
  src.text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 1) return;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (key in RUN_INFO_KEYS) seen[key] = value; else unknown.push(key);
  });

  if ('mode' in seen) {
    const m = seen.mode.toLowerCase();
    if (m !== 'classic' && m !== 'real') throw new DataError(`run_info.txt: mode must be "classic" or "real", but it says "${seen.mode}".`);
    cfg.mode = m;
  } else {
    notes.push({ level: 'warn', text: 'run_info.txt has no mode= line, so the run is treated as classic.' });
  }

  if (cfg.mode === 'real') {
    if (!seen.units) throw new DataError('run_info.txt says mode=real but units are missing.');
    const missing = REAL_REQUIRED_KEYS.filter((k) => !seen[k]);
    if (missing.length) throw new DataError(`run_info.txt says mode=real but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing.`);
  }

  for (const [key, value] of Object.entries(seen)) {
    const prop = RUN_INFO_KEYS[key];
    if (prop === 'mode' || value === '') continue;
    if (NUMERIC_PROPS.has(prop)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new DataError(`run_info.txt: ${key} must be a positive number, but it is "${value}".`);
      cfg[prop] = n;
    } else {
      cfg[prop] = value;
    }
  }
  if (!seen.watch_dist && seen.warn_dist) {
    cfg.watchDist = cfg.warnDist;
    notes.push({ level: 'info', text: 'run_info.txt has no watch_dist, so watch_dist = warn_dist.' });
  }
  if (!(cfg.warnDist >= cfg.dangerDist && cfg.dangerDist >= cfg.criticalDist)) {
    throw new DataError(`run_info.txt: thresholds must satisfy warn_dist ≥ danger_dist ≥ critical_dist (got ${cfg.warnDist}, ${cfg.dangerDist}, ${cfg.criticalDist}).`);
  }
  if (cfg.mode === 'classic') {
    const usedDefaults = ['earth_radius', 'sector_size', 'warn_dist', 'danger_dist', 'critical_dist'].filter((k) => !seen[k]);
    if (usedDefaults.length) notes.push({ level: 'info', text: `run_info.txt has no ${usedDefaults.join(', ')}; classic defaults are used for them.` });
  }
  if (cfg.mode === 'real' && !cfg.snapshotDate) notes.push({ level: 'warn', text: 'run_info.txt has no snapshot_date, so the badge cannot show it.' });
  if (unknown.length) notes.push({ level: 'info', text: `run_info.txt keys ignored: ${unknown.join(', ')}.` });
  cfg.fromFile = true;
  return cfg;
}

function normClass(s) {
  const t = (s || '').trim();
  if (!t) return null;
  if (/^comm/i.test(t)) return 'Communication';
  if (/^imag/i.test(t)) return 'Imaging';
  return t;
}
function normSource(s) { return /^real$/i.test((s || '').trim()) ? 'real' : 'synthetic'; }
function parseDisabled(s) {
  const t = (s || '').trim().toLowerCase();
  if (t === '1' || t === 'true' || t === 'yes') return true;
  if (t === '0' || t === 'false' || t === 'no') return false;
  return null;
}

// telemetry.csv → frames. Parsed in chunks so a 500,000-row file stays responsive.
async function parseTelemetry(text, fileName, onProgress, stale) {
  const firstNl = text.indexOf('\n');
  const header = (firstNl === -1 ? text : text.slice(0, firstNl)).replace(/^\uFEFF/, '').replace(/\r$/, '');
  const names = splitCsvLine(header).map((h) => h.trim().toLowerCase());
  const col = (name) => names.indexOf(name.toLowerCase());

  for (const required of ['Tick', 'Type', 'ID_or_Name', 'X', 'Y', 'Z']) {
    if (col(required) === -1) {
      throw new DataError(`${fileName} is missing the ${required} column. Its header is "${header.slice(0, 100)}".`);
    }
  }
  const c = {
    tick: col('Tick'), type: col('Type'), id: col('ID_or_Name'), x: col('X'), y: col('Y'), z: col('Z'),
    cls: col('Class'), src: col('Source'), battery: col('Battery'), fuel: col('Fuel'),
    software: col('Software'), disabled: col('Disabled'),
  };
  const cols = {
    cls: c.cls >= 0, src: c.src >= 0, battery: c.battery >= 0, fuel: c.fuel >= 0,
    software: c.software >= 0, disabled: c.disabled >= 0,
  };
  const optNum = (f, i) => (i < 0 ? null : (Number.isFinite(toNum(f[i])) ? toNum(f[i]) : null));

  const frameMap = new Map();   // tick → frame
  const nameCache = new Map();  // one shared string per satellite name
  let rows = 0, bad = 0, dupes = 0;
  let pos = firstNl === -1 ? text.length : firstNl + 1;
  const len = text.length;

  while (pos < len) {
    for (let n = 0; n < UI.chunkRows && pos < len; n++) {
      let end = text.indexOf('\n', pos);
      if (end === -1) end = len;
      let line = text.substring(pos, end);
      pos = end + 1;
      if (line.length && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      if (!line.trim()) continue;

      const f = splitCsvLine(line);
      const tick = toNum(f[c.tick]), x = toNum(f[c.x]), y = toNum(f[c.y]), z = toNum(f[c.z]);
      const type = (f[c.type] || '').trim().toLowerCase();
      const idRaw = (f[c.id] || '').trim();
      const isSat = type.startsWith('sat');
      const isDebris = type.startsWith('deb');
      if (!Number.isFinite(tick) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
          (!isSat && !isDebris) || !idRaw) { bad++; continue; }

      let frame = frameMap.get(tick);
      if (!frame) {
        frame = { tick, sats: [], debris: [], satIndex: new Map(), debIndex: new Map(), realDebris: 0, synthDebris: 0 };
        frameMap.set(tick, frame);
      }
      const src = cols.src ? normSource(f[c.src]) : 'synthetic';
      let obj, list, index, key;
      if (isSat) {
        let name = nameCache.get(idRaw);
        if (!name) { name = idRaw; nameCache.set(name, name); }
        obj = {
          kind: 'sat', name, cls: cols.cls ? normClass(f[c.cls]) : null, src, x, y, z,
          battery: optNum(f, c.battery), fuel: optNum(f, c.fuel), software: optNum(f, c.software),
          disabled: cols.disabled ? parseDisabled(f[c.disabled]) : null,
          next: -1, ti: -1, nearDeb: Infinity, nearDebIdx: -1, nearSat: Infinity, nearSatIdx: -1, risk: 0,
        };
        list = frame.sats; index = frame.satIndex; key = name;
      } else {
        const idNum = Number(idRaw);
        obj = {
          kind: 'debris', id: Number.isFinite(idNum) ? idNum : idRaw, idKey: idRaw, src, x, y, z,
          next: -1, nearSat: Infinity, nearSatIdx: -1, risk: -1,
        };
        list = frame.debris; index = frame.debIndex; key = idRaw;
      }
      const prev = index.get(key);
      if (prev !== undefined) { list[prev] = obj; dupes++; }
      else { index.set(key, list.length); list.push(obj); }
      rows++;
    }
    onProgress(pos / len);
    await yieldToBrowser();
    if (stale()) return null;
  }
  if (!rows) throw new DataError(`${fileName} has a header but no usable data rows${bad ? ` (${bad} malformed rows skipped)` : ''}.`);

  const frames = Array.from(frameMap.values()).sort((a, b) => a.tick - b.tick);
  return { frames, cols, rows, bad, dupes, fileName };
}

// One blackbox line: "[t=37s] [TAG] free text"
const EVENT_LINE = /^\s*\[t=\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*s?\s*\]\s*\[([^\]]+)\]\s*(.*)$/i;

// blackbox.txt → list of raw events. Unknown or broken lines are counted, never fatal.
function parseBlackbox(text) {
  // orbital.cpp writes "----- END OF LOG -----" only after the last tick, so a missing
  // line means the program was still running (or crashed) when the file was copied.
  const finished = /-{3,}\s*END OF LOG\s*-{3,}/i.test(text.slice(-200));
  const events = [];
  let ignored = 0, lineNo = 0;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    lineNo++;
    try {
      const line = raw.trim();
      if (!line || /^-{3,}/.test(line)) continue;      // header / END OF LOG lines
      const m = EVENT_LINE.exec(line);
      if (!m) { ignored++; continue; }
      const t = Number(m[1]);
      const tag = m[2].trim().toUpperCase().replace(/\s+/g, ' ');
      if (!Number.isFinite(t) || !TAGS[tag]) { ignored++; continue; }
      events.push({ t, tag, text: m[3].trim(), raw: line, lineNo });
    } catch (err) {
      ignored++;
    }
  }
  return { events, ignored, lineCount: lineNo, finished };
}

// validation.csv → one series per satellite. Problems become notices, not errors.
function parseValidation(text, fileName, notes) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const names = splitCsvLine(lines[0] || '').map((h) => h.trim().toLowerCase());
  const ci = { t: names.indexOf('elapsed_s'), sat: names.indexOf('satellite'), err: names.indexOf('error_km') };
  if (ci.t < 0 || ci.sat < 0 || ci.err < 0) {
    notes.push({ level: 'warn', text: `${fileName} ignored: its header must contain Elapsed_s, Satellite and Error_km.` });
    return null;
  }
  const bySat = new Map();
  let bad = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = splitCsvLine(lines[i]);
    const t = toNum(f[ci.t]), e = toNum(f[ci.err]), sat = (f[ci.sat] || '').trim();
    if (!Number.isFinite(t) || !Number.isFinite(e) || !sat) { bad++; continue; }
    if (!bySat.has(sat)) bySat.set(sat, []);
    bySat.get(sat).push([t, e]);
  }
  if (!bySat.size) { notes.push({ level: 'warn', text: `${fileName} has no usable rows.` }); return null; }
  let maxT = 0, maxE = 0;
  const series = [];
  for (const [sat, pts] of bySat) {
    pts.sort((a, b) => a[0] - b[0]);
    const xs = Float64Array.from(pts, (p) => p[0]);
    const ys = Float64Array.from(pts, (p) => p[1]);
    for (let i = 0; i < xs.length; i++) { if (xs[i] > maxT) maxT = xs[i]; if (ys[i] > maxE) maxE = ys[i]; }
    series.push({ sat, xs, ys });
  }
  if (bad) notes.push({ level: 'info', text: `${fileName}: ${bad} malformed rows skipped.` });
  return { series, maxT, maxE };
}


/* --------------------------------------------------------------------------
   6. DERIVED DATA  –  computed once after loading, never per frame
   -------------------------------------------------------------------------- */

// Nearest debris / nearest satellite for every object in one frame (brute force:
// a frame has at most a few satellites, so this is satellites × debris).
function computeNearest(frame, cfg) {
  const S = frame.sats, D = frame.debris;
  for (let b = 0; b < D.length; b++) { D[b].nearSat = Infinity; D[b].nearSatIdx = -1; }
  for (let a = 0; a < S.length; a++) {
    const s = S[a];
    let best = Infinity, bestIdx = -1;
    for (let b = 0; b < D.length; b++) {
      const d = D[b];
      const dx = d.x - s.x, dy = d.y - s.y, dz = d.z - s.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < best) { best = dist; bestIdx = b; }
      if (dist < d.nearSat) { d.nearSat = dist; d.nearSatIdx = a; }
    }
    s.nearDeb = best; s.nearDebIdx = bestIdx;
    s.risk = Number.isFinite(best) ? riskOf(best, cfg) : 0;
    let bestSat = Infinity, bestSatIdx = -1;
    for (let b = 0; b < S.length; b++) {
      if (b === a) continue;
      const o = S[b];
      const dx = o.x - s.x, dy = o.y - s.y, dz = o.z - s.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < bestSat) { bestSat = dist; bestSatIdx = b; }
    }
    s.nearSat = bestSat; s.nearSatIdx = bestSatIdx;
  }
  // Debris is tinted only when a satellite is inside watch_dist.
  for (let b = 0; b < D.length; b++) {
    const d = D[b];
    d.risk = d.nearSat < cfg.watchDist ? riskOf(d.nearSat, cfg) : -1;
  }
}

// Find which satellite an event line is about.
function findSatName(ev, knownNames) {
  const words = ev.text.split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/^[(\[]+|[).,:;\]]+$/g, '');
    if (knownNames.has(clean)) return clean;
  }
  if (ev.tag === 'CHAOS') {
    const m = /\b(?:on|in|near)\s+([^\s.,:;]+)/.exec(ev.text);
    return m ? m[1] : null;
  }
  const first = (words[0] || '').replace(/[.,:;]+$/, '');
  return first && !first.startsWith('#') && !first.includes('=') ? first : null;
}

// Place a red zone from a classic log that has only "sector=KEY": search the
// debris positions (starting at the declaration frame and moving outward)
// for one whose classic key equals KEY. The key itself is never decoded.
function cornerFromClassicKey(keyText, tick, frames, ticks, cfg) {
  const key = Number(keyText);
  if (!Number.isFinite(key)) return null;
  const S = cfg.sectorSize, W = CLASSIC_KEY_WEIGHTS;
  const start = clamp(upperBound(ticks, tick) - 1, 0, frames.length - 1);
  const test = (i) => {
    const debris = frames[i].debris;
    for (let k = 0; k < debris.length; k++) {
      const d = debris[k];
      const bx = Math.floor(d.x / S), by = Math.floor(d.y / S), bz = Math.floor(d.z / S);
      if (bx * W.x + by * W.y + bz * W.z === key) return [bx * S, by * S, bz * S];
    }
    return null;
  };
  for (let off = 0; off < frames.length; off++) {
    const a = start + off, b = start - off;
    if (a >= frames.length && b < 0) break;
    if (a < frames.length) { const r = test(a); if (r) return r; }
    if (off > 0 && b >= 0) { const r = test(b); if (r) return r; }
  }
  return null;
}

// Turn raw events into the run's event list plus counters, repairs, zones and burns.
function deriveEvents(log, cfg, frames, ticks, sats, satIndex, notes) {
  const list = [];
  let unknownSat = 0;
  for (const raw of log.events) {
    const info = TAGS[raw.tag];
    const exact = raw.t / cfg.dt;
    const rounded = Math.round(exact);
    const tick = Math.abs(exact - rounded) < 1e-6 * Math.max(1, Math.abs(exact)) ? rounded : exact;
    const sat = findSatName(raw, satIndex);
    const satIdx = sat !== null && satIndex.has(sat) ? satIndex.get(sat) : -1;
    if (sat !== null && satIdx < 0) unknownSat++;
    const ev = {
      tick, t: raw.t, tag: raw.tag, cat: info.cat, text: raw.text, raw: raw.raw, lineNo: raw.lineNo,
      sat, satIdx, risk: info.risk ?? -1, alert: !!info.alert,
      burn: false, dispatch: false, repair: false, zone: null,
    };
    if (raw.tag === 'COLLISION ALERT' || raw.tag === 'SAT-COLLISION ALERT') {
      const m = /risk=([A-Z]+)/i.exec(raw.text);
      const r = m ? RISK_NAMES.indexOf(m[1].toUpperCase()) : -1;
      ev.risk = r > 0 ? r : 2;
    } else if (raw.tag === 'DECISION') {
      ev.burn = /evasive burn/i.test(raw.text);
    } else if (raw.tag === 'DISPATCH') {
      ev.dispatch = /needs repair/i.test(raw.text);
    } else if (raw.tag === 'REPAIR') {
      ev.repair = /repaired/i.test(raw.text);
    } else if (raw.tag === 'RED ZONE DECLARED') {
      const key = /sector=\s*([^\s]+)/i.exec(raw.text);
      const count = /debrisCount=\s*(\d+)/i.exec(raw.text);
      const bx = /\bbx=\s*(-?\d+)/i.exec(raw.text), by = /\bby=\s*(-?\d+)/i.exec(raw.text), bz = /\bbz=\s*(-?\d+)/i.exec(raw.text);
      if (key) {
        ev.zone = {
          key: key[1], count: count ? Number(count[1]) : null,
          idx: bx && by && bz ? [Number(bx[1]), Number(by[1]), Number(bz[1])] : null,
        };
      }
    }
    list.push(ev);
  }
  list.sort((a, b) => a.tick - b.tick || a.lineNo - b.lineNo);

  // Prefix sums: counter value "so far" = prefix[eventIdx] (one array read per frame).
  const n = list.length;
  const eventTicks = new Float64Array(n);
  const alertsPrefix = new Int32Array(n + 1), burnsPrefix = new Int32Array(n + 1);
  const dispatchPrefix = new Int32Array(n + 1), zonesPrefix = new Int32Array(n + 1);
  const zones = [], zoneKeys = new Set();
  const burnTicks = [], burnSat = [], burnEv = [];
  const openRepair = new Map();
  let unplaced = 0;

  for (let i = 0; i < n; i++) {
    const e = list[i];
    eventTicks[i] = e.tick;
    alertsPrefix[i + 1] = alertsPrefix[i] + (e.alert ? 1 : 0);
    burnsPrefix[i + 1] = burnsPrefix[i] + (e.burn ? 1 : 0);
    dispatchPrefix[i + 1] = dispatchPrefix[i] + (e.dispatch ? 1 : 0);
    let newZone = 0;
    if (e.zone && !zoneKeys.has(e.zone.key)) {
      zoneKeys.add(e.zone.key);
      newZone = 1;
      const S = cfg.sectorSize;
      const corner = e.zone.idx
        ? [e.zone.idx[0] * S, e.zone.idx[1] * S, e.zone.idx[2] * S]       // bx/by/bz given: draw directly
        : cornerFromClassicKey(e.zone.key, e.tick, frames, ticks, cfg);   // classic log: match keys
      if (!corner) unplaced++;
      zones.push({ tick: e.tick, sat: e.sat, satIdx: e.satIdx, key: e.zone.key, count: e.zone.count, corner, eventIndex: i });
    }
    zonesPrefix[i + 1] = zonesPrefix[i] + newZone;

    if (e.satIdx >= 0) {
      const track = sats[e.satIdx];
      track.events.push(i);
      if (e.burn) { burnTicks.push(e.tick); burnSat.push(e.satIdx); burnEv.push(i); }
      if (e.dispatch && !openRepair.has(e.satIdx)) openRepair.set(e.satIdx, e.tick);
      if (e.repair && openRepair.has(e.satIdx)) {
        track.repairs.push([openRepair.get(e.satIdx), e.tick]);
        openRepair.delete(e.satIdx);
      }
    }
  }
  for (const [satIdx, start] of openRepair) sats[satIdx].repairs.push([start, Infinity]);
  for (const s of sats) s.events = Int32Array.from(s.events);

  if (unknownSat) notes.push({ level: 'info', text: `${unknownSat} event lines name satellites that are not in telemetry.csv.` });
  if (unplaced) notes.push({ level: 'warn', text: `${unplaced} red zone${unplaced > 1 ? 's' : ''} could not be drawn: no debris position matches the sector key, and the log has no bx/by/bz.` });

  return {
    events: list, eventTicks, alertsPrefix, burnsPrefix, dispatchPrefix, zonesPrefix, zones,
    burnTicks: Float64Array.from(burnTicks), burnSat: Int32Array.from(burnSat), burnEv: Int32Array.from(burnEv),
  };
}

// Everything the viewer needs, computed once.
async function deriveRun(cfg, tele, log, validation, notes, onProgress, stale) {
  const frames = tele.frames;
  const n = frames.length;
  const ticks = Float64Array.from(frames, (f) => f.tick);

  // (a) satellite registry: one "track" per satellite name
  const sats = [];
  const satIndex = new Map();
  for (const fr of frames) {
    for (const s of fr.sats) {
      let t = satIndex.get(s.name);
      if (t === undefined) {
        t = sats.length;
        satIndex.set(s.name, t);
        sats.push({
          name: s.name, cls: s.cls, src: s.src,
          idx: new Int32Array(n).fill(-1),        // index of this satellite inside each frame
          earth: new Float32Array(n).fill(NaN),   // distance to Earth's centre per frame
          nearDeb: new Float32Array(n).fill(NaN), // nearest-debris distance per frame
          events: [], repairs: [], maxFuel: 0,
        });
      } else if (!sats[t].cls && s.cls) {
        sats[t].cls = s.cls;
      }
      s.ti = t;
    }
  }

  // (b) link each object to itself in the next frame, nearest distances, counts
  let maxSatR = 0, hasReal = false, hasSynth = false;
  const radii = [];
  let lastYield = performance.now();
  for (let i = 0; i < n; i++) {
    const fr = frames[i], nx = frames[i + 1];
    for (const s of fr.sats) { const j = nx ? nx.satIndex.get(s.name) : undefined; s.next = j === undefined ? -1 : j; }
    for (const d of fr.debris) {
      const j = nx ? nx.debIndex.get(d.idKey) : undefined;
      d.next = j === undefined ? -1 : j;
      if (d.src === 'real') fr.realDebris++; else fr.synthDebris++;
      if (d.src === 'real') hasReal = true; else hasSynth = true;
    }
    computeNearest(fr, cfg);
    for (let k = 0; k < fr.sats.length; k++) {
      const s = fr.sats[k], track = sats[s.ti];
      const r = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      track.idx[i] = k; track.earth[i] = r; track.nearDeb[i] = s.nearDeb;
      if (s.fuel !== null && s.fuel > track.maxFuel) track.maxFuel = s.fuel;
      if (r > maxSatR) maxSatR = r;
      if (i === 0) radii.push(r);
    }
    if (performance.now() - lastYield > 30) {          // keep the page responsive on big runs
      onProgress((i + 1) / n * 0.85);
      await yieldToBrowser();
      if (stale()) return null;
      lastYield = performance.now();
    }
  }
  for (const fr of frames) { fr.satIndex = null; fr.debIndex = null; }   // parse-time maps no longer needed

  // (c) events, counters, repair intervals, red zones
  const evd = log
    ? deriveEvents(log, cfg, frames, ticks, sats, satIndex, notes)
    : deriveEvents({ events: [] }, cfg, frames, ticks, sats, satIndex, notes);
  if (!log) notes.push({ level: 'info', text: 'blackbox.txt not loaded: events, red zones and repair status will be empty.' });
  else if (log.ignored) notes.push({ level: 'info', text: `${log.ignored} unrecognised lines in blackbox.txt were ignored.` });
  if (log && !log.finished) notes.push({ level: 'warn', text: 'blackbox.txt has no “END OF LOG” line, so the run looks unfinished: orbital.cpp may still be running, or it stopped early. Load the files again after it finishes.' });

  // (d) UNDER REPAIR status: the Disabled column wins; otherwise DISPATCH→REPAIR intervals
  for (let i = 0; i < n; i++) {
    for (const s of frames[i].sats) {
      if (s.disabled !== null) continue;
      const reps = sats[s.ti].repairs;
      let dis = false;
      for (let r = 0; r < reps.length; r++) if (frames[i].tick >= reps[r][0] && frames[i].tick < reps[r][1]) { dis = true; break; }
      s.disabled = dis;
    }
  }

  // (e) model accuracy only for real runs
  let accuracy = null;
  if (validation) {
    if (cfg.mode === 'real') accuracy = validation;
    else notes.push({ level: 'info', text: 'validation.csv ignored: model accuracy is shown for real-data runs only.' });
  }

  // (f) sanity checks that catch wrong settings early
  radii.sort((a, b) => a - b);
  const medianR = radii.length ? radii[radii.length >> 1] : 0;
  if (radii.length && medianR < cfg.earthRadius) {
    notes.push({ level: 'warn', text: `Satellites start inside the Earth (median distance ${medianR.toFixed(1)} ${cfg.units} < earth_radius ${cfg.earthRadius}). Check units and earth_radius in run_info.txt.` });
  }
  if (n > 2) {
    const gaps = [];
    for (let i = 1; i < Math.min(n, 50); i++) gaps.push(ticks[i] - ticks[i - 1]);
    gaps.sort((a, b) => a - b);
    const gap = gaps[gaps.length >> 1];
    if (cfg.fromFile && Math.abs(gap - cfg.writeInterval) > 1e-9) {
      notes.push({ level: 'info', text: `run_info.txt says write_interval=${cfg.writeInterval}, but telemetry ticks are ${gap} apart. Playback follows the telemetry.` });
    }
  }
  if (tele.bad) notes.push({ level: 'warn', text: `${tele.bad} malformed telemetry rows were skipped.` });
  if (tele.dupes) notes.push({ level: 'info', text: `${tele.dupes} duplicate telemetry rows (same tick and object) were replaced by the later row.` });
  if (cfg.mode === 'real' && cfg.sectorSize < cfg.watchDist) {
    notes.push({ level: 'warn', text: `sector_size (${cfg.sectorSize}) is smaller than watch_dist (${cfg.watchDist}): the C++ 3×3×3 sector search can miss debris inside watch_dist.` });
  }
  onProgress(1);

  // (g) playback rate. Real time would look frozen (a satellite takes ~90 minutes per
  // orbit), so 1× is defined from the data: a typical satellite (the median) completes
  // one orbit in UI.orbitSecondsAt1x seconds. This uses each satellite's own orbit, so
  // far-out satellites (geostationary, 42,000 km) no longer speed up the near ones.
  // The clock shows the real-time factor.
  const sceneRadius = Math.max(cfg.earthRadius * 1.25, maxSatR * 1.12);
  const periods = [];                                   // orbit time of each sampled satellite, in ticks
  for (let i = 0; i + 1 < n && periods.length < 2000; i++) {
    const gap = ticks[i + 1] - ticks[i];
    for (const s of frames[i].sats) {
      if (s.next < 0) continue;
      const p = frames[i + 1].sats[s.next];
      const v = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2 + (p.z - s.z) ** 2) / gap;   // units per tick
      const r = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      if (v > 0 && r > 0) periods.push((TAU * r) / v);
    }
  }
  periods.sort((a, b) => a - b);
  const typicalPeriod = periods.length ? periods[periods.length >> 1] : 0;
  const span = ticks[n - 1] - ticks[0];
  let ticksPerSecond = typicalPeriod > 0 ? typicalPeriod / UI.orbitSecondsAt1x : span / 60;
  if (span > 0) ticksPerSecond = clamp(ticksPerSecond, span / 900, span / 5);   // a run lasts 5 s – 15 min at 1×
  if (!(ticksPerSecond > 0)) ticksPerSecond = 1;

  const run = {
    frames, ticks, sats, satIndex, cols: tele.cols, rows: tele.rows,
    firstTick: ticks[0], lastTick: ticks[n - 1], sceneRadius, ticksPerSecond,
    hasRealDebris: hasReal, hasSynthDebris: hasSynth,
    accuracy, ...evd,
  };
  buildOrbitPaths(run);
  return run;
}
