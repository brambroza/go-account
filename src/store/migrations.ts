import type { ISODate, DocLine, Payment, SalesDoc, BankAccount, PurchaseDoc, JournalEntry, AccountingData } from 'src/domain';

import { formatSchemaIssues, AccountingDataSchema } from 'src/schemas/accounting/data-schema';
import {
  subBaht,
  toSatang,
  monthKeyOf,
  calcDocument,
  DATA_VERSION,
  partySnapshot,
  docPeriodCode,
  isCashAccount,
  isBankKindCode,
  companySnapshot,
  DEFAULT_ACCOUNTS,
  withAddressCodes,
  purchaseWhtGroups,
  dateOrderInversions,
  validateAccountingData,
} from 'src/domain';

// ----------------------------------------------------------------------
// ย้ายโครงข้อมูลเก่า (localStorage / ไฟล์ backup) ขึ้นเวอร์ชันปัจจุบัน
//
// v1 → v2
//   - snapshot ผู้ขาย/ผู้ซื้อในเอกสารทุกใบ — เอกสารเก่าไม่มีข้อมูล ณ วันออก จึงใช้ข้อมูลบริษัท/ผู้ติดต่อปัจจุบันแทน
//   - สร้างใบสำคัญจ่าย (payments) ย้อนหลัง: เลข PV ของเดิมถูกใช้แต่ไม่ถูกเก็บ — ไล่ตามลำดับรายการจ่ายในสมุดรายวัน
//     ได้เลขเดิมตรงตัว เพราะ v1 ออกเลข PV ครั้งละ 1 ต่อการจ่าย 1 ครั้งตามลำดับนั้น
//   - เลข 50 ทวิ ออกใหม่เป็น sequence WT ของตัวเอง (เดิมใช้เลข PV แทน จึงไม่ต่อเนื่อง) — v1 ยังไม่มีการพิมพ์ 50 ทวิ
//   - เพิ่มบัญชีใหม่ในผังบัญชี (2120 เงินรอคืนลูกค้า) และ refunds = []
//
// v2 → v3
//   - การตรวจข้อมูลเพิ่ม "เลขที่ต้องเรียงตามวันที่" (IV/BL/CN/CM/RE/PV/WT/RF) — v1 ไม่ได้บังคับกฎนี้ เอกสารเดิม
//     จึงอาจเลขเรียงไม่ตรงวันที่ (ออกไปแล้ว แก้เลขไม่ได้) → ตั้ง `legacyOrderThrough` = วันที่ล่าสุดของคู่ที่เรียงผิด
//     เพื่อยกเว้นเฉพาะเอกสารเดิม เอกสารใหม่ยังถูกตรวจ (action ของ v2 บังคับลำดับแล้ว คู่ที่ผิดจึงมาจาก v1)
//   - ไม่มีการเปลี่ยนโครงอื่น
//
// v3 → v4 (Sprint B batch 2 — ภาษี)
//   - เอกสารซื้อ: หัก ณ ที่จ่ายย้ายจากระดับเอกสาร (whtRate/whtIncomeType) ไปทุกบรรทัด — ผลรวมเท่าเดิมพอดี
//     (ทุกบรรทัดอยู่ในกลุ่มเดียว ฐาน = มูลค่าก่อน VAT ทั้งเอกสาร)
//   - supplierInvoiceDate = วันที่เอกสารเดิม (เดิมบันทึกตามวันที่ในใบกำกับ), vatClaimPeriod = เดือนของวันที่นั้น
//     เมื่อขอคืนภาษีซื้อ → รายงานภาษีซื้อของเดือนเดิมไม่เปลี่ยน
//   - ข้อมูลการจ่ายในเอกสารซื้อ (paidDate/paymentId/whtCertNo …) ย้ายไปอยู่ที่ใบสำคัญจ่ายเท่านั้น (เดิมจ่ายครั้งเดียว)
//     ใบสำคัญจ่ายได้ whtItems 1 รายการจากประเภทเงินได้เดิม
//   - ใบลดหนี้ได้ originalNet/correctNet (มูลค่าตามใบกำกับ ณ วันออก ไล่ตามลำดับวันที่/เลขที่)
//   - vatCloses = [] (ปิดภาษีเดือนเริ่มที่การปิดงวดครั้งถัดไป — รวมเดือนที่ปิดงวดไว้แล้วแต่ยังไม่ปิดภาษี)
//   - ผังบัญชีเพิ่ม 1180 ภาษีชำระเกินยกไป, PI เริ่มบังคับเลขเรียงตามวันที่ (คู่ที่เรียงผิดของเดิมได้ legacyOrderThrough)
//
// v4 → v5 (Sprint B batch 3 — งานบริการ / ปิดปี / ยอดยกมา / ใบลดหนี้ผู้ขาย)
//   - ผังบัญชีเพิ่ม 2151 ภาษีขายยังไม่ถึงกำหนด (งานบริการ ม.78/1)
//   - purchaseCredits = [], yearCloses = [] (ยังไม่มีใบลดหนี้ผู้ขาย/การปิดปี) ไม่มี openingBalance
//   - เอกสารเดิมทั้งหมดเป็น "ขายสินค้า" (ไม่มี saleType) ใบเสร็จเดิมเป็นใบเสร็จธรรมดา (RE) — ตัวเลขทุกรายงานเท่าเดิม
//
// v5 → v6 (Sprint B batch 4 — ธนาคาร / เงินสดย่อย / ใบเสนอราคา)
//   - ผังบัญชีเพิ่ม 1111 เงินสดย่อย (ถ้ายังไม่มี)
//   - bankAccounts: ลงทะเบียนบัญชีเงินที่มีอยู่ตามช่วงรหัส — 112x = ธนาคาร (ชื่อธนาคาร/เลขที่บัญชีว่าง ให้ผู้ใช้กรอก),
//     1111–1119 = เงินสดย่อย; 1110 เงินสด ไม่ลงทะเบียน
//   - transfers / bankStatements / bankMatches / quotations = [] — ไม่มีรายการบัญชีใหม่ ตัวเลขทุกรายงานเท่าเดิม
//
// v6 → v7 (Sprint B.1)
//   - ผังบัญชีเพิ่ม 1150 ลูกหนี้-เงินคืนจากผู้ขาย (ใบลดหนี้ผู้ขายหลังจ่ายเงินแล้ว), supplierRefunds = []
//   - ใบลดหนี้ผู้ขายเดิมไม่มี refundDue (= ลดเจ้าหนี้ทั้งหมด ตามกติกาเดิมที่ลดได้ไม่เกินยอดค้าง)
//   - U10: ใบสำคัญจ่ายจาก v1 ที่หัก ณ ที่จ่ายปัดเป็น 0 (เงินได้ต่ำมาก เช่น 0.10 บาท × 3%) เดิมไม่มี whtItems
//     ทำให้ตรวจไม่ผ่าน (แอปเป็นอ่านอย่างเดียว) — เติม whtItems ตามกลุ่มของเอกสาร ภาษี 0.00
//     กติกา: แถว ภ.ง.ด. ของการจ่ายนั้นแสดงเงินได้และภาษี 0.00 ตามที่ v1 รายงานไว้ (ไม่ตัดทิ้ง เพื่อให้ยอดเงินได้ตรงกับที่ยื่น)
//     — การจ่ายใหม่ก็ได้แถวภาษี 0.00 แบบเดียวกัน (planPurchasePayment เก็บบรรทัดที่ฐาน > 0)
//   - การหักลดหนี้ฐานหัก ณ ที่จ่ายเปลี่ยนเป็นรายบรรทัด (U8) — ใบลดหนี้เดิมที่ไม่มี purchaseLineId จับคู่ตามบัญชี
//
// v7 → v8 (ETDA/RD ต.ค. 2569 — docs/research-etda-rd-2026-10.md)
//   - ที่อยู่บริษัทและผู้ติดต่อได้รหัส TIS 1099 (provinceCode / districtCode / subDistrictCode) จากการจับคู่ชื่อแบบ best-effort
//     (`withAddressCodes`) — จับคู่ไม่ได้ = ไม่มีรหัส แล้ว `eTaxReadiness` เตือนให้เลือกจากรายการใหม่ก่อนออก e-Tax
//   - snapshot ในเอกสารที่ออกแล้วไม่แก้ (เอกสารที่ออกแล้วแก้ไม่ได้) — XML จับคู่ชื่อตอนสร้างด้วยตรรกะเดียวกัน
//   - ใบลด/เพิ่มหนี้เดิมไม่มี reasonCode (= เหตุอื่น …99 ตามเดิม), บริษัทไม่มี sbtRegistered (= ไม่ได้จด SBT) — ตัวเลขทุกรายงานเท่าเดิม
// ----------------------------------------------------------------------

