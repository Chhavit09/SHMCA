'use strict';
/*
   Copyright (c) 2026 Chhavit (@Chhavit09), Harsh Jain (@harshj1214-hj), Satyam Kumar (@kr-Satyam09), and Sudhanshu Ojha (@sudhanshuOjha07)
   All Rights Reserved. Proprietary and confidential: see LICENSE.txt for the terms.
*/
/* ORBITAL website – js/simulator.js. Browser simulator (a JavaScript port of orbital.cpp) and CelesTrak GP data import. */

/* --------------------------------------------------------------------------
   13. BROWSER SIMULATION  –  a small JavaScript port of orbital.cpp
   Used by the "New run" form (real CelesTrak data or typed satellites). It writes run_info.txt,
   telemetry.csv, blackbox.txt (and validation.csv for the real-data demo) in
   exactly the formats the C++ program uses, so these runs go through the same
   loading code as a real run. The interface labels them "Browser simulation":
   they are NOT output from orbital.cpp.
   -------------------------------------------------------------------------- */

// Rough size of a run before simulating it, so the form can warn or refuse.
// P = run settings; satCount lets the form estimate without reading every row.
// typedCount = satellites typed by the user; only they get invented (synthetic) debris.
function estimateRun(P, satCount = P.sats.length, typedCount = satCount) {
  const S = satCount, wi = P.runInfo.write_interval;
  const typedShare = S > 0 ? typedCount / S : 0;
  const frames = Math.ceil(P.ticks / wi);
  const chaosRolls = P.chaosEvery > 0 ? Math.floor(P.ticks / P.chaosEvery) : 0;
  const spawned = chaosRolls * 0.25 * (1 + (P.fragmentChance || 0)) * typedShare;   // 25% of chaos events, typed satellites only
  const startDebris = typedCount * P.debrisPerSat + (P.catalogDebris || 0);
  const avgDebris = startDebris + spawned / 2;
  const rows = frames * (S + avgDebris);                     // telemetry rows the page must hold
  const steps = P.ticks * (S * (P.closestApproach ? 56 : 28) + avgDebris * (P.closestApproach ? 2 : 1));   // 27 look-ups per satellite (twice with closest approach)
  const pairs = frames * S * (avgDebris + S);                // nearest-distance checks after loading
  // Rough time on a typical laptop, measured on this code: simulate + parse + derive.
  const seconds = steps / 2.8e6 + rows / 2.7e5 + rows / 2.8e5 + pairs / 1.4e7;
  return {
    frames, rows: Math.round(rows), endDebris: Math.round(startDebris + spawned),
    steps, pairs, seconds, mb: (rows * 62) / 1e6,            // ≈ 62 bytes per telemetry row
  };
}

