# HANDOFF.md — PM-500 Runtime Tracker

> ใช้ส่งต่อ session ข้ามเครื่อง (บ้าน ↔ ที่ทำงาน) ตาม workflow ของพี่ A — GitHub คือสะพานซิงค์หลัก

## 🔗 Quick Link (สำหรับวางใน Excel)

คัดลอกสูตรด้านล่างไปวางในเซลล์ Excel เพื่อสร้างลิงก์เปิดแอปโดยตรง (กันปัญหาลิงก์หายเวลาคัดลอกมาจากที่อื่น):

```
=HYPERLINK("https://count-time-of-pm-500a-b.supasiao.workers.dev/", "@Open PM-500 Tracker")
```

- **URL:** https://count-time-of-pm-500a-b.supasiao.workers.dev/ (production จริง — Cloudflare Worker)
- **Label ที่แสดง:** `@Open PM-500 Tracker`

## สถานะล่าสุด

- 2569-08-07: sync เอกสาร `agents.md`/`context.md` ให้ตรงกับ `CLAUDE.md` (เพิ่ม cloud sync, module 6→8) — ไม่มีงานค้าง
