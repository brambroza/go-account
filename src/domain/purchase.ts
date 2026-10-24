import { calcDocument, lineNetAmounts } from './document-calc';
import { normalizeTaxId, isValidThaiTaxId } from './thai-tax-id';
import { isMonthKey, endOfMonth, monthKeyOf, shiftMonthKey, isValidISODate } from './thai-date';
import { round2, sumBaht, subBaht, toSatang, percentOf, fromSatang, prorateBaht } from './money';

import type {
  ISODate,
  Payment,
  DocTotals,
  PurchaseDoc,
  WhtLineItem,
  PartySnapshot,
  AccountingData,
  PurchaseCreditLine,
  PurchaseCreditNote,
} from './types';

// ----------------------------------------------------------------------
// เอกสารซื้อ: สิทธิภาษีซื้อ (ม.82/3, ม.82/5), หัก ณ ที่จ่ายระดับบรรทัด และการแบ่งจ่ายหลายครั้ง
// ----------------------------------------------------------------------

/** ใช้สิทธิภาษีซื้อได้ในเดือนที่ออกใบกำกับ ถึงไม่เกิน 6 เดือนถัดจากเดือนนั้น (ม.82/3 วรรคท้าย) */
export const VAT_CLAIM_WINDOW_MONTHS = 6;

/** เงินได้ที่จ่ายแต่ละครั้งต่ำกว่า 1,000 บาท ไม่ต้องหักภาษี ณ ที่จ่าย (ท.ป.4/2528 ข้อ 12) — ใช้เตือน ไม่บล็อก */
export const WHT_MIN_PAYMENT = 1000;

/** ช่วงเดือนที่ใช้สิทธิภาษีซื้อของใบกำกับลงวันที่นี้ได้ `{ first, last }` (YYYY-MM) */
export function vatClaimWindow(supplierInvoiceDate: ISODate): { first: string; last: string } {
  const first = monthKeyOf(supplierInvoiceDate);
  return { first, last: shiftMonthKey(first, VAT_CLAIM_WINDOW_MONTHS) };
}

/** เดือนภาษีนี้ปิดงวดแล้วทั้งเดือนหรือยัง (ยื่น ภ.พ.30 ไปแล้ว ใช้สิทธิในเดือนนี้ไม่ได้) */
export function isMonthLocked(month: string, lockedThrough: ISODate | undefined): boolean {
  return !!lockedThrough && endOfMonth(month) <= lockedThrough;
}

/** เดือนที่เลือกใช้สิทธิได้ (อยู่ในช่วง 6 เดือน และยังไม่ปิดงวด) — ใช้ทำตัวเลือกในฟอร์ม */
export function vatClaimPeriodOptions(
  supplierInvoiceDate: string | undefined,
  lockedThrough?: ISODate,
  /** วันยอดยกมา — เดือนนั้นและก่อนหน้ายื่น ภ.พ.30 ในระบบเดิมแล้ว ใช้สิทธิในระบบนี้ไม่ได้ */
  openingDate?: ISODate
): string[] {
  if (!supplierInvoiceDate || !isValidISODate(supplierInvoiceDate)) return [];
  const { first } = vatClaimWindow(supplierInvoiceDate);
  return Array.from({ length: VAT_CLAIM_WINDOW_MONTHS + 1 }, (_, i) => shiftMonthKey(first, i)).filter(
    (m) => !isMonthLocked(m, lockedThrough) && !(openingDate && m <= openingDate.slice(0, 7))
  );
}

/**
 * เดือนที่ระบบเสนอให้ใช้สิทธิ: เดือนในใบกำกับถ้ายังไม่ปิดงวด ไม่อย่างนั้นเดือนแรกที่ยังเปิดอยู่ในช่วง 6 เดือน
 * (ไม่มีเดือนที่ใช้ได้ = ใบกำกับเกิน 6 เดือนแล้ว คืน undefined)
 */
export function defaultVatClaimPeriod(
  supplierInvoiceDate: string | undefined,
  lockedThrough?: ISODate,
  openingDate?: ISODate
): string | undefined {
  return vatClaimPeriodOptions(supplierInvoiceDate, lockedThrough, openingDate)[0];
}

/**
 * ผู้ขายมีข้อมูลพอให้ใช้สิทธิภาษีซื้อหรือไม่ (ม.82/5 (1) ใบกำกับที่ไม่มีรายการตาม ม.86/4 = ภาษีซื้อต้องห้าม)
 * ตรวจเลขผู้เสียภาษี 13 หลัก (check digit) และเลขสาขา 5 หลักใน snapshot — คืนข้อความปัญหา หรือ null
 */