// The New run form calls this with the user's settings (starting from RUN_PRESETS).
async function simulateRun(P, onProgress = () => {}, stale = () => false) {
  const ri = P.runInfo;
  const rnd = mulberry32(P.seed);
  const randInt = (n) => Math.floor(rnd() * n);        // like rand() % n
  const chance = (pct) => rnd() * 100 < pct;
  const num = (v) => String(Number(v.toPrecision(6)));  // C++ ostream default: 6 significant digits (log lines)
  const val = (v) => String(Math.round(v * 100) / 100);  // telemetry values: 2 decimals, much faster to format
  const thresholds = { warnDist: ri.warn_dist, dangerDist: ri.danger_dist, criticalDist: ri.critical_dist };
  const S = ri.sector_size;
  const log = ['----- ORBITAL BLACKBOX LOG -----'];
  const tel = ['Tick,Type,ID_or_Name,Class,Source,X,Y,Z,Battery,Fuel,Software,Disabled'];
  let simTime = 0;
  const stamp = () => `[t=${num(simTime)}s]`;

  // --- satellites ---
  const sats = P.sats.map((spec, i) => {
    const s = { id: i + 1, name: spec.name, cls: spec.cls, src: spec.src || P.satSource, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      battery: 100, software: 100, fuel: 50, thrusterOk: true, sensorsOk: true, disabled: false,
      repairLeft: 0, signal: 100, calibration: 100, lastBurn: -Infinity };
    if (P.gravity === 'classic') {
      // createSatelliteAroundEarth() from orbital.cpp
      const r = 4800 + randInt(400), ang = randInt(360) * Math.PI / 180, speed = 6.5 + randInt(20) / 10;
      s.x = r * Math.cos(ang); s.y = r * Math.sin(ang); s.z = (randInt(200) - 100) / 10;
      s.vx = -Math.sin(ang) * speed; s.vy = Math.cos(ang) * speed; s.vz = 0;
    } else if (spec.state) {                          // real orbit (CelesTrak) converted to a starting state
      Object.assign(s, spec.state);
    } else {
      setCircularOrbit(s, ri.earth_radius + spec.alt, spec.inc, spec.raan, spec.u, P.mu);
    }
    return s;
  });

  // --- debris ---
  let debris = [];
  // real debris keeps its NORAD catalogue number; invented debris then starts at 900001 so ids never clash
  const realDebris = P.realDebris || [];
  for (const rd of realDebris) debris.push({ id: rd.id, src: 'real', ...rd.state });
  let nextId = realDebris.length ? 900001 : 1;
  for (let j = 0; j < P.catalogDebris; j++) {       // debris on its own orbits around the Earth
    const d = { id: nextId++, src: P.catalogSource || 'synthetic', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const incs = [53, 97.4, 86.4, 51.6, 28.5, 74, 82.5, 65];
    setCircularOrbit(d, ri.earth_radius + 450 + rnd() * 650, incs[j % incs.length] + (rnd() - 0.5) * 2, rnd() * 360, rnd() * 360, P.mu);
    debris.push(d);
  }
  // Invented debris belongs only to invented satellites: a satellite from real data
  // (CelesTrak) gets none, unless a demo asks for it (P.syntheticNearReal).
  const inventedAround = (s) => s.src !== 'real' || P.syntheticNearReal;
  for (const s of sats) {                            // starting debris near each satellite
    if (!inventedAround(s)) continue;
    for (let j = 0; j < P.debrisPerSat; j++) {
      const sp = P.debrisSpread, rv = P.debrisRelSpeed;
      debris.push({ id: nextId++, src: 'synthetic',
        x: s.x + (rnd() * 2 - 1) * sp, y: s.y + (rnd() * 2 - 1) * sp, z: s.z + (rnd() * 2 - 1) * sp,
        vx: s.vx + (rnd() * 2 - 1) * rv, vy: s.vy + (rnd() * 2 - 1) * rv, vz: s.vz + (rnd() * 2 - 1) * rv });
    }
  }

  // --- helpers mirroring the C++ classes ---
  function gravityStep(o, dt) {
    const r = Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z);
    if (r > 0) {
      const g = P.gravity === 'classic' ? P.classicK / r : P.mu / (r * r);
      o.vx -= (o.x / r) * g * dt; o.vy -= (o.y / r) * g * dt; o.vz -= (o.z / r) * g * dt;
    }
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
  }
  function sendForRepair(s, reason) {
    if (s.disabled) return;
    s.disabled = true;
    s.repairLeft = P.repairTicks;
    log.push(`${stamp()} [DISPATCH] ${s.name} needs repair. Reason: ${reason}`);
  }
  function tickRepair(s) {
    if (s.repairLeft > 0) s.repairLeft--;
    if (s.repairLeft <= 0) {
      s.disabled = false; s.thrusterOk = true; s.sensorsOk = true; s.software = 100; s.battery = 100;
      s.fuel = Math.min(50, s.fuel + 25);
      log.push(`${stamp()} [REPAIR] ${s.name} repaired and back online`);
    }
  }
  function autoPatch(s, detail) { log.push(`${stamp()} [PATCH] ${s.name} auto-patched: ${detail}`); s.software = 100; }
  function healthDecision(s) {
    if (!s.sensorsOk) { log.push(`${stamp()} [HEALTH] ${s.name} sensor fault detected`); sendForRepair(s, 'sensor hardware fault'); return; }
    if (!s.thrusterOk) { log.push(`${stamp()} [HEALTH] ${s.name} thruster failure detected`); sendForRepair(s, 'thruster burnout'); return; }
    if (s.cls === 'Communication') {
      s.signal = Math.max(0, s.signal - 0.05);
      if (s.software < 70) autoPatch(s, 'corrupted packet routing table');
      if (s.signal < 40) { s.signal = 100; log.push(`${stamp()} [PATCH] ${s.name} signal re-tuned`); }
    } else {
      s.calibration = Math.max(0, s.calibration - (s.battery < 30 ? 0.5 : 0.05));
      if (s.software < 75) autoPatch(s, 'corrupted image compression logic');
      if (s.calibration < 50) { s.calibration = 100; log.push(`${stamp()} [PATCH] ${s.name} sensor recalibrated`); }
    }
  }
  function chaos() {
    const s = sats[randInt(sats.length)];
    if (chance(6) && !s.disabled) { const sev = 15 + randInt(30); s.software = Math.max(0, s.software - sev); log.push(`${stamp()} [CHAOS] Solar flare on ${s.name} software -${sev}`); }
    if (chance(7) && !s.disabled) { const amt = 3 + randInt(8); s.battery = Math.max(0, s.battery - amt); log.push(`${stamp()} [CHAOS] Battery drain on ${s.name} battery -${amt}`); }
    if (chance(2) && !s.disabled && s.thrusterOk) { s.thrusterOk = false; log.push(`${stamp()} [CHAOS] Thruster burnout on ${s.name}`); }
    if (chance(5) && !s.disabled) { s.software = Math.max(0, s.software - 35); log.push(`${stamp()} [CHAOS] Critical program bug in ${s.name} code`); }
    if (chance(3) && !s.disabled && s.sensorsOk) { s.sensorsOk = false; log.push(`${stamp()} [CHAOS] Sensor hardware fault on ${s.name}`); }
    if (chance(25) && inventedAround(s)) {
      const n = P.fragmentChance && rnd() < P.fragmentChance ? 2 : 1;   // demo: sometimes a fragment pair
      const sx = s.x + (randInt(90) - 45), sy = s.y + (randInt(90) - 45), sz = s.z + (randInt(90) - 45);
      for (let f = 0; f < n; f++) {
        const fx = sx + (f ? (rnd() * 2 - 1) * P.fragmentSpread : 0), fy = sy + (f ? (rnd() * 2 - 1) * P.fragmentSpread : 0), fz = sz + (f ? (rnd() * 2 - 1) * P.fragmentSpread : 0);
        const dx = s.x - fx, dy = s.y - fy, dz = s.z - fz, mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let ux = 0, uy = 0, uz = 1;
        if (mag > 0.001) { ux = dx / mag; uy = dy / mag; uz = dz / mag; }
        const sp = 0.1 + randInt(20) / 100;
        const d = { id: nextId++, src: 'synthetic', x: fx, y: fy, z: fz, vx: s.vx + ux * sp, vy: s.vy + uy * sp, vz: s.vz + uz * sp };
        debris.push(d);
        log.push(`${stamp()} [CHAOS] New debris #${d.id} near ${s.name}`);
      }
    }
  }
  // Sector key of a cell. Classic: AVL_Tree.h formula. Real demo: offset formula that
  // cannot collide for |index| < 5000 (the classic one collides once |bz| ≥ 500).
  const classicKeys = P.keyStyle === 'classic';
  const KX = CLASSIC_KEY_WEIGHTS.x, KY = CLASSIC_KEY_WEIGHTS.y, KZ = CLASSIC_KEY_WEIGHTS.z;
  function cellKey(bx, by, bz) {
    return classicKeys ? bx * KX + by * KY + bz * KZ : indexKey(bx, by, bz);
  }
  function handleThreat(s, kind, other, dist, tick) {
    if (s.disabled || (kind === 'sat' && other.disabled)) return;
    const risk = riskOf(dist, thresholds);
    if (risk === 0) return;
    const what = kind === 'sat' ? `friendly sat ${other.name}` : `debris #${other.id}`;
    if (risk === 1) {
      log.push(kind === 'sat'
        ? `${stamp()} [SAT-WARNING] ${s.name} near friendly sat ${other.name} distance=${num(dist)}`
        : `${stamp()} [WARNING] ${s.name} debris #${other.id} distance=${num(dist)}`);
      return;
    }
    log.push(`${stamp()} [${kind === 'sat' ? 'SAT-COLLISION ALERT' : 'COLLISION ALERT'}] ${s.name} ${what} distance=${num(dist)} risk=${RISK_NAMES[risk]}`);
    if (tick - s.lastBurn < P.burnCooldown) return;                  // demo: one burn per cooldown
    if (!s.thrusterOk) {
      log.push(`${stamp()} [DECISION] ${s.name} thruster unavailable - repair required`);
      sendForRepair(s, kind === 'sat' ? 'thruster failure during sat collision threat' : 'thruster failure during collision threat');
      return;
    }
    if (s.fuel < 2.5) {
      log.push(`${stamp()} [DECISION] ${s.name} insufficient fuel for ${kind === 'sat' ? 'sat ' : ''}evasive maneuver`);
      sendForRepair(s, 'out of propellant');
      return;
    }
    s.fuel -= 2.5;
    s.lastBurn = tick;
    const dx = s.x - other.x, dy = s.y - other.y, dz = s.z - other.z, mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let ux = 0, uy = 0, uz = 1;
    if (mag > 0.001) { ux = dx / mag; uy = dy / mag; uz = dz / mag; }
    s.vx += ux * P.burnDv; s.vy += uy * P.burnDv; s.vz += uz * P.burnDv;
    log.push(`${stamp()} [DECISION] ${s.name} performed evasive burn against ${what} fuel=2.5kg`);
  }

  // Optional (browser runs): judge each encounter by its closest approach during the next
  // tick instead of the distance at the tick itself. orbital.cpp checks at ticks only.
  const cpa = !!P.closestApproach;

  // --- main loop (same order as orbital.cpp) ---
  const zones = new Map();   // sector key → satellite that declared it
  const decay = P.decay.slice();
  let lastYield = performance.now();
  for (let tick = 1; tick <= P.ticks; tick++) {
    // every ~30 ms hand control back to the browser so the page stays responsive
    if ((tick & 15) === 0 && performance.now() - lastYield > 30) {
      onProgress(tick / P.ticks);
      await yieldToBrowser();
      if (stale()) return null;
      lastYield = performance.now();
    }
    simTime += ri.dt;
    if (P.chaosEvery > 0 && tick % P.chaosEvery === 0) chaos();
    for (const d of debris) gravityStep(d, ri.dt);
    if (decay.length && decay[0].tick === tick) {                    // demo: some debris disappears
      let n = decay.shift().count;
      debris = debris.filter((d) => !(d.src === 'synthetic' && n-- > 0));
    }
    for (const s of sats) {
      if (s.disabled) { tickRepair(s); if (!P.freezeWhenDisabled) gravityStep(s, ri.dt); continue; }
      gravityStep(s, ri.dt);
      s.battery = Math.max(0, s.battery - P.batteryDrain * ri.dt);
      s.fuel = Math.max(0, s.fuel - P.fuelDrain * ri.dt);
      healthDecision(s);
    }

    if (tick % ri.write_interval === 0 || tick === P.ticks) {
      for (const s of sats) {
        tel.push(`${tick},Sat,${s.name},${s.cls},${s.src},${val(s.x)},${val(s.y)},${val(s.z)},${val(s.battery)},${val(s.fuel)},${val(s.software)},${s.disabled ? 1 : 0}`);
      }
      for (const d of debris) tel.push(`${tick},Debris,${d.id},,${d.src},${val(d.x)},${val(d.y)},${val(d.z)},,,,`);
    }

    // spatial grid (the AVL tree's job in the C++): each debris remembers its sector
    const grid = new Map();
    for (const d of debris) {
      d.cx = Math.floor(d.x / S); d.cy = Math.floor(d.y / S); d.cz = Math.floor(d.z / S);
      const key = gridKey(d.cx, d.cy, d.cz);
      const cell = grid.get(key);
      if (cell) cell.push(d); else grid.set(key, [d]);
    }
    // debris really inside sector (X, Y, Z) – the grid key repeats every 1024 sectors
    const countIn = (cell, X, Y, Z) => {
      let n = 0;
      for (const d of cell) if (d.cx === X && d.cy === Y && d.cz === Z) n++;
      return n;
    };
    // Friendly satellites bucketed into cubes of watch_dist. orbital.cpp compares every
    // pair; with hundreds of satellites that is too slow here, and the result is the same.
    const W = ri.watch_dist;
    const satGrid = new Map();
    for (const o of sats) {
      if (o.disabled) continue;
      const key = gridKey(Math.floor(o.x / W), Math.floor(o.y / W), Math.floor(o.z / W));
      const cell = satGrid.get(key);
      if (cell) cell.push(o); else satGrid.set(key, [o]);
    }
    // closest-approach scan: grid cells wide enough to hold anything that can come within
    // the watch distance during the next tick (watch + both objects' travel)
    let reach = 0;
    const reachDebris = new Map(), reachSats = new Map();
    if (cpa) {
      let vmax = 0;
      for (const o of sats) vmax = Math.max(vmax, Math.hypot(o.vx, o.vy, o.vz));
      for (const d of debris) vmax = Math.max(vmax, Math.hypot(d.vx, d.vy, d.vz));
      reach = Math.max(ri.watch_dist, ri.watch_dist + 2 * vmax * ri.dt);
      const put = (map, o) => {
        const key = gridKey(Math.floor(o.x / reach), Math.floor(o.y / reach), Math.floor(o.z / reach));
        const cell = map.get(key);
        if (cell) cell.push(o); else map.set(key, [o]);
      };
      for (const d of debris) put(reachDebris, d);
      for (const o of sats) if (!o.disabled) put(reachSats, o);
    }
    const threats = [];
    for (const s of sats) {
      if (s.disabled) continue;
      const bx = Math.floor(s.x / S), by = Math.floor(s.y / S), bz = Math.floor(s.z / S);
      const own = cellKey(bx, by, bz);
      const flagger = zones.get(own);
      const ownCell = flagger && flagger !== s.name ? grid.get(gridKey(bx, by, bz)) : null;
      const count = ownCell ? countIn(ownCell, bx, by, bz) : 0;
      if (count > 0) {
        log.push(`${stamp()} [RED ZONE ALERT] ${s.name} entered Red Zone sector=${own} flaggedBy=${flagger} debrisCount=${count}`);
        if (s.thrusterOk && s.fuel >= 1.5) {
          s.fuel -= 1.5;
          s.vx += 0.05 * P.burnDv / 0.08; s.vy += 0.05 * P.burnDv / 0.08; s.vz += 0.04 * P.burnDv / 0.08;
          log.push(`${stamp()} [RED ZONE AVOIDANCE] ${s.name} diverted from Red Zone sector=${own} fuel=1.5kg`);
        }
      }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const X = bx + dx, Y = by + dy, Z = bz + dz;
        const cell = grid.get(gridKey(X, Y, Z));
        if (!cell) continue;
        if (cell.length >= 2) {
          const count = countIn(cell, X, Y, Z);
          const key = count >= 2 ? cellKey(X, Y, Z) : 0;
          if (count >= 2 && !zones.has(key)) {
            zones.set(key, s.name);
            const idx = P.keyStyle === 'classic' ? '' : ` bx=${X} by=${Y} bz=${Z}`;
            log.push(`${stamp()} [RED ZONE DECLARED] ${s.name} flagged sector=${key} debrisCount=${count}${idx}`);
          }
        }
        if (cpa) continue;                                          // threats come from the closest-approach scan below
        for (const d of cell) {
          const ex = s.x - d.x, ey = s.y - d.y, ez = s.z - d.z, dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (dist < ri.watch_dist) threats.push({ s, kind: 'debris', other: d, dist });
        }
      }
      if (cpa) {
        // Closest approach during the next tick. A crossing object moves up to ~15 km per
        // second relative to the satellite, so checking positions only once per tick misses
        // most close passes. Instead, from the relative position r and relative velocity v,
        // the closest distance over the next dt is |r + v·t*| with t* = −(r·v)/|v|² kept in
        // [0, dt]. Candidates are everything within reach, found in a coarser grid.
        const qx = Math.floor(s.x / reach), qy = Math.floor(s.y / reach), qz = Math.floor(s.z / reach);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const cellD = reachDebris.get(gridKey(qx + dx, qy + dy, qz + dz));
          if (cellD) for (const d of cellD) {
            const dist = closestApproach(s, d, ri.dt);
            if (dist < ri.watch_dist) threats.push({ s, kind: 'debris', other: d, dist });
          }
          const cellS = reachSats.get(gridKey(qx + dx, qy + dy, qz + dz));
          if (cellS) for (const o of cellS) {
            if (o === s) continue;
            const dist = closestApproach(s, o, ri.dt);
            if (dist < W) threats.push({ s, kind: 'sat', other: o, dist });
          }
        }
        continue;                                                   // (the at-tick satellite check below is not needed)
      }
      const cx = Math.floor(s.x / W), cy = Math.floor(s.y / W), cz = Math.floor(s.z / W);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const cell = satGrid.get(gridKey(cx + dx, cy + dy, cz + dz));
        if (!cell) continue;
        for (const o of cell) {
          if (o === s) continue;
          const ex = s.x - o.x, ey = s.y - o.y, ez = s.z - o.z, dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (dist < W) threats.push({ s, kind: 'sat', other: o, dist });
        }
      }
    }
    threats.sort((a, b) => a.dist - b.dist);                        // the C++ MinHeap order
    for (const th of threats) handleThreat(th.s, th.kind, th.other, th.dist, tick);
  }
  log.push('----- END OF LOG -----');

  const runInfoText = Object.entries(ri).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const out = {
    runinfo: { name: 'run_info.txt', text: runInfoText },
    telemetry: { name: 'telemetry.csv', text: tel.join('\n') + '\n' },
    blackbox: { name: 'blackbox.txt', text: log.join('\n') + '\n' },
  };
  if (P.validationStep) {
    // demo: invented error curves. A real validation.csv comes from comparing against SGP4.
    const lines = ['Elapsed_s,Satellite,Error_km'];
    for (const s of sats) {
      const a = 0.0002 + rnd() * 0.0003, b = 1.0e-7 + rnd() * 1.6e-7;
      for (let t = 0; t <= P.ticks * ri.dt; t += P.validationStep) {
        const e = Math.max(0, a * t + b * t * t + (rnd() - 0.5) * 0.03 * (1 + t / 2000));
        lines.push(`${t},${s.name},${e.toFixed(3)}`);
      }
    }
    out.validation = { name: 'validation.csv', text: lines.join('\n') + '\n' };
  }
  return out;
}

