import { round2 } from './money';
import { parseCsv } from './csv-import';
import { isValidISODate } from './thai-date';

import type { ISODate } from './types';

// ----------------------------------------------------------------------
// นำเข้า statement ธนาคารจาก CSV — รูปแบบที่ธนาคารไทยส่งออกบ่อย:
//   วันที่ (DD/MM/YYYY พ.ศ. หรือ ค.ศ., DD/MM/YY พ.ศ. 2 หลัก, YYYY-MM-DD), รายการ/คำอธิบาย,
//   จำนวนเงินช่องเดียว (ลบ = ถอน) หรือแยกช่อง ถอน/ฝาก, ยอดคงเหลือ (ถ้ามี)
// ผู้ใช้เลือกคอลัมน์เองในหน้าจอ ระบบเดาจากหัวคอลัมน์ให้ก่อน (`guessStatementMapping`)
// ----------------------------------------------------------------------

export type StatementMapping = {
  /** แถวแรกเป็นหัวคอลัมน์ */
  hasHeader: boolean;
  date: number;
  description: number;
  /** จำนวนเงินช่องเดียว (บวก = เข้า, ลบ = ออก) — ใช้เมื่อไม่ได้เลือกช่องถอน/ฝาก */
  amount?: number;
  /** ช่องถอน (เงินออก) */
  withdrawal?: number;
  /** ช่องฝาก (เงินเข้า) */
  deposit?: number;
  balance?: number;
};

export type StatementRow = { date: ISODate; description: string; amount: number; balance?: number };

export type StatementImportResult = {
  rows: StatementRow[];
  /** ข้อผิดพลาดรายแถว (เลขแถวตามไฟล์ เริ่มที่ 1) */
  errors: { row: number; message: string }[];
};

/** "1,234.50" / "-1,234.50" / "(1,234.50)" / "1,234.50-" / "฿ 1,234" → ตัวเลข (ว่าง = null, อ่านไม่ได้ = NaN) */
export function parseStatementAmount(text: string | undefined): number | null {
  const raw = (text ?? '').trim();
  if (!raw || raw === '-') return null;
  let s = raw.replace(/[฿,\s]/g, '').replace(/^THB/i, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const value = round2(Number(s));
  return negative ? -value : value;
}

/**
 * วันที่ใน statement → ISO ค.ศ. (null = อ่านไม่ได้)
 * รับ DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (ปี > 2400 = พ.ศ.), DD/MM/YY (ปี 2 หลัก = พ.ศ. 25xx), YYYY-MM-DD
 * ตัดเวลาที่ต่อท้าย (เช่น "24/10/2569 14:05") ทิ้ง
 */
export function parseStatementDate(text: string | undefined): ISODate | null {
  const raw = (text ?? '').trim().split(/\s+/)[0] ?? '';
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(raw);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (dmy[3].length === 2) y += 2500;
  } else {
    return null;
  }
  if (y > 2400) y -= 543;
  const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISODate(out) ? out : null;
}

const HEADER_HINTS: { key: keyof Omit<StatementMapping, 'hasHeader'>; pattern: RegExp }[] = [
  { key: 'date', pattern: /วันที่|date/i },
  { key: 'withdrawal', pattern: /ถอน|withdraw|debit|เงินออก|จ่าย/i },
  { key: 'deposit', pattern: /ฝาก|deposit|credit|เงินเข้า|รับ/i },
  { key: 'balance', pattern: /คงเหลือ|balance/i },
  { key: 'amount', pattern: /จำนวนเงิน|amount/i },
  { key: 'description', pattern: /รายการ|คำอธิบาย|รายละเอียด|description|detail|memo|narrative/i },
];

/** เดาการเลือกคอลัมน์จากหัวคอลัมน์ (ไม่พบ = คอลัมน์แรก/ที่สอง/ที่สาม) */
export function guessStatementMapping(header: string[]): StatementMapping {
  const found: Partial<Record<keyof Omit<StatementMapping, 'hasHeader'>, number>> = {};
  header.forEach((h, i) => {
    const hint = HEADER_HINTS.find((x) => found[x.key] === undefined && x.pattern.test(h));
    if (hint) found[hint.key] = i;
  });
  const hasHeader = found.date !== undefined || parseStatementDate(header[0]) === null;
  const split = found.withdrawal !== undefined || found.deposit !== undefined;
  return {
    hasHeader,
    date: found.date ?? 0,
    description: found.description ?? 1,
    ...(split
      ? { withdrawal: found.withdrawal, deposit: found.deposit }
      : { amount: found.amount ?? 2 }),
    ...(found.balance !== undefined ? { balance: found.balance } : {}),
  };
}

/** แปลงแถว CSV ตามการเลือกคอลัมน์ — แถวที่อ่านไม่ได้รายงานใน `errors` (แถวยอดยกมา/ยอดรวมที่ไม่มีวันที่ถูกข้าม) */
export function mapStatementRows(table: string[][], mapping: StatementMapping): StatementImportResult {
  const rows: StatementRow[] = [];
  const errors: StatementImportResult['errors'] = [];
  table.forEach((cells, index) => {
    if (mapping.hasHeader && index === 0) return;
    const rowNo = index + 1;
    const dateText = cells[mapping.date];
    const date = parseStatementDate(dateText);
    if (!date) {
      // แถวสรุป/ยอดยกมาที่ไม่มีวันที่ — ข้ามเงียบ ๆ; มีข้อความแต่อ่านไม่ได้ = แจ้ง
      if ((dateText ?? '').trim()) errors.push({ row: rowNo, message: `วันที่ "${dateText}" อ่านไม่ได้` });
      return;
    }
    let amount: number | null;
    if (mapping.withdrawal !== undefined || mapping.deposit !== undefined) {
      const out = mapping.withdrawal === undefined ? null : parseStatementAmount(cells[mapping.withdrawal]);
      const inn = mapping.deposit === undefined ? null : parseStatementAmount(cells[mapping.deposit]);
      if (Number.isNaN(out) || Number.isNaN(inn)) {
        errors.push({ row: rowNo, message: 'จำนวนเงินอ่านไม่ได้' });
        return;
      }
      amount = round2((inn ?? 0) - Math.abs(out ?? 0));
    } else {
      amount = parseStatementAmount(mapping.amount === undefined ? undefined : cells[mapping.amount]);
      if (amount === null || Number.isNaN(amount)) {
        errors.push({ row: rowNo, message: 'จำนวนเงินอ่านไม่ได้' });
        return;
      }
    }
    if (amount === 0) {
      errors.push({ row: rowNo, message: 'จำนวนเงินเป็นศูนย์' });
      return;
    }
    const balance = mapping.balance === undefined ? null : parseStatementAmount(cells[mapping.balance]);
    rows.push({
      date,
      description: (cells[mapping.description] ?? '').trim(),
      amount,
      ...(balance !== null && !Number.isNaN(balance) ? { balance } : {}),
    });
  });
  return { rows, errors };
}

/** อ่านไฟล์ CSV ทั้งไฟล์: ตาราง + การเลือกคอลัมน์ที่เดาไว้ */
export function readStatementCsv(text: string): { table: string[][]; mapping: StatementMapping } {
  const table = parseCsv(text);
  return { table, mapping: guessStatementMapping(table[0] ?? []) };
}
