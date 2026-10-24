import type { AccountingData } from 'src/domain';

import { downloadText } from 'src/utils/download';

// ----------------------------------------------------------------------

/** ดาวน์โหลดข้อมูลทั้งหมดเป็นไฟล์ .json (ใช้กู้คืนในหน้าตั้งค่า) */
export function downloadBackup(data: AccountingData, suffix = '') {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadText(`go-account-backup-${stamp}${suffix}.json`, JSON.stringify(data, null, 2), 'application/json');
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
    { key: 'contacts', label: 'ลูกค้า / ผู้ขาย', count: data.contacts.length },
    { key: 'journal', label: 'รายการบัญชี', count: data.journal.length },
  ];
}
