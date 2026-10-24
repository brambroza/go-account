import type { AccountingData } from 'src/domain';

import { downloadText } from 'src/utils/download';

// ----------------------------------------------------------------------

/** เวลาท้องถิ่นของเครื่องสำหรับชื่อไฟล์ เช่น 2026-10-24-17-05-09 (ไม่ใช้ UTC — สำรองตอนเช้าจะได้วันที่ถูก) */
export function backupStamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    p(date.getMonth() + 1),
    p(date.getDate()),
    p(date.getHours()),
    p(date.getMinutes()),
    p(date.getSeconds()),
  ].join('-');
}

/** ดาวน์โหลดข้อมูลทั้งหมดเป็นไฟล์ .json (ใช้กู้คืนในหน้าตั้งค่า) */
export function downloadBackup(data: AccountingData, suffix = '') {
  const stamp = backupStamp();
  downloadText(
    `go-account-backup-${stamp}${suffix}.json`,
    JSON.stringify(data, null, 2),
    'application/json'
  );
}

export type BackupCount = { key: string; label: string; count: number };

/** จำนวนรายการแต่ละประเภท — ใช้เทียบไฟล์สำรองกับข้อมูลปัจจุบันก่อนกู้คืน/ล้างข้อมูล */
export function backupCounts(data: AccountingData): BackupCount[] {
  return [
    { key: 'sales', label: 'เอกสารขาย / ใบลดหนี้', count: data.sales.length },
    { key: 'receipts', label: 'ใบรับชำระ', count: data.receipts.length },
    { key: 'purchases', label: 'เอกสารซื้อ / ค่าใช้จ่าย', count: data.purchases.length },
    { key: 'payments', label: 'ใบสำคัญจ่าย', count: data.payments.length },
    { key: 'refunds', label: 'คืนเงินลูกค้า', count: data.refunds.length },
    { key: 'purchaseCredits', label: 'ใบลดหนี้จากผู้ขาย', count: data.purchaseCredits.length },
    { key: 'supplierRefunds', label: 'รับเงินคืนจากผู้ขาย', count: (data.supplierRefunds ?? []).length },
    { key: 'quotations', label: 'ใบเสนอราคา', count: data.quotations.length },
    { key: 'transfers', label: 'โอนเงินระหว่างบัญชี', count: data.transfers.length },
    { key: 'bankStatements', label: 'รายการ statement ธนาคาร', count: data.bankStatements.length },
    { key: 'contacts', label: 'ลูกค้า / ผู้ขาย', count: data.contacts.length },
    { key: 'journal', label: 'รายการบัญชี', count: data.journal.length },
  ];
}
