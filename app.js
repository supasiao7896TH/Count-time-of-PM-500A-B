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
  const DB_VERSION = 1;
  const STORE_SESSIONS = 'runtime_sessions';
  const STORE_RESETS = 'unit_resets';

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

  return {
    DB_NAME, DB_VERSION, STORE_SESSIONS, STORE_RESETS, UNITS, UNIT_LABEL,
    pad2, bangkokParts, dayKey, formatDayKeyBE, formatMonthKeyBE,
    formatDateTimeBE, formatClock, formatHours, formatDays, localInputToISO, isoToLocalInput,
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
    trendRangeDays: 7,
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

  // Wipes both stores entirely — used only by the "clear test data" dev control.
  async function clearAllData() {
    const sessionsStore = await tx(APP_CONFIG.STORE_SESSIONS, 'readwrite');
    await reqToPromise(sessionsStore.clear());
    const resetsStore = await tx(APP_CONFIG.STORE_RESETS, 'readwrite');
    await reqToPromise(resetsStore.clear());
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
      if (!buckets[key]) buckets[key] = { A: 0, B: 0, countA: 0, countB: 0 };
      buckets[key][s.equipment] += effectiveDurationSec(s);
      buckets[key]['count' + s.equipment] += 1;
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
  async function getCumulativeSince(equipment) {
    const [sessions, resetRec] = await Promise.all([
      getSessionsByEquipment(equipment),
      getReset(equipment),
    ]);
    const resetAt = resetRec && resetRec.lastResetAt ? new Date(resetRec.lastResetAt).getTime() : null;
    let sum = 0;
    for (const s of sessions) {
      const start = new Date(s.startTime).getTime();
      const end = effectiveEnd(s).getTime();
      if (resetAt != null && end <= resetAt) continue;
      const effStart = resetAt != null && start < resetAt ? resetAt : start;
      sum += Math.max(0, (end - effStart) / 1000);
    }
    return sum;
  }

  return {
    open, addSession, updateSession, deleteSession, getSessionById,
    getSessionsByEquipment, getAllSessions, getOpenSessionsFor, startSessionAtomic,
    getReset, saveReset, hasOverlap, effectiveDurationSec, clearAllData,
    getDailyAggregates, getMonthlyAggregates, getCumulativeSince,
  };
})();

/* ==========================================================================
   ④ UI_RENDERER — pure DOM rendering; textContent only for dynamic data
   ========================================================================== */
