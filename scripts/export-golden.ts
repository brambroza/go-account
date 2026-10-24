/**
 * เขียน golden vectors ของตรรกะ TS ลง `golden/*.json` — รันด้วย `yarn golden`
 *
 * โปรเจกต์ไม่มี TS runner (ts-node/tsx) จึงรันผ่าน jest + ts-jest ที่มีอยู่แล้ว (ไฟล์นี้เป็น "test" หนึ่งตัวที่เขียนไฟล์)
 * แก้ตรรกะใน src/domain แล้วต้องรันใหม่และ commit ไฟล์ใน golden/ — ฝั่ง C# (go-account-api) ต้องตามให้ผ่าน
 * test `src/golden/__tests__/golden.test.ts` ตรวจว่าไฟล์ที่ commit ตรงกับผลปัจจุบัน
 */
import fs from 'fs';
import path from 'path';

import { renderGoldenFiles } from '../src/golden/golden-vectors';

const GOLDEN_DIR = path.resolve(__dirname, '..', 'golden');

test('export golden vectors', () => {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  const files = renderGoldenFiles();
  fs.readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.json') && !(f in files))
    .forEach((f) => fs.unlinkSync(path.join(GOLDEN_DIR, f)));
  Object.entries(files).forEach(([file, content]) => {
    fs.writeFileSync(path.join(GOLDEN_DIR, file), content);
    const { count } = JSON.parse(content) as { count: number };
    console.log(`golden/${file}: ${count} vectors`);
  });
});
