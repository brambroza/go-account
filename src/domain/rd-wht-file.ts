import { whtTotals } from './wht';
import { formatPlain } from './money';
import { toBE, toRdDate } from './thai-date';
import { toBranch6, normalizeTaxId, isValidThaiTaxId } from './thai-tax-id';

import type { Company } from './types';
import type { Period } from './thai-date';
import type { WhtForm, WhtItem, WhtPayee } from './wht';

// ----------------------------------------------------------------------
// ไฟล์ .txt ภ.ง.ด.3 / ภ.ง.ด.53 ตาม "รูปแบบข้อมูล (Format กลาง) Version 2.0"
// ของกรมสรรพากร (ปรับปรุง 16/06/2568) — ใช้นำเข้าโปรแกรม SWC / RD Prep แล้วยื่น e-Filing
//   https://rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND3V2_0.pdf
//   https://rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND53V2_0.pdf
// กฎหลัก: UTF-8, คั่นด้วย | (ไม่มี | หน้า/ท้ายแถว), แต่ละแถวจบด้วย CRLF,
// แถวแรก H หนึ่งแถว ตามด้วย D, ตัวเลขไม่มีคอมม่า ทศนิยม 2 ตำแหน่ง,
// ห้ามใช้อักขระ * + / \ ! $ % # & @ , ' "  และไม่เติมช่องว่างให้ครบความยาว
// ----------------------------------------------------------------------

