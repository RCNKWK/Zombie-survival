# 🌍 WORLD STARTER — Persistent Multiplayer World (Three.js)

> ไฟล์กลางสำหรับเปิดโปรเจคเกมแบบ **โลก (world)** ที่เล่นยาว ไม่มีรอบแพ้ชนะ ผู้เล่นมี **เซฟ** ของตัวเอง
> วิธีใช้: ก๊อปไฟล์นี้ไปไว้ที่ root ของโปรเจคใหม่ (หรือเปลี่ยนชื่อเป็น `CLAUDE.md`) พร้อม `world-integration-guide.md` แล้วแปะ **Kickoff Prompt** ข้างล่างให้ Claude
> เกมแบบแข่งเป็นรอบ ๆ (มีอันดับ จ่ายเหรียญ) ใช้ `GAME-STARTER.md` แทน · สัญญากับ platform ฉบับเต็มอยู่ที่ `world-integration-guide.md` (ไฟล์นี้สรุปเฉพาะส่วนที่กระทบการออกแบบเกม)

## ต่างจากเกมแบบแข่งอย่างไร (อ่านก่อน)

| เรื่อง | เกมแบบแข่ง (`match`) | เกมแบบโลก (`world`) |
|---|---|---|
| ห้อง / lobby / ready / start / rematch | เกมไม่ต้องทำ platform ทำให้ | **เกมไม่ต้องทำ** platform ดูแลเจ้าของ โลกเปิด/ปิด รายชื่อสมาชิก รหัสเชิญ |
| matchmaking, room code, quick play | ไม่มี | **ไม่มี** (ห้ามทำซ้ำกับ platform) |
| จุดจบ | จบด้วยอันดับ → `reportResult` | **ไม่มีจุดจบ** ไม่มี `reportResult` ไม่มี `ended` |
| เหรียญ / XP / เวลาเล่น | platform จ่ายจากอันดับ | **ไม่มีเลย** |
| ข้อมูลที่ต้องเก็บ | ไม่มี (ผลอย่างเดียว) | **เซฟของผู้เล่นทุกคน** (JSON ≤ 256 KB ต่อคนต่อโลก) |
| ตัวตนผู้เล่น | `identify` ด้วย token ของ session | `identify` ด้วย token ของ **โลก** (audience ต่างกัน ใช้สลับกันไม่ได้) |
| อายุของ server | มีแค่ช่วง match | **โลกอยู่นาน** server ต้องรอดเรื่อง restart / ผู้เล่นหลุดแล้วไม่เสียความคืบหน้า |
| งานยากที่สุด | netcode + กติกา | **ระบบเซฟ** (autosave, เซฟตอนหลุด, retry, migrate รูปแบบเซฟ) |

---

## 0. Kickoff Prompt (แปะอันนี้ตอนเริ่มโปรเจค)

```text
อ่าน WORLD-STARTER.md และ world-integration-guide.md ทั้งสองไฟล์ แล้วสร้างโปรเจคเกมโลกใหม่ตามนั้น

เกม: <ชื่อเกม> — <คำอธิบาย 1–2 บรรทัด>
ผู้เล่นต่อโลก: <min>–<max> คน (max = Players max ที่ตั้งใน Admin) · เล่นบน PC + มือถือผ่าน browser
ประเภทโลก: <sandbox / survival / ฟาร์ม / ฯลฯ> · แบบเรียลไทม์หรือเทิร์น: <...>
สิ่งที่ผู้เล่นแต่ละคนมี (ไปอยู่ในเซฟส่วนตัว): <ตัวละคร, ของ, เลเวล, ตำแหน่ง ...>
สิ่งที่เป็นของโลกร่วมกัน (ไปอยู่ในเซฟของเจ้าของโลก): <แมพ, สิ่งปลูกสร้าง, เวลาในเกม ...>
กฎเฉพาะเกม: <แนบ spec หรือเขียนสรุปกติกา>

ขั้นตอน:
1. Phase 1: โครง + LocalAdapter + world instance + เซฟ/โหลดลงไฟล์ ให้ npm run dev แล้วเปิด 2 แท็บเข้าโลกเดียวกันเห็นกันได้ (ยังเป็นลูกบาศก์ได้)
2. Phase 2: simulation + กติกาใน shared/ + schema เซฟ + migrate + test (ยังไม่ต้องมีภาพ 3D) ต้องมี test "serialize → save → load → ได้โลกเดิม"
3. Phase 3: ฉาก 3D ฝั่ง client ต่อกับ snapshot/event จาก server ให้เล่นได้ครบ loop
4. Phase 4: ระบบเซฟจริง (NakaWorldAdapter): autosave, เซฟตอนหลุด, retry + คิวลงดิสก์, graceful shutdown, poll สถานะโลก, reconnect, ผู้เล่นหลุดเพราะออกจากโลก
5. Phase 5: มือถือ, performance, deploy
ยังไม่ต้องเรียก platform จริงจนถึง Phase 4 แต่ให้วาง WorldPlatformAdapter ไว้ตั้งแต่ Phase 1 ตามส่วนที่ 5
แต่ละ Phase จบให้รัน typecheck + test + เปิดเล่นจริงใน browser ยืนยันก่อนไปต่อ
ห้ามเขียนชื่อ Naka หรือเรียก fetch ไป platform ใน game logic: ทุกอย่างผ่าน adapter เท่านั้น
```

---

## 1. Tech Stack (ล็อกไว้)

