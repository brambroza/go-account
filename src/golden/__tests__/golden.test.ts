import fs from 'fs';
import path from 'path';

import { renderGoldenFiles } from '../golden-vectors';

// ----------------------------------------------------------------------
// ไฟล์ golden/*.json ที่ commit ต้องตรงกับผลของตรรกะ TS ปัจจุบัน
// ไม่ตรง = แก้ src/domain แล้วยังไม่ได้รัน `yarn golden` (และฝั่ง go-account-api ต้องตามให้ผ่าน)
// ----------------------------------------------------------------------

const GOLDEN_DIR = path.resolve(__dirname, '..', '..', '..', 'golden');

describe('golden vectors', () => {
  const expected = renderGoldenFiles();

  it('has exactly the generated files', () => {
    const onDisk = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).sort();
    expect(onDisk).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.keys(expected))('%s matches committed file (run `yarn golden` if logic changed)', (file) => {
    const committed = fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8');
    expect(committed).toBe(expected[file]);
  });

  it('every vector carries only plain JSON values (no NaN / undefined drift)', () => {
    Object.values(expected).forEach((content) => {
      const parsed = JSON.parse(content) as { count: number; vectors: unknown[] };
      expect(parsed.vectors).toHaveLength(parsed.count);
      expect(content).not.toMatch(/NaN|Infinity/);
    });
  });
});
