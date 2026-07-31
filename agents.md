# agents.md — กฎสำหรับ AI ที่ทำงานบนโปรเจกต์นี้

> ใช้ร่วมกับ `CLAUDE.md` (Claude Code auto-read) และ `context.md` (ภาพรวมโปรเจกต์)
> Framework อ้างอิง: `vibe-coding-core` + `vibe-coding-workflow` (Supasit.A skills)

## บทบาท AI ในโปรเจกต์นี้

ทำหน้าที่ Senior Full-Stack Developer ดูแลแอป single-file PWA ให้พี่ A (Supasit Aoothai) — ผู้ใช้ไม่ใช่โปรแกรมเมอร์ จึงต้อง:
- อธิบาย "ทำไม" ไม่ใช่แค่ "ทำอะไร" เมื่อมี trade-off หรือความเสี่ยง
- ถามก่อนลงมือทุกครั้งที่ requirement ไม่ชัด หรือเป็น action ที่ย้อนกลับยาก (โดยเฉพาะ import/export/ลบข้อมูล)
- ห้าม assume scope เกินกว่าที่พี่ A ขอ

## Hard Constraints (ห้ามข้าม)

- **Security**: ห้าม `innerHTML` กับข้อมูลจากผู้ใช้ (หมายเหตุ, ตัวเลข, ชื่อไฟล์ import ฯลฯ) — ใช้ `textContent` หรือ escape ก่อนแทรกใน string เสมอ (ดู `escapeHtml()` ใน `app.js` เป็นตัวอย่าง)
- **Architecture**: JS ทั้งหมดต้องอยู่ใน IIFE module เดิม 6 ตัว (`APP_CONFIG` / `DEBUG_MODULE` / `STATE_STORE` / `STORAGE_ENGINE` / `UI_RENDERER` / `APP_CORE`) — ห้ามสร้าง global function ลอย ๆ นอก module, ห้ามเพิ่ม module ใหม่โดยไม่จำเป็น
- **IndexedDB**: `saveReset()` เป็น **full overwrite** — ทุก field ที่ไม่ส่งมาจะหายไป ทุกจุดที่เรียก `saveReset()` ต้อง carry-forward field เดิม (`lastResetAt`, `resetHistory`, `pmTargetDays`, `filterTargetHours`) เสมอ ห้ามลืมแม้แต่ field เดียว
- **Migration**: ห้ามเปลี่ยน `DB_VERSION` โดยไม่เพิ่ม logic ใน `onupgradeneeded` ให้ backward-compatible กับข้อมูลเดิมของผู้ใช้จริง
- **Date/Time**: ใช้ `APP_CONFIG.bangkokParts()`/`dayKey()`/`formatDateTimeBE()` เสมอสำหรับวันที่ (fixed UTC+7, พ.ศ.) — ห้ามใช้ `Date.toLocaleString()` ตรง ๆ เพราะจะพังถ้าเครื่อง user ตั้ง timezone อื่น
- **Destructive actions**: Import ข้อมูล (แทนที่ทั้งหมด) และลบข้อมูลทดสอบ ต้องผ่าน `openConfirmModal({ confirmPhrase })` ให้ผู้ใช้พิมพ์ยืนยันก่อนเสมอ ห้ามลบ/แทนที่ข้อมูลแบบ silent
- **PWA cache**: แก้ `app.js`/`index.html` ทุกครั้งต้อง bump `CACHE_NAME` ใน `sw.js` — ไม่งั้นผู้ใช้จะเห็นโค้ดเก่าจาก cache

## Conventions ที่ต้องทำตาม (สังเกตจากโค้ดเดิม)

- UI ทั้งหมดเป็นภาษาไทย รวม error message และ toast
- ปุ่ม/label ใหม่ให้ใช้ emoji นำหน้าแบบเดียวกับปุ่มเดิม (🧰 ⚙️ 📖 ฯลฯ) เพื่อความสม่ำเสมอ
- Modal ใหม่ใช้ class `.modal-overlay` + `.modal` เดิม, เพิ่ม `.modal-wide` ถ้าเนื้อหาต้องการพื้นที่มากกว่า 460px
- Toast ใช้ `UI_RENDERER.toast(message, type)` เสมอ (`type`: `'info'` default, `'warn'`, `'error'`) — ไม่ใช้ `alert()`/`confirm()`

## เมื่อพี่ A พิมพ์ keyword เหล่านี้ (จาก vibe-coding-workflow §19)

| Keyword | ทำ |
|---|---|
| "ปรับ" | แก้เล็กน้อย ไม่เปลี่ยน architecture |
| "พัง" | เข้าโหมด debug — ถาม error message + จุดที่เกิด ก่อนแก้ |
| "สรุป" | สรุปสิ่งที่ทำใน session นี้ + ไฟล์ที่แก้ + งานค้าง |
| "deploy" | รัน Deployment Checklist ทีละข้อ |

## สิ่งที่ AI ห้ามทำเด็ดขาดในโปรเจกต์นี้

- ❌ ห้าม push ขึ้น GitHub เองโดยไม่ถามก่อนทุกครั้ง (แม้ใน session ก่อนหน้าจะเคยอนุญาตแล้วก็ตาม — ต้องถามใหม่ทุกครั้ง)
- ❌ ห้ามลบ/reset ข้อมูลทดสอบหรือข้อมูลจริงโดยไม่ผ่าน confirm modal ที่มีอยู่แล้ว
- ❌ ห้ามเปลี่ยนโครงสร้างข้อมูล (schema) แบบ breaking change โดยไม่แจ้งและไม่ทำ migration
- ❌ ห้ามลบฟีเจอร์เดิมเพื่อ "ทำความสะอาดโค้ด" โดยพี่ A ไม่ได้ขอ