| ส่วน | ใช้ |
|---|---|
| ภาษา | TypeScript strict ทั้งโปรเจค (`tsc --noEmit` ต้องผ่านตลอด) |
| Client | **Three.js** + Vite · ไม่ใช้ React/framework |
| Server | Node ≥ 22 + `ws` · รันด้วย `tsx` · server ตัวเดียวเสิร์ฟทั้งหน้าเว็บ (`dist/`) และ WebSocket `/ws` |
| Dev | `concurrently` รัน server (watch) + Vite พร้อมกัน · Vite proxy `/ws` → server |
| Deploy | Render / Railway / Fly · region **Singapore** · **ต้องเป็น host ที่ถือ WebSocket ค้างได้ และมี disk หรือ DB ถาวร** (ไม่ใช่ serverless) |

### package.json scripts มาตรฐาน
```json
{
  "dev": "concurrently -k -n server,client \"npm:dev:server\" \"npm:dev:client\"",
  "dev:server": "tsx watch server/index.ts --port 2567 --dev",
  "dev:client": "vite --port 5173 --strictPort",
  "build": "vite build",
  "start": "tsx server/index.ts",
  "typecheck": "tsc --noEmit",
  "test": "tsx --test \"shared/**/*.test.ts\" \"server/**/*.test.ts\"",
  "bots": "tsx scripts/bots.ts",
  "check:save": "tsx scripts/check-save.ts"
}
```

### vite.config.ts
```ts
export default defineConfig({
  root: 'client',
  envDir: '..',          // .env อยู่ที่ root
  base: './',            // platform เสิร์ฟเกมจาก subfolder และฝังใน iframe
  build: { outDir: '../dist', emptyOutDir: true },
  server: { host: true, port: 5173, proxy: { '/ws': { target: 'ws://localhost:2567', ws: true } } },
});
```
`host: true` = มือถือใน Wi-Fi เดียวกันเปิดทดสอบได้

---

## 2. โครงสร้างโฟลเดอร์

```
shared/            โค้ดที่ server + client ใช้ร่วมกัน (ห้าม import three / DOM / node)
  constants.ts     ตัวเลขปรับเกมทั้งหมด (tick rate, autosave, ขนาดโลก, ขีดจำกัดเซฟ)
  protocol.ts      type ของทุกข้อความ ClientMsg / ServerMsg (discriminated union ด้วย `t`)
  sim.ts           simulation แบบ pure function: (worldState, input, dt) → state ใหม่ + events
  save.ts          schema เซฟ: type, CURRENT_VERSION, serialize(), deserialize(), migrate()
  *.test.ts        test ของ sim และ save
server/
  index.ts         http (เสิร์ฟ dist) + WebSocketServer + WorldManager + graceful shutdown
  worlds.ts        WorldManager: worldId → World instance, โหลดตอนมีคนแรกเข้า, ปลดเมื่อคนสุดท้ายออก
  world.ts         World: state ในหน่วยความจำ, ผู้เล่นที่ออนไลน์, tick loop, dirty flag, autosave
  saves.ts         SaveQueue: เซฟ + retry (saveKey เดิม) + คิวลงดิสก์ + batch ตอนปิด server
  bot.ts           NPC / บอทสำหรับทดสอบ (ถ้ามี)
  platform/
    adapter.ts     WorldPlatformAdapter (interface)
    local.ts       LocalAdapter: เซฟลงไฟล์ ไม่ต้องมี platform (ใช้ตอนพัฒนา)
    naka.ts        NakaWorldAdapter: เรียก /internal/worlds/* ด้วย server key
client/
  index.html
  src/
    main.ts        boot: อ่าน ?world + #token (ลบทันที) → เชื่อม WS → โหลด → ส่ง ready
    net.ts         WebSocket client + resume token + reconnect + ping
    game.ts        state ฝั่ง client + รับ snapshot/event มาแสดง
    input.ts       mouse/touch/keyboard รวมเป็น input เดียวกัน
    ui.ts          HUD, ปุ่ม Leave, หน้า error ("โลกปิดอยู่", "ลิงก์หมดอายุ")
    render/        ฉาก 3D (Three.js) แยกจาก logic เกม
  public/
scripts/           bots.ts, check-save.ts, curl-smoke.sh
docs/              game overview + save format (md)
.data/             (gitignore) เซฟของ LocalAdapter + คิวเซฟที่ส่งไม่สำเร็จ
```

**กฎ:** logic เกมอยู่ `shared/` เสมอ · server เป็นคนตัดสิน · client แค่แสดงผล + ส่ง input · **ไม่มีที่ไหนนอก `server/platform/` ที่รู้จัก platform**

---

## 3. Netcode & Server Rules