export function supplierVatClaimProblem(party: Pick<PartySnapshot, 'taxId' | 'branchNo'> | undefined): string | null {
  if (!party) return 'ไม่พบข้อมูลผู้ขาย';
  if (!normalizeTaxId(party.taxId)) return 'ผู้ขายไม่มีเลขประจำตัวผู้เสียภาษี';
  if (!isValidThaiTaxId(party.taxId)) return 'เลขประจำตัวผู้เสียภาษีของผู้ขายไม่ถูกต้อง';
  if (!/^\d{5}$/.test(party.branchNo ?? '')) return 'ผู้ขายไม่มีเลขสาขา 5 หลัก';
  return null;
}

/**
 * ตรวจวันที่ใบกำกับผู้ขายและเดือนใช้สิทธิของเอกสารที่ขอคืนภาษีซื้อ — คืนข้อความปัญหา หรือ null
 * กฎ: มีวันที่ใบกำกับ (ไม่หลังวันที่บันทึก), เดือนใช้สิทธิ ≥ เดือนในใบกำกับ และ ≤ +6 เดือน
 * (การตรวจว่าเดือนใช้สิทธิปิดงวดแล้วหรือยังอยู่ที่ action — ข้อมูลเดิมที่ปิดงวดไปแล้วถูกต้อง)
 */
export function vatClaimProblem(
  doc: Pick<PurchaseDoc, 'date' | 'supplierInvoiceDate' | 'vatClaimPeriod'>
): string | null {
  if (!doc.supplierInvoiceDate || !isValidISODate(doc.supplierInvoiceDate)) {
    return 'ขอคืนภาษีซื้อต้องระบุวันที่ในใบกำกับภาษีของผู้ขาย (ปี ค.ศ.)';
  }
  if (doc.supplierInvoiceDate > doc.date) return 'วันที่ใบกำกับผู้ขายต้องไม่หลังวันที่บันทึก';
  if (!doc.vatClaimPeriod || !isMonthKey(doc.vatClaimPeriod)) return 'ขอคืนภาษีซื้อต้องเลือกเดือนที่ใช้สิทธิ';
  const { first, last } = vatClaimWindow(doc.supplierInvoiceDate);
  if (doc.vatClaimPeriod < first) return 'เดือนที่ใช้สิทธิภาษีซื้อต้องไม่ก่อนเดือนในใบกำกับของผู้ขาย';
  if (doc.vatClaimPeriod > last) {
    return `ใช้สิทธิภาษีซื้อได้ไม่เกิน ${VAT_CLAIM_WINDOW_MONTHS} เดือนถัดจากเดือนในใบกำกับ (ถึง ${last}) — ม.82/3`;
  }
  return null;
}

/** เดือนภาษีที่ภาษีซื้อของเอกสารนี้เข้ารายงาน (ข้อมูลเก่าที่ไม่มี `vatClaimPeriod` = เดือนของวันที่เอกสาร) */
export function purchaseVatMonth(doc: Pick<PurchaseDoc, 'date' | 'vatClaimPeriod'>): string {
  return doc.vatClaimPeriod ?? monthKeyOf(doc.date);
}

// ---------------- หัก ณ ที่จ่ายระดับบรรทัด ----------------

/**
 * หัก ณ ที่จ่ายของทั้งเอกสาร แยกตามประเภทเงินได้ + อัตรา (ฐาน = มูลค่าก่อน VAT ของบรรทัด รวมกันแล้วคิดภาษีครั้งเดียว)
 * บรรทัดที่อัตรา 0 (สินค้า) ไม่นับ — เรียงตามลำดับบรรทัดแรกที่พบ
 */
export function purchaseWhtGroups(doc: Pick<PurchaseDoc, 'lines' | 'vatMode' | 'vatRate'>): WhtLineItem[] {
  const nets = lineNetAmounts(doc);
  const groups = new Map<string, { incomeType: string; rate: number; base: number }>();
  doc.lines.forEach((line, index) => {
    if (!(line.whtRate > 0)) return;
    const key = `${line.whtIncomeType}|${line.whtRate}`;
    const g = groups.get(key) ?? { incomeType: line.whtIncomeType, rate: line.whtRate, base: 0 };
    g.base = sumBaht([g.base, nets[index]]);
    groups.set(key, g);
  });
  return Array.from(groups.values()).map((g) => ({ ...g, tax: percentOf(g.base, g.rate) }));
}