/** เอกสารซื้อโครง v3 (หัก ณ ที่จ่ายระดับเอกสาร + ข้อมูลการจ่ายครั้งเดียว) */
type PurchaseV3 = Omit<PurchaseDoc, 'lines' | 'supplierInvoiceDate' | 'vatClaimPeriod'> & {
  lines: DocLine[];
  whtRate: number;
  whtIncomeType: string;
  paidDate?: ISODate;
  paymentAccountCode?: string;
  paymentId?: string;
  paymentDocNo?: string;
  whtCertNo?: string;
  paymentJournalId?: string;
};

type PaymentV3 = Omit<Payment, 'whtItems'>;

/** โครง v7 = ปัจจุบัน (ฟิลด์ใหม่ของ v8 เป็น optional ทั้งหมด: รหัสที่อยู่, reasonCode, sbtRegistered) */
export type DataV7 = Omit<AccountingData, 'version'> & { version: 7 };

/** โครง v6 = v7 ที่ยังไม่มีการรับเงินคืนจากผู้ขาย */
export type DataV6 = Omit<DataV7, 'version' | 'supplierRefunds'> & { version: 6 };

/** โครง v5 = v6 ที่ยังไม่มีทะเบียนธนาคาร / โอนเงิน / กระทบยอด / ใบเสนอราคา */
export type DataV5 = Omit<DataV6, 'version' | 'bankAccounts' | 'transfers' | 'bankStatements' | 'bankMatches' | 'quotations'> & {
  version: 5;
};