1. **Server-authoritative 100%** — client ส่งแค่ input/ความตั้งใจ (`{t:'move', dx, dy}`, `{t:'place', x, y, item}`) server ตรวจแล้วค่อยเปลี่ยนโลก
2. **ห้ามเชื่อ client เรื่องเซฟ** — เซฟมาจาก state ใน server เสมอ ไม่รับ "เซฟของฉันคือ ..." จาก client และไม่ส่ง save blob ดิบไปให้ client
3. **validate ทุก field** (type, ช่วงค่า, ระยะ, ของอยู่ในกระเป๋าจริงไหม, cooldown) และจำกัดข้อความ/วิ ต่อ socket
4. **ข้อมูลลับส่งเฉพาะคนที่ควรเห็น** + **interest management**: โลกใหญ่ส่งเฉพาะสิ่งที่อยู่ใกล้ผู้เล่น (grid/chunk) ไม่ broadcast ทั้งโลก
5. **ข้อความสั้น** key สั้นใน snapshot ที่ส่งบ่อย ส่งเฉพาะที่เปลี่ยน (delta) เพื่อมือถือ
6. **Loop แบบ fixed-step + catch-up** (`setInterval` 4ms + accumulator) เพราะ timer Windows drift
   - เรียลไทม์: tick 20–30/s + client prediction + interpolation ~100ms
   - เทิร์น/ช้า: tick 10/s พอ สำหรับ timer, NPC, การเติบโตของโลก
   - **โลกที่ไม่มีคนออนไลน์ไม่ต้อง tick** (ปลดโลกออกจากหน่วยความจำหลังเซฟ) ถ้าเกมต้องการ "เวลาเดินระหว่างออฟไลน์" ให้คำนวณย้อนหลังจาก timestamp ตอนโหลด ไม่ใช่รัน tick ค้างไว้
7. `maxPayload` เล็ก (4096), parse JSON ใน try/catch, เช็ค `msg && typeof msg === 'object'`
8. `ping`/`pong` ทุก 2 วิ (วัด latency)
9. ทุกอย่างสุ่มบน server ด้วย `crypto.randomInt` · ถ้าโลกต้อง "สร้างซ้ำได้เหมือนเดิม" ให้เก็บ `seed` ในเซฟของโลก แล้วใช้ PRNG ที่กำหนด seed ได้ใน `shared/`

---

## 4. โลก, ผู้เล่น และวงจรชีวิต (แทนระบบห้อง/matchmaking)

### 4.1 ใครทำอะไร

| เรื่อง | platform | game server (เรา) |
|---|---|---|
| สร้าง/ลบโลก, เปิด/ปิด, รหัสเชิญ, เตะสมาชิก, จำกัด `maxPlayers` | ✅ | ❌ ไม่ทำซ้ำ |
| ออก launch token, ตรวจสิทธิ์ (identify) | ✅ | เรียกเท่านั้น |
| เก็บเซฟ (ไม่อ่านข้างใน) | ✅ | ส่งเข้า/ดึงออก |
| เนื้อหาโลก, simulation, ตำแหน่งผู้เล่น, การ sync | ❌ | ✅ |

**client ไม่มีหน้าเมนู ไม่มีช่องใส่ชื่อ ไม่มีปุ่ม create/join** ผู้เล่นมาถึงเกมแล้วด้วย `?world=<id>#token=<jwt>` และเข้าโลกเลย มีแค่ปุ่ม **Leave** (ส่ง `postMessage leave` ให้ platform พากลับหน้าห้องรอของโลก)

### 4.2 วงจรชีวิตของ World instance (ฝั่ง server เรา)

```
ผู้เล่นคนแรกเข้า ──▶ identify ผ่าน ──▶ ยังไม่มี instance?
                                          ├─ GET /internal/worlds/:id            (รายชื่อ + owner)
                                          ├─ ดึงเซฟของเจ้าของ (สถานะโลก)        → load state (migrate ถ้าเวอร์ชันเก่า)
                                          └─ สร้าง World instance, เริ่ม tick + autosave
ผู้เล่นคนถัดไป ──▶ identify ผ่าน ──▶ ใช้ instance เดิม · วางตัวละครจาก me.save (ไม่มีเซฟ = ตัวละครใหม่)
ผู้เล่นหลุด ──▶ เซฟทันที (reason "disconnect") ──▶ เก็บตัวละครไว้ RECONNECT_GRACE ──▶ เอาออกจากฉาก
ผู้เล่นคนสุดท้ายออก ──▶ เซฟสถานะโลก (ในเซฟเจ้าของ) ──▶ รอคิวเซฟเกลี้ยง ──▶ ปลด instance
```

กฎสำคัญ:
- **หนึ่งโลก = หนึ่ง instance บน server ตัวเดียวเท่านั้น** ห้ามมีสอง server เขียนเซฟโลกเดียวกัน (จะชน `baseVersion` และสถานะแตก) ถ้าอนาคตต้องมีหลาย server ให้ route ตาม `worldId` ไปเครื่องเดิมเสมอ
- **เซฟสถานะโลกเขียนเข้า "เซฟของเจ้าของโลก"** (`userId` = owner) **โดย server ในนามเจ้าของ แม้เจ้าของไม่ได้ออนไลน์** platform รับได้ตราบใดที่เป็นสมาชิก โลกไม่มีเอกสาร "สถานะโลก" แยก
- ตอนโหลด instance ใหม่ ต้องดึงเซฟเจ้าของเอง (`GET /internal/worlds/:id/members/:ownerId/save`) เพราะ identify ของสมาชิกคนอื่นไม่ได้ให้เซฟเจ้าของมา
- เจ้าของ = `role: "owner"` ใช้เป็นหัวห้องในเกมได้ (สิทธิ์ admin ในโลก) แต่ **ถ้าเจ้าของไม่อยู่ในเกมและโลกยัง `open` คนอื่นเล่นต่อได้** เกมต้องไม่พังเพราะเจ้าของไม่อยู่
- **สถานะโลกใน platform ปิดได้ระหว่างเล่น** (เจ้าของกดปิด หรือเจ้าของหลุดจาก platform เกิน 60 วิ) platform **ไม่เตะคนที่อยู่ในเกม** และ identify ใหม่ได้ `409` → ให้ poll `GET /internal/worlds/:id` ทุก 30–60 วิ แล้วเลือกนโยบาย `WORLD_CLOSED_POLICY`:
  - `continue` (ดีฟอลต์): คนที่อยู่แล้วเล่นต่อ ไม่รับคนใหม่ (identify กันให้เอง) → ปลด instance เมื่อว่าง
  - `drain`: ประกาศ "โลกกำลังปิด" แล้วเซฟ + ส่งผู้เล่นออกภายใน N วินาที