/** มีหัก ณ ที่จ่ายบรรทัดใดบ้างหรือไม่ */
export function hasWht(doc: Pick<PurchaseDoc, 'lines'>): boolean {
  return doc.lines.some((l) => l.whtRate > 0);
}

/** ยอดเอกสารซื้อ — `wht` = ผลรวมหัก ณ ที่จ่ายทุกประเภทเงินได้, `payable` = ยอดโอนจริงถ้าจ่ายครั้งเดียว */
export function purchaseTotals(doc: Pick<PurchaseDoc, 'lines' | 'vatMode' | 'vatRate'>): DocTotals {
  const t = calcDocument(doc);
  const wht = sumBaht(purchaseWhtGroups(doc).map((g) => g.tax));
  return { ...t, wht, payable: subBaht(t.total, wht) };
}

/** สรุปประเภทเงินได้ของเอกสาร เช่น "ค่าบริการ 3%, ค่าขนส่ง 1%" ('' = ไม่มีหัก) */
export function whtSummaryLabel(items: Pick<WhtLineItem, 'incomeType' | 'rate'>[]): string {
  return items.map((g) => `${g.incomeType} ${g.rate}%`).join(', ');
}

// ---------------- การจ่ายชำระ (แบ่งจ่ายได้) และใบลดหนี้จากผู้ขาย ----------------

/** ข้อมูลที่ใช้คิดยอดค้างจ่าย — `purchaseCredits` ไม่มี = ไม่มีใบลดหนี้ผู้ขาย (test/ข้อมูลบางส่วน) */
type PaymentState = Pick<AccountingData, 'payments'> & Partial<Pick<AccountingData, 'purchaseCredits' | 'supplierRefunds'>>;

export function paymentsOf(state: Pick<AccountingData, 'payments'>, purchaseId: string): Payment[] {
  return state.payments.filter((p) => p.purchaseId === purchaseId);
}

/** ใบลดหนี้จากผู้ขายที่อ้างเอกสารซื้อนี้ */
export function purchaseCreditsOf(state: Partial<Pick<AccountingData, 'purchaseCredits'>>, purchaseId: string): PurchaseCreditNote[] {
  return (state.purchaseCredits ?? []).filter((c) => c.purchaseId === purchaseId);
}

/** ยอดลดหนี้จากผู้ขายรวม (รวม VAT) ของเอกสารซื้อนี้ */
export function purchaseCreditedTotal(state: Partial<Pick<AccountingData, 'purchaseCredits'>>, doc: Pick<PurchaseDoc, 'id'>): number {
  return sumBaht(purchaseCreditsOf(state, doc.id).map((c) => calcDocument(c).total));
}

/** มูลค่าก่อน VAT และ VAT ของใบลดหนี้ผู้ขายทั้งหมดของเอกสารนี้ */
export function purchaseCreditedParts(
  state: Partial<Pick<AccountingData, 'purchaseCredits'>>,
  doc: Pick<PurchaseDoc, 'id'>
): { net: number; vat: number } {
  const t = purchaseCreditsOf(state, doc.id).map((c) => calcDocument(c));
  return { net: sumBaht(t.map((x) => x.net)), vat: sumBaht(t.map((x) => x.vat)) };
}

/** ยอดเอกสารหลังหักใบลดหนี้ผู้ขาย (รวม VAT) */
type CalcPurchase = Pick<PurchaseDoc, 'id' | 'lines' | 'vatMode' | 'vatRate'>;

export function purchaseAdjustedTotal(state: PaymentState, doc: CalcPurchase): number {
  return subBaht(calcDocument(doc).total, purchaseCreditedTotal(state, doc));
}

/** ยอดที่ใบลดหนี้ผู้ขายยังลดได้ = ยอดเอกสาร − ใบลดหนี้ก่อนหน้า (ลดได้แม้จ่ายแล้ว — ส่วนเกินยอดค้างตั้งเป็นเงินคืนจากผู้ขาย) */
export function purchaseCreditableOf(state: PaymentState, doc: CalcPurchase): number {
  return purchaseAdjustedTotal(state, doc);
}

/** ส่วนของใบลดหนี้ผู้ขายที่ตั้งเป็นลูกหนี้-เงินคืนจากผู้ขาย (1150) ของเอกสารนี้ */
export function purchaseRefundDueTotal(state: Partial<Pick<AccountingData, 'purchaseCredits'>>, doc: Pick<PurchaseDoc, 'id'>): number {
  return sumBaht(purchaseCreditsOf(state, doc.id).map((c) => c.refundDue ?? 0));
}