/** โครง v4 = v5 ที่ยังไม่มีใบลดหนี้ผู้ขาย / ปิดปี / ยอดยกมา */
export type DataV4 = Omit<DataV5, 'version' | 'purchaseCredits' | 'yearCloses' | 'openingBalance'> & { version: 4 };

export type DataV3 = Omit<DataV4, 'version' | 'purchases' | 'payments' | 'vatCloses'> & {
  version: 3;
  purchases: PurchaseV3[];
  payments: PaymentV3[];
};

type DataV1 = Omit<DataV3, 'version' | 'payments' | 'refunds'> & { version: 1 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeV1(value: Record<string, unknown>): value is DataV1 {
  return (
    value.version === 1 &&
    isRecord(value.company) &&
    isRecord(value.sequences) &&
    ['accounts', 'contacts', 'sales', 'receipts', 'purchases', 'journal'].every((k) => Array.isArray(value[k]))
  );
}

/** สร้างใบสำคัญจ่ายย้อนหลังจากรายการจ่ายในสมุดรายวัน (ตามลำดับที่บันทึก) */
function rebuildPayments(data: DataV1) {
  const purchaseByJournal = new Map(data.purchases.filter((p) => p.paymentJournalId).map((p) => [p.paymentJournalId, p]));
  const counters: Record<string, number> = {};
  const next = (key: string) => {
    counters[key] = (counters[key] ?? 0) + 1;
    return `${key}-${String(counters[key]).padStart(4, '0')}`;
  };
  const payments: PaymentV3[] = [];
  const purchaseUpdates = new Map<string, Partial<PurchaseV3>>();
  const journalUpdates = new Map<string, Partial<JournalEntry>>();
  const contacts = new Map(data.contacts.map((c) => [c.id, c]));

  data.journal
    .filter((e) => e.source === 'payment')
    .forEach((entry) => {
      const purchase = purchaseByJournal.get(entry.id);
      if (!purchase) return;
      const period = docPeriodCode(entry.date);
      const t = calcDocument(purchase);
      const docNo = next(`PV${period}`);
      const whtCertNo = toSatang(t.wht) > 0 ? next(`WT${period}`) : undefined;
      const id = `pv-${entry.id}`;
      const contact = contacts.get(purchase.contactId);
      payments.push({
        id,
        docNo,
        date: entry.date,
        purchaseId: purchase.id,
        contactId: purchase.contactId,
        amount: t.total,
        whtAmount: t.wht,
        netPaid: subBaht(t.total, t.wht),
        accountCode: purchase.paymentAccountCode ?? '',
        whtCertNo,
        payer: companySnapshot(data.company),
        payee: contact ? partySnapshot(contact) : undefined,
        journalId: entry.id,
      });
      purchaseUpdates.set(purchase.id, { paymentId: id, paymentDocNo: docNo, whtCertNo });
      journalUpdates.set(entry.id, { sourceId: id, sourceDocNo: docNo });
    });

  const sequences = { ...data.sequences };
  Object.entries(counters)
    .filter(([key]) => key.startsWith('WT'))
    .forEach(([key, value]) => {
      sequences[key] = value;
    });
  return { payments, purchaseUpdates, journalUpdates, sequences };
}

/** v1 → v2 (pure) — ได้โครง v3 (v2 ต่างจาก v3 แค่ legacyOrderThrough) */
export function migrateV1(data: DataV1): DataV3 {
  const contacts = new Map(data.contacts.map((c) => [c.id, c]));
  const party = (contactId: string) => {
    const c = contacts.get(contactId);
    return c ? partySnapshot(c) : undefined;
  };
  const seller = companySnapshot(data.company);
  const { payments, purchaseUpdates, journalUpdates, sequences } = rebuildPayments(data);
  const knownAccounts = new Set(data.accounts.map((a) => a.code));

  return {
    ...data,
    version: 3,
    accounts: [...data.accounts, ...DEFAULT_ACCOUNTS.filter((a) => !knownAccounts.has(a.code))],
    sales: data.sales.map((s) => ({
      ...s,
      isTaxInvoice: s.isTaxInvoice ?? s.vatMode !== 'none',
      creditToCustomer: s.kind === 'credit-note' ? (s.creditToCustomer ?? 0) : undefined,
      seller: s.seller ?? seller,
      buyer: s.buyer ?? party(s.contactId),
    })),
    receipts: data.receipts.map((r) => ({ ...r, seller: r.seller ?? seller, buyer: r.buyer ?? party(r.contactId) })),
    purchases: data.purchases.map((p) => ({
      ...p,
      supplier: p.supplier ?? party(p.contactId),
      ...(purchaseUpdates.get(p.id) ?? {}),
    })),
    payments,
    refunds: [],
    journal: data.journal.map((e) => ({ ...e, ...(journalUpdates.get(e.id) ?? {}) })),
    sequences,
  };
}

/** มูลค่าตามใบกำกับ ณ วันออกใบลดหนี้แต่ละใบ (ไล่ตามวันที่/เลขที่ของใบลดหนี้ที่อ้างใบกำกับเดียวกัน) */
function backfillCreditNoteValues(sales: SalesDoc[]): SalesDoc[] {
  const byId = new Map(sales.map((s) => [s.id, s]));
  const credited = new Map<string, number>();
  const updates = new Map<string, Pick<SalesDoc, 'originalNet' | 'correctNet'>>();
  sales
    .filter((s) => s.kind === 'credit-note' && s.originalNet === undefined)
    .sort((a, b) => (a.date + a.docNo).localeCompare(b.date + b.docNo))
    .forEach((cn) => {
      const invoice = cn.refDocId ? byId.get(cn.refDocId) : undefined;
      if (!invoice) return;
      const before = credited.get(invoice.id) ?? 0;
      const originalNet = subBaht(calcDocument(invoice).net, before);
      const diff = calcDocument(cn).net;
      credited.set(invoice.id, before + diff);
      updates.set(cn.id, { originalNet, correctNet: subBaht(originalNet, diff) });
    });
  return sales.map((s) => ({ ...s, ...(updates.get(s.id) ?? {}) }));
}

/** v3 → v4 (pure): หัก ณ ที่จ่ายระดับบรรทัด, วันที่ใบกำกับ/เดือนใช้สิทธิ, whtItems ในใบสำคัญจ่าย, vatCloses */
export function migrateV3(data: DataV3): DataV4 {
  const knownAccounts = new Set(data.accounts.map((a) => a.code));
  const purchaseById = new Map(data.purchases.map((p) => [p.id, p]));
  const purchases: PurchaseDoc[] = data.purchases.map((p) => {
    const hasRate = p.whtRate > 0;
    // คัดเฉพาะฟิลด์ของโครง v4 (ฟิลด์การจ่ายครั้งเดียว/หัก ณ ที่จ่ายระดับเอกสารของ v3 ไม่ยกมา)
    return {
      id: p.id,
      docNo: p.docNo,
      supplierInvoiceNo: p.supplierInvoiceNo,
      supplierInvoiceDate: p.date,
      date: p.date,
      contactId: p.contactId,
      lines: p.lines.map((l) => ({ ...l, whtRate: hasRate ? p.whtRate : 0, whtIncomeType: hasRate ? p.whtIncomeType : '' })),
      vatMode: p.vatMode,
      vatRate: p.vatRate,
      claimVat: p.claimVat,
      vatClaimPeriod: p.claimVat ? monthKeyOf(p.date) : undefined,
      whtCondition: p.whtCondition,
      paid: p.paid,
      note: p.note,
      supplier: p.supplier,
      journalId: p.journalId,
      createdAt: p.createdAt,
    };
  });
  const payments: Payment[] = data.payments.map((pv) => {
    const p = purchaseById.get(pv.purchaseId);
    // U10: v1 ที่หัก ณ ที่จ่ายปัดเป็น 0 ก็ได้รายการ (ภาษี 0.00) — ตรงกับรายงาน ภ.ง.ด. ของ v1 และกลุ่มหัก ณ ที่จ่ายของเอกสาร
    const withheld = !!p && p.whtRate > 0 && toSatang(pv.whtAmount) >= 0 && toSatang(calcDocument(p).net) > 0;
    return {
      ...pv,
      whtItems: withheld && p ? [{ incomeType: p.whtIncomeType, rate: p.whtRate, base: calcDocument(p).net, tax: pv.whtAmount }] : [],
    };
  });
  return {
    ...data,
    version: 4,
    accounts: [...data.accounts, ...DEFAULT_ACCOUNTS.filter((a) => !knownAccounts.has(a.code))],
    sales: backfillCreditNoteValues(data.sales),
    purchases,
    payments,
    vatCloses: [],
  };
}

/** v4 → v5 (pure): บัญชี 2151, purchaseCredits / yearCloses ว่าง */
export function migrateV4(data: DataV4): DataV5 {
  const knownAccounts = new Set(data.accounts.map((a) => a.code));
  return {
    ...data,
    version: 5,
    accounts: [...data.accounts, ...DEFAULT_ACCOUNTS.filter((a) => !knownAccounts.has(a.code))],
    purchaseCredits: [],
    yearCloses: [],
  };
}

/** v5 → v6 (pure): บัญชี 1111 เงินสดย่อย, ทะเบียนบัญชีเงินจากผังบัญชีเดิม, รายการธนาคาร/ใบเสนอราคาว่าง */
export function migrateV5(data: DataV5): DataV6 {
  const knownAccounts = new Set(data.accounts.map((a) => a.code));
  const accounts = [...data.accounts, ...DEFAULT_ACCOUNTS.filter((a) => !knownAccounts.has(a.code))];
  const bankAccounts: BankAccount[] = accounts
    .filter((a) => isCashAccount(a) && (isBankKindCode(a.code, 'bank') || isBankKindCode(a.code, 'petty-cash')))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) =>
      isBankKindCode(a.code, 'bank')
        ? { accountCode: a.code, kind: 'bank' as const, bankName: '', accountNo: '' }
        : { accountCode: a.code, kind: 'petty-cash' as const, bankName: a.name, accountNo: '' }
    );
  return {
    ...data,
    version: 6,
    accounts,
    bankAccounts,
    transfers: [],
    bankStatements: [],
    bankMatches: [],
    quotations: [],
  };
}

