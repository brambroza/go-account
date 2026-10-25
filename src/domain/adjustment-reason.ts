import type { SaleType, SalesDocKind } from './types';

// ----------------------------------------------------------------------
// รหัสเหตุผลการออกใบเพิ่มหนี้/ใบลดหนี้ — ETDA ขมธอ.3-2560 ภาคผนวก B.3 (RD 1225 Thai Message Function Code)
// สินค้า: CDNG01–05 / DBNG01–02, บริการ: CDNS01–04 / DBNS01–02, เหตุอื่น: …99 (ต้องระบุสาเหตุเป็นข้อความ)
// ข้อความไทยตามฉบับภาษาไทย (ตรวจความหมายกับฉบับแปลอังกฤษ V03 น.50 และไฟล์ตัวอย่าง ETDA Example_CreditNote_2p0_v1.xml)
// ⚠️ ยืนยันถ้อยคำกับ ขมธอ.3-2560 ฉบับภาษาไทยล่าสุดก่อนใช้งานจริง
// ----------------------------------------------------------------------

export type AdjustmentKind = Extract<SalesDocKind, 'credit-note' | 'debit-note'>;

export type AdjustmentReason = { code: string; kind: AdjustmentKind; saleType: SaleType; label: string };

export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  { code: 'CDNG01', kind: 'credit-note', saleType: 'goods', label: 'ลดราคาสินค้าที่ขาย (สินค้าผิดข้อกำหนดที่ตกลงกัน)' },
  { code: 'CDNG02', kind: 'credit-note', saleType: 'goods', label: 'สินค้าชำรุดเสียหาย' },
  { code: 'CDNG03', kind: 'credit-note', saleType: 'goods', label: 'สินค้าขาดจำนวนตามที่ตกลงซื้อขาย' },
  { code: 'CDNG04', kind: 'credit-note', saleType: 'goods', label: 'คำนวณราคาสินค้าผิดพลาดสูงกว่าที่เป็นจริง' },
  { code: 'CDNG05', kind: 'credit-note', saleType: 'goods', label: 'รับคืนสินค้า (ไม่ตรงตามคำพรรณนา)' },
  { code: 'CDNG99', kind: 'credit-note', saleType: 'goods', label: 'เหตุอื่น (ระบุสาเหตุ)' },
  { code: 'CDNS01', kind: 'credit-note', saleType: 'service', label: 'ลดราคาค่าบริการ (บริการผิดข้อกำหนดที่ตกลงกัน)' },
  { code: 'CDNS02', kind: 'credit-note', saleType: 'service', label: 'ค่าบริการขาดจำนวน' },
  { code: 'CDNS03', kind: 'credit-note', saleType: 'service', label: 'คำนวณราคาค่าบริการผิดพลาดสูงกว่าที่เป็นจริง' },
  { code: 'CDNS04', kind: 'credit-note', saleType: 'service', label: 'บอกเลิกสัญญาบริการ' },
  { code: 'CDNS99', kind: 'credit-note', saleType: 'service', label: 'เหตุอื่น (ระบุสาเหตุ)' },
  { code: 'DBNG01', kind: 'debit-note', saleType: 'goods', label: 'มีการเพิ่มราคาค่าสินค้า (สินค้าเกินกว่าจำนวนที่ตกลงกัน)' },
  { code: 'DBNG02', kind: 'debit-note', saleType: 'goods', label: 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง' },
  { code: 'DBNG99', kind: 'debit-note', saleType: 'goods', label: 'เหตุอื่น (ระบุสาเหตุ)' },
  { code: 'DBNS01', kind: 'debit-note', saleType: 'service', label: 'การเพิ่มราคาค่าบริการ (บริการเกินกว่าข้อกำหนดที่ตกลงกัน)' },
  { code: 'DBNS02', kind: 'debit-note', saleType: 'service', label: 'คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง' },
  { code: 'DBNS99', kind: 'debit-note', saleType: 'service', label: 'เหตุอื่น (ระบุสาเหตุ)' },
];

