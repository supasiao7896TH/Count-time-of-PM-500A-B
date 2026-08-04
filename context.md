# context.md — PM-500 Runtime Tracker

> Auto-generated project overview (Vibe Coding — MilerDev Super Power Method). อ่านไฟล์นี้ก่อนเริ่มงานใน session ใหม่ เพื่อไม่ต้องอธิบาย context ซ้ำ.

## ภาพรวม

แอปติดตามชั่วโมงทำงานของหน่วย PM-500A และ PM-500B (ปั๊ม/ฟิลเตอร์ที่โรงงาน PTA) — ใช้แทนการจดชั่วโมงด้วยมือ เพื่อวางแผนรอบ PM (Preventive Maintenance) และติดตามค่าใช้จ่ายจากการเปลี่ยน Filter แอปเป็น single-page PWA ไม่มี backend, เก็บข้อมูลทั้งหมดใน IndexedDB ของเบราว์เซอร์ผู้ใช้เอง

**ไฟล์หลัก:** `index.html` (markup + CSS ทั้งหมด) และ `app.js` (logic ทั้งหมด) — ไม่มีไฟล์อื่นที่มีโค้ด ไม่มี build step, เปิดได้ทันทีผ่าน static server ใดก็ได้

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI | Vanilla HTML/CSS/JS, SVG (ท่อ/ถังแบบ animated) |
| State | Reactive pub/sub เขียนเอง (`STATE_STORE`) |
| Storage | IndexedDB (`pm500_tracker_db`, `DB_VERSION = 2`) |
| PWA | `manifest.webmanifest` + `sw.js` (cache-first app shell, stale-while-revalidate สำหรับ Google Fonts) |
| Deploy | GitHub repo `supasiao7896TH/Count-time-of-PM-500A-B`, branch `main` |

## ฟีเจอร์หลักที่มีอยู่ตอนนี้

1. **เริ่ม/หยุดทำงาน** — จับเวลาแบบ real-time ต่อหน่วย, บันทึกเป็น session log เมื่อหยุด
2. **ชั่วโมงสะสม + เป้าหมาย PM** — นับสะสมตั้งแต่รีเซ็ตล่าสุด, ตั้งเป้าหมายวันได้แยกต่อเครื่อง, แถบ progress ในถัง SVG
3. **รีเซ็ตชั่วโมงสะสม** — บันทึก PD-2500.PV, จำนวนรอบเปิด B/V bypass PE-501/LCV-2502 (รองรับเศษส่วนเช่น 1/4, 1/2), หมายเหตุ (dropdown + custom text), รองรับ **รีเซ็ตย้อนหลัง** (เลือกวันที่/เวลาในอดีต ระบบคำนวณชั่วโมงสะสม ณ เวลานั้นให้)
4. **แก้ไข Session ย้อนหลัง** — รวมถึงแก้ "เวลาหยุด" ของ session ที่ยังเปิดอยู่ (แก้ปัญหาลืมกดหยุด) โดยไม่ต้องกดหยุดสด
5. **ประวัติการเปลี่ยน Filter** — นับจำนวนครั้ง, ค่าใช้จ่าย, หมายเหตุ ต่อเครื่อง พร้อมตารางประวัติแก้ไข/ลบได้ (แสดงทั้งในแท็บ Filter และท้าย Dashboard)
6. **แจ้งเตือนบนการ์ด Dashboard** (แบบ binary, ไม่มี two-tier):
   - เกินเป้าหมาย PM แล้ว (progress ≥ 100%)
   - ถึงกำหนดเปลี่ยน Filter แล้ว (ชั่วโมงทำงานสะสมนับจากเปลี่ยน Filter ครั้งล่าสุด ≥ เป้าหมายที่ตั้งไว้ต่อเครื่อง ค่าเริ่มต้น 720 ชม.)
   - คาดว่าจะถึงคิวเปลี่ยน Filter รอบหน้า (เทียบชั่วโมงสะสมนับจากรีเซ็ต PM ล่าสุดระหว่าง A กับ B เครื่องที่สะสมมากกว่าจะขึ้นป้ายนี้ล่วงหน้า — แยกกลไกจากป้ายเตือนด้านบน)
7. **รายงานสรุป** — แยกดูทีละเครื่อง (A/B) รายวัน/รายเดือน + กราฟชั่วโมงใช้งานต่อรอบ PM
8. **ตั้งค่า** (เมนูใหม่ล่าสุด) — นำเข้า/ส่งออกข้อมูลทั้งหมดเป็น JSON (import จะแทนที่ข้อมูลเดิมทั้งหมด มี confirm พิมพ์ยืนยัน), ส่งออกรายงานสรุปเป็นไฟล์ HTML พิมพ์ได้, ส่งออกสำเนาแอปแบบ Standalone HTML (ฝังข้อมูลปัจจุบันไว้ในไฟล์ เปิดใช้งานต่อได้ทันทีโดยไม่ต้อง import)
9. **คู่มือการใช้งาน** — modal สรุปวิธีใช้ทุกฟีเจอร์ข้างต้น

## Data Model (IndexedDB)

```
runtime_sessions   { id (autoInc), equipment: 'A'|'B', startTime, endTime|null, durationSec|null, auditLog[] }
unit_resets        { equipment (key): 'A'|'B', lastResetAt, pmTargetDays, filterTargetHours, resetHistory: [{ts, hoursAtReset, note, pd2500Pv, pe501OpenCount, lcv2502OpenCount}] }
filter_changes     { id (autoInc), equipment: 'A'|'B', changedAt, cost, note }
```

## ข้อจำกัด / สิ่งที่รู้อยู่แล้ว

- ไม่มี cloud sync — ถ้าเปลี่ยนเครื่อง/เบราว์เซอร์ต้อง export→import ข้อมูลเอง (ฟีเจอร์นี้เพิ่งเพิ่มในเมนูตั้งค่า)
- ป้ายเตือนทั้งหมดเป็นแบบ pull (ต้องเปิดแอปดู) ไม่มี push notification
- "สำเนาแอป Standalone" ใช้ `fetch()` โหลด `index.html`/`app.js` ของตัวเอง — ต้องเปิดผ่าน http/https เท่านั้น ใช้ไม่ได้ถ้าเปิดไฟล์ตรง ๆ แบบ `file://`

## ประวัติการพัฒนา (session ล่าสุดสรุปคร่าว ๆ)

ไล่จากฟีเจอร์ visual (ท่อโค้ง/เม็ดน้ำวนในถัง) → เพิ่ม tracking การเปลี่ยน Filter → แยกรายงานตามเครื่อง → เพิ่มการบันทึก process value ตอนรีเซ็ต → รองรับแก้ไขย้อนหลัง (session/reset) → แจ้งเตือนถึงกำหนดเปลี่ยน Filter → เมนูตั้งค่า (import/export/คู่มือ) — ดูรายละเอียดทั้งหมดใน `git log`