/**
 * v6 → v7 (pure): บัญชี 1150, supplierRefunds ว่าง, เติม whtItems ภาษี 0.00 ให้ใบสำคัญจ่าย v1 ที่หัก ณ ที่จ่ายปัดเป็น 0 (U10)
 * — เฉพาะเอกสารจ่ายครั้งเดียวเต็มจำนวนที่ไม่มีใบลดหนี้ และกลุ่มหัก ณ ที่จ่ายของเอกสารทุกกลุ่มภาษีเป็น 0
 */
export function migrateV6(data: DataV6): DataV7 {
  const knownAccounts = new Set(data.accounts.map((a) => a.code));
  const purchases = new Map(data.purchases.map((p) => [p.id, p]));
  const credited = new Set(data.purchaseCredits.map((c) => c.purchaseId));
  const count = new Map<string, number>();
  data.payments.forEach((pv) => count.set(pv.purchaseId, (count.get(pv.purchaseId) ?? 0) + 1));
  const payments = data.payments.map((pv) => {
    const p = purchases.get(pv.purchaseId);
    if (!p || pv.whtItems.length || toSatang(pv.whtAmount) !== 0 || count.get(p.id) !== 1 || credited.has(p.id)) return pv;
    const groups = purchaseWhtGroups(p);
    if (!groups.length || groups.some((g) => toSatang(g.tax) !== 0)) return pv;
    if (toSatang(pv.amount) !== toSatang(calcDocument(p).total)) return pv;
    return { ...pv, whtItems: groups };
  });
  return {
    ...data,
    version: 7,
    accounts: [...data.accounts, ...DEFAULT_ACCOUNTS.filter((a) => !knownAccounts.has(a.code))],
    payments,
    supplierRefunds: [],
  };
}