const PROHIBITED = /[*+\\!$%#&@,'"]/g;

/** ทำความสะอาดข้อความตามกฎ Format กลาง: '/' (เช่นบ้านเลขที่ 918/288) แปลงเป็น '-' ที่เหลือตัดทิ้ง */
export function sanitizeRdText(value: string | undefined, maxLength: number): string {
  return (value ?? '')
    .replace(/\//g, '-')
    .replace(PROHIBITED, ' ')
    .replace(/[|\r\n\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export type RdWhtFileOptions = {
  form: WhtForm;
  company: Company;
  period: Period;
  payees: WhtPayee[];
  /** '00' = ยื่นปกติ, '01'.. = ยื่นเพิ่มเติม */
  formType?: string;
  /** ครั้งที่ส่ง 00-99 (ใช้ในชื่อไฟล์) */
  sendNo?: string;
  /** '1' = ผู้มีหน้าที่หักภาษี ณ ที่จ่าย */
  senderRole?: '1' | '2' | '3' | '4';
  /** '2' = ยื่นทางอินเทอร์เน็ต, '1' = ยื่นสื่อฝากไฟล์ */
  formFlag?: '1' | '2';
  deptName?: string;
};

export type RdWhtFileResult = {
  fileName: string;
  content: string;
  errors: string[];
  warnings: string[];
};

function rdNumber(value: number): string {
  return formatPlain(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function incomeSlot(item: WhtItem | undefined): string[] {
  if (!item) {
    return ['00000000', '0.00', '0.00', '0.00', '', ''];
  }
  return [
    toRdDate(item.paidDate),
    rdNumber(item.rate),
    rdNumber(item.amount),
    rdNumber(item.tax),
    sanitizeRdText(item.incomeType, 100),
    item.condition,
  ];
}

export type WhtDetailRow = { seq: number; payee: WhtPayee; items: WhtItem[] };

/**
 * แถว D ของแบบ ภ.ง.ด. ตามลำดับ: ผู้รับเงินแต่ละราย → ใบสำคัญจ่ายแต่ละใบ (วันที่จ่ายของตัวเอง)
 * → 1 แถวรองรับ 3 ประเภทเงินได้ เกินขึ้นแถวใหม่ — ลำดับที่ (`seq`) พิมพ์ในหนังสือรับรอง 50 ทวิ
 */
export function whtDetailRows(payees: WhtPayee[]): WhtDetailRow[] {
  const rows: WhtDetailRow[] = [];
  payees.forEach((payee) => {
    const byPayment = new Map<string, WhtItem[]>();
    payee.items.forEach((item) => byPayment.set(item.paymentId, [...(byPayment.get(item.paymentId) ?? []), item]));
    byPayment.forEach((items) => {
      chunk(items, 3).forEach((slots) => rows.push({ seq: rows.length + 1, payee, items: slots }));
    });
  });
  return rows;
}

export function buildRdWhtFile(options: RdWhtFileOptions): RdWhtFileResult {
  const {
    form,
    company,
    period,
    payees,
    formType = '00',
    sendNo = '00',
    senderRole = '1',
    formFlag = '2',
    deptName = 'สำนักงานใหญ่',
  } = options;

  const errors: string[] = [];
  const warnings: string[] = [];

  const nid = normalizeTaxId(company.taxId);
  if (!isValidThaiTaxId(nid)) errors.push('เลขผู้เสียภาษีของบริษัทไม่ถูกต้อง (ตั้งค่า > ข้อมูลบริษัท)');
  if (!company.rdUserId) {
    warnings.push('ยังไม่ได้ระบุรหัสผู้ใช้ e-Filing (USER_ID) ในข้อมูลบริษัท — ไฟล์ยังนำเข้าได้แต่ต้องกรอกก่อนส่ง');
  }

  const branch6 = toBranch6(company.branchNo);
  const totals = whtTotals(payees);
  const yearBE = String(toBE(period.year));
  const month = String(period.month).padStart(2, '0');

  // ---------------- HEADER (25 ฟิลด์) ----------------
  const header = [
    'H',
    '0000', // SENDER_ID — ยื่นเองไม่ผ่านธนาคาร
    nid,
    branch6,
    senderRole,
    form,
    nid,
    branch6,
    sanitizeRdText(deptName, 80),
    '0', // ภ.ง.ด.3: ม.3 เตรส | ภ.ง.ด.53: ม.3 เตรส
    '0', // ภ.ง.ด.3: ม.48 ทวิ | ภ.ง.ด.53: ม.65 จัตวา
    '0', // ภ.ง.ด.3: ม.50(3)(4)(5) | ภ.ง.ด.53: ม.69 ทวิ
    '0', // LTO
    month,
    yearBE,
    company.vatRegistered ? 'V' : '',
    formType,
    String(totals.payees),
    rdNumber(totals.amount),
    rdNumber(totals.tax),
    '0.00', // SUR_AMT เงินเพิ่ม
    rdNumber(totals.tax), // GTOT_TAX
    '0.00', // TRANS_AMT
    sanitizeRdText(company.rdUserId, 20),
    formFlag,
  ];

  // ---------------- DETAIL (38 ฟิลด์) ----------------
  payees.forEach(({ contact }) => {
    const payeeId = normalizeTaxId(contact.taxId);
    const who = `${contact.title ?? ''}${contact.name}`;
    if (!isValidThaiTaxId(payeeId)) {
      errors.push(`${who}: เลขผู้เสียภาษี/เลขบัตรประชาชนไม่ถูกต้อง`);
    }
    const a = contact.address ?? {};
    if (form === 'PND3' && (!a.district || !a.province || !/^\d{5}$/.test(a.postalCode ?? ''))) {
      errors.push(`${who}: ภ.ง.ด.3 บังคับ อำเภอ/เขต, จังหวัด และรหัสไปรษณีย์ 5 หลัก`);
    }
  });

  // ใบสำคัญจ่ายแต่ละใบเป็นแถวของตัวเอง (วันที่จ่ายต่างกัน / ตรงกับลำดับที่ใน 50 ทวิ)
  const details: string[][] = whtDetailRows(payees).map(({ seq, payee: { contact }, items: slots }) => {
    const a = contact.address ?? {};
    return [
      'D',
      String(seq),
      branch6,
      normalizeTaxId(contact.taxId),
      '0000000000',
      sanitizeRdText(contact.title || '-', 100),
      sanitizeRdText(contact.name, 100),
      sanitizeRdText(contact.lastName, 80),
      ...incomeSlot(slots[0]),
      ...incomeSlot(slots[1]),
      ...incomeSlot(slots[2]),
      sanitizeRdText(a.buildingName, 40),
      sanitizeRdText(a.roomNo, 20),
      sanitizeRdText(a.floorNo, 20),
      sanitizeRdText(a.village, 100),
      sanitizeRdText(a.addressNo, 20),
      sanitizeRdText(a.moo, 20),
      sanitizeRdText(a.soi, 100),
      sanitizeRdText(a.street, 100),
      sanitizeRdText(a.subDistrict, 50),
      sanitizeRdText(a.district, 50),
      sanitizeRdText(a.province, 50),
      sanitizeRdText(a.postalCode, 5),
    ];
  });

  if (!payees.length) warnings.push('ไม่มีรายการหัก ณ ที่จ่ายในงวดนี้');

  const content = `${[header, ...details].map((r) => r.join('|')).join('\r\n')}\r\n`;
  const fileName = `${form}_${nid}_${branch6}_${yearBE}_${month}_${formType}_${sendNo}.txt`;

  return { fileName, content, errors, warnings };
}