/** ยอดที่จ่ายแล้ว (ตัดเจ้าหนี้ รวม VAT) */
export function purchasePaidAmount(state: Pick<AccountingData, 'payments'>, doc: Pick<PurchaseDoc, 'id'>): number {
  return sumBaht(paymentsOf(state, doc.id).map((p) => p.amount));
}

/**
 * ยอดค้างจ่าย = ยอดเอกสาร − ส่วนของใบลดหนี้ผู้ขายที่ลดเจ้าหนี้ − ใบสำคัญจ่ายทั้งหมด
 * (ส่วนของใบลดหนี้ที่ตั้งเป็นเงินคืนจากผู้ขายไม่ลดเจ้าหนี้ซ้ำ จึงไม่ติดลบ)
 */
export function purchaseOutstanding(state: PaymentState, doc: CalcPurchase): number {
  return sumBaht([purchaseAdjustedTotal(state, doc), purchaseRefundDueTotal(state, doc), -purchasePaidAmount(state, doc)]);
}

/**
 * แบ่งใบลดหนี้ผู้ขายจำนวน `creditTotal` (รวม VAT): ส่วนที่ลดเจ้าหนี้ (ไม่เกินยอดค้างจ่าย) และส่วนที่เกิน
 * ตั้งเป็นลูกหนี้-เงินคืนจากผู้ขาย (1150) — D1: ลดหนี้เอกสารที่จ่ายแล้วได้ไม่เกินยอดเอกสาร − ใบลดหนี้ก่อนหน้า
 */
export function supplierCreditSplit(state: PaymentState, doc: CalcPurchase, creditTotal: number): { toPayable: number; refundDue: number; limit: number } {
  const outstanding = Math.max(0, toSatang(purchaseOutstanding(state, doc)));
  const total = toSatang(creditTotal);
  const toPayable = Math.min(total, outstanding);
  return { toPayable: fromSatang(toPayable), refundDue: fromSatang(total - toPayable), limit: purchaseCreditableOf(state, doc) };
}

/**
 * เงินคืนจากผู้ขายคงค้าง = ส่วนเกินจากใบลดหนี้ผู้ขาย − ที่รับคืนแล้ว (ต่อผู้ติดต่อ)
 * `asOf` = นับเฉพาะใบลดหนี้ที่ลงวันที่ไม่เกินวันนั้น (รับคืนได้เฉพาะยอดที่เกิดแล้ว)
 */
export function supplierRefundDueOf(
  state: Partial<Pick<AccountingData, 'purchaseCredits' | 'supplierRefunds'>>,
  contactId: string,
  asOf?: ISODate
): number {
  const due = sumBaht(
    (state.purchaseCredits ?? []).filter((c) => c.contactId === contactId && (!asOf || c.date <= asOf)).map((c) => c.refundDue ?? 0)
  );
  const received = sumBaht((state.supplierRefunds ?? []).filter((r) => r.contactId === contactId).map((r) => r.amount));
  return subBaht(due, received);
}

/**
 * มูลค่าก่อน VAT ที่ใบลดหนี้ผู้ขายลดแต่ละบรรทัดของเอกสารซื้อ (U8 — ฐานหัก ณ ที่จ่ายลดเฉพาะบรรทัดที่ลด ไม่เฉลี่ยทั้งเอกสาร)
 * บรรทัดใบลดหนี้ → บรรทัดเอกสารซื้อ: `purchaseLineId` ถ้ามี, ไม่มีจับคู่บรรทัดบัญชีเดียวกันตามลำดับ (เติมทีละบรรทัดจนเต็มมูลค่า)
 * บัญชีไม่ตรงบรรทัดใดเลย = เฉลี่ยตามมูลค่าคงเหลือของทุกบรรทัด (ข้อมูลเก่า) — `problems` = ลดเกินมูลค่าบรรทัด / อ้างบรรทัดที่ไม่มี
 */
