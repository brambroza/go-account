# thai-address.json — จังหวัด / อำเภอ / ตำบล + รหัส TIS 1099

ใช้กับ XML e-Tax (ETDA ขมธอ.3-2560 §8.8–8.10): `CountrySubDivisionID` = รหัสจังหวัด 2 หลัก,
`CityName` = รหัสอำเภอ/เขต 4 หลัก, `CitySubDivisionName` = รหัสตำบล/แขวง 6 หลัก และช่องเลือกที่อยู่ในฟอร์มผู้ติดต่อ/บริษัท

| | |
|---|---|
| ต้นทาง | [thailand-geography-data/thailand-geography-json](https://github.com/thailand-geography-data/thailand-geography-json) commit `b8b3fb91c7df1129ff5b43cb46f7fcffadd2156b` (`src/provinces.json`, `src/districts.json`, `src/subdistricts.json`) |
| สัญญาอนุญาต | MIT — Copyright (c) 2023-Present Joe Takara (ใช้/แก้/แจกจ่ายได้ ต้องคงข้อความลิขสิทธิ์นี้) |
| จำนวน | 77 จังหวัด, 928 อำเภอ/เขต, 7,436 ตำบล/แขวง (รหัสไปรษณีย์ 1 ค่าต่อตำบล) |
| ตรวจกับของทางการ | รหัสทุกตัวมีอยู่ใน code list ของ ETDA (ภาคผนวก B.5/B.6): `ThaiISOCountrySubdivisionCode_1p0.xsd`, `TISICityName_1p0.xsd`, `TISICitySubDivisionName_1p0.xsd` จาก [gitlab.com/etdath-teda-schema/teda-objects/common/e-tax-invoice-receipt](https://gitlab.com/etdath-teda-schema/teda-objects/common/e-tax-invoice-receipt) (`ETDA/codelist/standard/`) — ชื่อตำบลต่างจาก ETDA 3 รหัส (450109, 501805, 600113) ใช้ชื่อตามต้นทาง |
| sha256 | อยู่ใน `golden/thai-address.json` (`constants/dataset`) — go-account-api เก็บสำเนาไฟล์เดียวกันแล้วตรวจ sha256 ตอน test |

รูปแบบ (รหัสเป็น string เรียงตามรหัส):

```json
{ "provinces": [["10", "กรุงเทพมหานคร"]], "districts": [["1001", "พระนคร"]], "subdistricts": [["100101", "พระบรมมหาราชวัง", "10200"]] }
```

ชื่ออำเภอ/ตำบลไม่มีคำนำหน้า (อำเภอ/เขต/ตำบล/แขวง) — หน้าจอและการจับคู่ชื่อตัดคำนำหน้าเอง (`src/domain/thai-address.ts`)

อัปเดตข้อมูล: ดาวน์โหลดไฟล์ต้นทาง (และ code list ETDA) ลงโฟลเดอร์ว่าง แล้ว

```sh
node scripts/build-thai-address.mjs <โฟลเดอร์ต้นทาง> <โฟลเดอร์ code list ETDA>
yarn golden   # sha256 + vector การค้นหาเปลี่ยน → คัดลอกไฟล์ไป go-account-api ด้วย
```
