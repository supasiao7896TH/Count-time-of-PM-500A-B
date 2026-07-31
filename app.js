'use strict';

// Defense-in-depth against clickjacking: CSP frame-ancestors can't be set via
// <meta> (see index.html), so bust out of any iframe here instead.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  window.top.location = window.self.location;
}

/* ==========================================================================
   ① APP_CONFIG — design tokens, DB schema names, Thai/BE localization utils
   ========================================================================== */
const APP_CONFIG = (() => {
  'use strict';

  const DB_NAME = 'pm500_tracker_db';
  const DB_VERSION = 2;
  const STORE_SESSIONS = 'runtime_sessions';
  const STORE_RESETS = 'unit_resets';
  const STORE_FILTER_CHANGES = 'filter_changes';

  const BE_OFFSET = 543;
  const BKK_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok, fixed UTC+7, no DST
  const UNITS = ['A', 'B'];
  const UNIT_LABEL = { A: 'PM-500A', B: 'PM-500B' };
  const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Shift a UTC instant by the fixed Bangkok offset, then read its UTC parts —
  // gives correct Bangkok calendar date/time regardless of the OS timezone.
  function bangkokParts(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    const shifted = new Date(d.getTime() + BKK_OFFSET_MS);
    return {
      y: shifted.getUTCFullYear(),
      m: shifted.getUTCMonth() + 1,
      d: shifted.getUTCDate(),
      hh: shifted.getUTCHours(),
      mm: shifted.getUTCMinutes(),
      ss: shifted.getUTCSeconds(),
    };
  }

  function dayKey(isoOrDate) {
    const p = bangkokParts(isoOrDate);
    return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  }

  function formatDayKeyBE(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `${pad2(d)}/${pad2(m)}/${y + BE_OFFSET}`;
  }

  function formatMonthKeyBE(key) {
    const [y, m] = key.split('-').map(Number);
    return `${THAI_MONTHS[m - 1]} ${y + BE_OFFSET}`;
  }

  function formatDateTimeBE(iso) {
    if (!iso) return '';
    const p = bangkokParts(iso);
    return `${pad2(p.d)}/${pad2(p.m)}/${p.y + BE_OFFSET} ${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
  }

  function formatClock(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds || 0));
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  }

  function formatHours(totalSeconds, decimals) {
    return (Math.max(0, totalSeconds || 0) / 3600).toFixed(decimals == null ? 1 : decimals);
  }

  function formatDays(totalSeconds, decimals) {
    return (Math.max(0, totalSeconds || 0) / 86400).toFixed(decimals == null ? 1 : decimals);
  }

  function formatBaht(amount) {
    return (Math.max(0, amount || 0)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท';
  }

  // <input type=datetime-local> value <-> ISO 8601 UTC string.
  // The datetime-local value has no timezone info (just wall-clock numbers).
  // We always interpret/render those numbers as Asia/Bangkok (fixed UTC+7),
  // using the same BKK_OFFSET_MS shift as bangkokParts()/dayKey() above —
  // independent of the OS/browser's local timezone setting.
  function localInputToISO(value) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) return null;
    const [, y, mo, d, hh, mm, ss] = match;
    const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, ss ? +ss : 0);
    return new Date(utcMs - BKK_OFFSET_MS).toISOString();
  }

  function isoToLocalInput(iso) {
    if (!iso) return '';
    const p = bangkokParts(iso);
    return `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
  }

  const DEFAULT_PM_TARGET_DAYS = 30;
  const LONG_RUN_WARNING_HOURS = 12;
  const DEFAULT_FILTER_TARGET_HOURS = 720;

  function pmProgressPercent(cumulativeSec, pmTargetDays) {
    const targetDays = (pmTargetDays == null || !Number.isFinite(pmTargetDays) || pmTargetDays <= 0)
      ? DEFAULT_PM_TARGET_DAYS : pmTargetDays;
    const cumulativeDays = Math.max(0, cumulativeSec || 0) / 86400;
    return Math.min(100, Math.max(0, (cumulativeDays / targetDays) * 100));
  }

  // RGB triples must stay in sync with :root --green/--amber/--red in index.html
  // (theme-invariant, so a JS-side constant is safe).
  const PM_COLOR_STOPS = [
    { pct: 0, rgb: [22, 163, 74] },   // --green  #16a34a
    { pct: 50, rgb: [217, 119, 6] },  // --amber  #d97706
    { pct: 100, rgb: [220, 38, 38] }, // --red    #dc2626
  ];

  function pmFillColor(pct) {
    const p = Math.min(100, Math.max(0, pct));
    let lo = PM_COLOR_STOPS[0], hi = PM_COLOR_STOPS[PM_COLOR_STOPS.length - 1];
    for (let i = 0; i < PM_COLOR_STOPS.length - 1; i++) {
      if (p >= PM_COLOR_STOPS[i].pct && p <= PM_COLOR_STOPS[i + 1].pct) {
        lo = PM_COLOR_STOPS[i]; hi = PM_COLOR_STOPS[i + 1]; break;
      }
    }
    const t = (p - lo.pct) / ((hi.pct - lo.pct) || 1);
    const r = Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t);
    const g = Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t);
    const b = Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  return {
    DB_NAME, DB_VERSION, STORE_SESSIONS, STORE_RESETS, STORE_FILTER_CHANGES, UNITS, UNIT_LABEL,
    pad2, bangkokParts, dayKey, formatDayKeyBE, formatMonthKeyBE,
    formatDateTimeBE, formatClock, formatHours, formatDays, formatBaht, localInputToISO, isoToLocalInput,
    DEFAULT_PM_TARGET_DAYS, LONG_RUN_WARNING_HOURS, DEFAULT_FILTER_TARGET_HOURS, pmProgressPercent, pmFillColor,
  };
})();

/* ==========================================================================
   DEBUG_MODULE — lightweight logger (?debug=1 to see info/warn, errors always)
   ========================================================================== */
const DEBUG_MODULE = (() => {
  'use strict';
  const DEBUG_ON = new URLSearchParams(location.search).has('debug');

  function log(level, scope, message, data) {
    if (level !== 'error' && !DEBUG_ON) return;
    const fn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
    fn(`[PM500][${level}][${scope}]`, message, data !== undefined ? data : '');
  }

  return { log };
})();

/* ==========================================================================
   ② STATE_STORE — reactive pub/sub, single source of truth for UI rendering
   ========================================================================== */
const STATE_STORE = (() => {
  'use strict';

  const state = {
    unitA: { status: 'stopped', openSessionId: null, startTime: null },
    unitB: { status: 'stopped', openSessionId: null, startTime: null },
    theme: localStorage.getItem('pm500_theme') || 'auto',
    activeView: localStorage.getItem('pm500_view') || 'dashboard',
    reportMode: 'daily',
    reportUnit: 'A',
  };
  const listeners = {};

  function set(key, value) {
    state[key] = value;
    (listeners[key] || []).forEach((fn) => {
      try { fn(value); } catch (err) { DEBUG_MODULE.log('error', 'STATE_STORE.notify', err); }
    });
  }
  function get(key) { return state[key]; }
  function on(key, fn) { (listeners[key] = listeners[key] || []).push(fn); }
  function off(key, fn) { listeners[key] = (listeners[key] || []).filter((f) => f !== fn); }

  return { set, get, on, off };
})();

/* ==========================================================================
   ③ STORAGE_ENGINE — IndexedDB CRUD + report/cumulative aggregation queries
   ========================================================================== */
