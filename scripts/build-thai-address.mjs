/**
 * สร้าง `src/domain/data/thai-address.json` (จังหวัด/อำเภอ/ตำบล + รหัส TIS 1099 + รหัสไปรษณีย์) จากชุดข้อมูลต้นทาง
 *
 *   node scripts/build-thai-address.mjs <โฟลเดอร์ที่มี provinces.json districts.json subdistricts.json> [โฟลเดอร์ code list ETDA]
 *
 * ต้นทาง: https://github.com/thailand-geography-data/thailand-geography-json (MIT) — ดู `src/domain/data/README.md`
 * ถ้าส่งโฟลเดอร์ ETDA (ThaiISOCountrySubdivisionCode_1p0.xsd, TISICityName_1p0.xsd, TISICitySubDivisionName_1p0.xsd)
 * จะตรวจว่ารหัสทุกตัวมีอยู่ใน code list ของ ETDA (ขมธอ.3-2560 ภาคผนวก B.5/B.6) — ไม่ตรง = ล้ม
 * รูปแบบผลลัพธ์ (เรียงตามรหัส, รหัสเป็น string):
 *   { provinces: [[code2, name]], districts: [[code4, name]], subdistricts: [[code6, name, postcode5]] }
 * ไฟล์นี้เป็นสคริปต์ครั้งคราว (ไม่ได้รันใน build) — แก้ข้อมูลแล้วต้อง `yarn golden` (sha256 อยู่ใน golden/thai-address.json)
 */
import fs from 'fs';
import path from 'path';

const [srcDir, etdaDir] = process.argv.slice(2);
if (!srcDir) {
  console.error('usage: node scripts/build-thai-address.mjs <source-dir> [etda-codelist-dir]');
  process.exit(1);
}

const read = (file) => JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const byCode = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

const provinces = read('provinces.json')
  .map((p) => [String(p.provinceCode), clean(p.provinceNameTh)])
  .sort(byCode);
const districts = read('districts.json')
  .map((d) => [String(d.districtCode), clean(d.districtNameTh)])
  .sort(byCode);
const subdistricts = read('subdistricts.json')
  .map((s) => [String(s.subdistrictCode), clean(s.subdistrictNameTh), String(s.postalCode)])
  .sort(byCode);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const provinceSet = new Set(provinces.map(([c]) => c));
const districtSet = new Set(districts.map(([c]) => c));
provinces.forEach(([c]) => /^\d{2}$/.test(c) || fail(`province code ${c}`));
districts.forEach(([c]) => (/^\d{4}$/.test(c) && provinceSet.has(c.slice(0, 2))) || fail(`district code ${c}`));
subdistricts.forEach(
  ([c, , zip]) => (/^\d{6}$/.test(c) && districtSet.has(c.slice(0, 4)) && /^\d{5}$/.test(zip)) || fail(`subdistrict ${c}`)
);

if (etdaDir) {
  const codes = (file) =>
    new Set([...fs.readFileSync(path.join(etdaDir, file), 'utf8').matchAll(/<xsd:enumeration value="([^"]+)"/g)].map((m) => m[1]));
  const check = (rows, file) => {
    const known = codes(file);
    const missing = rows.filter(([c]) => !known.has(c)).map(([c]) => c);
    if (missing.length) fail(`${file}: ${missing.length} codes not in ETDA list: ${missing.slice(0, 10).join(', ')}`);
  };
  check(provinces, 'ThaiISOCountrySubdivisionCode_1p0.xsd');
  check(districts, 'TISICityName_1p0.xsd');
  check(subdistricts, 'TISICitySubDivisionName_1p0.xsd');
}

const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'domain', 'data', 'thai-address.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
// 1 แถวต่อบรรทัด — diff อ่านง่ายเมื่ออัปเดตข้อมูล
const rows = (list) => list.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
fs.writeFileSync(
  out,
  `{\n  "provinces": [\n${rows(provinces)}\n  ],\n  "districts": [\n${rows(districts)}\n  ],\n  "subdistricts": [\n${rows(subdistricts)}\n  ]\n}\n`
);
console.log(`${out}: ${provinces.length} provinces, ${districts.length} districts, ${subdistricts.length} subdistricts`);