export function purchaseCreditAllocation(
  doc: Pick<PurchaseDoc, 'lines' | 'vatMode' | 'vatRate'>,
  credits: Pick<PurchaseCreditNote, 'lines' | 'vatMode' | 'vatRate' | 'docNo'>[]
): { lineNets: number[]; reduced: number[]; remaining: number[]; problems: string[] } {
  const lineNets = lineNetAmounts(doc).map(toSatang);
  const reduced = lineNets.map(() => 0);
  const problems: string[] = [];
  const room = (i: number) => lineNets[i] - reduced[i];
  const fill = (amount: number, indices: number[]) => {
    let left = amount;
    indices.forEach((i) => {
      const take = Math.min(left, Math.max(0, room(i)));
      reduced[i] += take;
      left -= take;
    });
    return left;
  };
  credits.forEach((c) => {
    const nets = lineNetAmounts(c).map(toSatang);
    c.lines.forEach((line, j) => {
      const amount = nets[j];
      if (!(amount > 0)) return;
      const label = `${c.docNo ? `${c.docNo} ` : ''}รายการที่ ${j + 1}`;
      const ref = (line as PurchaseCreditLine).purchaseLineId;
      if (ref) {
        const index = doc.lines.findIndex((l) => l.id === ref);
        if (index < 0) {
          problems.push(`${label}: ไม่พบบรรทัดของเอกสารซื้อที่อ้างถึง`);
          return;
        }
        if (fill(amount, [index]) > 0) problems.push(`${label}: ลดเกินมูลค่าของบรรทัดที่อ้างถึง`);
        return;
      }
      const same = doc.lines.map((l, i) => (l.accountCode === line.accountCode ? i : -1)).filter((i) => i >= 0);
      if (same.length) {
        const others = doc.lines.map((_, i) => i).filter((i) => !same.includes(i));
        if (fill(fill(amount, same), others) > 0) problems.push(`${label}: ลดเกินมูลค่าคงเหลือของเอกสารซื้อ`);
        return;
      }
      // ไม่มีบรรทัดบัญชีเดียวกัน: เฉลี่ยตามมูลค่าคงเหลือ (บรรทัดสุดท้ายที่ยังเหลือรับเศษ)
      const open = doc.lines.map((_, i) => i).filter((i) => room(i) > 0);
      const pool = open.reduce((a, i) => a + room(i), 0);
      if (amount > pool) {
        problems.push(`${label}: ลดเกินมูลค่าคงเหลือของเอกสารซื้อ`);
        fill(amount, open);
        return;
      }
      let left = amount;
      open.forEach((i, k) => {
        const take = k === open.length - 1 ? left : Math.min(left, Math.round((room(i) * amount) / pool));
        reduced[i] += take;
        left -= take;
      });
    });
  });
  return {
    lineNets: lineNets.map(fromSatang),
    reduced: reduced.map(fromSatang),
    remaining: lineNets.map((n, i) => fromSatang(n - reduced[i])),
    problems,
  };
}

/**
 * หัก ณ ที่จ่ายของทั้งเอกสารหลังใบลดหนี้ผู้ขาย — ฐานแต่ละประเภท = มูลค่าคงเหลือของบรรทัดในกลุ่มนั้น
 * (ลดหนี้บรรทัดสินค้าไม่กระทบฐานค่าบริการ) — ไม่มีใบลดหนี้ = `purchaseWhtGroups` เดิม
 */
export function purchaseAdjustedWhtGroups(state: PaymentState, doc: CalcPurchase): WhtLineItem[] {
  const credits = purchaseCreditsOf(state, doc.id);
  if (!credits.length) return purchaseWhtGroups(doc);
  const { remaining } = purchaseCreditAllocation(doc, credits);
  const groups = new Map<string, { incomeType: string; rate: number; base: number }>();
  doc.lines.forEach((line, index) => {
    if (!(line.whtRate > 0)) return;
    const key = `${line.whtIncomeType}|${line.whtRate}`;
    const g = groups.get(key) ?? { incomeType: line.whtIncomeType, rate: line.whtRate, base: 0 };
    g.base = sumBaht([g.base, remaining[index]]);
    groups.set(key, g);
  });
  return Array.from(groups.values()).map((g) => ({ ...g, tax: percentOf(g.base, g.rate) }));
}

/** วันที่จ่ายครั้งล่าสุด (ไม่มีคืน undefined) */
export function lastPaymentDateOf(state: PaymentState, purchaseId: string): ISODate | undefined {
  return paymentsOf(state, purchaseId).reduce<ISODate | undefined>(
    (latest, p) => (!latest || p.date > latest ? p.date : latest),
    undefined
  );
}

export type PaymentPlan = {
  /** จ่ายครั้งนี้แล้วครบยอดเอกสาร */
  final: boolean;
  whtItems: WhtLineItem[];
  whtAmount: number;
  netPaid: number;
  /** เงินได้ (ฐานก่อน VAT) ที่หัก ณ ที่จ่ายครั้งนี้ */
  whtBase: number;
};