- poll เจอสมาชิกที่หายจากรายชื่อ (ออกจากโลกบน platform) → เซฟครั้งสุดท้ายของเขา แล้วเตะออกจากฉากทันที
- `online` ใน roster = เปิดหน้าเว็บ platform อยู่ **ไม่ใช่** อยู่ในเกม ใช้ WebSocket ของเราเองเป็นความจริงเรื่อง "ใครอยู่ในเกม"

### 4.3 State machine ของผู้เล่นใน instance
```
connecting ──identify ok──▶ playing ──socket หลุด──▶ away (ตัวละครค้าง GRACE วิ) ──resume──▶ playing
     │                         │                         └─ หมด grace ─▶ removed (เซฟแล้วตั้งแต่ตอนหลุด)
     └─ 401/403/404/409 ─▶ rejected (ส่ง error ที่อ่านรู้เรื่อง แล้วปิด socket)
```

### 4.4 Reconnect
- หลัง identify สำเร็จ server ออก **resume token ของเกมเอง** (random 16 bytes, ผูก worldId + userId, อายุสั้น) ส่งใน `welcome` → client เก็บใน `sessionStorage`
- เหตุผล: launch token ถูกลบจาก address bar แล้ว reload หน้าจะไม่มี `#token` ถ้าไม่มี resume token ผู้เล่นต้องกลับไปกด Play ใหม่
- client reconnect อัตโนมัติ (backoff 0.5 → 1 → 2 → 4 วิ) ส่ง `{t:'resume', rt}` → server ส่ง snapshot เต็มกลับ
- ตอนหลุด **เซฟก่อน** แล้วค่อยเก็บตัวละครไว้ ถ้ากลับมาทัน (ภายใน `RECONNECT_GRACE` เช่น 20 วิ) เล่นต่อจากเดิม ไม่ต้องโหลดเซฟใหม่ ถ้าไม่ทัน ตัวละครหายจากฉาก กลับมาครั้งหน้าใช้เซฟล่าสุด
- resume token หมดอายุ/ไม่รู้จัก → ส่ง `{t:'error', code:'relaunch'}` ให้ UI บอก "กลับไปกด Play ใหม่"

### 4.5 Protocol (ตัวอย่าง)
```ts
type ClientMsg =
  | { t: 'join'; token: string }                  // launch token จาก #token (ครั้งแรกเท่านั้น)
  | { t: 'resume'; rt: string }                   // resume token ของเกม (reload / reconnect)
  | { t: 'ping'; c: number }
  | { t: 'save' }                                 // ผู้เล่นกดเซฟเอง → reason 'manual' (ถ้าเกมมีปุ่ม) ไม่ส่งข้อมูลเซฟมา
  | { t: 'chat'; e: number }                      // emote id เท่านั้น ไม่มี text chat
  | WorldAction;                                  // input เฉพาะเกม

type ServerMsg =
  | { t: 'welcome'; you: number; rt: string; world: { id: string; name: string; ownerId: string }; role: 'owner' | 'member'; fresh: boolean }
  | { t: 'snap'; ... }                            // state/delta เฉพาะเกม
  | { t: 'saved'; at: number }                    // แจ้ง UI ว่าเซฟแล้ว (ไอคอนเล็ก ๆ)
  | { t: 'worldClosing'; inSec: number }          // ใช้กับนโยบาย drain
  | { t: 'error'; code: ErrorCode; msg: string }  // 'badToken' | 'notMember' | 'worldClosed' | 'worldGone' | 'relaunch' | 'full' | 'rate'
  | { t: 'pong'; c: number };
```
ข้อความ error ที่ผู้เล่นเห็นต้องอ่านรู้เรื่อง ไม่ค้างหน้า loading (ดู checklist ข้อ 11)

### 4.6 ความปลอดภัยพื้นฐาน
- จำกัดข้อความ/วิ ต่อ socket (เช่น 30) เกิน → ตัด · จำกัด socket ต่อ userId (1 ตัว: เข้าซ้ำ = เตะตัวเก่า)
- path ไฟล์ static: `normalize` + เช็คว่าอยู่ใน `dist/` (กัน path traversal)
- **server key ไม่ออกนอก server**: ไม่อยู่ใน client bundle (`VITE_*` = public), ไม่อยู่ใน log, ไม่อยู่ใน response
- ผู้ใช้ปลายทางห้ามเรียก `/internal/*` ของ platform ได้จาก browser

---

## 5. WorldPlatformAdapter (ขอบเขตเดียวที่คุยกับ platform)

ต่างจากเกมแบบแข่ง: **ทำจริงตั้งแต่ Phase 1** เพราะ "เซฟ/โหลด" เป็นแกนของเกม ใช้ `LocalAdapter` (ไฟล์) ตอนพัฒนา แล้วสลับเป็น `NakaWorldAdapter` ตอน Phase 4