const STORAGE_ENGINE = (() => {
  'use strict';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(APP_CONFIG.DB_NAME, APP_CONFIG.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(APP_CONFIG.STORE_SESSIONS)) {
          const store = db.createObjectStore(APP_CONFIG.STORE_SESSIONS, { keyPath: 'id', autoIncrement: true });
          store.createIndex('by_equipment', 'equipment', { unique: false });
          store.createIndex('by_equipment_startTime', ['equipment', 'startTime'], { unique: false });
        }
        if (!db.objectStoreNames.contains(APP_CONFIG.STORE_RESETS)) {
          db.createObjectStore(APP_CONFIG.STORE_RESETS, { keyPath: 'equipment' });
        }
        if (!db.objectStoreNames.contains(APP_CONFIG.STORE_FILTER_CHANGES)) {
          const store = db.createObjectStore(APP_CONFIG.STORE_FILTER_CHANGES, { keyPath: 'id', autoIncrement: true });
          store.createIndex('by_equipment', 'equipment', { unique: false });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function addSession(session) {
    const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readwrite');
    const id = await reqToPromise(store.add(session));
    return { ...session, id };
  }

  async function updateSession(id, patch) {
    const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readwrite');
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('session not found: ' + id);
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  }

  async function deleteSession(id) {
    const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readwrite');
    await reqToPromise(store.delete(id));
  }

  async function getSessionById(id) {
    const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readonly');
    return reqToPromise(store.get(id));
  }

  async function getSessionsByEquipment(equipment) {
    const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readonly');
    const idx = store.index('by_equipment');
    return reqToPromise(idx.getAll(equipment));
  }

  async function getAllSessions() {
    const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readonly');
    return reqToPromise(store.getAll());
  }

  async function getOpenSessionsFor(equipment) {
    const all = await getSessionsByEquipment(equipment);
    return all.filter((s) => s.endTime === null || s.endTime === undefined);
  }

  // Atomically checks for an existing open session and creates a new one if
  // none exists, both within a single IndexedDB transaction — this closes the
  // check-then-act race that a plain getOpenSessionsFor()+addSession() pair
  // has when the same equipment is started from two tabs/windows at once.
  async function startSessionAtomic(equipment) {
    const db = await open();
    const t = db.transaction(APP_CONFIG.STORE_SESSIONS, 'readwrite');
    const store = t.objectStore(APP_CONFIG.STORE_SESSIONS);
    const idx = store.index('by_equipment');
    const all = await reqToPromise(idx.getAll(equipment));
    const openSession = all.find((s) => s.endTime === null || s.endTime === undefined);
    if (openSession) return { created: false, session: openSession };
    const now = new Date().toISOString();
    const session = {
      equipment, startTime: now, endTime: null, durationSec: null,
      isManualEntry: false, isEdited: false,
      auditLog: [{ ts: now, action: 'start' }],
      createdAt: now, updatedAt: now,
    };
    const id = await reqToPromise(store.add(session));
    return { created: true, session: { ...session, id } };
  }

  async function getReset(equipment) {
    const store = await tx(APP_CONFIG.STORE_RESETS, 'readonly');
    return reqToPromise(store.get(equipment));
  }

  async function saveReset(record) {
    const store = await tx(APP_CONFIG.STORE_RESETS, 'readwrite');
    await reqToPromise(store.put(record));
    return record;
  }

  async function addFilterChange(record) {
    const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readwrite');
    const id = await reqToPromise(store.add(record));
    return { ...record, id };
  }

  async function updateFilterChange(id, patch) {
    const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readwrite');
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('filter change not found: ' + id);
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  }

  async function deleteFilterChange(id) {
    const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readwrite');
    await reqToPromise(store.delete(id));
  }

  async function getFilterChangeById(id) {
    const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readonly');
    return reqToPromise(store.get(id));
  }

  async function getFilterChangesByEquipment(equipment) {
    const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readonly');
    const idx = store.index('by_equipment');
    return reqToPromise(idx.getAll(equipment));
  }

  async function getAllFilterChanges() {
    const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readonly');
    return reqToPromise(store.getAll());
  }

  // Accumulated runtime hours since the unit's last filter change (across
  // all sessions, independent of PM-reset cycles) — null if never changed.
  async function getHoursSinceLastFilterChange(equipment) {
    const [sessions, changes] = await Promise.all([
      getSessionsByEquipment(equipment),
      getFilterChangesByEquipment(equipment),
    ]);
    if (!changes.length) return null;
    const lastChangedAt = changes.reduce(
      (latest, r) => (!latest || r.changedAt > latest ? r.changedAt : latest), null,
    );
    const resetAt = new Date(lastChangedAt).getTime();
    return sumSessionsSinceReset(sessions, resetAt) / 3600;
  }

  // Full backup of every store — shape mirrors what importAllData expects back.
  async function exportAllData() {
    const [sessions, resets, filterChanges] = await Promise.all([
      getAllSessions(),
      Promise.all(APP_CONFIG.UNITS.map((u) => getReset(u))),
      getAllFilterChanges(),
    ]);
    return {
      app: 'pm500-runtime-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      resets: resets.filter(Boolean),
      filterChanges,
    };
  }

  // Wipes all stores then re-inserts every record with its original key intact
  // (autoIncrement stores bump their key generator past any explicit numeric
  // key on put(), so ids stay stable and future adds won't collide).
  async function importAllData(data) {
    await clearAllData();
    for (const s of (data.sessions || [])) {
      const store = await tx(APP_CONFIG.STORE_SESSIONS, 'readwrite');
      await reqToPromise(store.put(s));
    }
    for (const r of (data.resets || [])) {
      const store = await tx(APP_CONFIG.STORE_RESETS, 'readwrite');
      await reqToPromise(store.put(r));
    }
    for (const f of (data.filterChanges || [])) {
      const store = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readwrite');
      await reqToPromise(store.put(f));
    }
  }

  // Wipes all stores entirely — used only by the "clear test data" dev control.
  async function clearAllData() {
    const sessionsStore = await tx(APP_CONFIG.STORE_SESSIONS, 'readwrite');
    await reqToPromise(sessionsStore.clear());
    const resetsStore = await tx(APP_CONFIG.STORE_RESETS, 'readwrite');
    await reqToPromise(resetsStore.clear());
    const filterChangesStore = await tx(APP_CONFIG.STORE_FILTER_CHANGES, 'readwrite');
    await reqToPromise(filterChangesStore.clear());
  }

  function effectiveEnd(session) {
    return session.endTime ? new Date(session.endTime) : new Date();
  }

  // Duration for a closed session is its stored value; for a still-open
  // session it's recomputed live from the stored startTime (never from an
  // in-memory counter), so it stays correct across reloads.
  function effectiveDurationSec(session) {
    if (typeof session.durationSec === 'number') return session.durationSec;
    const start = new Date(session.startTime).getTime();
    return Math.max(0, (Date.now() - start) / 1000);
  }

  async function hasOverlap(equipment, startISO, endISO, excludeId) {
    const sessions = await getSessionsByEquipment(equipment);
    const newStart = new Date(startISO).getTime();
    const newEnd = endISO ? new Date(endISO).getTime() : Infinity;
    return sessions.find((s) => {
      if (excludeId != null && s.id === excludeId) return false;
      const sStart = new Date(s.startTime).getTime();
      const sEnd = s.endTime ? new Date(s.endTime).getTime() : Infinity;
      return sStart < newEnd && sEnd > newStart;
    }) || null;
  }

  // Report breakdown tables: each session's full duration is credited to the
  // Bangkok calendar day its startTime falls on (per confirmed requirement) —
  // not split across the days/months it spans. This keeps the report simple;
  // the exact PM-critical cumulative total (getCumulativeSince) is unaffected
  // by this simplification since it sums durations directly, with no
  // day-bucketing involved.
  async function getDailyAggregates() {
    const sessions = await getAllSessions();
    const buckets = {};
    for (const s of sessions) {
      const key = APP_CONFIG.dayKey(s.startTime);
      if (!buckets[key]) {
        buckets[key] = {
          A: 0, B: 0, countA: 0, countB: 0,
          hasOpenSessionA: false, hasOpenSessionB: false,
          latestEndDayKeyA: null, latestEndDayKeyB: null,
        };
      }
      buckets[key][s.equipment] += effectiveDurationSec(s);
      buckets[key]['count' + s.equipment] += 1;
      if (!s.endTime) {
        buckets[key]['hasOpenSession' + s.equipment] = true;
      } else {
        const endKey = APP_CONFIG.dayKey(s.endTime);
        const latestField = 'latestEndDayKey' + s.equipment;
        if (buckets[key][latestField] == null || endKey > buckets[key][latestField]) {
          buckets[key][latestField] = endKey;
        }
      }
    }
    return Object.keys(buckets).sort().reverse().map((key) => ({
      key, label: APP_CONFIG.formatDayKeyBE(key), ...buckets[key],
    }));
  }

  async function getMonthlyAggregates() {
    const daily = await getDailyAggregates();
    const buckets = {};
    for (const row of daily) {
      const mKey = row.key.slice(0, 7);
      if (!buckets[mKey]) buckets[mKey] = { A: 0, B: 0, countA: 0, countB: 0 };
      buckets[mKey].A += row.A;
      buckets[mKey].B += row.B;
      buckets[mKey].countA += row.countA;
      buckets[mKey].countB += row.countB;
    }
    return Object.keys(buckets).sort().reverse().map((key) => ({
      key, label: APP_CONFIG.formatMonthKeyBE(key), ...buckets[key],
    }));
  }

  // Exact sum of running time since the unit's last reset (or all-time if
  // never reset), clipping any session that straddles the reset boundary.
  // `untilAt` (optional) caps the window at an arbitrary point instead of
  // "now" — sessions starting after it are excluded, sessions ending after
  // it are clipped at it. Used to compute the exact cumulative total as of
  // a backdated reset time.
  function sumSessionsSinceReset(sessions, resetAt, untilAt) {
    let sum = 0;
    for (const s of sessions) {
      const start = new Date(s.startTime).getTime();
      let end = effectiveEnd(s).getTime();
      if (untilAt != null) {
        if (start >= untilAt) continue;
        end = Math.min(end, untilAt);
      }
      if (resetAt != null && end <= resetAt) continue;
      const effStart = resetAt != null && start < resetAt ? resetAt : start;
      sum += Math.max(0, (end - effStart) / 1000);
    }
    return sum;
  }

  async function getCumulativeSince(equipment) {
    const [sessions, resetRec] = await Promise.all([
      getSessionsByEquipment(equipment),
      getReset(equipment),
    ]);
    const resetAt = resetRec && resetRec.lastResetAt ? new Date(resetRec.lastResetAt).getTime() : null;
    return sumSessionsSinceReset(sessions, resetAt);
  }

  // Same as getCumulativeSince but capped at an arbitrary past timestamp
  // instead of "now" — used for backdated resets.
  async function getCumulativeSinceUntil(equipment, untilISO) {
    const [sessions, resetRec] = await Promise.all([
      getSessionsByEquipment(equipment),
      getReset(equipment),
    ]);
    const resetAt = resetRec && resetRec.lastResetAt ? new Date(resetRec.lastResetAt).getTime() : null;
    const untilAt = new Date(untilISO).getTime();
    return sumSessionsSinceReset(sessions, resetAt, untilAt);
  }

  // Fetches sessions + reset record once, returns both the exact cumulative
  // seconds and the unit's configured PM-cycle target (defaulted) — avoids a
  // redundant getReset() round-trip alongside getCumulativeSince().
  async function getCumulativeAndTarget(equipment) {
    const [sessions, resetRec] = await Promise.all([
      getSessionsByEquipment(equipment),
      getReset(equipment),
    ]);
    const resetAt = resetRec && resetRec.lastResetAt ? new Date(resetRec.lastResetAt).getTime() : null;
    const sec = sumSessionsSinceReset(sessions, resetAt);
    const pmTargetDays = (resetRec && resetRec.pmTargetDays) || APP_CONFIG.DEFAULT_PM_TARGET_DAYS;
    return { sec, pmTargetDays };
  }

  // One entry per completed cycle (from resetHistory, already carrying the
  // exact hours accumulated in that cycle) plus one trailing entry for the
  // still-open current cycle (live from getCumulativeSince) — a "cycle" here
  // is the span from the previous reset (or first-ever use) to a reset.
  async function getCycleUsageSeries(equipment) {
    const [resetRec, liveSec] = await Promise.all([
      getReset(equipment), getCumulativeSince(equipment),
    ]);
    const history = (resetRec && resetRec.resetHistory) || [];
    const entries = history.map((h) => ({
      label: APP_CONFIG.formatDayKeyBE(APP_CONFIG.dayKey(h.ts)),
      hours: h.hoursAtReset,
      ongoing: false,
      note: h.note || '',
    }));
    if (liveSec > 0 || entries.length === 0) {
      entries.push({ label: 'ปัจจุบัน', hours: liveSec / 3600, ongoing: true, note: '' });
    }
    return entries.length ? entries : [];
  }

  // Pairs A's and B's cycle-usage entries by sequence (1st cycle vs 1st
  // cycle, 2nd vs 2nd, ...) rather than by calendar date, since the two
  // units get reset independently and their cycle boundaries don't line up.
  async function getCycleUsageTrend() {
    const [a, b] = await Promise.all([getCycleUsageSeries('A'), getCycleUsageSeries('B')]);
    const maxLen = Math.max(a.length, b.length);
    const groups = [];
    for (let i = 0; i < maxLen; i++) {
      groups.push({ index: i + 1, A: a[i] || null, B: b[i] || null });
    }
    return groups;
  }

  return {
    open, addSession, updateSession, deleteSession, getSessionById,
    getSessionsByEquipment, getAllSessions, getOpenSessionsFor, startSessionAtomic,
    getReset, saveReset, hasOverlap, effectiveDurationSec, clearAllData, getCumulativeAndTarget,
    getDailyAggregates, getMonthlyAggregates, getCumulativeSince, getCumulativeSinceUntil, getCycleUsageTrend,
    addFilterChange, updateFilterChange, deleteFilterChange, getFilterChangeById,
    getFilterChangesByEquipment, getAllFilterChanges, getHoursSinceLastFilterChange,
    exportAllData, importAllData,
  };
})();

/* ==========================================================================
   ④ UI_RENDERER — pure DOM rendering; textContent only for dynamic data
   ========================================================================== */
const UI_RENDERER = (() => {
  'use strict';

  function buildTankFlowParticlesHTML() {
    return Array.from({ length: 6 }, (_, i) =>
      `<div class="tank-flow-particle tank-flow-particle-${i + 1}"></div>`
    ).join('');
  }

  function buildUnitCardHTML(unit) {
    const label = APP_CONFIG.UNIT_LABEL[unit];
    return `
      <div class="card unit-card" data-unit="${unit}">
        <div class="unit-card-top">
          <h3 class="unit-name">${label}</h3>
          <span class="status-pill stopped" id="statusPill-${unit}">
            <span class="status-dot"></span><span id="statusText-${unit}">หยุดทำงาน</span>
          </span>
        </div>
        <div class="tank-block">
          <div class="tank-visual" id="tankVisual-${unit}">
            <div class="tank-pipe-wrap">
              <svg class="tank-pipe-svg tank-pipe-svg-in" viewBox="0 0 76 44">
                <path class="tank-pipe-wall" d="M66,44 L66,24 Q66,10 52,10 L0,10"/>
                <path class="tank-pipe-fill" d="M66,44 L66,24 Q66,10 52,10 L0,10"/>
                <path class="tank-pipe-flow-path" d="M0,10 L52,10 Q66,10 66,24 L66,44"/>
              </svg>
              <div class="tank-pipe-label tank-pipe-label-in">UT Unit</div>
            </div>
            <div class="tank-shell">
              <div class="tank-fill" id="tankFill-${unit}"></div>
              <div class="tank-rim"></div>
              <div class="tank-panel-lines"></div>
              ${buildTankFlowParticlesHTML()}
            </div>
            <div class="tank-pipe-wrap">
              <svg class="tank-pipe-svg tank-pipe-svg-out" viewBox="0 0 76 44">
                <path class="tank-pipe-wall" d="M10,0 L10,20 Q10,34 24,34 L76,34"/>
                <path class="tank-pipe-fill" d="M10,0 L10,20 Q10,34 24,34 L76,34"/>
                <path class="tank-pipe-flow-path" d="M10,0 L10,20 Q10,34 24,34 L76,34"/>
              </svg>
              <div class="tank-pipe-label tank-pipe-label-out">PTA Unit</div>
            </div>
          </div>
          <div class="tank-progress-label">ความคืบหน้ารอบ PM: <span id="tankPct-${unit}">0%</span></div>
          <div class="pm-overdue-warning" id="pmOverdueWarning-${unit}" style="display:none;">⚠️ เกินเป้าหมาย PM แล้ว กรุณารีเซ็ต</div>
        </div>
        <div class="timer-row"><span class="timer-label">เวลาทำงาน (session ปัจจุบัน)</span></div>
        <div class="timer-value" id="timer-${unit}">00:00:00</div>
        <div class="long-run-warning" id="longRunWarning-${unit}" style="display:none;">⚠️ ทำงานต่อเนื่องนานผิดปกติ (เกิน ${APP_CONFIG.LONG_RUN_WARNING_HOURS} ชม.) — ตรวจสอบว่าลืมกดหยุดทำงานหรือไม่</div>
        <div class="cumulative-row"><span class="timer-label">ชั่วโมงสะสม (ตั้งแต่รีเซ็ตล่าสุด)</span></div>
        <div>
          <span class="cumulative-value" id="cumulative-${unit}">0.0 ชม.</span>
          <span class="cumulative-days" id="cumulativeDays-${unit}">(≈ 0.0 วัน)</span>
        </div>
        <div class="unit-actions">
          <button type="button" class="btn btn-start" id="startBtn-${unit}">▶ เริ่มทำงาน</button>
          <button type="button" class="btn btn-stop" id="stopBtn-${unit}" style="display:none;">⏹ หยุดทำงาน</button>
          <button type="button" class="btn btn-ghost" id="resetBtn-${unit}" title="รีเซ็ตชั่วโมงสะสม">รีเซ็ต</button>
        </div>
        <div class="filter-row">
          <span class="filter-count-label">เปลี่ยน Filter แล้ว <b id="filterCount-${unit}">0</b> ครั้ง</span>
          <button type="button" class="btn-ghost btn" id="filterChangeBtn-${unit}">🧰 บันทึกเปลี่ยน Filter</button>
        </div>
        <div class="filter-overdue-warning" id="filterOverdueWarning-${unit}" style="display:none;">⚠️ ถึงกำหนดเปลี่ยน Filter แล้ว</div>
      </div>`;
  }

  function initDashboard() {
    document.getElementById('unitGrid').innerHTML = APP_CONFIG.UNITS.map(buildUnitCardHTML).join('');
  }

  function setUnitStatus(unit, status) {
    const pill = document.getElementById(`statusPill-${unit}`);
    const text = document.getElementById(`statusText-${unit}`);
    const startBtn = document.getElementById(`startBtn-${unit}`);
    const stopBtn = document.getElementById(`stopBtn-${unit}`);
    const tank = document.getElementById(`tankVisual-${unit}`);
    if (tank) tank.classList.toggle('running', status === 'running');
    if (status === 'running') {
      pill.classList.add('running'); pill.classList.remove('stopped');
      text.textContent = 'กำลังทำงาน';
      startBtn.style.display = 'none';
      stopBtn.style.display = '';
      stopBtn.disabled = false;
    } else {
      pill.classList.remove('running'); pill.classList.add('stopped');
      text.textContent = 'หยุดทำงาน';
      startBtn.style.display = '';
      startBtn.disabled = false;
      stopBtn.style.display = 'none';
    }
  }

  function updateTimer(unit, elapsedSec) {
    const el = document.getElementById(`timer-${unit}`);
    if (el) el.textContent = APP_CONFIG.formatClock(elapsedSec);
  }

  function updateCumulative(unit, sec) {
    const el = document.getElementById(`cumulative-${unit}`);
    if (el) el.textContent = APP_CONFIG.formatHours(sec, 1) + ' ชม.';
    const daysEl = document.getElementById(`cumulativeDays-${unit}`);
    if (daysEl) daysEl.textContent = `(≈ ${APP_CONFIG.formatDays(sec, 1)} วัน)`;
  }

  function updateTankLevel(unit, pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    const fillEl = document.getElementById(`tankFill-${unit}`);
    if (fillEl) {
      fillEl.style.height = clamped.toFixed(1) + '%';
      fillEl.style.backgroundColor = APP_CONFIG.pmFillColor(clamped);
    }
    const pctEl = document.getElementById(`tankPct-${unit}`);
    if (pctEl) pctEl.textContent = Math.round(clamped) + '%';
    const overdueEl = document.getElementById(`pmOverdueWarning-${unit}`);
    if (overdueEl) overdueEl.style.display = clamped >= 100 ? '' : 'none';
  }

  function setLongRunWarning(unit, show) {
    const el = document.getElementById(`longRunWarning-${unit}`);
    if (el) el.style.display = show ? '' : 'none';
  }

  function setFilterOverdueWarning(unit, show) {
    const el = document.getElementById(`filterOverdueWarning-${unit}`);
    if (el) el.style.display = show ? '' : 'none';
  }

  function toast(message, type) {
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = 'toast' + (type && type !== 'info' ? ' ' + type : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function showModal(id) { document.getElementById(id).classList.add('open'); }
  function hideModal(id) { document.getElementById(id).classList.remove('open'); }

  function setTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.getElementById('themeToggleBtn').textContent = isDark ? '☀️' : '🌙';
    const themeColor = isDark ? '#0b1220' : '#f1f5f9';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', themeColor));
  }

  function setActiveView(view) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('nav.tabs button').forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
  }

  function setReportModeButtons(mode) {
    document.getElementById('reportModeDailyBtn').classList.toggle('active', mode === 'daily');
    document.getElementById('reportModeMonthlyBtn').classList.toggle('active', mode === 'monthly');
  }

  function setReportUnitButtons(unit) {
    document.getElementById('reportUnitABtn').classList.toggle('active', unit === 'A');
    document.getElementById('reportUnitBBtn').classList.toggle('active', unit === 'B');
  }

  function setReportRangeCaption(text) {
    const el = document.getElementById('reportRangeCaption');
    if (el) el.textContent = text;
  }

  function reportUntilCellText(row, unit) {
    if (row['hasOpenSession' + unit]) return 'ถึงปัจจุบัน';
    const latestEndDayKey = row['latestEndDayKey' + unit];
    if (latestEndDayKey && latestEndDayKey !== row.key) return `ถึง ${APP_CONFIG.formatDayKeyBE(latestEndDayKey)}`;
    return '—';
  }

  function renderReportTable(rows, mode, unit) {
    const thead = document.querySelector('#reportTable thead tr');
    thead.innerHTML = '';
    const headers = mode === 'daily'
      ? ['วันที่', 'ถึงวันที่', 'ชั่วโมง (ชม.)', 'สะสม (วัน)', 'จำนวน Session']
      : ['เดือน', 'ชั่วโมง (ชม.)', 'สะสม (วัน)', 'จำนวน Session'];
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h;
      thead.appendChild(th);
    }

    const tbody = document.querySelector('#reportTable tbody');
    tbody.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = headers.length; td.className = 'empty-state'; td.textContent = 'ยังไม่มีข้อมูล';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      const cells = mode === 'daily'
        ? [row.label, reportUntilCellText(row, unit), APP_CONFIG.formatHours(row[unit], 1), APP_CONFIG.formatDays(row[unit], 1), String(row['count' + unit])]
        : [row.label, APP_CONFIG.formatHours(row[unit], 1), APP_CONFIG.formatDays(row[unit], 1), String(row['count' + unit])];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderHistoryTable(sessions) {
    const tbody = document.querySelector('#historyTable tbody');
    tbody.innerHTML = '';
    if (!sessions.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7; td.className = 'empty-state'; td.textContent = 'ยังไม่มีประวัติ Session';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    for (const s of sessions) {
      const tr = document.createElement('tr');

      const tdUnit = document.createElement('td');
      tdUnit.textContent = APP_CONFIG.UNIT_LABEL[s.equipment];
      tr.appendChild(tdUnit);

      const tdStart = document.createElement('td');
      tdStart.textContent = APP_CONFIG.formatDateTimeBE(s.startTime);
      tr.appendChild(tdStart);

      const tdEnd = document.createElement('td');
      if (s.endTime) {
        tdEnd.textContent = APP_CONFIG.formatDateTimeBE(s.endTime);
      } else {
        const badge = document.createElement('span');
        badge.className = 'badge badge-open';
        badge.textContent = 'กำลังทำงาน';
        tdEnd.appendChild(badge);
      }
      tr.appendChild(tdEnd);

      const tdDur = document.createElement('td');
      tdDur.textContent = APP_CONFIG.formatClock(STORAGE_ENGINE.effectiveDurationSec(s));
      tr.appendChild(tdDur);

      const tdType = document.createElement('td');
      const b1 = document.createElement('span');
      b1.className = 'badge ' + (s.isManualEntry ? 'badge-manual' : 'badge-live');
      b1.textContent = s.isManualEntry ? 'เพิ่มย้อนหลัง' : 'บันทึกสด';
      tdType.appendChild(b1);
      if (s.isEdited) {
        const b2 = document.createElement('span');
        b2.className = 'badge badge-edited';
        b2.textContent = 'แก้ไขแล้ว';
        tdType.appendChild(b2);
      }
      tr.appendChild(tdType);

      const tdNote = document.createElement('td');
      const lastLog = (s.auditLog && s.auditLog.length) ? s.auditLog[s.auditLog.length - 1] : null;
      tdNote.textContent = lastLog && lastLog.note ? lastLog.note : '';
      tr.appendChild(tdNote);

      const tdActions = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'row-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.textContent = 'แก้ไข';
      editBtn.dataset.action = 'edit'; editBtn.dataset.id = s.id;
      wrap.appendChild(editBtn);
      if (s.isManualEntry) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button'; delBtn.textContent = 'ลบ';
        delBtn.dataset.action = 'delete'; delBtn.dataset.id = s.id;
        wrap.appendChild(delBtn);
      }
      tdActions.appendChild(wrap);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    }
  }

  // Rounds a value up to a "clean" axis-tick step (1/2/2.5/5/10 x a power of ten).
  function niceCeil(x) {
    if (x <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(x)));
    const residual = x / magnitude;
    let niceResidual;
    if (residual <= 1) niceResidual = 1;
    else if (residual <= 2) niceResidual = 2;
    else if (residual <= 2.5) niceResidual = 2.5;
    else if (residual <= 5) niceResidual = 5;
    else niceResidual = 10;
    return niceResidual * magnitude;
  }

  function renderTrendChart(groups) {
    const host = document.getElementById('trendChartHost');
    host.innerHTML = '';
    if (!groups.length) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = 'ยังไม่มีข้อมูลเพียงพอสำหรับกราฟ';
      host.appendChild(empty);
      return;
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    const width = 720, height = 220;
    const padLeft = 34, padRight = 10, padTop = 10, padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const allHours = groups.flatMap((g) => [g.A && g.A.hours, g.B && g.B.hours]).filter((v) => v != null);
    const maxHours = niceCeil(Math.max(1, ...allHours));

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', 'trendChart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'กราฟแท่งชั่วโมงใช้งานต่อรอบ เปรียบเทียบ PM-500A กับ PM-500B');

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const val = (maxHours / steps) * i;
      const y = padTop + plotH - (val / maxHours) * plotH;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', padLeft); line.setAttribute('x2', width - padRight);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('class', 'chart-gridline');
      svg.appendChild(line);

      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', padLeft - 6); text.setAttribute('y', y + 3);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('class', 'chart-axis-text');
      text.textContent = val.toFixed(val < 10 ? 1 : 0);
      svg.appendChild(text);
    }

    const slotW = plotW / groups.length;
    const barW = slotW * 0.32;
    const barGap = slotW * 0.06;
    const heightAt = (hours) => (hours / maxHours) * plotH;
    const labelEvery = Math.max(1, Math.ceil(groups.length / 8));

    function drawBar(x, entry, barClass, unitLabel, groupIndex) {
      if (!entry) return;
      const h = entry.hours > 0 ? Math.max(1.5, heightAt(entry.hours)) : 0;
      const y = padTop + plotH - h;
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', barW); rect.setAttribute('height', h);
      rect.setAttribute('class', entry.ongoing ? `${barClass} bar-ongoing` : barClass);
      const statusText = entry.ongoing ? 'ยังไม่จบรอบ (นับถึงตอนนี้)' : entry.label;
      const noteText = entry.note ? ` · หมายเหตุ: ${entry.note}` : '';
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${unitLabel} · รอบที่ ${groupIndex} · ${statusText}: ${entry.hours.toFixed(1)} ชม.${noteText}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    }

    groups.forEach((group, i) => {
      const slotX = padLeft + i * slotW;
      const pairW = barW * 2 + barGap;
      const startX = slotX + (slotW - pairW) / 2;
      drawBar(startX, group.A, 'bar-a', 'PM-500A', group.index);
      drawBar(startX + barW + barGap, group.B, 'bar-b', 'PM-500B', group.index);

      if (i % labelEvery !== 0 && i !== groups.length - 1) return;
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', slotX + slotW / 2);
      label.setAttribute('y', height - 8);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'chart-axis-text');
      label.textContent = `รอบ ${group.index}`;
      svg.appendChild(label);
    });

    host.appendChild(svg);
  }

  function renderResetInfo(units) {
    const grid = document.getElementById('resetInfoGrid');
    grid.innerHTML = '';
    for (const { unit, resetRec } of units) {
      const item = document.createElement('div');
      item.className = 'reset-info-item';

      const name = document.createElement('span');
      name.className = 'reset-info-name';
      name.textContent = APP_CONFIG.UNIT_LABEL[unit];
      item.appendChild(name);

      const dateEl = document.createElement('span');
      dateEl.className = 'reset-info-date';
      dateEl.textContent = (resetRec && resetRec.lastResetAt)
        ? APP_CONFIG.formatDateTimeBE(resetRec.lastResetAt)
        : 'ยังไม่เคยรีเซ็ต';
      item.appendChild(dateEl);

      const history = (resetRec && resetRec.resetHistory) || [];
      const last = history.length ? history[history.length - 1] : null;
      if (last && last.note) {
        const noteEl = document.createElement('span');
        noteEl.className = 'reset-info-note';
        noteEl.textContent = `หมายเหตุ: ${last.note}`;
        item.appendChild(noteEl);
      }

      const targetWrap = document.createElement('div');
      targetWrap.className = 'reset-pm-target';

      const targetLabel = document.createElement('label');
      targetLabel.setAttribute('for', `pmTarget-${unit}`);
      targetLabel.textContent = 'เป้าหมาย PM ต่อรอบ (วัน)';
      targetWrap.appendChild(targetLabel);

      const targetInput = document.createElement('input');
      targetInput.type = 'number';
      targetInput.id = `pmTarget-${unit}`;
      targetInput.min = '1'; targetInput.max = '365'; targetInput.step = '1';
      targetInput.value = String((resetRec && resetRec.pmTargetDays) || APP_CONFIG.DEFAULT_PM_TARGET_DAYS);
      targetInput.dataset.unit = unit;
      targetInput.dataset.pmTarget = '1';
      targetWrap.appendChild(targetInput);

      item.appendChild(targetWrap);

      grid.appendChild(item);
    }
  }

  function renderResetHistoryTable(records) {
    const tbody = document.querySelector('#resetHistoryTable tbody');
    tbody.innerHTML = '';
    if (!records.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8; td.className = 'empty-state'; td.textContent = 'ยังไม่มีประวัติการรีเซ็ต';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    for (const r of records) {
      const tr = document.createElement('tr');
      const cells = [
        APP_CONFIG.UNIT_LABEL[r.unit],
        APP_CONFIG.formatDateTimeBE(r.ts),
        r.hoursAtReset.toFixed(2),
        APP_CONFIG.formatDays(r.hoursAtReset * 3600, 1),
        r.pd2500Pv != null ? String(r.pd2500Pv) : '—',
        r.pe501OpenCount != null ? String(r.pe501OpenCount) : '—',
        r.lcv2502OpenCount != null ? String(r.lcv2502OpenCount) : '—',
        r.note || '',
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function updateFilterCount(unit, count) {
    const el = document.getElementById(`filterCount-${unit}`);
    if (el) el.textContent = String(count);
  }

  function renderFilterSummary(units) {
    const grid = document.getElementById('filterSummaryGrid');
    grid.innerHTML = '';
    let totalCount = 0, totalCost = 0;
    for (const { unit, count, totalCost: unitCost, lastChangedAt, filterTargetHours } of units) {
      totalCount += count;
      totalCost += unitCost;

      const item = document.createElement('div');
      item.className = 'reset-info-item';

      const name = document.createElement('span');
      name.className = 'reset-info-name';
      name.textContent = APP_CONFIG.UNIT_LABEL[unit];
      item.appendChild(name);

      const countEl = document.createElement('span');
      countEl.className = 'reset-info-date';
      countEl.textContent = `เปลี่ยนแล้ว ${count} ครั้ง`;
      item.appendChild(countEl);

      const costEl = document.createElement('span');
      costEl.className = 'reset-info-note';
      costEl.textContent = `ค่าใช้จ่ายรวม: ${APP_CONFIG.formatBaht(unitCost)}`;
      item.appendChild(costEl);

      const lastEl = document.createElement('span');
      lastEl.className = 'reset-info-note';
      lastEl.textContent = lastChangedAt ? `เปลี่ยนล่าสุด: ${APP_CONFIG.formatDayKeyBE(APP_CONFIG.dayKey(lastChangedAt))}` : 'ยังไม่เคยเปลี่ยน';
      item.appendChild(lastEl);

      const targetWrap = document.createElement('div');
      targetWrap.className = 'reset-pm-target';

      const targetLabel = document.createElement('label');
      targetLabel.setAttribute('for', `filterTarget-${unit}`);
      targetLabel.textContent = 'เป้าหมายเปลี่ยน Filter ทุก (ชม.)';
      targetWrap.appendChild(targetLabel);

      const targetInput = document.createElement('input');
      targetInput.type = 'number';
      targetInput.id = `filterTarget-${unit}`;
      targetInput.min = '1'; targetInput.max = '8760'; targetInput.step = '1';
      targetInput.value = String(filterTargetHours || APP_CONFIG.DEFAULT_FILTER_TARGET_HOURS);
      targetInput.dataset.unit = unit;
      targetInput.dataset.filterTarget = '1';
      targetWrap.appendChild(targetInput);

      item.appendChild(targetWrap);

      grid.appendChild(item);
    }

    const totalItem = document.createElement('div');
    totalItem.className = 'reset-info-item';
    totalItem.style.gridColumn = '1 / -1';
    const totalName = document.createElement('span');
    totalName.className = 'reset-info-name';
    totalName.textContent = 'รวมทั้งสองเครื่อง';
    totalItem.appendChild(totalName);
    const totalCountEl = document.createElement('span');
    totalCountEl.className = 'reset-info-date';
    totalCountEl.textContent = `เปลี่ยนแล้ว ${totalCount} ครั้ง`;
    totalItem.appendChild(totalCountEl);
    const totalCostEl = document.createElement('span');
    totalCostEl.className = 'reset-info-note';
    totalCostEl.textContent = `ค่าใช้จ่ายรวม: ${APP_CONFIG.formatBaht(totalCost)}`;
    totalItem.appendChild(totalCostEl);
    grid.appendChild(totalItem);
  }

  function renderFilterHistoryTable(records, tableId) {
    const tbody = document.querySelector(`#${tableId || 'filterHistoryTable'} tbody`);
    tbody.innerHTML = '';
    if (!records.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5; td.className = 'empty-state'; td.textContent = 'ยังไม่มีประวัติการเปลี่ยน Filter';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    for (const r of records) {
      const tr = document.createElement('tr');

      const tdUnit = document.createElement('td');
      tdUnit.textContent = APP_CONFIG.UNIT_LABEL[r.equipment];
      tr.appendChild(tdUnit);

      const tdDate = document.createElement('td');
      tdDate.textContent = APP_CONFIG.formatDayKeyBE(APP_CONFIG.dayKey(r.changedAt));
      tr.appendChild(tdDate);

      const tdCost = document.createElement('td');
      tdCost.textContent = r.cost != null ? APP_CONFIG.formatBaht(r.cost) : '—';
      tr.appendChild(tdCost);

      const tdNote = document.createElement('td');
      tdNote.textContent = r.note || '';
      tr.appendChild(tdNote);

      const tdActions = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'row-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.textContent = 'แก้ไข';
      editBtn.dataset.action = 'edit'; editBtn.dataset.id = r.id;
      wrap.appendChild(editBtn);
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.textContent = 'ลบ';
      delBtn.dataset.action = 'delete'; delBtn.dataset.id = r.id;
      wrap.appendChild(delBtn);
      tdActions.appendChild(wrap);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    }
  }

  return {
    initDashboard, setUnitStatus, updateTimer, updateCumulative, updateTankLevel, setLongRunWarning, toast,
    showModal, hideModal, setTheme, setActiveView, setReportModeButtons, setReportUnitButtons, setReportRangeCaption,
    renderReportTable, renderHistoryTable, renderTrendChart, renderResetInfo, renderResetHistoryTable,
    updateFilterCount, renderFilterSummary, renderFilterHistoryTable, setFilterOverdueWarning,
  };
})();

/* ==========================================================================
   ⑤ APP_CORE — init, resume-on-load, event wiring, ticker, PWA registration
   ========================================================================== */
const APP_CORE = (() => {
  'use strict';

  let editingSessionId = null;
  let editingSessionWasOpen = false;
  let editingFilterChangeId = null;
  let filterChangeUnit = null;
  let pendingConfirmAction = null;

  async function init() {
    try {
      UI_RENDERER.initDashboard();
      wireStaticEvents();
      wireTabEvents();
      await STORAGE_ENGINE.open();
      await maybeImportSeedData();
      await resumeOpenSessions();
      renderTodayLabel();
      applyStoredTheme();
      UI_RENDERER.setActiveView(STATE_STORE.get('activeView'));
      UI_RENDERER.setReportModeButtons(STATE_STORE.get('reportMode'));
      UI_RENDERER.setReportUnitButtons(STATE_STORE.get('reportUnit'));
      await Promise.all([refreshCumulativeCards(), refreshReport(), refreshHistory(), refreshTrendChart(), refreshResetInfo(), refreshResetHistory(), refreshFilterCounts(), refreshFilterChanges()]);
      startTicker();
      registerServiceWorker();
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.init', err);
      UI_RENDERER.toast('เกิดข้อผิดพลาดในการเริ่มต้นแอป: ' + err.message, 'error');
    }
  }

  // Seeds a fresh (empty) database from window.__PM500_SEED_DATA__, embedded
  // by exportStandaloneHtml() into a self-contained backup copy of the app —
  // only runs once, on first load, and never touches a DB that already has data.
  async function maybeImportSeedData() {
    if (!window.__PM500_SEED_DATA__) return;
    const existing = await STORAGE_ENGINE.getAllSessions();
    if (existing.length > 0) return;
    await STORAGE_ENGINE.importAllData(window.__PM500_SEED_DATA__);
  }

  async function resumeOpenSessions() {
    for (const unit of APP_CONFIG.UNITS) {
      let candidates = await STORAGE_ENGINE.getOpenSessionsFor(unit);

      if (candidates.length > 1) {
        candidates.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
        const keep = candidates[0];
        const strays = candidates.slice(1);
        for (const stray of strays) {
          await STORAGE_ENGINE.updateSession(stray.id, {
            endTime: stray.startTime,
            durationSec: 0,
            auditLog: [...(stray.auditLog || []), {
              ts: new Date().toISOString(), action: 'edit',
              note: 'auto-closed: duplicate open session found on load',
            }],
          });
          DEBUG_MODULE.log('warn', 'APP_CORE.resume', 'duplicate open session auto-closed', stray);
        }
        candidates = [keep];
      }

      if (candidates.length === 1) {
        STATE_STORE.set('unit' + unit, { status: 'running', openSessionId: candidates[0].id, startTime: candidates[0].startTime });
        UI_RENDERER.setUnitStatus(unit, 'running');
      } else {
        STATE_STORE.set('unit' + unit, { status: 'stopped', openSessionId: null, startTime: null });
        UI_RENDERER.setUnitStatus(unit, 'stopped');
      }
    }
  }

  function startTicker() {
    setInterval(() => {
      for (const unit of APP_CONFIG.UNITS) {
        const st = STATE_STORE.get('unit' + unit);
        if (st.status === 'running') {
          const elapsedSec = (Date.now() - new Date(st.startTime).getTime()) / 1000;
          UI_RENDERER.updateTimer(unit, elapsedSec);
          UI_RENDERER.setLongRunWarning(unit, elapsedSec > APP_CONFIG.LONG_RUN_WARNING_HOURS * 3600);
        } else {
          UI_RENDERER.setLongRunWarning(unit, false);
        }
      }
    }, 1000);

    // Cumulative totals don't need per-second precision; refresh periodically
    // so a long-running open session keeps its contribution climbing.
    setInterval(refreshCumulativeCards, 30000);
  }

  function wireStaticEvents() {
    for (const unit of APP_CONFIG.UNITS) {
      document.getElementById(`startBtn-${unit}`).addEventListener('click', () => handleStart(unit));
      document.getElementById(`stopBtn-${unit}`).addEventListener('click', () => handleStop(unit));
      document.getElementById(`resetBtn-${unit}`).addEventListener('click', () => openResetModal(unit));
      document.getElementById(`filterChangeBtn-${unit}`).addEventListener('click', () => openAddFilterChangeModal(unit));
    }

    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    document.getElementById('manualBtn').addEventListener('click', openManualModal);
    document.getElementById('manualModalCloseBtn').addEventListener('click', closeManualModal);

    document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
    document.getElementById('settingsModalCloseBtn').addEventListener('click', closeSettingsModal);
    document.getElementById('exportDataBtn').addEventListener('click', handleExportData);
    document.getElementById('importDataBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
    document.getElementById('importFileInput').addEventListener('change', handleImportFileSelected);
    document.getElementById('exportReportHtmlBtn').addEventListener('click', handleExportReportHtml);
    document.getElementById('exportStandaloneHtmlBtn').addEventListener('click', handleExportStandaloneHtml);

    document.getElementById('addSessionBtn').addEventListener('click', openAddSessionModal);
    document.getElementById('clearAllDataBtn').addEventListener('click', handleClearAllDataRequest);
    document.getElementById('sessionModalCancelBtn').addEventListener('click', closeSessionModal);
    document.getElementById('sessionForm').addEventListener('submit', handleSessionFormSubmit);

    document.getElementById('resetModalCancelBtn').addEventListener('click', closeResetModal);
    document.getElementById('resetForm').addEventListener('submit', handleResetFormSubmit);
    document.getElementById('fResetNoteSelect').addEventListener('change', (evt) => {
      if (evt.target.value) document.getElementById('fResetNote').value = evt.target.value;
    });

    document.getElementById('filterModalCancelBtn').addEventListener('click', closeFilterModal);
    document.getElementById('filterForm').addEventListener('submit', handleFilterFormSubmit);
    document.querySelector('#filterHistoryTable tbody').addEventListener('click', handleFilterHistoryTableClick);
    document.querySelector('#dashboardFilterHistoryTable tbody').addEventListener('click', handleFilterHistoryTableClick);

    document.getElementById('confirmModalCancelBtn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmModalOkBtn').addEventListener('click', handleConfirmOk);

    document.querySelector('#historyTable tbody').addEventListener('click', handleHistoryTableClick);

    document.getElementById('resetInfoGrid').addEventListener('change', handlePmTargetChange);
    document.getElementById('filterSummaryGrid').addEventListener('change', handleFilterTargetChange);

    document.getElementById('reportModeDailyBtn').addEventListener('click', () => setReportMode('daily'));
    document.getElementById('reportModeMonthlyBtn').addEventListener('click', () => setReportMode('monthly'));
    document.getElementById('reportUnitABtn').addEventListener('click', () => setReportUnit('A'));
    document.getElementById('reportUnitBBtn').addEventListener('click', () => setReportUnit('B'));
    document.getElementById('reportRangeSelect').addEventListener('change', refreshReport);

    document.getElementById('exportSessionCsvBtn').addEventListener('click', exportSessionCsv);
  }

  function wireTabEvents() {
    document.querySelectorAll('nav.tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        STATE_STORE.set('activeView', view);
        localStorage.setItem('pm500_view', view);
        UI_RENDERER.setActiveView(view);
      });
    });
  }

  /* ---- Start / Stop ---- */

  async function handleStart(unit) {
    const startBtn = document.getElementById(`startBtn-${unit}`);
    const st = STATE_STORE.get('unit' + unit);
    if (st.status === 'running') return;
    startBtn.disabled = true;
    try {
      const { created, session } = await STORAGE_ENGINE.startSessionAtomic(unit);
      if (!created) {
        STATE_STORE.set('unit' + unit, { status: 'running', openSessionId: session.id, startTime: session.startTime });
        UI_RENDERER.setUnitStatus(unit, 'running');
        UI_RENDERER.toast('พบ session ที่กำลังทำงานอยู่แล้ว — เชื่อมโยงกับ session เดิม', 'warn');
        return;
      }
      STATE_STORE.set('unit' + unit, { status: 'running', openSessionId: session.id, startTime: session.startTime });
      UI_RENDERER.setUnitStatus(unit, 'running');
      UI_RENDERER.updateTimer(unit, 0);
      await refreshHistory();
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleStart', err);
      UI_RENDERER.toast('บันทึกการเริ่มทำงานไม่สำเร็จ: ' + err.message, 'error');
      startBtn.disabled = false;
    }
  }

  async function handleStop(unit) {
    const stopBtn = document.getElementById(`stopBtn-${unit}`);
    const st = STATE_STORE.get('unit' + unit);
    if (st.status !== 'running') return;
    stopBtn.disabled = true;
    try {
      const now = new Date().toISOString();
      const durationSec = Math.max(0, (new Date(now).getTime() - new Date(st.startTime).getTime()) / 1000);
      const session = await STORAGE_ENGINE.getSessionById(st.openSessionId);
      await STORAGE_ENGINE.updateSession(st.openSessionId, {
        endTime: now, durationSec,
        auditLog: [...((session && session.auditLog) || []), { ts: now, action: 'stop' }],
      });
      STATE_STORE.set('unit' + unit, { status: 'stopped', openSessionId: null, startTime: null });
      UI_RENDERER.setUnitStatus(unit, 'stopped');
      UI_RENDERER.updateTimer(unit, 0);
      if (durationSec > 24 * 3600) {
        UI_RENDERER.toast(`PM-500${unit}: ระยะเวลาทำงานนานผิดปกติ (เกิน 24 ชม.) กรุณาตรวจสอบ`, 'warn');
      }
      await Promise.all([refreshCumulativeCards(), refreshHistory(), refreshReport(), refreshTrendChart()]);
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleStop', err);
      UI_RENDERER.toast('บันทึกการหยุดทำงานไม่สำเร็จ: ' + err.message, 'error');
      stopBtn.disabled = false;
    }
  }

  /* ---- Reset cumulative hours ---- */

  let resetModalUnit = null;

  function openResetModal(unit) {
    resetModalUnit = unit;
    document.getElementById('resetModalTitle').textContent = `รีเซ็ตชั่วโมงสะสม PM-500${unit}`;
    document.getElementById('resetModalBody').textContent =
      `การรีเซ็ตจะทำให้ตัวเลข "ชั่วโมงสะสม" ของ PM-500${unit} เริ่มนับใหม่จาก 0 ตั้งแต่เวลาที่เลือกด้านล่าง ประวัติ Session ทั้งหมดจะยังคงถูกเก็บไว้ครบถ้วนและตรวจสอบย้อนหลังได้เสมอ กรุณาระบุค่าต่อไปนี้`;
    document.getElementById('resetForm').reset();
    document.getElementById('resetFormError').textContent = '';
    document.getElementById('fResetDate').value = APP_CONFIG.isoToLocalInput(new Date().toISOString());
    UI_RENDERER.showModal('resetModalOverlay');
  }

  function closeResetModal() {
    UI_RENDERER.hideModal('resetModalOverlay');
    resetModalUnit = null;
  }

  async function handleResetFormSubmit(evt) {
    evt.preventDefault();
    const errorEl = document.getElementById('resetFormError');
    errorEl.textContent = '';

    const resetDateLocal = document.getElementById('fResetDate').value;
    const pd2500Val = document.getElementById('fResetPd2500').value;
    const pe501Val = document.getElementById('fResetPe501').value;
    const lcv2502Val = document.getElementById('fResetLcv2502').value;
    const note = document.getElementById('fResetNote').value.trim();

    if (!resetDateLocal) { errorEl.textContent = 'กรุณาระบุวันที่/เวลาที่จะรีเซ็ต'; return; }
    const resetAtISO = APP_CONFIG.localInputToISO(resetDateLocal);
    if (new Date(resetAtISO).getTime() > Date.now()) { errorEl.textContent = 'เวลาที่รีเซ็ตต้องไม่เป็นอนาคต'; return; }

    if (pd2500Val === '') { errorEl.textContent = 'กรุณาระบุค่า PD-2500.PV'; return; }
    const pd2500Pv = Number(pd2500Val);
    if (!Number.isFinite(pd2500Pv) || pd2500Pv < 0) { errorEl.textContent = 'ค่า PD-2500.PV ต้องเป็นตัวเลขไม่ติดลบ'; return; }

    if (pe501Val === '') { errorEl.textContent = 'กรุณาระบุจำนวนรอบที่เปิด B/V bypass PE-501'; return; }
    const pe501OpenCount = Number(pe501Val);
    if (!Number.isFinite(pe501OpenCount) || pe501OpenCount < 0) { errorEl.textContent = 'B/V bypass PE-501 ต้องเป็นตัวเลขไม่ติดลบ'; return; }

    if (lcv2502Val === '') { errorEl.textContent = 'กรุณาระบุจำนวนรอบที่เปิด B/V bypass LCV-2502'; return; }
    const lcv2502OpenCount = Number(lcv2502Val);
    if (!Number.isFinite(lcv2502OpenCount) || lcv2502OpenCount < 0) { errorEl.textContent = 'B/V bypass LCV-2502 ต้องเป็นตัวเลขไม่ติดลบ'; return; }

    if (!note) { errorEl.textContent = 'กรุณาระบุหมายเหตุ'; return; }

    const unit = resetModalUnit;
    const saveBtn = document.getElementById('resetModalSaveBtn');
    saveBtn.disabled = true;
    try {
      const existing = await STORAGE_ENGINE.getReset(unit);
      if (existing && existing.lastResetAt && new Date(resetAtISO).getTime() <= new Date(existing.lastResetAt).getTime()) {
        errorEl.textContent = 'เวลาที่รีเซ็ตต้องอยู่หลังการรีเซ็ตครั้งก่อน';
        return;
      }
      const cumulativeSec = await STORAGE_ENGINE.getCumulativeSinceUntil(unit, resetAtISO);
      await STORAGE_ENGINE.saveReset({
        equipment: unit,
        lastResetAt: resetAtISO,
        pmTargetDays: existing && existing.pmTargetDays,
        filterTargetHours: existing && existing.filterTargetHours,
        resetHistory: [...((existing && existing.resetHistory) || []), {
          ts: resetAtISO, hoursAtReset: +(cumulativeSec / 3600).toFixed(2), note,
          pd2500Pv, pe501OpenCount, lcv2502OpenCount,
        }],
      });
      closeResetModal();
      await Promise.all([refreshCumulativeCards(), refreshResetInfo(), refreshResetHistory(), refreshTrendChart()]);
      UI_RENDERER.toast(`รีเซ็ตชั่วโมงสะสมของ PM-500${unit} เรียบร้อยแล้ว`);
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleResetFormSubmit', err);
      errorEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function handlePmTargetChange(evt) {
    const input = evt.target.closest('input[data-pm-target]');
    if (!input) return;
    const unit = input.dataset.unit;
    let days = parseInt(input.value, 10);
    if (!Number.isFinite(days) || days < 1) days = APP_CONFIG.DEFAULT_PM_TARGET_DAYS;
    days = Math.min(365, Math.max(1, days));
    input.value = days;
    try {
      const existing = await STORAGE_ENGINE.getReset(unit);
      await STORAGE_ENGINE.saveReset({
        equipment: unit,
        lastResetAt: (existing && existing.lastResetAt) || null,
        resetHistory: (existing && existing.resetHistory) || [],
        pmTargetDays: days,
        filterTargetHours: existing && existing.filterTargetHours,
      });
      await refreshCumulativeCards();
      UI_RENDERER.toast(`บันทึกเป้าหมาย PM ของ PM-500${unit} เรียบร้อยแล้ว (${days} วัน)`);
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handlePmTargetChange', err);
      UI_RENDERER.toast('บันทึกเป้าหมาย PM ไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  async function handleFilterTargetChange(evt) {
    const input = evt.target.closest('input[data-filter-target]');
    if (!input) return;
    const unit = input.dataset.unit;
    let hours = parseInt(input.value, 10);
    if (!Number.isFinite(hours) || hours < 1) hours = APP_CONFIG.DEFAULT_FILTER_TARGET_HOURS;
    hours = Math.min(8760, Math.max(1, hours));
    input.value = hours;
    try {
      const existing = await STORAGE_ENGINE.getReset(unit);
      await STORAGE_ENGINE.saveReset({
        equipment: unit,
        lastResetAt: (existing && existing.lastResetAt) || null,
        resetHistory: (existing && existing.resetHistory) || [],
        pmTargetDays: existing && existing.pmTargetDays,
        filterTargetHours: hours,
      });
      await refreshFilterOverdueWarnings();
      UI_RENDERER.toast(`บันทึกเป้าหมายเปลี่ยน Filter ของ PM-500${unit} เรียบร้อยแล้ว (${hours} ชม.)`);
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleFilterTargetChange', err);
      UI_RENDERER.toast('บันทึกเป้าหมายเปลี่ยน Filter ไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  /* ---- Cumulative / report refresh ---- */

  async function refreshCumulativeCards() {
    for (const unit of APP_CONFIG.UNITS) {
      const { sec, pmTargetDays } = await STORAGE_ENGINE.getCumulativeAndTarget(unit);
      UI_RENDERER.updateCumulative(unit, sec);
      UI_RENDERER.updateTankLevel(unit, APP_CONFIG.pmProgressPercent(sec, pmTargetDays));
    }
    await refreshFilterOverdueWarnings();
  }

  function setReportMode(mode) {
    STATE_STORE.set('reportMode', mode);
    UI_RENDERER.setReportModeButtons(mode);
    refreshReport();
  }

  function setReportUnit(unit) {
    STATE_STORE.set('reportUnit', unit);
    UI_RENDERER.setReportUnitButtons(unit);
    refreshReport();
  }

  function buildReportRangeCaption(rows, mode, rangeVal) {
    if (!rows.length) return '';
    const latest = rows[0].label;
    const earliest = rows[rows.length - 1].label;
    const unitWord = mode === 'daily' ? 'วันที่' : 'เดือน';
    const rangeText = earliest === latest ? earliest : `${earliest} – ${latest}`;
    const countText = rangeVal === 'all' ? `ทั้งหมด ${rows.length} รายการ` : `${rows.length} รายการล่าสุด`;
    return `ข้อมูล${unitWord} ${rangeText} (${countText})`;
  }

  async function refreshReport() {
    const mode = STATE_STORE.get('reportMode');
    const unit = STATE_STORE.get('reportUnit');
    const rangeVal = document.getElementById('reportRangeSelect').value;
    let rows = mode === 'daily' ? await STORAGE_ENGINE.getDailyAggregates() : await STORAGE_ENGINE.getMonthlyAggregates();
    if (rangeVal !== 'all') rows = rows.slice(0, parseInt(rangeVal, 10));
    UI_RENDERER.renderReportTable(rows, mode, unit);
    UI_RENDERER.setReportRangeCaption(buildReportRangeCaption(rows, mode, rangeVal));
  }

  async function refreshHistory() {
    const sessions = await STORAGE_ENGINE.getAllSessions();
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    UI_RENDERER.renderHistoryTable(sessions);
  }

  async function refreshTrendChart() {
    const groups = await STORAGE_ENGINE.getCycleUsageTrend();
    UI_RENDERER.renderTrendChart(groups);
  }

  async function refreshResetInfo() {
    const units = await Promise.all(APP_CONFIG.UNITS.map(async (unit) => ({
      unit, resetRec: await STORAGE_ENGINE.getReset(unit),
    })));
    UI_RENDERER.renderResetInfo(units);
  }

  async function refreshResetHistory() {
    const perUnit = await Promise.all(APP_CONFIG.UNITS.map(async (unit) => {
      const resetRec = await STORAGE_ENGINE.getReset(unit);
      return ((resetRec && resetRec.resetHistory) || []).map((entry) => ({ ...entry, unit }));
    }));
    const records = perUnit.flat().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    UI_RENDERER.renderResetHistoryTable(records);
  }

  async function refreshFilterCounts() {
    for (const unit of APP_CONFIG.UNITS) {
      const records = await STORAGE_ENGINE.getFilterChangesByEquipment(unit);
      UI_RENDERER.updateFilterCount(unit, records.length);
    }
  }

  async function refreshFilterChanges() {
    const all = await STORAGE_ENGINE.getAllFilterChanges();
    const summary = await Promise.all(APP_CONFIG.UNITS.map(async (unit) => {
      const records = all.filter((r) => r.equipment === unit);
      const totalCost = records.reduce((sum, r) => sum + (r.cost || 0), 0);
      const lastChangedAt = records.reduce((latest, r) => (!latest || r.changedAt > latest ? r.changedAt : latest), null);
      const resetRec = await STORAGE_ENGINE.getReset(unit);
      const filterTargetHours = (resetRec && resetRec.filterTargetHours) || APP_CONFIG.DEFAULT_FILTER_TARGET_HOURS;
      return { unit, count: records.length, totalCost, lastChangedAt, filterTargetHours };
    }));
    UI_RENDERER.renderFilterSummary(summary);
    for (const s of summary) UI_RENDERER.updateFilterCount(s.unit, s.count);

    const sorted = [...all].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
    UI_RENDERER.renderFilterHistoryTable(sorted, 'filterHistoryTable');
    UI_RENDERER.renderFilterHistoryTable(sorted.slice(0, 10), 'dashboardFilterHistoryTable');

    await refreshFilterOverdueWarnings();
  }

  async function refreshFilterOverdueWarnings() {
    for (const unit of APP_CONFIG.UNITS) {
      const [hoursSince, resetRec] = await Promise.all([
        STORAGE_ENGINE.getHoursSinceLastFilterChange(unit),
        STORAGE_ENGINE.getReset(unit),
      ]);
      const targetHours = (resetRec && resetRec.filterTargetHours) || APP_CONFIG.DEFAULT_FILTER_TARGET_HOURS;
      const overdue = hoursSince != null && hoursSince >= targetHours;
      UI_RENDERER.setFilterOverdueWarning(unit, overdue);
    }
  }

  /* ---- Session add / edit modal ---- */

  function openAddSessionModal() {
    editingSessionId = null;
    editingSessionWasOpen = false;
    document.getElementById('sessionModalTitle').textContent = 'เพิ่ม Session ย้อนหลัง';
    document.getElementById('sessionForm').reset();
    document.getElementById('fEquipment').disabled = false;
    document.getElementById('fEnd').disabled = false;
    document.getElementById('fEndHint').textContent = '';
    document.getElementById('fNoteRequiredMark').textContent = '';
    document.getElementById('sessionFormError').textContent = '';
    const nowLocal = APP_CONFIG.isoToLocalInput(new Date().toISOString());
    document.getElementById('fStart').value = nowLocal;
    document.getElementById('fEnd').value = nowLocal;
    UI_RENDERER.showModal('sessionModalOverlay');
  }

  async function openEditSessionModal(id) {
    const session = await STORAGE_ENGINE.getSessionById(id);
    if (!session) return;
    editingSessionId = id;
    editingSessionWasOpen = !session.endTime;
    document.getElementById('sessionModalTitle').textContent = `แก้ไข Session — PM-500${session.equipment}`;
    document.getElementById('sessionFormError').textContent = '';
    document.getElementById('fEquipment').value = session.equipment;
    document.getElementById('fEquipment').disabled = true;
    document.getElementById('fStart').value = APP_CONFIG.isoToLocalInput(session.startTime);
    const isOpen = !session.endTime;
    document.getElementById('fEnd').value = isOpen ? '' : APP_CONFIG.isoToLocalInput(session.endTime);
    document.getElementById('fEnd').disabled = false;
    document.getElementById('fEndHint').textContent = isOpen
      ? 'กำลังทำงาน (ยังไม่ปิด) — เว้นว่างไว้เพื่อแก้ไขแค่เวลาเริ่ม หรือกรอกเวลาหยุดย้อนหลังเพื่อปิด session นี้'
      : '';
    document.getElementById('fNote').value = '';
    document.getElementById('fNoteRequiredMark').textContent = '*';
    UI_RENDERER.showModal('sessionModalOverlay');
  }

  function closeSessionModal() {
    UI_RENDERER.hideModal('sessionModalOverlay');
    editingSessionId = null;
  }

  async function handleSessionFormSubmit(evt) {
    evt.preventDefault();
    const errorEl = document.getElementById('sessionFormError');
    errorEl.textContent = '';

    const equipment = document.getElementById('fEquipment').value;
    const startLocal = document.getElementById('fStart').value;
    const endLocal = document.getElementById('fEnd').value;
    const note = document.getElementById('fNote').value.trim();
    const isEditingOpen = editingSessionId != null && editingSessionWasOpen && !endLocal;

    if (!startLocal) { errorEl.textContent = 'กรุณาระบุเวลาเริ่ม'; return; }
    if (!isEditingOpen && !endLocal) { errorEl.textContent = 'กรุณาระบุเวลาหยุด'; return; }
    if (editingSessionId != null && !note) { errorEl.textContent = 'กรุณาระบุหมายเหตุ/เหตุผลที่แก้ไข'; return; }

    const startISO = APP_CONFIG.localInputToISO(startLocal);
    const endISO = isEditingOpen ? null : APP_CONFIG.localInputToISO(endLocal);
    const nowMs = Date.now();

    if (new Date(startISO).getTime() > nowMs) { errorEl.textContent = 'เวลาเริ่มต้องไม่เป็นอนาคต'; return; }
    if (endISO) {
      if (new Date(endISO).getTime() > nowMs) { errorEl.textContent = 'เวลาหยุดต้องไม่เป็นอนาคต'; return; }
      if (new Date(endISO).getTime() <= new Date(startISO).getTime()) { errorEl.textContent = 'เวลาหยุดต้องอยู่หลังเวลาเริ่ม'; return; }
    }

    const saveBtn = document.getElementById('sessionModalSaveBtn');
    saveBtn.disabled = true;
    try {
      const overlap = await STORAGE_ENGINE.hasOverlap(equipment, startISO, endISO, editingSessionId);
      if (overlap) {
        errorEl.textContent = `ช่วงเวลาทับซ้อนกับ session อื่น (${APP_CONFIG.formatDateTimeBE(overlap.startTime)} - ${overlap.endTime ? APP_CONFIG.formatDateTimeBE(overlap.endTime) : 'กำลังทำงาน'})`;
        return;
      }

      const now = new Date().toISOString();
      if (editingSessionId == null) {
        const durationSec = (new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000;
        await STORAGE_ENGINE.addSession({
          equipment, startTime: startISO, endTime: endISO, durationSec,
          isManualEntry: true, isEdited: false,
          auditLog: [{ ts: now, action: 'manual_add', note }],
          createdAt: now, updatedAt: now,
        });
        UI_RENDERER.toast('เพิ่ม Session ย้อนหลังเรียบร้อยแล้ว');
      } else {
        const existing = await STORAGE_ENGINE.getSessionById(editingSessionId);
        const durationSec = endISO ? (new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000 : null;
        await STORAGE_ENGINE.updateSession(editingSessionId, {
          startTime: startISO,
          endTime: endISO,
          durationSec,
          isEdited: true,
          auditLog: [...((existing && existing.auditLog) || []), {
            ts: now, action: 'edit', note,
            oldValue: { startTime: existing.startTime, endTime: existing.endTime },
            newValue: { startTime: startISO, endTime: endISO },
          }],
        });
        const st = STATE_STORE.get('unit' + equipment);
        if (st.openSessionId === editingSessionId) {
          if (!endISO) {
            STATE_STORE.set('unit' + equipment, { ...st, startTime: startISO });
          } else {
            STATE_STORE.set('unit' + equipment, { status: 'stopped', openSessionId: null, startTime: null });
            UI_RENDERER.setUnitStatus(equipment, 'stopped');
            UI_RENDERER.updateTimer(equipment, 0);
            if (durationSec > 24 * 3600) {
              UI_RENDERER.toast(`PM-500${equipment}: ระยะเวลาทำงานนานผิดปกติ (เกิน 24 ชม.) กรุณาตรวจสอบ`, 'warn');
            }
          }
        }
        UI_RENDERER.toast('แก้ไข Session เรียบร้อยแล้ว');
      }
      closeSessionModal();
      await Promise.all([refreshHistory(), refreshReport(), refreshCumulativeCards(), refreshTrendChart()]);
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleSessionFormSubmit', err);
      errorEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    } finally {
      saveBtn.disabled = false;
    }
  }

  function handleHistoryTableClick(evt) {
    const btn = evt.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'edit') {
      openEditSessionModal(id);
    } else if (btn.dataset.action === 'delete') {
      openConfirmModal({
        title: 'ลบ Session',
        body: 'ยืนยันการลบ Session ที่เพิ่มย้อนหลังนี้? การลบไม่สามารถย้อนกลับได้',
        requireNote: false,
        onConfirm: async () => {
          await STORAGE_ENGINE.deleteSession(id);
          await Promise.all([refreshHistory(), refreshReport(), refreshCumulativeCards(), refreshTrendChart()]);
          UI_RENDERER.toast('ลบ Session เรียบร้อยแล้ว');
        },
      });
    }
  }

  /* ---- Filter change add / edit modal ---- */

  function openAddFilterChangeModal(unit) {
    editingFilterChangeId = null;
    filterChangeUnit = unit;
    document.getElementById('filterModalTitle').textContent = `บันทึกเปลี่ยน Filter — PM-500${unit}`;
    document.getElementById('filterForm').reset();
    document.getElementById('fFilterNoteRequiredMark').textContent = '';
    document.getElementById('filterFormError').textContent = '';
    document.getElementById('fFilterDate').value = APP_CONFIG.dayKey(new Date());
    UI_RENDERER.showModal('filterModalOverlay');
  }

  async function openEditFilterChangeModal(id) {
    const record = await STORAGE_ENGINE.getFilterChangeById(id);
    if (!record) return;
    editingFilterChangeId = id;
    filterChangeUnit = record.equipment;
    document.getElementById('filterModalTitle').textContent = `แก้ไขรายการเปลี่ยน Filter — PM-500${record.equipment}`;
    document.getElementById('filterFormError').textContent = '';
    document.getElementById('fFilterDate').value = APP_CONFIG.dayKey(record.changedAt);
    document.getElementById('fFilterCost').value = record.cost != null ? record.cost : '';
    document.getElementById('fFilterNote').value = '';
    document.getElementById('fFilterNoteRequiredMark').textContent = '*';
    UI_RENDERER.showModal('filterModalOverlay');
  }

  function closeFilterModal() {
    UI_RENDERER.hideModal('filterModalOverlay');
    editingFilterChangeId = null;
    filterChangeUnit = null;
  }

  async function handleFilterFormSubmit(evt) {
    evt.preventDefault();
    const errorEl = document.getElementById('filterFormError');
    errorEl.textContent = '';

    const dateVal = document.getElementById('fFilterDate').value;
    const costVal = document.getElementById('fFilterCost').value;
    const note = document.getElementById('fFilterNote').value.trim();

    if (!dateVal) { errorEl.textContent = 'กรุณาระบุวันที่เปลี่ยน'; return; }
    if (editingFilterChangeId != null && !note) { errorEl.textContent = 'กรุณาระบุหมายเหตุ/เหตุผลที่แก้ไข'; return; }

    const todayKey = APP_CONFIG.dayKey(new Date());
    if (dateVal > todayKey) { errorEl.textContent = 'วันที่เปลี่ยนต้องไม่เป็นอนาคต'; return; }

    const cost = costVal === '' ? null : Number(costVal);
    if (cost != null && (!Number.isFinite(cost) || cost < 0)) { errorEl.textContent = 'ค่าใช้จ่ายต้องเป็นตัวเลขไม่ติดลบ'; return; }

    const changedAtISO = new Date(dateVal + 'T00:00:00.000Z').toISOString();
    const saveBtn = document.getElementById('filterModalSaveBtn');
    saveBtn.disabled = true;
    try {
      const now = new Date().toISOString();
      if (editingFilterChangeId == null) {
        await STORAGE_ENGINE.addFilterChange({
          equipment: filterChangeUnit, changedAt: changedAtISO, cost, note,
          createdAt: now, updatedAt: now,
        });
        UI_RENDERER.toast('บันทึกเปลี่ยน Filter เรียบร้อยแล้ว');
      } else {
        await STORAGE_ENGINE.updateFilterChange(editingFilterChangeId, { changedAt: changedAtISO, cost, note });
        UI_RENDERER.toast('แก้ไขรายการเปลี่ยน Filter เรียบร้อยแล้ว');
      }
      closeFilterModal();
      await Promise.all([refreshFilterCounts(), refreshFilterChanges()]);
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleFilterFormSubmit', err);
      errorEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    } finally {
      saveBtn.disabled = false;
    }
  }

  function handleFilterHistoryTableClick(evt) {
    const btn = evt.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'edit') {
      openEditFilterChangeModal(id);
    } else if (btn.dataset.action === 'delete') {
      openConfirmModal({
        title: 'ลบรายการเปลี่ยน Filter',
        body: 'ยืนยันการลบรายการนี้? การลบไม่สามารถย้อนกลับได้',
        requireNote: false,
        onConfirm: async () => {
          await STORAGE_ENGINE.deleteFilterChange(id);
          await Promise.all([refreshFilterCounts(), refreshFilterChanges()]);
          UI_RENDERER.toast('ลบรายการเรียบร้อยแล้ว');
        },
      });
    }
  }

  /* ---- Clear all test data (dev control) ---- */

  function handleClearAllDataRequest() {
    const anyRunning = APP_CONFIG.UNITS.some((unit) => STATE_STORE.get('unit' + unit).status === 'running');
    if (anyRunning) {
      UI_RENDERER.toast('กรุณากดหยุดทำงานทั้งหมดก่อนลบข้อมูล', 'warn');
      return;
    }
    openConfirmModal({
      title: 'ลบข้อมูลทดสอบทั้งหมด',
      body: 'การลบนี้จะลบประวัติ Session, ประวัติการรีเซ็ต และประวัติการเปลี่ยน Filter ของทั้ง PM-500A และ PM-500B ทั้งหมดอย่างถาวร ไม่สามารถกู้คืนได้ ใช้เฉพาะก่อนเริ่มใช้งานจริงเท่านั้น',
      confirmPhrase: 'ลบทั้งหมด',
      onConfirm: async () => {
        await STORAGE_ENGINE.clearAllData();
        for (const unit of APP_CONFIG.UNITS) {
          STATE_STORE.set('unit' + unit, { status: 'stopped', openSessionId: null, startTime: null });
          UI_RENDERER.setUnitStatus(unit, 'stopped');
          UI_RENDERER.updateTimer(unit, 0);
        }
        await Promise.all([refreshHistory(), refreshReport(), refreshCumulativeCards(), refreshTrendChart(), refreshFilterCounts(), refreshFilterChanges()]);
        UI_RENDERER.toast('ลบข้อมูลทดสอบทั้งหมดเรียบร้อยแล้ว เริ่มนับใหม่จาก 0');
      },
    });
  }

  /* ---- Confirm modal (reset / delete) ---- */

  function openConfirmModal({ title, body, requireNote, confirmPhrase, onConfirm }) {
    pendingConfirmAction = onConfirm;
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = body;
    document.getElementById('confirmModalNoteField').style.display = (requireNote || confirmPhrase) ? '' : 'none';
    document.getElementById('confirmModalNote').value = '';
    document.getElementById('confirmModalNote').placeholder = confirmPhrase ? confirmPhrase : '';
    document.getElementById('confirmModalNoteLabel').textContent = confirmPhrase ? `พิมพ์ "${confirmPhrase}" เพื่อยืนยัน` : 'หมายเหตุ';
    document.getElementById('confirmModalError').textContent = '';
    document.getElementById('confirmModalOkBtn').dataset.requireNote = requireNote ? '1' : '0';
    document.getElementById('confirmModalOkBtn').dataset.confirmPhrase = confirmPhrase || '';
    UI_RENDERER.showModal('confirmModalOverlay');
  }

  function closeConfirmModal() {
    UI_RENDERER.hideModal('confirmModalOverlay');
    pendingConfirmAction = null;
  }

  async function handleConfirmOk() {
    const okBtn = document.getElementById('confirmModalOkBtn');
    const requireNote = okBtn.dataset.requireNote === '1';
    const confirmPhrase = okBtn.dataset.confirmPhrase || '';
    const note = document.getElementById('confirmModalNote').value.trim();
    const errorEl = document.getElementById('confirmModalError');
    if (confirmPhrase) {
      if (note !== confirmPhrase) { errorEl.textContent = `กรุณาพิมพ์ "${confirmPhrase}" ให้ตรงกันเพื่อยืนยัน`; return; }
    } else if (requireNote && !note) {
      errorEl.textContent = 'กรุณาระบุหมายเหตุ'; return;
    }
    if (!pendingConfirmAction) return;
    okBtn.disabled = true;
    try {
      await pendingConfirmAction(note);
      closeConfirmModal();
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleConfirmOk', err);
      errorEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    } finally {
      okBtn.disabled = false;
    }
  }

  /* ---- Settings modal (backup / restore / export) ---- */

  function openSettingsModal() { UI_RENDERER.showModal('settingsModalOverlay'); }
  function closeSettingsModal() { UI_RENDERER.hideModal('settingsModalOverlay'); }
  function openManualModal() { UI_RENDERER.showModal('manualModalOverlay'); }
  function closeManualModal() { UI_RENDERER.hideModal('manualModalOverlay'); }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExportData() {
    try {
      const data = await STORAGE_ENGINE.exportAllData();
      const stamp = APP_CONFIG.dayKey(new Date().toISOString());
      downloadTextFile(`pm500-backup-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
      UI_RENDERER.toast('ส่งออกข้อมูลเรียบร้อยแล้ว');
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleExportData', err);
      UI_RENDERER.toast('ส่งออกข้อมูลไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  async function handleImportFileSelected(evt) {
    const file = evt.target.files[0];
    evt.target.value = '';
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      UI_RENDERER.toast('ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ JSON', 'error');
      return;
    }
    if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.filterChanges)) {
      UI_RENDERER.toast('โครงสร้างข้อมูลในไฟล์นี้ไม่ตรงกับรูปแบบของแอปนี้', 'error');
      return;
    }

    const anyRunning = APP_CONFIG.UNITS.some((unit) => STATE_STORE.get('unit' + unit).status === 'running');
    if (anyRunning) {
      UI_RENDERER.toast('กรุณากดหยุดทำงานทั้งหมดก่อนนำเข้าข้อมูล', 'warn');
      return;
    }

    closeSettingsModal();
    openConfirmModal({
      title: 'นำเข้าข้อมูล',
      body: `ไฟล์นี้มีประวัติ Session ${data.sessions.length} รายการ และประวัติเปลี่ยน Filter ${data.filterChanges.length} รายการ`
        + (data.exportedAt ? ` (ส่งออกเมื่อ ${APP_CONFIG.formatDateTimeBE(data.exportedAt)})` : '')
        + ' การนำเข้าจะแทนที่ข้อมูลปัจจุบันทั้งหมดอย่างถาวร ไม่สามารถย้อนกลับได้',
      confirmPhrase: 'นำเข้าข้อมูล',
      onConfirm: async () => {
        await STORAGE_ENGINE.importAllData(data);
        for (const unit of APP_CONFIG.UNITS) {
          STATE_STORE.set('unit' + unit, { status: 'stopped', openSessionId: null, startTime: null });
          UI_RENDERER.setUnitStatus(unit, 'stopped');
          UI_RENDERER.updateTimer(unit, 0);
        }
        await Promise.all([
          refreshHistory(), refreshReport(), refreshCumulativeCards(), refreshTrendChart(),
          refreshResetInfo(), refreshResetHistory(), refreshFilterCounts(), refreshFilterChanges(),
        ]);
        UI_RENDERER.toast('นำเข้าข้อมูลเรียบร้อยแล้ว');
      },
    });
  }

  async function buildReportHtmlDocument() {
    const [sessions, filterChanges, unitOverview] = await Promise.all([
      STORAGE_ENGINE.getAllSessions(),
      STORAGE_ENGINE.getAllFilterChanges(),
      Promise.all(APP_CONFIG.UNITS.map(async (unit) => {
        const [{ sec, pmTargetDays }, resetRec, hoursSinceFilter] = await Promise.all([
          STORAGE_ENGINE.getCumulativeAndTarget(unit),
          STORAGE_ENGINE.getReset(unit),
          STORAGE_ENGINE.getHoursSinceLastFilterChange(unit),
        ]);
        return {
          unit, sec, pmTargetDays,
          filterTargetHours: (resetRec && resetRec.filterTargetHours) || APP_CONFIG.DEFAULT_FILTER_TARGET_HOURS,
          hoursSinceFilter,
        };
      })),
    ]);

    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const resetRows = [];
    for (const unit of APP_CONFIG.UNITS) {
      const resetRec = await STORAGE_ENGINE.getReset(unit);
      for (const h of (resetRec && resetRec.resetHistory) || []) resetRows.push({ ...h, unit });
    }
    resetRows.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const filterRows = [...filterChanges].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));

    const overviewHtml = unitOverview.map((o) => `
      <tr>
        <td>${escapeHtml(APP_CONFIG.UNIT_LABEL[o.unit])}</td>
        <td>${APP_CONFIG.formatHours(o.sec, 1)} ชม.</td>
        <td>${o.pmTargetDays} วัน</td>
        <td>${o.filterTargetHours} ชม.</td>
        <td>${o.hoursSinceFilter == null ? 'ยังไม่เคยเปลี่ยน' : APP_CONFIG.formatHours(o.hoursSinceFilter * 3600, 1) + ' ชม.'}</td>
      </tr>`).join('');

    const sessionRows = sessions.map((s) => `
      <tr>
        <td>${escapeHtml(APP_CONFIG.UNIT_LABEL[s.equipment])}</td>
        <td>${APP_CONFIG.formatDateTimeBE(s.startTime)}</td>
        <td>${s.endTime ? APP_CONFIG.formatDateTimeBE(s.endTime) : 'กำลังทำงาน'}</td>
        <td>${APP_CONFIG.formatHours(STORAGE_ENGINE.effectiveDurationSec(s), 2)} ชม.</td>
      </tr>`).join('');

    const resetTableRows = resetRows.map((r) => `
      <tr>
        <td>${escapeHtml(APP_CONFIG.UNIT_LABEL[r.unit])}</td>
        <td>${APP_CONFIG.formatDateTimeBE(r.ts)}</td>
        <td>${(r.hoursAtReset || 0).toFixed(2)} ชม.</td>
        <td>${((r.hoursAtReset || 0) / 24).toFixed(2)} วัน</td>
        <td>${r.pd2500Pv ?? ''}</td>
        <td>${r.pe501OpenCount ?? ''}</td>
        <td>${r.lcv2502OpenCount ?? ''}</td>
        <td>${escapeHtml(r.note || '')}</td>
      </tr>`).join('');

    const filterTableRows = filterRows.map((f) => `
      <tr>
        <td>${escapeHtml(APP_CONFIG.UNIT_LABEL[f.equipment])}</td>
        <td>${APP_CONFIG.formatDayKeyBE(APP_CONFIG.dayKey(f.changedAt))}</td>
        <td>${APP_CONFIG.formatBaht(f.cost || 0)}</td>
        <td>${escapeHtml(f.note || '')}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8">
<title>รายงานสรุป PM-500 Runtime Tracker</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 24px; color:#111; }
  h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.85rem; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f0f0f0; }
  .meta { color: #666; font-size: 0.85rem; }
  @media print { body { margin: 8px; } }
</style>
</head><body>
  <h1>📊 รายงานสรุป PM-500 Runtime Tracker</h1>
  <p class="meta">สร้างเมื่อ ${escapeHtml(APP_CONFIG.formatDateTimeBE(new Date().toISOString()))}</p>

  <h2>ภาพรวม</h2>
  <table>
    <tr><th>เครื่อง</th><th>ชั่วโมงสะสม</th><th>เป้าหมาย PM/รอบ</th><th>เป้าหมายเปลี่ยน Filter</th><th>ชม. ตั้งแต่เปลี่ยน Filter ล่าสุด</th></tr>
    ${overviewHtml}
  </table>

  <h2>ประวัติ Session (${sessions.length} รายการ)</h2>
  <table>
    <tr><th>เครื่อง</th><th>เริ่ม</th><th>หยุด</th><th>ระยะเวลา</th></tr>
    ${sessionRows || '<tr><td colspan="4">ไม่มีข้อมูล</td></tr>'}
  </table>

  <h2>ประวัติการรีเซ็ต (${resetRows.length} รายการ)</h2>
  <table>
    <tr><th>เครื่อง</th><th>วันที่/เวลา</th><th>ชม.ตอนรีเซ็ต</th><th>จำนวนวัน</th><th>PD-2500.PV</th><th>PE-501</th><th>LCV-2502</th><th>หมายเหตุ</th></tr>
    ${resetTableRows || '<tr><td colspan="8">ไม่มีข้อมูล</td></tr>'}
  </table>

  <h2>ประวัติการเปลี่ยน Filter (${filterRows.length} รายการ)</h2>
  <table>
    <tr><th>เครื่อง</th><th>วันที่เปลี่ยน</th><th>ค่าใช้จ่าย</th><th>หมายเหตุ</th></tr>
    ${filterTableRows || '<tr><td colspan="4">ไม่มีข้อมูล</td></tr>'}
  </table>
</body></html>`;
  }

  async function handleExportReportHtml() {
    try {
      const html = await buildReportHtmlDocument();
      const stamp = APP_CONFIG.dayKey(new Date().toISOString());
      downloadTextFile(`pm500-report-${stamp}.html`, html, 'text/html');
      UI_RENDERER.toast('ส่งออกรายงานสรุปเรียบร้อยแล้ว');
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleExportReportHtml', err);
      UI_RENDERER.toast('ส่งออกรายงานไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  async function handleExportStandaloneHtml() {
    try {
      const [htmlText, jsText, seedData] = await Promise.all([
        fetch('index.html').then((r) => {
          if (!r.ok) throw new Error('โหลด index.html ไม่สำเร็จ');
          return r.text();
        }),
        fetch('app.js').then((r) => {
          if (!r.ok) throw new Error('โหลด app.js ไม่สำเร็จ');
          return r.text();
        }),
        STORAGE_ENGINE.exportAllData(),
      ]);

      const safeSeedJson = JSON.stringify(seedData).replace(/</g, '\\u003c');
      const inlineScript = `<script>window.__PM500_SEED_DATA__ = ${safeSeedJson};<\/script>\n<script>${jsText}<\/script>`;
      if (!htmlText.includes('<script src="app.js"></script>')) {
        throw new Error('ไม่พบตำแหน่งฝังสคริปต์ใน index.html');
      }
      const combined = htmlText.replace('<script src="app.js"></script>', inlineScript);

      const stamp = APP_CONFIG.dayKey(new Date().toISOString());
      downloadTextFile(`pm500-standalone-${stamp}.html`, combined, 'text/html');
      UI_RENDERER.toast('ส่งออกสำเนาแอปแบบ Standalone เรียบร้อยแล้ว');
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.handleExportStandaloneHtml', err);
      UI_RENDERER.toast('ส่งออกสำเนาแอปไม่สำเร็จ: ' + err.message + ' (ต้องเปิดผ่านเว็บเซิร์ฟเวอร์ ไม่ใช่ file://)', 'error');
    }
  }

  /* ---- Theme ---- */

  function applyStoredTheme() { UI_RENDERER.setTheme(STATE_STORE.get('theme')); }

  function toggleTheme() {
    const current = STATE_STORE.get('theme');
    const isDark = current === 'dark' || (current === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    STATE_STORE.set('theme', next);
    localStorage.setItem('pm500_theme', next);
    UI_RENDERER.setTheme(next);
  }

  /* ---- Misc ---- */

  function renderTodayLabel() {
    const p = APP_CONFIG.bangkokParts(new Date());
    document.getElementById('todayLabel').textContent = `${APP_CONFIG.pad2(p.d)}/${APP_CONFIG.pad2(p.m)}/${p.y + 543}`;
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        DEBUG_MODULE.log('warn', 'APP_CORE.registerServiceWorker', err);
      });
    }
  }

  /* ---- CSV export ---- */

  function csvEscape(value) {
    const str = String(value == null ? '' : value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function downloadCsv(filename, rows) {
    const content = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function todayFileStamp() {
    const p = APP_CONFIG.bangkokParts(new Date());
    return `${p.y}${APP_CONFIG.pad2(p.m)}${APP_CONFIG.pad2(p.d)}`;
  }

  async function exportSessionCsv() {
    const sessions = await STORAGE_ENGINE.getAllSessions();
    sessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const rows = [['เครื่อง', 'เวลาเริ่ม', 'เวลาหยุด', 'ระยะเวลา (HH:MM:SS)', 'ระยะเวลา (ชม.)', 'ระยะเวลา (วัน)', 'ประเภท', 'หมายเหตุ']];
    for (const s of sessions) {
      const lastLog = (s.auditLog && s.auditLog.length) ? s.auditLog[s.auditLog.length - 1] : null;
      const durSec = STORAGE_ENGINE.effectiveDurationSec(s);
      rows.push([
        APP_CONFIG.UNIT_LABEL[s.equipment],
        APP_CONFIG.formatDateTimeBE(s.startTime),
        s.endTime ? APP_CONFIG.formatDateTimeBE(s.endTime) : 'กำลังทำงาน',
        APP_CONFIG.formatClock(durSec),
        APP_CONFIG.formatHours(durSec, 2),
        APP_CONFIG.formatDays(durSec, 2),
        s.isManualEntry ? 'เพิ่มย้อนหลัง' : 'บันทึกสด',
        lastLog && lastLog.note ? lastLog.note : '',
      ]);
    }
    downloadCsv(`PM500_SessionLog_${todayFileStamp()}.csv`, rows);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => { APP_CORE.init(); });