// Smallest distance between two objects moving in straight lines over the next dt
// (positions x, y, z and velocities vx, vy, vz in the same units).
function closestApproach(a, b, dt) {
  const rx = a.x - b.x, ry = a.y - b.y, rz = a.z - b.z;
  const vx = a.vx - b.vx, vy = a.vy - b.vy, vz = a.vz - b.vz;
  const vv = vx * vx + vy * vy + vz * vz;
  let t = vv > 0 ? -(rx * vx + ry * vy + rz * vz) / vv : 0;
  if (t < 0) t = 0; else if (t > dt) t = dt;                         // only the coming tick
  const x = rx + vx * t, y = ry + vy * t, z = rz + vz * t;
  return Math.sqrt(x * x + y * y + z * z);
}

// Sector key written to the log in real-data runs: unique while |index| < 5000
// (the classic AVL_Tree.h formula clashes once an index reaches 500).
function indexKey(bx, by, bz) { return ((bx + 5000) * 10001 + (by + 5000)) * 10001 + (bz + 5000); }

// Small-integer key for the simulator's per-tick lookup tables (fast in JavaScript).
// It repeats every 1024 cubes, so callers re-check the exact cube or the distance.
function gridKey(bx, by, bz) { return ((bx & 1023) << 20) | ((by & 1023) << 10) | (bz & 1023); }