const sameGroup = (a: Pick<WhtLineItem, 'incomeType' | 'rate'>, b: Pick<WhtLineItem, 'incomeType' | 'rate'>) =>
  a.incomeType === b.incomeType && a.rate === b.rate;

/**
 * คำนวณหัก ณ ที่จ่ายของการจ่ายครั้งนี้ตามสัดส่วนยอดที่จ่าย (amount ÷ ยอดเอกสาร)
 * - ฐานแต่ละประเภท = ฐานทั้งเอกสาร × สัดส่วน (half-up) แล้วภาษี = ฐาน × อัตรา
 * - ครั้งที่จ่ายครบ รับส่วนที่เหลือทั้งหมด → ผลรวมทุกครั้งเท่ากับหัก ณ ที่จ่ายของทั้งเอกสารพอดี
 * - ไม่ให้ยอดสะสมเกินของทั้งเอกสาร (กันเศษปัดสะสมจากการจ่ายหลายครั้ง)
 */
export function planPurchasePayment(state: PaymentState, doc: CalcPurchase, amount: number): PaymentPlan {
  // ใบลดหนี้ผู้ขายลดยอดเอกสาร และฐานหัก ณ ที่จ่ายเฉพาะบรรทัดที่ลด (`purchaseAdjustedWhtGroups`)
  const total = purchaseAdjustedTotal(state, doc);
  const outstanding = purchaseOutstanding(state, doc);
  const credited = purchaseCreditsOf(state, doc.id).length > 0;
  const prior = paymentsOf(state, doc.id);
  const final = toSatang(amount) >= toSatang(outstanding);
  const priorItems = prior.flatMap((p) => p.whtItems);
  const nonNegative = (v: number) => (toSatang(v) < 0 ? 0 : v);

  const whtItems = purchaseAdjustedWhtGroups(state, doc)
    .map((g) => {
      const before = priorItems.filter((i) => sameGroup(i, g));
      // หักไปแล้วเกินฐานหลังลดหนี้ (ลดหนี้หลังจ่าย) — ไม่หักเพิ่ม ไม่คืนภาษีที่หักไปแล้ว
      const restBase = nonNegative(subBaht(g.base, sumBaht(before.map((i) => i.base))));
      const restTax = nonNegative(subBaht(g.tax, sumBaht(before.map((i) => i.tax))));
      if (final) return { ...g, base: restBase, tax: restTax };
      // มีใบลดหนี้: ฐานที่เหลือ × ยอดจ่าย ÷ ยอดค้าง (ฐานคงเหลือต่อบรรทัด) — ไม่มี: ฐานทั้งเอกสาร × สัดส่วนเดิม
      const prorated = credited ? prorateBaht(restBase, amount, outstanding) : prorateBaht(g.base, amount, total);
      const base = Math.min(prorated, restBase);
      return { ...g, base, tax: Math.min(percentOf(base, g.rate), restTax) };
    })
    .filter((i) => toSatang(i.base) !== 0 || toSatang(i.tax) !== 0);

  const whtAmount = sumBaht(whtItems.map((i) => i.tax));
  return {
    final,
    whtItems,
    whtAmount,
    netPaid: subBaht(amount, whtAmount),
    whtBase: sumBaht(whtItems.map((i) => i.base)),
  };
}

/**
 * เตือนเมื่อหัก ณ ที่จ่ายจากเงินได้ที่จ่ายครั้งเดียวต่ำกว่า 1,000 บาท (ท.ป.4/2528 ข้อ 12 — ไม่ต้องหัก
 * ยกเว้นจ่ายตามสัญญาที่รวมแล้วถึง 1,000 บาท) — คืนข้อความเตือน หรือ null
 */
export function whtSmallPaymentWarning(plan: Pick<PaymentPlan, 'whtAmount' | 'whtBase'>): string | null {
  if (!(toSatang(plan.whtAmount) > 0) || toSatang(plan.whtBase) >= toSatang(WHT_MIN_PAYMENT)) return null;
  return `เงินได้ที่จ่ายครั้งนี้ ${round2(plan.whtBase).toFixed(2)} บาท ต่ำกว่า ${WHT_MIN_PAYMENT.toLocaleString('th-TH')} บาท — ตามคำสั่ง ท.ป.4/2528 ข้อ 12 ไม่ต้องหักภาษี ณ ที่จ่าย เว้นแต่จ่ายตามสัญญาที่รวมแล้วถึง 1,000 บาท ตรวจก่อนยืนยัน`;
}
