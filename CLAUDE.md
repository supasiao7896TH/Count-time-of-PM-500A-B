# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

- ชื่อแอป: PM-500 Runtime Tracker
- Stack: Single-page vanilla HTML/CSS/JS · IndexedDB (`pm500_tracker_db`, `DB_VERSION = 2`) เป็น source of truth ของการอ่านทั้งหมด · **Firebase Firestore (compat SDK v11.6.0 จาก CDN) เป็น cloud mirror แบบ realtime** ให้ข้อมูลต่อเนื่องข้ามเครื่อง PC / Windows login · ไม่มี build step, ไม่มี package.json/node_modules
- Deploy: GitHub (`supasiao7896TH/Count-time-of-PM-500A-B`), branch `main` — production จริงคือ **Cloudflare Worker** `count-time-of-pm-500a-b.supasiao.workers.dev` (ดูรายละเอียดสำคัญที่หัวข้อ Deploy ใน Commands ด้านล่าง — **ไม่ใช่ GitHub Pages**) เปิดทดสอบ local ผ่าน static server ใดก็ได้ (เช่น local http.server)
- ผู้ใช้งาน: เจ้าหน้าที่กะเดินเครื่อง PTA plant ติดตามชั่วโมงทำงานของหน่วย PM-500A/B

## Commands