// Circular orbit from altitude, inclination, RAAN and argument of latitude (degrees).
function setCircularOrbit(o, a, incDeg, raanDeg, uDeg, mu) {
  const d = Math.PI / 180, i = incDeg * d, O = raanDeg * d, u = uDeg * d;
  const Px = Math.cos(O), Py = Math.sin(O), Pz = 0;                                     // ascending node direction
  const Qx = -Math.cos(i) * Math.sin(O), Qy = Math.cos(i) * Math.cos(O), Qz = Math.sin(i); // 90° ahead in the orbit plane
  const v = Math.sqrt(mu / a);
  o.x = a * (Math.cos(u) * Px + Math.sin(u) * Qx);
  o.y = a * (Math.cos(u) * Py + Math.sin(u) * Qy);
  o.z = a * (Math.cos(u) * Pz + Math.sin(u) * Qz);
  o.vx = v * (-Math.sin(u) * Px + Math.cos(u) * Qx);
  o.vy = v * (-Math.sin(u) * Py + Math.cos(u) * Qy);
  o.vz = v * (-Math.sin(u) * Pz + Math.cos(u) * Qz);
}



/* --------------------------------------------------------------------------
   16. CELESTRAK GP DATA (CSV)  –  real orbits as starting states
   CelesTrak "GP data" lists one orbit per object as mean orbital elements:
   OBJECT_NAME, OBJECT_ID, EPOCH, MEAN_MOTION (rev/day), ECCENTRICITY,
   INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY (degrees), ...
   Each orbit is turned into a position and velocity at one common start time
   (the newest epoch) with Kepler's equation plus the slow drift caused by the
   Earth's flattening (J2). These are SGP4 *mean* elements, so this is an
   approximation of SGP4: expect a few km of difference at the start.
   -------------------------------------------------------------------------- */