/** ไม่มี saleType = ขายสินค้า */
const family = (saleType: SaleType | undefined): SaleType => (saleType === 'service' ? 'service' : 'goods');

/** รหัสที่เลือกได้ของใบลด/เพิ่มหนี้ตามประเภทการขายของใบเดิม (เหตุอื่นอยู่ท้ายสุด) */
export function adjustmentReasonOptions(kind: AdjustmentKind, saleType: SaleType | undefined): AdjustmentReason[] {
  return ADJUSTMENT_REASONS.filter((r) => r.kind === kind && r.saleType === family(saleType));
}

/** รหัส "เหตุอื่น" ของชนิด/ประเภทการขาย (CDNG99 / CDNS99 / DBNG99 / DBNS99) */
export function otherReasonCode(kind: AdjustmentKind, saleType: SaleType | undefined): string {
  return `${kind === 'credit-note' ? 'CDN' : 'DBN'}${family(saleType) === 'service' ? 'S' : 'G'}99`;
}

/** รหัสที่ใช้จริง: ไม่ระบุ = เหตุอื่น */
export function effectiveReasonCode(kind: AdjustmentKind, saleType: SaleType | undefined, code: string | undefined): string {
  return code || otherReasonCode(kind, saleType);
}

export function isOtherReasonCode(code: string | undefined): boolean {
  return !code || code.endsWith('99');
}

export function adjustmentReasonLabel(code: string | undefined): string | undefined {
  return ADJUSTMENT_REASONS.find((r) => r.code === code)?.label;
}

/**
 * ตรวจรหัส/ข้อความเหตุผลก่อนออกใบลด/เพิ่มหนี้ — `label` = ใบลดหนี้ / ใบเพิ่มหนี้
 * รหัสต้องเป็นของชนิดและประเภทการขายนี้; เหตุอื่น (99 หรือไม่ระบุ) ต้องมีข้อความ — คืนข้อความปัญหา หรือ null
 */
export function adjustmentReasonProblem(
  kind: AdjustmentKind,
  saleType: SaleType | undefined,
  code: string | undefined,
  reason: string | undefined,
  label: string
): string | null {
  if (code && !adjustmentReasonOptions(kind, saleType).some((r) => r.code === code)) {
    return `รหัสเหตุผล ${code} ใช้กับ${label}${family(saleType) === 'service' ? 'งานบริการ' : 'ขายสินค้า'}ไม่ได้`;
  }
  if (isOtherReasonCode(code) && !(reason ?? '').trim()) return `${label}ต้องระบุเหตุผล`;
  return null;
}

/**
 * ข้อความเหตุผลที่พิมพ์/ส่งใน XML (Purpose): เหตุอื่น = ข้อความที่กรอก, รหัสเฉพาะ = คำอธิบายของรหัส
 * (ข้อความที่กรอกเพิ่มกับรหัสเฉพาะเป็นรายละเอียดบนเอกสารพิมพ์ — `adjustmentReasonDisplay`)
 */
export function adjustmentPurposeText(doc: { kind: AdjustmentKind; saleType?: SaleType; reasonCode?: string; reason?: string }): string {
  if (!isOtherReasonCode(doc.reasonCode)) return adjustmentReasonLabel(doc.reasonCode) ?? '';
  return (doc.reason ?? '').trim();
}

/** เหตุผลบนเอกสารพิมพ์: คำอธิบายรหัส + รายละเอียดที่กรอก (ถ้ามี) */
export function adjustmentReasonDisplay(doc: { kind: AdjustmentKind; reasonCode?: string; reason?: string }): string {
  const reason = (doc.reason ?? '').trim();
  if (isOtherReasonCode(doc.reasonCode)) return reason;
  const label = adjustmentReasonLabel(doc.reasonCode) ?? '';
  return reason ? `${label} — ${reason}` : label;
}