- **รันแอป local**: ไม่มี build step — แต่ **ห้ามเปิดผ่าน `file://` ตรงๆ** เพราะฟีเจอร์ "ส่งออกสำเนาแอปแบบ Standalone" (`APP_CORE.handleExportStandaloneHtml`, `app.js` ~บรรทัด 2167) ใช้ `fetch('index.html')`/`fetch('app.js')` โหลดตัวเอง ซึ่ง `fetch()` ใช้ไม่ได้กับ `file://` ต้องรันผ่าน static server เช่น `python -m http.server` ที่ root repo แล้วเปิด `http://localhost:8000`
- **Test / Lint**: ไม่มี test suite, ไม่มี lint config, ไม่มี CI/CD ในโปรเจกต์นี้ — ตรวจสอบด้วยการรันจริงในเบราว์เซอร์เท่านั้น เปิด URL พร้อม `?debug=1` เพื่อดู console log ระดับ info/warn จาก `DEBUG_MODULE` (error แสดงเสมอไม่ต้องเปิด flag)
- **Deploy**: commit + push ไป branch `main` — **ต้อง bump `CACHE_NAME` ใน `sw.js` ทุกครั้ง** ที่แก้ `app.js`/`index.html`/`manifest.webmanifest` (ปัจจุบัน `pm500-tracker-v12`) ไม่งั้น service worker จะเสิร์ฟโค้ดเก่าจาก cache ให้ผู้ใช้ต่อไป
  - **มี GitHub Actions auto-deploy แล้ว** (`.github/workflows/deploy.yml`, ตั้งแต่ 2569-08-06) — push เข้า `main` จะรัน `wrangler deploy` ให้อัตโนมัติผ่าน `wrangler.jsonc` โดย runner ของ GitHub เอง (ไม่ต้องมี Node.js/wrangler ในเครื่อง PC เลยสักเครื่อง) **แต่ต้องตั้ง GitHub Secret ชื่อ `CLOUDFLARE_API_TOKEN` ในหน้า repo Settings ก่อนถึงจะทำงานได้** — ถ้ายังไม่ได้ตั้ง workflow นี้จะ fail และต้อง fallback ไป deploy manual ผ่าน [Cloudflare dashboard](https://dash.cloudflare.com) → Workers & Pages → `count-time-of-pm-500a-b` → "New deployment" → "file" → อัปโหลด `index.html`/`app.js`/`sw.js`/`manifest.webmanifest` → "Deploy" แทน (วิธีนี้คือสาเหตุของบั๊ก "ลบ session/filter history แล้วไม่หายจริง" เมื่อ 2569-08-06 ที่ลืม deploy หลัง push)

## Architecture

### ไฟล์หลักใน repo (ไม่มี subfolder อื่นนอกจาก `icons/`)

- `index.html` (815 บรรทัด) — markup ทั้งหมด + CSS inline ใน `<style>` (บรรทัด 1–382) มี CSP ผ่าน `<meta http-equiv="Content-Security-Policy">` (บรรทัด 11–20) ท้ายบอดี้โหลด Firebase compat SDK 3 ตัวจาก `gstatic.com` (app/auth/firestore) **ก่อน** `<script src="app.js">` เสมอ เพราะ `app.js` ใช้ global `firebase` ตรงๆ (ไม่มี `defer`/`async`/`type=module` พึ่งลำดับ DOM ล้วนๆ)
- `app.js` (2710 บรรทัด) — logic ทั้งหมด แบ่งเป็น 8 IIFE module (ดูด้านล่าง) จบไฟล์ด้วย `document.addEventListener('DOMContentLoaded', () => APP_CORE.init())`
- `sw.js` (63 บรรทัด) — service worker (ดูหัวข้อ PWA ด้านล่าง)
- `manifest.webmanifest` — PWA manifest, `orientation: "landscape"` (ตั้งใจให้ใช้แนวนอน), `lang: "th"`
- `agents.md`, `context.md` — เอกสารเสริมที่ repo root สำหรับคนอ่าน **แต่ไม่ถูก Claude Code auto-load** (auto-load เฉพาะ `CLAUDE.md` ตาม global config ของพี่ A) กฎสำคัญจากทั้งสองไฟล์ถูกดึงมารวมใน `CLAUDE.md` นี้แล้ว — ถ้าจะแก้กฎเหล่านี้ในอนาคต ควร sync กลับไปที่ 2 ไฟล์นั้นด้วยเพื่อไม่ให้เอกสารขัดกัน
- `supasit-brand-footer.html` — ไฟล์เดี่ยวๆ ที่ไม่ถูก reference จากไฟล์ไหนเลยในโปรเจกต์ (dead file, น่าจะเป็น template badge "by Supasit.A" ที่ยังไม่ได้เอามาใช้จริงตาม Brand Rules ด้านล่าง) — อย่าสมมติว่ามันถูกโหลดอยู่จริง

### 8 IIFE Modules ใน `app.js` (ห้ามเพิ่ม module ใหม่โดยไม่จำเป็น, ห้ามสร้าง global function ลอยนอก module — ยกเว้น clickjacking bust-out ที่บรรทัด 1–8 ซึ่งตั้งใจให้อยู่นอก module เพื่อรันก่อนสุด)

1. **`APP_CONFIG`** (บรรทัด 13–145) — ค่าคงที่ (`DB_NAME`, `DB_VERSION`, ชื่อ store, `UNITS`) + ฟังก์ชัน format วันที่/เวลาแบบไทย: `bangkokParts()` / `dayKey()` / `formatDateTimeBE()` (fixed UTC+7, พ.ศ.) **ต้องใช้ฟังก์ชันกลุ่มนี้เสมอสำหรับวันที่-เวลา ห้ามใช้ `Date.toLocaleString()` ตรงๆ** เพราะจะพังถ้า timezone เครื่อง user ไม่ใช่ +7
2. **`DEBUG_MODULE`** (บรรทัด 150–161) — `log(level, scope, message, data)`, เปิด info/warn ด้วย `?debug=1`
3. **`STATE_STORE`** (บรรทัด 166–190) — เก็บ state กลาง (`unitA`/`unitB`/`theme`/`activeView`/...) มี API `set/get/on/off` **แต่ `on`/`off` (pub/sub) ไม่ถูกเรียกใช้จริงที่ไหนเลยในโค้ด** — ในทางปฏิบัติ `APP_CORE` เรียก `STATE_STORE.set()` แล้วเรียก `UI_RENDERER.xxx()` ตามหลังทันทีแบบ imperative เสมอ **ไม่ใช่ reactive จริง — อย่าสมมติว่าการ `set()` จะ trigger re-render อัตโนมัติ**
4. **`STORAGE_ENGINE`** (บรรทัด 195–585) — IndexedDB CRUD แบบ Promise-based, `onupgradeneeded` (บรรทัด ~204–218) สร้าง 3 store แบบ idempotent (guard ด้วย `if (!db.objectStoreNames.contains(...))`):

   ```text
   runtime_sessions  { keyPath:'id', autoIncrement:true, indexes: by_equipment, by_equipment_startTime }
   unit_resets       { keyPath:'equipment' }              // ไม่มี index, ไม่มี autoIncrement
   filter_changes    { keyPath:'id', autoIncrement:true, index: by_equipment }
   ```

   มี `exportAllData()`/`importAllData()` (บรรทัด ~364–397) สำหรับ backup JSON — `importAllData()` จะ **wipe ทั้ง 3 store ก่อนแล้ว `put()` กลับด้วย key เดิม** (ไม่ใช่ merge)
5. **`AUTH_PROVIDER`** (บรรทัด 599–636) — Firebase anonymous auth ไม่มีหน้า login, `Persistence.NONE` (ได้ uid ใหม่ทุกครั้งที่โหลดหน้า) Firestore rules เช็คแค่ "signed in" ไม่ได้ผูกกับ uid เพราะข้อมูลเป็นของเครื่องจักรร่วมกัน ไม่ใช่ของราย user — ใช้ project `radiosync-6662c` **ที่แชร์กับแอปอื่น (RadioSync)**
6. **`CLOUD_SYNC_MANAGER`** (บรรทัด 645–971) — มิเรอร์ write ของ `STORAGE_ENGINE` ขึ้น Firestore แล้วดึงกลับด้วย `onSnapshot` → เขียนลง IndexedDB → เรียก `APP_CORE.refreshAll()` ทำงานโดย **monkey-patch เมธอดของ `STORAGE_ENGINE`** ใน `wrapStorageEngine()` (ไม่ใช่แก้ที่ตัว `STORAGE_ENGINE` เอง) ข้อควรรู้:
   - collection เป็น root-level แบบมี prefix: `pm500_runtime_sessions` / `pm500_unit_resets` / `pm500_filter_changes` **ห้ามย้ายไปใต้ `artifacts/{appId}/...`** เพราะ rules ของ RadioSync จับ path นั้นไว้แล้วและจะ deny เงียบๆ
   - **`db.settings({ ignoreUndefinedProperties: true })` ต้องอยู่ทันทีหลัง `firebase.firestore()` และก่อน operation อื่นใด** ไม่งั้น compat SDK จะ throw `Firestore has already been started`
   - เขียนไม่สำเร็จให้ผ่าน `noteWriteFailure()` เสมอ (log ระดับ `error` + toast ไทย + sticky badge) **ห้าม catch แล้ว log แค่ `warn` เงียบๆ** — นั่นคือสาเหตุที่บั๊กรีเซ็ตไม่ sync ซ่อนตัวอยู่ได้นาน
   - ทุกอย่างต้อง degrade ได้: ถ้า Firebase ใช้ไม่ได้ `db` เป็น `null` แล้วแอปทำงาน local-only ครบทุกฟีเจอร์
7. **`UI_RENDERER`** (บรรทัด 973–1587) — DOM rendering ล้วนๆ ใช้ `textContent`/escape เท่านั้น **ห้าม `innerHTML` กับข้อมูลจากผู้ใช้** (หมายเหตุ, ตัวเลข, ชื่อไฟล์ import ฯลฯ — ดู `escapeHtml()` เป็นตัวอย่าง) แจ้งเตือนผู้ใช้ผ่าน `UI_RENDERER.toast(message, type)` เท่านั้น (`type`: `'info'`/`'warn'`/`'error'`) **ห้าม `alert()`/`confirm()`**
8. **`APP_CORE`** (บรรทัด 1589–2708) — expose แค่ `{ init }`, ทุกอย่างอื่น private — `init()` sequence: render dashboard shell → wire event ทั้งหมด → open IndexedDB → `CLOUD_SYNC_MANAGER.init(refreshAll)` (never throws) → `maybeImportSeedData()` (สำหรับไฟล์ Standalone export ที่ฝัง seed data) → `resumeOpenSessions()` (auto-close duplicate open session ถ้าเจอมากกว่า 1 ต่อเครื่องหลัง reload พร้อมบันทึก `auditLog`) → apply theme/state ที่บันทึกไว้ → `startTicker()` (1s ต่อ unit timer, 30s refresh การ์ดสะสม) → register service worker

### Destructive actions

Import ข้อมูล (แทนที่ทั้งหมด) และการลบข้อมูล ต้องผ่าน `openConfirmModal({ confirmPhrase })` ให้ผู้ใช้พิมพ์ยืนยันก่อนเสมอ — **ห้าม silent delete/overwrite**

### PWA / Service Worker (`sw.js`)

- `CACHE_NAME = 'pm500-tracker-v12'` — ต้อง bump ทุกครั้งที่แก้ `app.js`/`index.html`/`manifest.webmanifest`
- Same-origin GET request: cache-first + background revalidation (เขียน response ใหม่กลับเข้า cache ด้วย) fallback ไป network แล้ว fallback ไป stale cache ถ้า network ล่ม (non-GET request ถูก ignore)
- Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`): stale-while-revalidate — เป็น progressive enhancement เท่านั้น (แอปต้องอ่านออกได้แม้โหลด font ไม่สำเร็จ)
- request ของ Firestore เป็น cross-origin + non-GET จึงไม่ถูก sw แตะเลย (ตั้งใจ — ห้ามเพิ่ม cache ให้เส้นทางนี้ ไม่งั้น realtime sync จะได้ข้อมูลเก่า)

### Security

- CSP กำหนดใน `<meta>` tag (`index.html` บรรทัด 11–20): `default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; ...` — **ถ้าเพิ่ม/เปลี่ยน endpoint ของ Firebase ต้องอัปเดต `connect-src` ด้วย ไม่งั้นจะถูกบล็อกเงียบๆ** และเพราะ meta-tag CSP ไม่รองรับ `frame-ancestors`/`report-uri`/`sandbox` จึงมี **clickjacking bust-out เป็น global code ที่บรรทัดบนสุดของ `app.js`** (นอก module ใดๆ โดยตั้งใจ ต้องรันก่อน module IIFE ทั้งหมด) เป็น defense-in-depth

## Brand Rules

- ภาษา UI เป็นภาษาไทยทั้งหมด รวม error message และ toast, วันที่แสดงแบบ พ.ศ. (BE_OFFSET = 543), timezone คงที่ Asia/Bangkok (UTC+7) ไม่สนใจ timezone เครื่อง
- Dark/Light mode ผ่าน CSS variables + `data-theme` attribute (ค่าเริ่มต้น `auto` ตาม `prefers-color-scheme`), เก็บค่าไว้ที่ `localStorage['pm500_theme']` (แยกจาก IndexedDB)
- ปุ่ม/label ใหม่ใช้ emoji นำหน้าแบบเดียวกับปุ่มเดิม (🧰 ⚙️ 📖 ฯลฯ) เพื่อความสม่ำเสมอ, modal ใหม่ใช้ class `.modal-overlay` + `.modal` เดิม (เพิ่ม `.modal-wide` ถ้าต้องการพื้นที่มากกว่า 460px)
- Glass badge "by Supasit.A" — ยังไม่มีในแอปนี้ (แอปนี้สร้างก่อนกฎ brand ปัจจุบัน — ไม่บังคับเพิ่มย้อนหลังถ้าพี่ A ไม่ได้ขอ ดู `supasit-brand-footer.html` ด้านบน)

## Current Phase

- [x] Phase 1: Local-First HTML (เสร็จสมบูรณ์ — เดินเครื่อง/หยุด/รีเซ็ต/รายงาน/ประวัติเปลี่ยน Filter/แจ้งเตือน/สำรองข้อมูล)
- [ ] Phase 2: AI — ไม่อยู่ในสโคปของแอปนี้
- [x] Phase 3: Cloud Sync — ทำแล้ว (Firebase Firestore realtime mirror, ดู `AUTH_PROVIDER` / `CLOUD_SYNC_MANAGER`) IndexedDB ยังเป็น source of truth ของการอ่าน และแอปต้องทำงานได้ครบแม้ Firebase ใช้ไม่ได้
- [x] Phase 4: Deploy — push ขึ้น GitHub repo `Count-time-of-PM-500A-B`

## Known Issues

- ยังไม่มีอัตโนมัติแจ้งเตือนแบบ push notification — ต้องเปิดแอปเองถึงจะเห็นป้ายเตือน (long-run / PM overdue / filter overdue)
- Export "สำเนาแอปแบบ Standalone" ต้องเปิดผ่าน http(s) เท่านั้น (fetch `index.html`/`app.js` ใช้ไม่ได้ถ้าเปิดแบบ `file://` ตรงๆ)
- `supasit-brand-footer.html` เป็นไฟล์ที่ไม่ถูกใช้งานจริง (dead file) — อย่าสับสนว่ามันถูก render อยู่
- **Cloud sync — จุดที่รู้แล้วว่ายังไม่ถูกต้อง (ยังไม่ได้แก้ พี่ A ยังไม่ได้สั่ง):**
  - `deleteLocal()` ไม่มี branch สำหรับ `unit_resets` → กด "ลบข้อมูลทั้งหมด" ที่เครื่องหนึ่ง เครื่องอื่นจะยังค้าง record รีเซ็ตเดิม (ต้องเพิ่ม `STORAGE_ENGINE.deleteReset()` ซึ่งยังไม่มี)
  - `applyingRemote` เป็น flag ตัวเดียวใช้ร่วมกันทั้ง 3 listener และถูกถือค้างข้าม `await` → ถ้ากดบันทึกพอดีตอนกำลัง apply snapshot จากเครื่องอื่น การ push จะถูกข้ามเงียบๆ (แก้ถูกวิธีคือเลิกใช้ flag แล้วให้ `upsertLocal`/`deleteLocal` เรียกฟังก์ชัน original ที่ยังไม่ถูก wrap)
  - `tryStartSessionCloud()` ใช้ query ไม่ใช่ transaction จึงกันการกด "เริ่มทำงาน" พร้อมกันสองเครื่องได้ไม่ 100% (ยอมรับความเสี่ยงนี้ไว้แล้วโดยตั้งใจ)

## DO NOT

- ❌ ห้ามใช้ `innerHTML` กับข้อมูลที่ผู้ใช้กรอกเอง (หมายเหตุ, ตัวเลข B/V bypass ฯลฯ) — ใช้ `textContent` หรือ escape ก่อนเสมอ
- ❌ ห้ามเปลี่ยน `DB_VERSION` โดยไม่เพิ่ม migration logic ใน `onupgradeneeded`
- ❌ ห้าม hardcode secret ใดๆ — `FIREBASE_CONFIG` ใน `AUTH_PROVIDER` เป็น public web config ที่ตั้งใจฝังในโค้ด client (มาตรฐานของ Firebase web) การควบคุมสิทธิ์จริงอยู่ที่ Firestore Security Rules ไม่ใช่การซ่อน config นี้ — แต่ API key ของบริการอื่น (AI ฯลฯ) ห้ามฝังเด็ดขาด
- ❌ ห้ามแก้ `sw.js` โดยไม่ bump `CACHE_NAME` — ไม่งั้นผู้ใช้จะได้โค้ดเก่าจาก cache
- ❌ ห้ามลบ/แก้ฟิลด์ใน record ของ IndexedDB โดยไม่ตรวจว่า `saveReset()` เป็น full-overwrite (ทุก field ที่ไม่ส่งมาจะหายไป) — ต้อง carry-forward field เดิมเสมอเมื่อ save (`lastResetAt`, `resetHistory`, `pmTargetDays`, `filterTargetHours`) **ใช้ helper `buildResetRecord(unit, existing, patch)` ใน `APP_CORE` เสมอ อย่าประกอบ record เอง**
- ❌ ห้ามใส่ค่า `undefined` ลงฟิลด์ของ record ที่จะถูกมิเรอร์ขึ้น Firestore — ใช้ `null` หรือค่า default เสมอ **Firestore ปฏิเสธทั้ง document ถ้าเจอ `undefined` แม้ฟิลด์เดียว ในขณะที่ IndexedDB รับได้ปกติ** การเขียนในเครื่องจึงสำเร็จแต่ cloud เงียบ (ระวังรูปแบบ `x: existing && existing.foo` ซึ่งให้ `undefined` — นี่คือบั๊กที่ทำให้รีเซ็ตไม่ sync ข้ามเครื่อง แก้เมื่อ 2569-08-07) และห้ามใช้ค่า default ที่คำนวณตอนอ่านอย่างเดียวโดยไม่เก็บลง store
- ❌ ห้ามลบ/reset ข้อมูลทดสอบหรือข้อมูลจริงโดยไม่ผ่าน confirm modal ที่มีอยู่แล้ว (`openConfirmModal({ confirmPhrase })`)
- ❌ ห้ามใช้ `alert()`/`confirm()` — ใช้ `UI_RENDERER.toast()` หรือ modal ที่มีอยู่แล้วเท่านั้น
- ❌ ห้าม push ขึ้น GitHub เองโดยไม่ถามพี่ A ก่อนทุกครั้ง (แม้ session ก่อนหน้าจะเคยอนุญาตแล้วก็ตาม)
- ❌ ห้ามลบฟีเจอร์เดิมเพื่อ "ทำความสะอาดโค้ด" โดยพี่ A ไม่ได้ขอ