/**
 * v7 → v8 (pure): เติมรหัสจังหวัด/อำเภอ/ตำบลให้ที่อยู่บริษัทและผู้ติดต่อจากชื่อ (รหัสเดิมที่ไม่มีอยู่จริงถูกทิ้งแล้วจับคู่ใหม่)
 * — snapshot ในเอกสารไม่แก้
 */
export function migrateV7(data: DataV7): AccountingData {
  return {
    ...data,
    version: DATA_VERSION,
    company: { ...data.company, address: withAddressCodes(data.company.address ?? {}) },
    contacts: data.contacts.map((c) => ({ ...c, address: withAddressCodes(c.address ?? {}) })),
  };
}

/**
 * หลัง migrate: ยกเว้นการตรวจลำดับเลขที่ของเอกสารเดิมที่ออกก่อนบังคับกฎ (v2 → v3: IV/RE/…, v3 → v4: PI)
 * `legacyOrderThrough` = วันที่ล่าสุดของคู่ที่เรียงผิด
 */
export function exemptLegacyOrder(data: AccountingData): AccountingData {
  const inversions = dateOrderInversions(data);
  if (!inversions.length) return { ...data, version: DATA_VERSION };
  const through = inversions
    .map((x) => x.earlier.date)
    .reduce((latest, d) => (d > latest ? d : latest), data.legacyOrderThrough ?? '');
  return { ...data, version: DATA_VERSION, legacyOrderThrough: through };
}