const EARTH_J2 = Object.freeze({ j2: 1.08262668e-3, radius: 6378.137 });   // J2 and the radius it refers to (km)
// No cap on how many objects are imported: the New run size check decides what can run.
const CELESTRAK_LIMITS = Object.freeze({ minPerigeeKm: 100 });

// CelesTrak writes EPOCH in UTC without a "Z"; JavaScript would read that as local time.
function celestrakEpochMs(text) {
  let t = String(text || '').trim().replace(/(\.\d{3})\d+/, '$1');
  if (t && !/(Z|[+-]\d\d:?\d\d)$/i.test(t)) t += 'Z';
  return Date.parse(t);
}

function parseCelestrakCsv(text, fileName) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const names = splitCsvLine(lines[0] || '').map((h) => h.trim().toUpperCase());
  const col = (n) => names.indexOf(n);
  const need = ['OBJECT_NAME', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY'];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new DataError(`${fileName} is missing CelesTrak column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`);
  const c = Object.fromEntries(need.map((n) => [n, col(n)]));
  const cNorad = col('NORAD_CAT_ID');
  const objects = [], seen = new Set();
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const o = {
      name: (f[c.OBJECT_NAME] || '').trim(), norad: cNorad >= 0 ? Number(f[cNorad]) : NaN,
      epochMs: celestrakEpochMs(f[c.EPOCH]), n: toNum(f[c.MEAN_MOTION]), e: toNum(f[c.ECCENTRICITY]),
      i: toNum(f[c.INCLINATION]), raan: toNum(f[c.RA_OF_ASC_NODE]), argp: toNum(f[c.ARG_OF_PERICENTER]), ma: toNum(f[c.MEAN_ANOMALY]),
    };
    const ok = o.name && Number.isFinite(o.epochMs) && o.n > 0 && o.e >= 0 && o.e < 1 &&
      [o.i, o.raan, o.argp, o.ma].every(Number.isFinite);
    if (!ok) { skipped++; continue; }
    const a = Math.cbrt(RUN_PRESETS.real.mu / (o.n * TAU / 86400) ** 2);
    if (a * (1 - o.e) - EARTH_J2.radius < CELESTRAK_LIMITS.minPerigeeKm) { skipped++; continue; }   // re-entering
    if (!Number.isInteger(o.norad) || o.norad <= 0) o.norad = 800000 + i;      // no catalogue number given
    if (seen.has(o.norad)) { skipped++; continue; }                             // same object twice
    seen.add(o.norad);
    objects.push(o);
  }
  if (!objects.length) throw new DataError(`${fileName} has no usable orbits${skipped ? ` (${skipped} rows skipped)` : ''}.`);
  return { objects, skipped };
}