```ts
// server/platform/adapter.ts
export interface WorldInfo { id: string; name: string; status: 'open' | 'closed'; maxPlayers: number; owner: { userId: string; username: string } }
export interface SaveDoc { id: string; version: number; data: Record<string, unknown>; reason: SaveReason; createdAt: string }
export type SaveReason = 'manual' | 'autosave' | 'disconnect';

export interface WorldPlatformAdapter {
  /** token → ผู้เล่น + โลก + เซฟล่าสุดของเขา. error: badToken 401 / notMember 403 / worldGone 404 / worldClosed 409 / notConfigured 503 */
  identify(token: string): Promise<{ player: { userId: string; username: string; avatar?: string }; world: WorldInfo; me: { role: 'owner' | 'member'; save: SaveDoc | null } }>;
  /** รายชื่อสมาชิก (เจ้าของมาก่อน) ใช้ poll สถานะโลกและคนที่ออกไป */
  getWorld(worldId: string, opts?: { saves?: boolean }): Promise<{ world: WorldInfo; members: Member[] }>;
  /** เซฟปัจจุบันของสมาชิกคนเดียว (ใช้ดึงสถานะโลกจากเซฟเจ้าของตอนโหลด instance) */
  getMemberSave(worldId: string, userId: string): Promise<SaveDoc | null>;
  /** เซฟหนึ่งครั้ง. saveKey เดิมซ้ำ = เซฟเดิม (replayed). autosave/disconnect ห้ามส่ง baseVersion */
  save(worldId: string, s: { userId: string; data: object; reason: SaveReason; saveKey: string; baseVersion?: number }): Promise<{ saveId: string; version: number; replayed: boolean }>;
  /** 1–20 รายการ ใช้ตอน server ปิด / หลายคนหลุดพร้อมกัน. รายการหนึ่งพังไม่ทำให้รายการอื่นล้ม */
  saveBatch(worldId: string, saves: SaveInput[]): Promise<SaveBatchItem[]>;
}
```
- เลือกด้วย env `PLATFORM=local|naka`
- **LocalAdapter**: token รูปแบบ `local:<ชื่อ>` (client dev ใส่ `?world=dev#token=local:Kai`), เซฟลง `.data/worlds/<worldId>/<userId>.json` (เก็บ version เพิ่มทีละ 1 เหมือน platform), จำลองกติกาเดียวกัน: `data` ต้องเป็น object, ≤ 256 KB (เกิน = error 413), saveKey ซ้ำ = replayed, key แปลก ๆ (`$x`, `a.b`, `__proto__`) ต้องกลับมาตรงเดิม · มี env `LOCAL_FAIL_RATE=0.3` ไว้สุ่มให้ save ล้มเพื่อทดสอบ retry
- **NakaWorldAdapter**: `fetch` + `Authorization: Bearer ${NAKA_SERVER_KEY}` ไป `${NAKA_API_URL}/internal/worlds/...` timeout 10 วิ แปลง HTTP status เป็น error ชนิดเดียวกับ LocalAdapter (ดูตารางข้อ 6.4) · **ไม่ใช้** `naka-platform.ts` จากชุดเกมแบบแข่ง (ตัวนั้นเรียก `/internal/game-sessions/*` ซึ่ง token ของโลกใช้ไม่ได้) ใช้ได้เฉพาะ `naka-platform.client.ts` ฝั่ง client
- โหมด Naka: ไม่มีเมนู ไม่มี lobby ฝั่งเกม เข้าโลกจาก `?world` + `#token` เท่านั้น

### client: ส่วนที่ใช้ซ้ำจากชุดเกมแบบแข่งได้
`naka-platform.client.ts` ใช้ได้: `takeLaunchToken()` (อ่าน `#token` แล้วลบทันที), `toPlatform({type:'ready'})`, `toPlatform({type:'leave'})`
ต้องแก้: อ่าน `world` จาก query แทน `session` (`new URLSearchParams(location.search).get('world')`) · **ไม่เรียก** `toPlatform({type:'ended'})` เพราะโลกไม่มีจุดจบ

---

## 6. ระบบเซฟ (แกนของเกมโลก)

### 6.1 หลักการ
- เซฟ = **JSON object** ก้อนเดียว platform เก็บให้ ไม่อ่านข้างใน **แยกตาม (โลก + ผู้เล่น)** · `version` นับเพิ่มทีละ 1 ต่อผู้เล่นต่อโลก **เซฟปัจจุบัน = version สูงสุด** · platform เก็บ 20 เซฟล่าสุดต่อคน และยังไม่มี API กู้เซฟเก่า → เซฟล่าสุดคือความจริงเดียว
- **game server เป็นคนเขียนเสมอ** ด้วย server key
- `data` ≤ **256 KB** (JSON) เกิน = 413 และเซฟนั้นหาย → ต้องมี **งบขนาด** และ test ที่ fail ถ้าเซฟโตเกิน (เช่น เตือนที่ 150 KB)
- key ใน `data` คืนกลับตรงตัว ไม่ต้องเข้ารหัสเอง