function looksLikeV3(value: Record<string, unknown>): value is DataV3 {
  return (
    isRecord(value.company) &&
    isRecord(value.sequences) &&
    ['accounts', 'contacts', 'sales', 'receipts', 'purchases', 'payments', 'refunds', 'journal'].every((k) =>
      Array.isArray(value[k])
    )
  );
}

function looksLikeV4(value: Record<string, unknown>): value is DataV4 {
  return value.version === 4 && Array.isArray(value.vatCloses) && looksLikeV3(value);
}

function looksLikeV6(value: Record<string, unknown>): value is DataV6 {
  return (
    value.version === 6 &&
    ['vatCloses', 'purchaseCredits', 'yearCloses', 'bankAccounts', 'transfers', 'bankStatements', 'bankMatches', 'quotations'].every((k) =>
      Array.isArray(value[k])
    ) &&
    looksLikeV3(value)
  );
}

function looksLikeV7(value: Record<string, unknown>): value is DataV7 {
  return value.version === 7 && Array.isArray(value.supplierRefunds) && looksLikeV6({ ...value, version: 6 });
}

function looksLikeV5(value: Record<string, unknown>): value is DataV5 {
  return (
    value.version === 5 &&
    Array.isArray(value.vatCloses) &&
    Array.isArray(value.purchaseCredits) &&
    Array.isArray(value.yearCloses) &&
    looksLikeV3(value)
  );
}

export type LoadResult = {
  /** null = อ่านไม่ได้/รูปแบบผิด ห้ามนำไปใช้ */
  data: AccountingData | null;
  /** ปัญหาที่พบ — ถ้ามี data ด้วย แปลว่าโครงถูกแต่ผิดกติกาบัญชี (ให้ผู้ใช้ตัดสินใจ) */
  problems: string[];
  /** เวอร์ชันเดิมก่อน migrate (ถ้ามีการ migrate) */
  migratedFrom?: number;
};