// Mean elements → position (km) and velocity (km/s) in the Earth-centred inertial frame at time tMs.
function elementsToState(el, tMs, mu) {
  const d2r = Math.PI / 180;
  const n0 = (el.n * TAU) / 86400;                                  // mean motion, rad/s
  const a = Math.cbrt(mu / (n0 * n0));                              // semi-major axis from Kepler's third law
  const e = el.e, inc = el.i * d2r, ci = Math.cos(inc), si = Math.sin(inc);
  const p = a * (1 - e * e);
  const k = 1.5 * n0 * EARTH_J2.j2 * (EARTH_J2.radius / p) ** 2;     // J2 drift factor
  const dt = (tMs - el.epochMs) / 1000;                             // seconds from the element epoch
  const raan = el.raan * d2r - k * ci * dt;                         // node drifts west (prograde orbits)
  const argp = el.argp * d2r + 0.5 * k * (5 * ci * ci - 1) * dt;    // perigee rotates
  const M = el.ma * d2r + (n0 + 0.5 * k * Math.sqrt(1 - e * e) * (3 * ci * ci - 1)) * dt;
  let E = M;                                                        // Kepler's equation E − e·sinE = M (Newton)
  for (let it = 0; it < 15; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));   // true anomaly
  const rr = a * (1 - e * Math.cos(E));
  const xp = rr * Math.cos(nu), yp = rr * Math.sin(nu);             // position in the orbit plane
  const vf = Math.sqrt(mu / p);
  const vxp = -vf * Math.sin(nu), vyp = vf * (e + Math.cos(nu));
  const cO = Math.cos(raan), sO = Math.sin(raan), cw = Math.cos(argp), sw = Math.sin(argp);
  // rotate the orbit plane into space: argument of perigee, inclination, node
  const r11 = cO * cw - sO * sw * ci, r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci, r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si, r32 = cw * si;
  const wrap = (x) => ((x % TAU) + TAU) % TAU / d2r;
  return {
    state: { x: r11 * xp + r12 * yp, y: r21 * xp + r22 * yp, z: r31 * xp + r32 * yp,
      vx: r11 * vxp + r12 * vyp, vy: r21 * vxp + r22 * vyp, vz: r31 * vxp + r32 * vyp },
    a, raanDeg: wrap(raan), uDeg: wrap(argp + nu),                  // phase = argument of latitude
  };
}

// CelesTrak debris groups are named like "FENGYUN 1C DEB" or "... R/B" (rocket bodies).
function looksLikeDebris(objects) {
  const n = objects.filter((o) => /\b(DEB|R\/B)\b/i.test(o.name)).length;
  return n >= objects.length * 0.6;
}

// A satellite name the log format accepts: "ISS (ZARYA)" → "ISS_ZARYA", unique within the form.
function cleanSatName(raw, taken) {
  const base = raw.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'OBJECT';
  let name = base, k = 2;
  while (taken.has(name)) { const suffix = `-${k++}`; name = base.slice(0, 24 - suffix.length) + suffix; }
  taken.add(name);
  return name;
}