### 6.2 รูปแบบเซฟ (ออกแบบใน `shared/save.ts`)
```ts
// เซฟของผู้เล่นทุกคน
interface PlayerSave {
  v: number;                // เลขเวอร์ชันรูปแบบเซฟของ "เกมเรา" ไม่ใช่ version ของ platform
  player: { /* ตัวละคร, กระเป๋า, เลเวล, ตำแหน่งล่าสุด, ความคืบหน้าส่วนตัว */ };
  world?: WorldState;       // มีเฉพาะเซฟของเจ้าของโลก = สถานะโลกร่วมกัน
}
```
- **ใส่ `v` เสมอ** และมี `migrate(data) → ล่าสุด` ทีละขั้น (v1→v2→v3) ตอนโหลด เกมเปลี่ยนรูปแบบเซฟได้ทุกเมื่อ แต่ต้องอ่านเซฟเก่าได้ **test ต้องเก็บตัวอย่างเซฟของทุกเวอร์ชันไว้ใน `shared/fixtures/`**
- เซฟที่ `v` สูงกว่าที่ server รู้จัก (rollback เวอร์ชัน) → **ห้ามเขียนทับ** ปฏิเสธการเข้าเล่นพร้อมข้อความ "เกมกำลังอัปเดต" ดีกว่าทำเซฟพัง
- **เซฟเฉพาะส่วนที่ผู้เล่นคนนั้นเป็นเจ้าของ** อย่าใส่ทั้งโลกในเซฟของทุกคน ส่วนโลกใหญ่เกิน 256 KB ให้ลดขนาด (เก็บเฉพาะที่ผู้เล่นแก้ไขจาก seed, บีบอัดเป็น delta/chunk) ถ้ายังไม่พอให้ย้ายข้อมูลโลกไปเก็บที่ DB ของ game server เอง แล้วเซฟเจ้าของเก็บแค่ pointer + เวอร์ชัน (เป็นการตัดสินใจใหญ่ ให้จดใน spec ก่อน)
- เก็บเฉพาะข้อมูล serializable จริง: **ห้าม** `NaN`/`Infinity` (JSON แปลงเป็น `null`), `Map`/`Set`/class instance, `undefined`, ค่าวงกลม · ปัดทศนิยมตำแหน่ง (เช่น 2 หลัก) ให้เซฟเล็กและ diff ได้
- เซฟเป็นข้อมูลที่ผู้เล่นไม่ควรแก้เอง: ห้ามส่ง save ดิบไป client ห้ามรับ save จาก client

### 6.3 เมื่อไหร่ต้องเซฟ

| trigger | reason | หมายเหตุ |
|---|---|---|
| ทุก `AUTOSAVE_MS` (30–60 วิ) **เฉพาะที่ dirty** | `autosave` | กัน server ล่มเอง ความคืบหน้าหลัง autosave ล่าสุดคือส่วนที่เสี่ยงหาย |
| WebSocket ผู้เล่นหลุด (ปิดแท็บ เน็ตหลุด ถูกเตะ) | `disconnect` | **ทันที** ไม่รอ grace |
| ผู้เล่นกด Save (ถ้าเกมมีปุ่ม) | `manual` | ส่งแค่สัญญาณ ไม่ส่งข้อมูล |
| คนสุดท้ายออกจากโลก | `autosave` | เซฟสถานะโลกเข้าเซฟเจ้าของก่อนปลด instance |
| server ได้ `SIGTERM`/`SIGINT` | `disconnect` | **graceful shutdown**: หยุดรับ join → เซฟทุกคนผ่าน `saveBatch` (ชุดละ ≤ 20) → รอคิวเกลี้ยง → ค่อยปิด |
| ผู้เล่นถูกเอาออกจากโลกบน platform (poll เจอ) | `manual` | เซฟครั้งสุดท้ายแล้วเตะ |

- **ห้ามเซฟถี่เกินไป**: ขั้นต่ำ ~10 วิ ต่อคน ยกเว้น `disconnect` (platform ยังไม่มี rate limit แต่ไม่ควรยิงต่อเนื่อง)
- ใช้ **dirty flag**: ไม่มีอะไรเปลี่ยน = ไม่เซฟ (ลดงานและกัน version กระโดด)
- **`autosave` และ `disconnect` ห้ามส่ง `baseVersion`** (ต้องไม่ถูกปฏิเสธ) ใช้ `baseVersion` เฉพาะเมื่อมี server มากกว่าหนึ่งตัวเขียนเซฟคนเดียวกัน ซึ่งเกมนี้ไม่ควรเป็นแบบนั้น (ดูกฎ "หนึ่งโลก = หนึ่ง instance")

### 6.4 ส่งเซฟอย่างไรให้ไม่หาย (`server/saves.ts` — SaveQueue)
- สร้าง `saveKey` **หนึ่งครั้งต่อหนึ่งการเซฟ** (เช่น `${userId}-${Date.now()}-${counter}`, ≤ 64 ตัว) แล้วใช้ key เดิมทุกครั้งที่ retry → ได้ `replayed:true` ไม่เกิดเซฟซ้ำ
- **เซฟล่าสุดทับเซฟเก่าในคิว** ถ้าผู้เล่นคนเดียวกันมีเซฟค้างหลายอัน เก็บเฉพาะอันที่ใหม่สุด (กันคิวบวม) แต่ `disconnect` ต้องไม่ถูกแทนด้วย `autosave` ที่เก่ากว่า
- ผลตอบจาก platform:

| ผลที่ได้ | ทำอะไร |
|---|---|
| `200` (`replayed:true` ก็ถือสำเร็จ) | ลบออกจากคิว |
| `5xx`, `408`, `429`, เน็ตหลุด, timeout | retry ด้วย `saveKey` เดิม backoff 1s → 3s → 10s → 30s → 60s แล้ววนที่ 60s ต่อไป |
| `409 save_conflict` | ดึงเซฟล่าสุด (`getMemberSave`) รวมข้อมูล ส่งใหม่ (ไม่ส่ง `baseVersion`) พร้อม log ให้รู้ว่าผิดสมมติฐาน |
| `400`, `403`, `404`, `413` | **ไม่ retry** ข้อมูล/สิทธิ์ผิด log ให้เห็นชัด + เก็บเซฟลง `.data/rejected/` ไว้ตรวจ (404 = โลกถูกลบ → ปลด instance) |
| `401` | server key ผิด/ถูกแทนที่ → เก็บคิวไว้ แจ้งเตือนดัง ๆ (เป็นปัญหา setup ไม่ใช่ของผู้เล่น) |

- **คิวต้องอยู่ลงดิสก์ (`.data/pending-saves.json` หรือ DB)** ไม่ใช่แค่หน่วยความจำ เพราะถ้า platform ล่มตอน server รีสตาร์ต เซฟ `disconnect` จะหาย · ตอนเริ่ม server ให้อ่านคิวมาส่งต่อก่อนรับผู้เล่น (`flushPending` ตอนบูต และทุกนาที) · เขียนไฟล์แบบ atomic (เขียน `.tmp` แล้ว rename)
- **ลำดับต้องคงที่ต่อผู้เล่น**: อย่าให้เซฟที่ใหม่กว่าถูกส่งก่อนเซฟเก่าแล้วเซฟเก่าไปทับ → ส่งทีละอันต่อผู้เล่น (serial ต่อ userId) หรือแทนที่เซฟเก่าในคิวด้วยอันใหม่
- ผู้เล่นกลับเข้าโลกขณะที่เซฟล่าสุดของเขายังค้างในคิว (platform ล่ม) → ใช้เซฟในคิว/หน่วยความจำของ instance เป็นหลัก ไม่ใช่ `me.save` จาก platform ที่เก่ากว่า

### 6.5 ตอนโหลด
- เข้าครั้งแรก `me.save === null` → สร้างตัวละครใหม่ (`fresh: true` ใน `welcome` ให้ client แสดง tutorial/สร้างตัวละคร)
- `me.save` มีค่า → `deserialize` + `migrate` + **ตรวจความสมเหตุสมผล** (ตำแหน่งอยู่ในแมพ, ของอยู่ในกรอบ, จำนวนไม่ติดลบ) ค่าที่พัง → ซ่อมเป็นค่าเริ่มต้น + log ไม่ทิ้งทั้งเซฟ และห้าม crash ทั้ง instance เพราะเซฟของคนเดียว
- ผู้เล่นที่ออกจากโลกไปแล้ว เซฟยังอยู่ที่ platform ถ้าจอยกลับมาจะได้เซฟเดิม (ไม่ต้องทำอะไรพิเศษ)

---

## 7. Spec ของเกม (กรอกก่อนเริ่ม แทน GAME-SPEC.template.md)

ทีมเกมกรอกแล้วแนบไปกับ Kickoff Prompt, ส่วน 7.1 ส่งให้ทีม platform พร้อมขอ server key

### 7.1 สำหรับทีม platform (ตั้งใน Admin → Games)
| | |
|---|---|
| ชื่อ / slug | |
| Type | **`world`** |
| Game address (`launchUrl`, https ของหน้า client ที่ฝังใน iframe) | |
| Game server address (wss / https) | |
| Players min / max (max = คนสูงสุดต่อโลก นับเจ้าของด้วย) | |
| ติดต่อทีม | |

### 7.2 สำหรับทีมเกม (ตัดสินใจและจดไว้)
| หัวข้อ | คำตอบ |
|---|---|
| โลกคืออะไร / ขนาด / สร้างจาก seed หรือเก็บทั้งก้อน | |
| เรียลไทม์หรือเทิร์น · tick rate | |
| อะไรอยู่ในเซฟส่วนตัว | |
| อะไรอยู่ในสถานะโลก (เซฟเจ้าของ) · ขนาดโดยประมาณ (KB) | |
| มีงานที่ต้อง "เดินต่อตอนออฟไลน์" ไหม (พืชโต, เวลา) คำนวณจาก timestamp อย่างไร | |
| ผู้เล่นแก้ของของกันได้ไหม (สิทธิ์ของสมาชิก vs เจ้าของ) | |
| `WORLD_CLOSED_POLICY` (`continue` / `drain`) | |
| RECONNECT_GRACE / AUTOSAVE_MS | |
| ถ้าเซฟโลกเกิน 256 KB: แผนคืออะไร | |
| ที่เก็บคิวเซฟที่ส่งไม่สำเร็จ (ไฟล์/DB) | |

---

## 8. สิ่งที่ platform **ยังไม่มี** (อย่าเพิ่งทำฝั่งเกม / ออกแบบให้เผื่อ)

- เหรียญ / XP / เวลาเล่น / เควสจากโลก → เกมโลกตอนนี้ **ไม่ได้อะไรจาก platform** ห้ามทำ UI ที่โชว์เหรียญจากโลก
- webhook จาก platform (โลกเปิด/ปิด, สมาชิกเข้า/ออก) → ต้อง poll `GET /internal/worlds/:id`
- API กู้เซฟเก่า · เซฟร่วมของทั้งโลก (ใช้เซฟเจ้าของแทน) · โลกสาธารณะสำหรับคนแปลกหน้า
- rate limit การเซฟ (ฝั่งเกมต้องคุมเอง)

---

## 9. Dev Workflow & Quality