const UI_RENDERER = (() => {
  'use strict';

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
        <div class="timer-row"><span class="timer-label">เวลาทำงาน (session ปัจจุบัน)</span></div>
        <div class="timer-value" id="timer-${unit}">00:00:00</div>
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

  function renderReportTable(rows, mode) {
    const thead = document.querySelector('#reportTable thead tr');
    thead.innerHTML = '';
    const headers = mode === 'daily'
      ? ['วันที่', 'PM-500A (ชม.)', 'PM-500B (ชม.)', 'รวม (ชม.)', 'รวม (วัน)', 'จำนวน Session']
      : ['เดือน', 'PM-500A (ชม.)', 'PM-500B (ชม.)', 'รวม (ชม.)', 'รวม (วัน)', 'จำนวน Session'];
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
      td.colSpan = 6; td.className = 'empty-state'; td.textContent = 'ยังไม่มีข้อมูล';
      tr.appendChild(td); tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement('tr');
      const total = row.A + row.B;
      const cells = [row.label, APP_CONFIG.formatHours(row.A, 1), APP_CONFIG.formatHours(row.B, 1), APP_CONFIG.formatHours(total, 1), APP_CONFIG.formatDays(total, 1), String(row.countA + row.countB)];
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

  // Rounds a bar's top-left/top-right corners; stays square at the baseline,
  // per the mark spec (data-end rounded, baseline square).
  function roundedTopRectPath(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} L${x},${y + h} Z`;
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

  function renderTrendChart(rows) {
    const host = document.getElementById('trendChartHost');
    host.innerHTML = '';
    if (!rows.length) {
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
    const maxHours = niceCeil(Math.max(1, ...rows.map((r) => Math.max(r.A, r.B) / 3600)));

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', 'trendChart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'กราฟแนวโน้มชั่วโมงทำงานรายวัน เปรียบเทียบ PM-500A กับ PM-500B');

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

    const groupW = plotW / rows.length;
    const barGap = 2;
    const barW = Math.max(2, Math.min(24, (groupW - barGap * 3) / 2));
    const baseY = padTop + plotH;

    rows.forEach((row, i) => {
      const groupX = padLeft + i * groupW;
      const aHours = row.A / 3600, bHours = row.B / 3600;
      const aH = (aHours / maxHours) * plotH;
      const bH = (bHours / maxHours) * plotH;

      const barA = document.createElementNS(svgNS, 'path');
      barA.setAttribute('d', roundedTopRectPath(groupX + groupW / 2 - barGap / 2 - barW, baseY - aH, barW, aH, 4));
      barA.setAttribute('class', 'bar-a');
      const titleA = document.createElementNS(svgNS, 'title');
      titleA.textContent = `PM-500A · ${row.label}: ${aHours.toFixed(1)} ชม.`;
      barA.appendChild(titleA);
      svg.appendChild(barA);

      const barB = document.createElementNS(svgNS, 'path');
      barB.setAttribute('d', roundedTopRectPath(groupX + groupW / 2 + barGap / 2, baseY - bH, barW, bH, 4));
      barB.setAttribute('class', 'bar-b');
      const titleB = document.createElementNS(svgNS, 'title');
      titleB.textContent = `PM-500B · ${row.label}: ${bHours.toFixed(1)} ชม.`;
      barB.appendChild(titleB);
      svg.appendChild(barB);

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', groupX + groupW / 2);
      label.setAttribute('y', height - 8);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'chart-axis-text');
      label.textContent = row.shortLabel;
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

      grid.appendChild(item);
    }
  }

  function setTrendRangeButtons(days) {
    document.getElementById('trendRange7Btn').classList.toggle('active', days === 7);
    document.getElementById('trendRange14Btn').classList.toggle('active', days === 14);
  }

  return {
    initDashboard, setUnitStatus, updateTimer, updateCumulative, toast,
    showModal, hideModal, setTheme, setActiveView, setReportModeButtons,
    renderReportTable, renderHistoryTable, renderTrendChart, renderResetInfo,
    setTrendRangeButtons,
  };
})();

/* ==========================================================================
   ⑤ APP_CORE — init, resume-on-load, event wiring, ticker, PWA registration
   ========================================================================== */
const APP_CORE = (() => {
  'use strict';

  let editingSessionId = null;
  let pendingConfirmAction = null;

  async function init() {
    try {
      UI_RENDERER.initDashboard();
      wireStaticEvents();
      wireTabEvents();
      await STORAGE_ENGINE.open();
      await resumeOpenSessions();
      renderTodayLabel();
      applyStoredTheme();
      UI_RENDERER.setActiveView(STATE_STORE.get('activeView'));
      UI_RENDERER.setReportModeButtons(STATE_STORE.get('reportMode'));
      UI_RENDERER.setTrendRangeButtons(STATE_STORE.get('trendRangeDays'));
      await Promise.all([refreshCumulativeCards(), refreshReport(), refreshHistory(), refreshTrendChart(), refreshResetInfo()]);
      startTicker();
      registerServiceWorker();
    } catch (err) {
      DEBUG_MODULE.log('error', 'APP_CORE.init', err);
      UI_RENDERER.toast('เกิดข้อผิดพลาดในการเริ่มต้นแอป: ' + err.message, 'error');
    }
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
      document.getElementById(`resetBtn-${unit}`).addEventListener('click', () => handleResetRequest(unit));
    }

    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    document.getElementById('addSessionBtn').addEventListener('click', openAddSessionModal);
    document.getElementById('clearAllDataBtn').addEventListener('click', handleClearAllDataRequest);
    document.getElementById('sessionModalCancelBtn').addEventListener('click', closeSessionModal);
    document.getElementById('sessionForm').addEventListener('submit', handleSessionFormSubmit);

    document.getElementById('confirmModalCancelBtn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirmModalOkBtn').addEventListener('click', handleConfirmOk);

    document.querySelector('#historyTable tbody').addEventListener('click', handleHistoryTableClick);

    document.getElementById('reportModeDailyBtn').addEventListener('click', () => setReportMode('daily'));
    document.getElementById('reportModeMonthlyBtn').addEventListener('click', () => setReportMode('monthly'));
    document.getElementById('reportRangeSelect').addEventListener('change', refreshReport);

    document.getElementById('trendRange7Btn').addEventListener('click', () => setTrendRange(7));
    document.getElementById('trendRange14Btn').addEventListener('click', () => setTrendRange(14));

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

  function handleResetRequest(unit) {
    openConfirmModal({
      title: `รีเซ็ตชั่วโมงสะสม PM-500${unit}`,
      body: `การรีเซ็ตจะทำให้ตัวเลข "ชั่วโมงสะสม" ของ PM-500${unit} เริ่มนับใหม่จาก 0 ตั้งแต่ตอนนี้ ประวัติ Session ทั้งหมดจะยังคงถูกเก็บไว้ครบถ้วนและตรวจสอบย้อนหลังได้เสมอ กรุณาระบุหมายเหตุ`,
      requireNote: true,
      onConfirm: async (note) => {
        const cumulativeSec = await STORAGE_ENGINE.getCumulativeSince(unit);
        const now = new Date().toISOString();
        const existing = await STORAGE_ENGINE.getReset(unit);
        await STORAGE_ENGINE.saveReset({
          equipment: unit,
          lastResetAt: now,
          resetHistory: [...((existing && existing.resetHistory) || []), {
            ts: now, hoursAtReset: +(cumulativeSec / 3600).toFixed(2), note,
          }],
        });
        await Promise.all([refreshCumulativeCards(), refreshResetInfo()]);
        UI_RENDERER.toast(`รีเซ็ตชั่วโมงสะสมของ PM-500${unit} เรียบร้อยแล้ว`);
      },
    });
  }

  /* ---- Cumulative / report refresh ---- */

  async function refreshCumulativeCards() {
    for (const unit of APP_CONFIG.UNITS) {
      const sec = await STORAGE_ENGINE.getCumulativeSince(unit);
      UI_RENDERER.updateCumulative(unit, sec);
    }
  }

  function setReportMode(mode) {
    STATE_STORE.set('reportMode', mode);
    UI_RENDERER.setReportModeButtons(mode);
    refreshReport();
  }

  async function refreshReport() {
    const mode = STATE_STORE.get('reportMode');
    const rangeVal = document.getElementById('reportRangeSelect').value;
    let rows = mode === 'daily' ? await STORAGE_ENGINE.getDailyAggregates() : await STORAGE_ENGINE.getMonthlyAggregates();
    if (rangeVal !== 'all') rows = rows.slice(0, parseInt(rangeVal, 10));
    UI_RENDERER.renderReportTable(rows, mode);
  }

  async function refreshHistory() {
    const sessions = await STORAGE_ENGINE.getAllSessions();
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    UI_RENDERER.renderHistoryTable(sessions);
  }

  function setTrendRange(days) {
    STATE_STORE.set('trendRangeDays', days);
    UI_RENDERER.setTrendRangeButtons(days);
    refreshTrendChart();
  }

  async function refreshTrendChart() {
    const days = STATE_STORE.get('trendRangeDays');
    const daily = await STORAGE_ENGINE.getDailyAggregates();
    const rows = daily.slice(0, days).reverse().map((row) => ({ ...row, shortLabel: row.label.slice(0, 5) }));
    UI_RENDERER.renderTrendChart(rows);
  }

  async function refreshResetInfo() {
    const units = await Promise.all(APP_CONFIG.UNITS.map(async (unit) => ({
      unit, resetRec: await STORAGE_ENGINE.getReset(unit),
    })));
    UI_RENDERER.renderResetInfo(units);
  }

  /* ---- Session add / edit modal ---- */

  function openAddSessionModal() {
    editingSessionId = null;
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
    document.getElementById('sessionModalTitle').textContent = `แก้ไข Session — PM-500${session.equipment}`;
    document.getElementById('sessionFormError').textContent = '';
    document.getElementById('fEquipment').value = session.equipment;
    document.getElementById('fEquipment').disabled = true;
    document.getElementById('fStart').value = APP_CONFIG.isoToLocalInput(session.startTime);
    const isOpen = !session.endTime;
    document.getElementById('fEnd').value = isOpen ? '' : APP_CONFIG.isoToLocalInput(session.endTime);
    document.getElementById('fEnd').disabled = isOpen;
    document.getElementById('fEndHint').textContent = isOpen ? 'กำลังทำงาน (ยังไม่ปิด) — แก้ไขได้เฉพาะเวลาเริ่ม การปิด session ให้ใช้ปุ่มหยุดทำงาน' : '';
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
    const isEditingOpen = editingSessionId != null && document.getElementById('fEnd').disabled;

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
        if (st.openSessionId === editingSessionId && !endISO) {
          STATE_STORE.set('unit' + equipment, { ...st, startTime: startISO });
        }
        UI_RENDERER.toast('แก้ไข Session เรียบร้อยแล้ว');
      }
      closeSessionModal();
      await Promise.all([refreshHistory(), refreshReport(), refreshCumulativeCards()]);
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
          await Promise.all([refreshHistory(), refreshReport(), refreshCumulativeCards()]);
          UI_RENDERER.toast('ลบ Session เรียบร้อยแล้ว');
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
      body: 'การลบนี้จะลบประวัติ Session และประวัติการรีเซ็ตของทั้ง PM-500A และ PM-500B ทั้งหมดอย่างถาวร ไม่สามารถกู้คืนได้ ใช้เฉพาะก่อนเริ่มใช้งานจริงเท่านั้น',
      confirmPhrase: 'ลบทั้งหมด',
      onConfirm: async () => {
        await STORAGE_ENGINE.clearAllData();
        for (const unit of APP_CONFIG.UNITS) {
          STATE_STORE.set('unit' + unit, { status: 'stopped', openSessionId: null, startTime: null });
          UI_RENDERER.setUnitStatus(unit, 'stopped');
          UI_RENDERER.updateTimer(unit, 0);
        }
        await Promise.all([refreshHistory(), refreshReport(), refreshCumulativeCards()]);
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
