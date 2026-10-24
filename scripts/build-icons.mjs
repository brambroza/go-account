// รวมไอคอนที่ใช้จริงในโค้ดเป็นไฟล์เดียว เพื่อให้แอปทำงานได้โดยไม่ต้องดึงไอคอนจาก api.iconify.design
// รัน: node scripts/build-icons.mjs  (ทุกครั้งที่เพิ่มไอคอนใหม่)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getIcons } from '@iconify/utils';

const require = createRequire(import.meta.url);
const SETS = ['solar', 'eva', 'mingcute'];
const pattern = new RegExp(`['"\`]((${SETS.join('|')}):[a-z0-9-]+)['"\`]`, 'g');

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(f.name)) out.push(p);
  }
  return out;
}

const used = new Map(SETS.map((s) => [s, new Set()]));
for (const file of walk('src')) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
    const [prefix, name] = m[1].split(':');
    used.get(prefix).add(name);
  }
}

const collections = [];
for (const prefix of SETS) {
  const names = [...used.get(prefix)];
  if (!names.length) continue;
  const data = getIcons(require(`@iconify-json/${prefix}/icons.json`), names);
  const missing = names.filter((n) => !data?.icons?.[n] && !data?.aliases?.[n]);
  if (missing.length) console.warn(`ไม่พบไอคอน ${prefix}:`, missing.join(', '));
  if (data) collections.push(data);
}

fs.writeFileSync('src/components/iconify/offline-icons.json', JSON.stringify(collections));
console.log(`บันทึก ${collections.reduce((n, c) => n + Object.keys(c.icons).length, 0)} ไอคอน`);
