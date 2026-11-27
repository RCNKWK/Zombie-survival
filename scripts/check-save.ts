import fs from 'node:fs';
import path from 'node:path';
import { deserializePlayerSave, measureSaveBytes } from '../shared/save.js';

const worldsDir = path.resolve('.data/worlds');
if (!fs.existsSync(worldsDir)) {
  console.log('[check:save] No .data/worlds directory yet.');
  process.exit(0);
}

let checked = 0;
let failures = 0;

for (const wid of fs.readdirSync(worldsDir)) {
  const dir = path.join(worldsDir, wid);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const fname of fs.readdirSync(dir)) {
    if (fname === '_meta.json' || !fname.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, fname), 'utf8'));
    const data = raw?.latest?.data;
    if (!data) continue;
    checked++;
    try {
      const parsed = deserializePlayerSave(data);
      const budget = measureSaveBytes(parsed.save);
      console.log(
        `[check:save] ${wid}/${fname} v${parsed.save.v} ${(budget.bytes / 1024).toFixed(2)} KB` +
          (parsed.repaired ? ' (repaired)' : '') +
          (budget.warn ? ' [WARN]' : ''),
      );
      if (budget.overLimit) {
        console.error(`  FAIL: exceeds 256 KB limit!`);
        failures++;
      }
    } catch (err) {
      console.error(`[check:save] ${wid}/${fname} INVALID: ${String(err)}`);
      failures++;
    }
  }
}

console.log(`[check:save] checked ${checked} save file(s), failures=${failures}`);
if (failures > 0) process.exit(1);
