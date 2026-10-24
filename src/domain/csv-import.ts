import { normalizeTaxId, normalizeBranch5, isValidThaiTaxId } from './thai-tax-id';

import type { Contact, LegalForm, ContactKind } from './types';

// ----------------------------------------------------------------------
// นำเข้าผู้ติดต่อจากไฟล์ CSV (เช่น export รายชื่อลูกค้า/ผู้ขายจากโปรแกรมบัญชีเดิม)
// รับหัวคอลัมน์ทั้งภาษาไทยและอังกฤษ — คอลัมน์ที่ไม่รู้จักจะถูกข้าม
// ----------------------------------------------------------------------

/** แยก CSV แบบรองรับเครื่องหมายคำพูดและคอมม่าในช่อง */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_MAP: Record<string, keyof ImportedContactRow> = {
  code: 'code',
  รหัส: 'code',
  name: 'name',
  ชื่อ: 'name',
  'ชื่อลูกค้า': 'name',
  'ชื่อผู้จำหน่าย': 'name',
  title: 'title',
  คำนำหน้า: 'title',
  lastname: 'lastName',
  นามสกุล: 'lastName',
  taxid: 'taxId',
  'tax id': 'taxId',
  เลขประจำตัวผู้เสียภาษี: 'taxId',
  เลขผู้เสียภาษี: 'taxId',
  branch: 'branchNo',
  สาขา: 'branchNo',
  address: 'addressNo',
  ที่อยู่: 'addressNo',
  district: 'district',
  'อำเภอ/เขต': 'district',
  province: 'province',
  จังหวัด: 'province',
  postcode: 'postalCode',
  รหัสไปรษณีย์: 'postalCode',
  phone: 'phone',
  โทรศัพท์: 'phone',
  email: 'email',
  อีเมล: 'email',
  type: 'kind',
  ประเภท: 'kind',
  creditdays: 'creditDays',
  เครดิต: 'creditDays',
};

type ImportedContactRow = {
  code: string;
  name: string;
  title: string;
  lastName: string;
  taxId: string;
  branchNo: string;
  addressNo: string;
  district: string;
  province: string;
  postalCode: string;
  phone: string;
  email: string;
  kind: string;
  creditDays: string;
};

export type ContactImportResult = {
  contacts: Omit<Contact, 'id'>[];
  errors: { row: number; message: string }[];
};

const JURISTIC_HINT = /บริษัท|ห้างหุ้นส่วน|หจก|บจก|บมจ|จำกัด|co\.|ltd|limited/i;

function toKind(value: string): ContactKind {
  const v = value.trim().toLowerCase();
  if (['vendor', 'supplier', 'ผู้ขาย', 'ผู้จำหน่าย', 'เจ้าหนี้'].includes(v)) return 'vendor';
  if (['both', 'ทั้งสอง'].includes(v)) return 'both';
  return 'customer';
}

export function importContactsCsv(text: string): ContactImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { contacts: [], errors: [{ row: 1, message: 'ไม่พบข้อมูลในไฟล์' }] };

  const headers = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? HEADER_MAP[h.trim()]);
  if (!headers.includes('name')) {
    return { contacts: [], errors: [{ row: 1, message: 'ไม่พบคอลัมน์ "ชื่อ" หรือ "name"' }] };
  }

  const contacts: Omit<Contact, 'id'>[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.slice(1).forEach((cells, index) => {
    const rowNo = index + 2;
    const r = {} as ImportedContactRow;
    headers.forEach((key, col) => {
      if (key) r[key] = (cells[col] ?? '').trim();
    });

    if (!r.name) {
      errors.push({ row: rowNo, message: 'ไม่มีชื่อ' });
      return;
    }
    const taxId = normalizeTaxId(r.taxId);
    if (taxId && !isValidThaiTaxId(taxId)) {
      errors.push({ row: rowNo, message: `เลขผู้เสียภาษี ${r.taxId} ไม่ถูกต้อง (นำเข้าแล้วแต่ต้องแก้)` });
    }
    const fullName = `${r.title ?? ''} ${r.name}`;
    const legalForm: LegalForm = JURISTIC_HINT.test(fullName) ? 'juristic' : 'individual';

    contacts.push({
      code: r.code || `C${String(rowNo - 1).padStart(4, '0')}`,
      kind: toKind(r.kind ?? ''),
      legalForm,
      title: r.title || (legalForm === 'juristic' ? 'บริษัท' : ''),
      name: r.name,
      lastName: r.lastName || undefined,
      taxId: taxId || undefined,
      branchNo: r.branchNo ? normalizeBranch5(r.branchNo) : '00000',
      address: {
        addressNo: r.addressNo || undefined,
        district: r.district || undefined,
        province: r.province || undefined,
        postalCode: r.postalCode || undefined,
      },
      phone: r.phone || undefined,
      email: r.email || undefined,
      creditDays: Number(r.creditDays) || 30,
    });
  });

  return { contacts, errors };
}
