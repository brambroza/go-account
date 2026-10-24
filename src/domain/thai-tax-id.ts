// ----------------------------------------------------------------------

/**
 * ตรวจเลขประจำตัวผู้เสียภาษี / เลขประจำตัวประชาชน 13 หลัก
 * หลักที่ 13 คือ check digit: (11 − (Σ dᵢ × (13 − i)) mod 11) mod 10 สำหรับ i = 0..11
 */
export function isValidThaiTaxId(value: string | undefined | null): boolean {
  const digits = normalizeTaxId(value);
  if (!/^\d{13}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

/** ตัดขีด/ช่องว่างออก เหลือแต่ตัวเลข */
export function normalizeTaxId(value: string | undefined | null): string {
  return (value ?? '').replace(/[\s-]/g, '');
}

/** แสดงผลแบบ 0-1055-65012-34-5 */
export function formatTaxId(value: string | undefined | null): string {
  const d = normalizeTaxId(value);
  if (d.length !== 13) return d;
  return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
}

/** สาขา 5 หลักบนใบกำกับ (00000 = สำนักงานใหญ่) */
export function normalizeBranch5(value: string | undefined | null): string {
  const d = (value ?? '').replace(/\D/g, '');
  return (d || '0').padStart(5, '0').slice(-5);
}

/** สาขา 6 หลักในไฟล์ Format กลาง (000000 = สำนักงานใหญ่) */
export function toBranch6(value: string | undefined | null): string {
  const d = (value ?? '').replace(/\D/g, '');
  return (d || '0').padStart(6, '0').slice(-6);
}

export function branchLabel(value: string | undefined | null): string {
  const b = normalizeBranch5(value);
  return b === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${b}`;
}
