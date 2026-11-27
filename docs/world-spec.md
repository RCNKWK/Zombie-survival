# World Spec: Deadzone County (Project Zomboid-inspired Co-op Survival)

## 1. สำหรับทีม platform (ตั้งใน Admin → Games)

| ช่อง | ค่า |
|---|---|
| ชื่อ / slug | Deadzone County / `deadzone-county` |
| Type | **`world`** |
| Game address (`launchUrl`) | `https://<service>.onrender.com/` (ต้องเป็น https, ฝัง iframe ได้) |
| Game server address | `wss://<service>.onrender.com/ws` |
| Players min / max | **2 / 8** (นับเจ้าของโลกด้วย) |
| ติดต่อทีม | TBD |

## 2. การออกแบบระบบโลกและการเซฟ

| หัวข้อ | คำตอบ |
|---|---|
| โลกคืออะไร / ขนาด / สร้างจาก seed หรือเก็บทั้งก้อน | เมือง Deadzone County ขนาด 480×480 หน่วย (240×240 tiles) สร้างแผนที่ ถนน อาคาร 52 แห่งใน 4 ย่าน เชื่อมด้วยถนน พร้อมจุดค้นของ 208 จุด ต้นไม้ รถ และโครงสร้างคงที่จาก `seed` แบบ deterministic และเก็บเฉพาะ state ที่เปลี่ยน (container ที่ค้นแล้ว/เหลืออะไร, สิ่งปลูกสร้างของผู้เล่น, ของตกพื้น/สุ่มดรอป, เวลาโลก) |
| เรียลไทม์หรือเทิร์น · tick rate | เรียลไทม์ 20 ticks/sec (fixed-step `4ms` loop + accumulator), client interpolation ~100ms |
| อะไรอยู่ในเซฟส่วนตัว (`me.save`) | ตำแหน่งล่าสุด, มุมมอง, HP, Stamina, ความหิว/กระหาย, อาการเลือดออก, ระดับความตื่นตระหนก, แบตไฟฉาย, ช่องอาวุธที่ถือ, ช่องเก็บของ 16 ช่อง, สถิติสังหารซอมบี้/จำนวนวันที่รอด |
| อะไรอยู่ในสถานะโลก (เซฟเจ้าของ `world`) · ขนาดโดยประมาณ | `seed`, เวลาในเกม (`worldTimeMin`, `day`), `lastSavedAt`, สถานะกล่องเก็บของที่เปิดแล้ว (`containers`), สิ่งปลูกสร้าง/กับดัก/กองไฟ (`barricades`), ของตกพื้น (`droppedLoot`). ขนาดรวม ~5–40 KB (เพดาน 256 KB, เตือนที่ 150 KB) |
| งานที่ต้อง "เดินต่อตอนออฟไลน์" | เมื่อโหลดโลกขึ้นมาใหม่ จะคำนวณเวลาจริงที่ผ่านไปจาก `lastSavedAt` เพื่อขยับเวลาในโลกแบบจำกัดเพดานและเติมของในกล่องที่หมดอายุตามรอบวัน โดยไม่ลดความหิว/HP ของผู้เล่นที่ออฟไลน์ |
| ผู้เล่นแก้ของของกันได้ไหม | ทุกคนในโลกช่วยกันลูท, สร้าง/ซ่อมสิ่งกีดขวาง, จุดกองไฟ, และเก็บของตกพื้นได้ (co-op). เจ้าของโลกมี `role: 'owner'` |
| `WORLD_CLOSED_POLICY` | `continue` (คนที่อยู่ในโลกเล่นต่อได้ ไม่รับคนใหม่; ปลด instance เมื่อว่าง) |
| `RECONNECT_GRACE_MS` / `AUTOSAVE_MS` | `20000` ms (20 วิ) / `45000` ms (45 วิ) |
| ถ้าเซฟโลกเกิน 256 KB: แผนคืออะไร | จำกัดจำนวนของตกพื้น (auto-despawn ชิ้นเก่าสุดเมื่อเกิน 500 กอง) และเก็บเฉพาะกล่องที่ถูกเปิด/แก้ไขต่างจาก seed |
| ที่เก็บคิวเซฟที่ส่งไม่สำเร็จ | ไฟล์ `.data/pending-saves.json` (เขียนแบบ atomic `.tmp` + rename) บน Persistent Disk |

## Expanded county
- New worlds start with 24 ground-loot piles. Old saves receive up to 18 additional piles in the new districts once, capped at 500 total.
- Original district coordinates and IDs remain stable.
- Server-side invisible boundaries constrain movement, knockback and dropped loot.

## Searching and selective pickup
Containers take 2–5 seconds to search on the server. Contents are sent only to the searching player after completion. Moving, damage, combat, closing or disconnecting cancels the session. Previously searched containers reopen immediately until restocking. Transfers support one item, one stack or all, preserve overflow in the source and use item identity plus durability to avoid stale-row multiplayer races. Existing ground loot is preserved when loading older saves.
