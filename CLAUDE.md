# CLAUDE.md — PM-500 Runtime Tracker

## Project Context
- ชื่อแอป: PM-500 Runtime Tracker
- Stack: Single-page vanilla HTML/CSS/JS · IndexedDB (`pm500_tracker_db`, `DB_VERSION = 2`) · ไม่มี build step
- Deploy: GitHub (`supasiao7896TH/Count-time-of-PM-500A-B`), เปิดผ่าน static server ใดก็ได้ (GitHub Pages / local http.server)
- Branch: main
- ผู้ใช้งาน: เจ้าหน้าที่กะเดินเครื่อง PTA plant ติดตามชั่วโมงทำงานของหน่วย PM-500A/B

## Architecture
- Pattern: IIFE modules (subset ของ 9-module pattern — แอปนี้ local-only ไม่มี cloud/auth/AI จึงใช้แค่ 6 module)
  1. `APP_CONFIG` — constants, ค่าคงที่, ฟังก์ชัน format วันที่/ตัวเลขแบบไทย (พ.ศ., UTC+7 คงที่)
  2. `DEBUG_MODULE` — logger เบา ๆ (`?debug=1` เปิด log ระดับ info/warn, error แสดงเสมอ)
  3. `STATE_STORE` — reactive pub/sub (`set/get/on/off`) เก็บ state ของ unit A/B, theme, active view
  4. `STORAGE_ENGINE` — IndexedDB CRUD แบบ Promise-based ครบทุก store + aggregation queries
  5. `UI_RENDERER` — DOM rendering ล้วน ๆ ใช้ `textContent` เท่านั้น ไม่ใช้ `innerHTML` กับข้อมูลผู้ใช้
  6. `APP_CORE` — `init()`, event wiring, ticker, resume-on-load, PWA service worker registration
- Storage: IndexedDB stores — `runtime_sessions` (log แต่ละรอบเดินเครื่อง), `unit_resets` (keyed by equipment, เก็บ `lastResetAt`/`pmTargetDays`/`filterTargetHours`/`resetHistory[]`), `filter_changes` (keyed by id, ประวัติเปลี่ยน Filter)
- ไม่มี Cloud sync / Auth / AI — ข้อมูลอยู่ในเครื่อง (IndexedDB) เท่านั้น, สำรอง/กู้คืนผ่านฟีเจอร์ Import/Export JSON ในเมนู "ตั้งค่า"

## Brand Rules
- ภาษา UI เป็นภาษาไทยทั้งหมด, วันที่แสดงแบบ พ.ศ. (BE_OFFSET = 543), timezone คงที่ Asia/Bangkok (UTC+7) ไม่สนใจ timezone เครื่อง
- Dark/Light mode ผ่าน CSS variables + `data-theme` attribute (ค่าเริ่มต้น auto ตาม `prefers-color-scheme`)
- Glass badge "by Supasit.A" — ยังไม่มีในแอปนี้ (แอปนี้สร้างก่อนกฎ brand ปัจจุบัน — ไม่บังคับเพิ่มย้อนหลังถ้าพี่ A ไม่ได้ขอ)

## Current Phase
- [x] Phase 1: Local-First HTML (เสร็จสมบูรณ์ — เดินเครื่อง/หยุด/รีเซ็ต/รายงาน/ประวัติเปลี่ยน Filter/แจ้งเตือน/สำรองข้อมูล)
- [ ] Phase 2: AI — ไม่อยู่ในสโคปของแอปนี้
- [ ] Phase 3: Cloud Sync — ไม่อยู่ในสโคปของแอปนี้ (ตั้งใจให้เป็น local-only)
- [x] Phase 4: Deploy — push ขึ้น GitHub repo `Count-time-of-PM-500A-B`

## Known Issues
- ยังไม่มีอัตโนมัติแจ้งเตือนแบบ push notification — ต้องเปิดแอปเองถึงจะเห็นป้ายเตือน (long-run / PM overdue / filter overdue)
- Export "สำเนาแอปแบบ Standalone" ต้องเปิดผ่าน http(s) เท่านั้น (fetch `index.html`/`app.js` ใช้ไม่ได้ถ้าเปิดแบบ `file://` ตรง ๆ)

## DO NOT
- ❌ ห้ามใช้ `innerHTML` กับข้อมูลที่ผู้ใช้กรอกเอง (หมายเหตุ, ตัวเลข B/V bypass ฯลฯ) — ใช้ `textContent` หรือ escape ก่อนเสมอ
- ❌ ห้ามเปลี่ยน `DB_VERSION` โดยไม่เพิ่ม migration logic ใน `onupgradeneeded`
- ❌ ห้าม hardcode API key ใด ๆ (แอปนี้ไม่มี AI/cloud feature อยู่แล้ว แต่ถ้าจะเพิ่มในอนาคตต้องเข้ารหัสก่อนเก็บ)
- ❌ ห้ามแก้ `sw.js` โดยไม่ bump `CACHE_NAME` — ไม่งั้นผู้ใช้จะได้โค้ดเก่าจาก cache
- ❌ ห้ามลบ/แก้ฟิลด์ใน record ของ IndexedDB โดยไม่ตรวจว่า `saveReset()` เป็น full-overwrite (ทุก field ที่ไม่ส่งมาจะหายไป) — ต้อง carry-forward field เดิมเสมอเมื่อ save