/**
 * อ่านข้อมูลทั้งก้อนจาก backup/localStorage: migrate → ตรวจโครงด้วย zod → ตรวจ invariant
 * ใช้ก่อน `replace` ทุกครั้ง หน้าจอแสดง `problems` ให้ผู้ใช้ยืนยันก่อนกู้คืน
 */
export function readAccountingData(raw: unknown): LoadResult {
  if (!isRecord(raw)) return { data: null, problems: ['ไฟล์ไม่ใช่ข้อมูล GO Account'] };

  let candidate: unknown = raw;
  let migratedFrom: number | undefined;
  if (raw.version === 1) {
    if (!looksLikeV1(raw)) return { data: null, problems: ['ข้อมูลเวอร์ชัน 1 ไม่ครบ (ขาดรายการบางส่วน)'] };
    try {
      candidate = migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(migrateV1(raw))))));
      migratedFrom = 1;
    } catch (error) {
      return { data: null, problems: [`ย้ายข้อมูลเวอร์ชัน 1 ไม่สำเร็จ: ${error instanceof Error ? error.message : ''}`] };
    }
  } else if (raw.version === 2 || raw.version === 3) {
    // โครง v2 = v3 ที่ยังไม่มี legacyOrderThrough
    const from = raw.version;
    if (!looksLikeV3(raw)) return { data: null, problems: [`ข้อมูลเวอร์ชัน ${from} ไม่ครบ (ขาดรายการบางส่วน)`] };
    try {
      candidate = migrateV7(migrateV6(migrateV5(migrateV4(migrateV3({ ...raw, version: 3 })))));
      migratedFrom = from;
    } catch (error) {
      return { data: null, problems: [`ย้ายข้อมูลเวอร์ชัน ${from} ไม่สำเร็จ: ${error instanceof Error ? error.message : ''}`] };
    }
  } else if (raw.version === 4) {
    if (!looksLikeV4(raw)) return { data: null, problems: ['ข้อมูลเวอร์ชัน 4 ไม่ครบ (ขาดรายการบางส่วน)'] };
    try {
      candidate = migrateV7(migrateV6(migrateV5(migrateV4(raw))));
      migratedFrom = 4;
    } catch (error) {
      return { data: null, problems: [`ย้ายข้อมูลเวอร์ชัน 4 ไม่สำเร็จ: ${error instanceof Error ? error.message : ''}`] };
    }
  } else if (raw.version === 5) {
    if (!looksLikeV5(raw)) return { data: null, problems: ['ข้อมูลเวอร์ชัน 5 ไม่ครบ (ขาดรายการบางส่วน)'] };
    candidate = migrateV7(migrateV6(migrateV5(raw)));
    migratedFrom = 5;
  } else if (raw.version === 6) {
    if (!looksLikeV6(raw)) return { data: null, problems: ['ข้อมูลเวอร์ชัน 6 ไม่ครบ (ขาดรายการบางส่วน)'] };
    candidate = migrateV7(migrateV6(raw));
    migratedFrom = 6;
  } else if (raw.version === 7) {
    if (!looksLikeV7(raw)) return { data: null, problems: ['ข้อมูลเวอร์ชัน 7 ไม่ครบ (ขาดรายการบางส่วน)'] };
    candidate = migrateV7(raw);
    migratedFrom = 7;
  } else if (raw.version !== DATA_VERSION) {
    return { data: null, problems: [`ไม่รองรับข้อมูลเวอร์ชัน ${String(raw.version)}`] };
  }

  const parsed = AccountingDataSchema.safeParse(candidate);
  if (!parsed.success) return { data: null, problems: formatSchemaIssues(parsed.error), migratedFrom };
  const data = migratedFrom === undefined ? parsed.data : exemptLegacyOrder(parsed.data);
  return { data, problems: validateAccountingData(data), migratedFrom };
}

/** อ่านจากข้อความ JSON (ไฟล์ backup) */
export function readAccountingJson(text: string): LoadResult {
  try {
    return readAccountingData(JSON.parse(text));
  } catch {
    return { data: null, problems: ['อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .json ที่ส่งออกจาก GO Account'] };
  }
}
