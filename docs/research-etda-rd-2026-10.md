# ผลตรวจข้อกำหนดทางการ: e-Tax (ETDA) และไฟล์ ภ.ง.ด. (RD) — 25 ต.ค. 2569

ตรวจโค้ด `src/domain/etax-xml.ts`, `src/domain/rd-wht-file.ts`, `src/domain/thai-date.ts` กับเอกสารทางการ

## แหล่งอ้างอิง

- [A] ETDA Rec. 3-2560 Trade Services Message Standard v2.0 ฉบับแปลอังกฤษ V03 (20250515) — ฉบับภาษาไทยเท่านั้นที่มีผลทางกฎหมาย
  https://www.etda.or.th/getattachment/43f4a6d7-946e-4fc3-b5d4-e3c64f9d197a/20250515_ETDA-Rec-3-2560_English-V03.pdf.aspx
- [B] ไฟล์ตัวอย่าง ETDA (GitLab `etdath-teda-schema/teda-objects/common/e-tax-invoice-receipt`): `Example_CreditNote_2p0_v1.xml`, `Example_DebitNote_2p0_v1.xml`
- [C] RD STD-05-2566 มาตรฐานการลงลายมือชื่ออิเล็กทรอนิกส์ V1.00 (23 ส.ค. 2566)
  https://www.rd.go.th/fileadmin/user_upload/tortor/standard/STD-05-2566_Electronic_Signature_V1.00.0000.pdf
- [D] RD คู่มือการสร้างลายมือชื่อดิจิทัล (ธ.ค. 2562) https://etax.rd.go.th/etax_staticpage/app/emag/flipbook/06_Digital-Signature.pdf
- [E] RD 01_Overview (2567) https://etax.rd.go.th/etax_staticpage/app/emag/flipbook_2567/pdf/01_Overview.pdf
- [F] RD 09_Service-Provider (2567) https://etax.rd.go.th/etax_staticpage/app/emag/flipbook_2567/pdf/09_Service-Provider.pdf
- [G] RD Format กลาง ภ.ง.ด.3 / ภ.ง.ด.53 V2.0 (ปรับปรุง 16/06/2568)
  https://rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND3V2_0.pdf · https://rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND53V2_0.pdf
- [H] RD คู่มือขอคืน VAT 2025 https://www.rd.go.th/fileadmin/user_upload/lorkhor/newspr/2025/vat_refund.pdf
- [I] NRCA รายชื่อ CA (22 ก.ค. 2568)
- [J] ETDA e-Tax Invoice by Email https://www.etda.or.th/en/Our-Service/Digital-Trusted-services-Infrastructure/TEDA/ETAX.aspx

## ผลตรวจ

