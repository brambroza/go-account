// ----------------------------------------------------------------------

/**
 * ทุกการคำนวณเงินในระบบทำเป็น "สตางค์" (จำนวนเต็ม) แล้วค่อยแปลงกลับเป็นบาท
 * เพื่อเลี่ยงปัญหา floating point (0.1 + 0.2) — ปัดเศษแบบ half-up ตามหลักสากล
 * (ตรงกับที่ Format กลางของกรมสรรพากรกำหนด: ทศนิยมตำแหน่งที่ 3 ตั้งแต่ 5 ปัดขึ้น)
 */

export function toSatang(baht: number): number {
  if (!Number.isFinite(baht)) return 0;
  const sign = baht < 0 ? -1 : 1;
  // + 1e-9 แก้กรณี 1.005 * 100 = 100.49999999
  return sign * Math.round(Math.abs(baht) * 100 + 1e-9);
}

export function fromSatang(satang: number): number {
  return satang / 100;
}

/** ปัดเป็นทศนิยม 2 ตำแหน่ง (half-up) */
export function round2(baht: number): number {
  return fromSatang(toSatang(baht));
}

/** รวมเงินหลายจำนวนแบบไม่สะสม error */
export function sumBaht(values: number[]): number {
  return fromSatang(values.reduce((acc, v) => acc + toSatang(v), 0));
}

/** ลบเงิน a − b ในหน่วยสตางค์ */
export function subBaht(a: number, b: number): number {
  return fromSatang(toSatang(a) - toSatang(b));
}

/**
 * แบ่งตามสัดส่วน amount × part ÷ whole ปัดเป็นสตางค์ half-up
 * คำนวณด้วย BigInt บนสตางค์ เพื่อไม่ให้ผลคูณเกินความแม่นยำของ number
 */
export function prorateBaht(amount: number, part: number, whole: number): number {
  const w = toSatang(whole);
  if (w === 0) return 0;
  const product = BigInt(toSatang(amount)) * BigInt(toSatang(part));
  const negative = product < BigInt(0) !== w < 0;
  const absProduct = product < BigInt(0) ? -product : product;
  const absWhole = BigInt(Math.abs(w));
  const q = (absProduct * BigInt(2) + absWhole) / (absWhole * BigInt(2));
  return fromSatang(Number(negative ? -q : q));
}

/** คูณแล้วปัดเป็นสตางค์ทันที เช่น จำนวน × ราคาต่อหน่วย */
export function mulBaht(a: number, b: number): number {
  return round2(a * b);
}

/** เปอร์เซ็นต์ของจำนวนเงิน ปัดเป็นสตางค์ เช่น percentOf(1000, 7) = 70 */
export function percentOf(baht: number, rate: number): number {
  const raw = (toSatang(baht) * rate) / 100;
  const sign = raw < 0 ? -1 : 1;
  return fromSatang(sign * Math.round(Math.abs(raw) + 1e-9));
}

/** รูปแบบตัวเลขเงินสำหรับแสดงผล: 1,234.50 */
export function formatBaht(baht: number): string {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(baht));
}

/** รูปแบบตัวเลขในไฟล์ส่งสรรพากร: ไม่มีคอมม่า ทศนิยม 2 ตำแหน่งเสมอ เช่น 1234.50 */
export function formatPlain(baht: number): string {
  return round2(baht).toFixed(2);
}