- **Phase ละ commit** ข้อความ commit ชัด · README อัปเดตทุกครั้งที่เพิ่มระบบ (ภาษาไทยได้) · เอกสารรูปแบบเซฟ (`docs/save-format.md`) อัปเดตทุกครั้งที่ bump `v`
- Test `shared/` ด้วย `node:test`: กติกา + **round-trip เซฟ** (state → serialize → JSON.stringify → parse → deserialize → state เท่าเดิม) + **migrate ทุกเวอร์ชันจาก fixtures** + เซฟเสียแล้วไม่ crash + ขนาดเซฟไม่เกินงบ
- Test `server/` (ใช้ LocalAdapter + `LOCAL_FAIL_RATE`): retry ไม่ทำให้เกิดเซฟซ้ำ, เซฟ `disconnect` ไม่ถูกทับด้วย autosave เก่า, คิวรอดการ restart, graceful shutdown เซฟครบทุกคน
- `scripts/bots.ts <worldId> <n>` → ส่งบอท n ตัวเข้าโลกเดียวกันผ่าน WebSocket จริง (ทดสอบ load + flow + ปิดเปิดสลับเพื่อทดสอบเซฟ)
- `scripts/check-save.ts` ตรวจ invariant ของโลก (เช่น ของรวมในโลกต้องคงที่หลัง save → load)
- ทดสอบกับ platform จริงด้วย `scripts/curl-smoke.sh` (identify / roster / save / replay ตาม §11 ของ `world-integration-guide.md`) ก่อนปิด Phase 4
- ทดสอบ multiplayer: เปิด 2–4 แท็บ + มือถือจริง 1 เครื่อง (`http://<ip-เครื่อง>:5173/?world=dev#token=local:Kai`)
- `.env.example` มีทุกตัวแปรพร้อมคอมเมนต์ · `.env.local` และ `.data/` ไม่ commit
- Deploy: Build `npm install && npm run build` · Start `npm start` (ฟัง `$PORT`) · **ต้องมี disk ถาวรสำหรับคิวเซฟ** (หรือใช้ DB) และตั้ง `SIGTERM` handler ให้ทัน (host ให้เวลาปิดสั้น ๆ: เซฟด้วย batch ให้เร็ว)
- ห้ามมี secret ใน client bundle

### env ตัวอย่าง
```bash
PLATFORM=local                    # local | naka
PORT=2567
# --- โหมด naka (ฝั่ง server เท่านั้น ห้ามขึ้นต้นด้วย VITE_) ---
NAKA_API_URL=https://<api>/api    # base ของ API รวม /api
NAKA_SERVER_KEY=gsk_...           # Admin → Games → หน้าเกม → Game server key (แสดงครั้งเดียว)
# --- ปรับเกม ---
AUTOSAVE_MS=45000
RECONNECT_GRACE_MS=20000
WORLD_POLL_MS=45000
WORLD_CLOSED_POLICY=continue      # continue | drain
LOCAL_FAIL_RATE=0                 # 0–1 ใช้ทดสอบ retry เฉพาะ PLATFORM=local
```

### Definition of Done ต่อ Phase
- [ ] `npm run typecheck` ผ่าน · `npm test` ผ่าน
- [ ] เปิด 2 แท็บเข้าโลกเดียวกัน เห็นกันและเล่นได้
- [ ] **ปิดแท็บกลางเกม → เข้าใหม่ได้ตัวละคร/ของเดิมครบ** (ผ่านเซฟ ไม่ใช่แค่ memory)
- [ ] **รีสตาร์ต server กลางเกม → ทุกคนกลับเข้ามาได้ความคืบหน้าเดิม** (ไม่เกินช่วง autosave)
- [ ] ปิด platform/LocalAdapter ชั่วคราวตอนเซฟ แล้วเปิดใหม่ → retry สำเร็จ ไม่เกิดเซฟซ้ำ (version ไม่กระโดด)
- [ ] มือถือแนวนอน + แนวตั้ง ใช้งานได้ 60fps
- [ ] ไม่มี error ใน console ทั้ง client/server

### Checklist ก่อนส่งงาน (Phase 4–5, ตรงกับ §11 ของ world-integration-guide)
- [ ] token ปลอม/หมดอายุ → เห็นข้อความอ่านรู้เรื่อง ไม่ค้างหน้า loading
- [ ] ผู้เล่นที่ออกจากโลกแล้วเข้าไม่ได้ (403) · โลกปิดอยู่ได้ 409 พร้อมข้อความให้กลับไปรอเจ้าของเปิด
- [ ] เข้าครั้งแรก `me.save = null` เริ่มตัวละครใหม่ได้ · ครั้งถัดไปโหลดเซฟเดิมครบ
- [ ] `data` ที่มี key แปลก ๆ (`$x`, `a.b`, `constructor`) กลับมาตรงเดิม
- [ ] เซฟเกิน 256 KB ได้ 413 และเกมไม่ crash (ไม่ retry ไม่วนไม่สิ้นสุด)
- [ ] `#token` หายจาก address bar หลังโหลดหน้า · reload ด้วย resume token ได้
- [ ] server key ไม่ปรากฏใน client, log, หรือ Network ของ browser
- [ ] key ของเกมอื่นเรียกโลกของเกมนี้ไม่ได้ (404) · key ที่ถูก Replace/Revoke ได้ 401 และเกมแจ้งเตือนชัด
- [ ] ส่ง `ready` เมื่อโหลดเสร็จ · ปุ่ม Leave ส่ง `leave` · ไม่มีการส่ง `ended`