| # | โค้ดเรา | คำตอบทางการ | แหล่ง | ผล |
|---|---|---|---|---|
| 1a | 388 / 81 / 80 | 80 ใบเพิ่มหนี้, 81 ใบลดหนี้, 380 Invoice, 388 Tax Invoice | [A] App. B.2 น.49 | ยืนยันแล้ว |
| 1b | ใบเสร็จรับเงิน/ใบกำกับภาษี = T03 | T03 = Receipt/Tax Invoice | [A] B.2, §8.3 | ยืนยันแล้ว |
| 1c | พิมพ์ "ใบกำกับภาษี/ใบแจ้งหนี้" แต่ XML ส่ง Name "ใบกำกับภาษี" + 388 | T02 = Invoice/Tax Invoice; ชื่อเอกสารต้องตรงกับ TypeCode | [A] B.2, §8.3 | **ต้องแก้** |
| 1d | ใบเสร็จอ้างใบแจ้งหนี้ด้วย 380 | ReferenceTypeCode ใช้รหัสจาก B.2 | [A] §8.13 | ยืนยันแล้ว |
| 2 | CDNG99 / CDNS99 / DBNG99 / DBNS99 | มีจริง; 99 ต้องระบุเหตุผล; มีรหัสเฉพาะ CDNG01-05, CDNS01-04, DBNG01-02, DBNS01-02 | [A] §8.4, B.3 | ยืนยันแล้ว — ควรให้เลือกรหัสเฉพาะ |
| 3a | ลำดับ Original → LineTotal → Difference → TaxBasis → TaxTotal → GrandTotal | ตรงตาม Table 2 | [A] น.21-22 | ยืนยันแล้ว |
| 3b | LineTotalAmount ของใบลด/เพิ่มหนี้ = ยอดผลต่าง | LineTotal = มูลค่าที่ถูกต้อง; Difference = Original − LineTotal | [A] §7 R2/R3; [B] | **ต้องแก้** |
| 3c | CountrySubDivisionID / CityName / CitySubDivisionName เป็นชื่อ | ต้องเป็นรหัส (จังหวัด ISO 3166-2, อำเภอ/ตำบล TIS 1099) | [A] §8.7-8.10, App. D | **ต้องแก้** |
| 4 | ยังไม่ลงนาม | XAdES-BES enveloped, C14N 1.0, rsa-sha512/SHA-512, SigningTime บังคับ, SigningCertificate v1 (XAdES 1.3.2); CA ตาม NRCA: Thai Digital ID, INET, Turnkey/ThaiCA, NT | [A] App. C.1, D; [C] §8.1; [D] §2.1-2.2; [I] | ยืนยันแล้ว (SigningCertificate v2 หาแหล่งไม่ได้) |
| 5 | ยังไม่มีการนำส่ง | ยื่น บ.อ.01 แล้วนำส่งได้ 3 ทาง: Upload XML, Host-to-Host, Service Provider (SP ต้องทุน ≥ 50 ล้าน + ผ่าน ขมธอ.35-2567); e-Tax by Email สำหรับรายได้ ≤ 30 ล้าน/ปี | [E]; [F]; [J] | ยืนยันแล้ว — SaaS ขนาดเล็กไม่ควรเป็น SP |
| 6a | ฟิลด์ 16 = 'V' เมื่อจด VAT | V = VAT, S = SBT, ทั้งสอง = V, ไม่ใช่ = ว่าง | [G] Header #16 | ยืนยันแล้ว — ขาดกรณี 'S' |
| 6b | TOT_NUM = จำนวนผู้รับเงิน | "รวมจำนวนรายของใบแนบ" — น่าจะนับแถว D | [G] Header #18, ข้อ 16 | **ตรวจกับ RD Prep** |
| 6c | ชื่อไฟล์, UTF-8, `\|`, CRLF, half-up | ตรงข้อกำหนด 3, 6, 7, 9, 10 | [G] | ยืนยันแล้ว — ควรตัดเครื่องหมายคำพูดโค้ง |
| 7 | ภ.ง.ด. วันที่ 15 / ภ.พ.30 วันที่ 23 | ประกาศขยายเวลาฉบับที่ 8 ใช้ถึง 31 ม.ค. 2570 | [H] | ยืนยันถึงงวด ธ.ค. 2569; หลังจากนั้นหาแหล่งไม่ได้ |

## สิ่งที่ต้องแก้ (เรียงตามความสำคัญ)

1. **P1** ใบลด/เพิ่มหนี้: `LineTotalAmount` = มูลค่าที่ถูกต้อง + test ตามกฎ R2/R3
2. **P1** ที่อยู่ใน XML ใช้รหัสจังหวัด/อำเภอ/ตำบล (ต้องมีตารางรหัส TIS 1099)
3. **P1** ชื่อเอกสารให้ตรง TypeCode (T02 "ใบแจ้งหนี้/ใบกำกับภาษี" หรือพิมพ์ "ใบกำกับภาษี" อย่างเดียว) และรหัสอ้างอิงใน CN/DN ตรงกับเอกสารต้นฉบับ
4. **P2** TOT_NUM: ทดสอบกับ RD Prep (ผู้รับเงิน 1 ราย 2 PV)
5. **P2** `filingDueDates`: ใช้วันขยายได้ถึงงวด 2026-12 หลังจากนั้นเตือน/ใช้วันตามกฎหมาย (7 / 15) จนมีประกาศใหม่
6. **P3** รหัสเหตุผลเฉพาะ, BRANCH_TYPE 'S', ตัดเครื่องหมายคำพูดโค้ง
7. **P3** ตรวจด้วย XSD/Schematron ของ RD ก่อนใช้จริง

## ข้อจำกัดของการตรวจ

- อ้างฉบับแปลอังกฤษของ ขมธอ.3-2560 ยังไม่ได้เทียบฉบับภาษาไทยและฉบับแก้ไขภายหลัง
- วันสิ้นสุดประกาศฉบับที่ 8 มาจากคู่มือ RD ไม่ได้อ่านจากราชกิจจานุเบกษาโดยตรง
- ไฟล์ตัวอย่าง ETDA มีตัวเลขบางส่วนไม่สอดคล้องกันเอง ใช้ยืนยันได้เฉพาะความหมายของ LineTotalAmount
