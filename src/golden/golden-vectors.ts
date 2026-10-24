import type { CalcInput } from 'src/domain/document-calc';
import type { VatMode, Payment, WhtLineItem, PurchaseLine, PurchaseCreditNote } from 'src/domain/types';

import { bahtText } from 'src/domain/baht-text';
import { lineAmount, calcDocument, lineNetAmounts } from 'src/domain/document-calc';
import { receiptWhtAmount, RECEIPT_WHT_MAX_RATE, PURCHASE_WHT_MAX_RATE } from 'src/domain/wht';
import {
  nextDocNo,
  DOC_PREFIX,
  parseDocNo,
  DATE_ORDERED_PREFIXES,
  openingNumberConflict,
} from 'src/domain/numbering';
import {
  toBranch6,
  formatTaxId,
  branchLabel,
  normalizeTaxId,
  normalizeBranch5,
  isValidThaiTaxId,
} from 'src/domain/thai-tax-id';
import {
  round2,
  sumBaht,
  subBaht,
  mulBaht,
  toSatang,
  percentOf,
  fromSatang,
  prorateBaht,
  formatPlain,
} from 'src/domain/money';
import {
  purchaseTotals,
  purchaseWhtGroups,
  planPurchasePayment,
  purchaseOutstanding,
  purchaseAdjustedTotal,
  purchaseCreditAllocation,
  purchaseAdjustedWhtGroups,
} from 'src/domain/purchase';
import {
  toBE,
  addDays,
  inPeriod,
  diffDays,
  periodOf,
  toRdDate,
  periodKey,
  isMonthKey,
  endOfMonth,
  monthKeyOf,
  shiftPeriod,
  periodLabel,
  docPeriodCode,
  periodFromKey,
  shiftMonthKey,
  filingDueDates,
  formatThaiDate,
  isValidISODate,
  periodShortLabel,
  endOfPreviousMonth,
  formatThaiDateShort,
} from 'src/domain/thai-date';

// ----------------------------------------------------------------------
// Golden vectors: รันตรรกะ TS บนชุด input ที่กำหนดตายตัว แล้วเขียนผลลง `golden/*.json`
// ฝั่ง C# (go-account-api) อ่านไฟล์เดียวกันและต้องได้ผลตรงทุกตัว — ดู docs/adr-0001-backend.md
// ชื่อ vector = `<ฟังก์ชัน>/<กรณี>` (ส่วนหน้า `/` ใช้ dispatch ฝั่ง C#)
// ----------------------------------------------------------------------

export type GoldenVector = { name: string; input: unknown; output: unknown };

/** ชื่อไฟล์ → รายการ vector */
export type GoldenSet = Record<string, GoldenVector[]>;

/** PRNG แบบกำหนด seed (Park–Miller minimal standard, เลขจำนวนเต็มล้วนใน double) — ให้ชุด random เหมือนเดิมทุกครั้ง */
function createRandom(seed: number) {
  const MOD = 2147483647;
  let state = seed % MOD || 1;
  return () => {
    state = (state * 48271) % MOD;
    return (state - 1) / (MOD - 1);
  };
}

function collector() {
  const list: GoldenVector[] = [];
  const add = (name: string, input: unknown, output: unknown) => {
    if (list.some((v) => v.name === name)) throw new Error(`duplicate golden vector name: ${name}`);
    list.push({ name, input, output });
  };
  return { list, add };
}

/** check digit ของเลขผู้เสียภาษี 12 หลักแรก — ใช้สร้างเลขที่ถูกต้องสำหรับ vector */
function withCheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (13 - i);
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

// ---------------- money ----------------

function moneyVectors(): GoldenVector[] {
  const { list, add } = collector();
  const bahtInputs = [
    0, 1, -1, 0.01, -0.01, 0.005, -0.005, 0.004, 0.0049, 0.015, 0.025, 0.035, 0.045, 1.005, -1.005, 2.675,
    -2.675, 1.115, 8.345, 10.555, 33.335, 0.1 + 0.2, 1234.5, 1234567.895, -1234567.895, 99999999.995,
    123456789012.34, 0.125, 0.135, 4.355, 1.0049, 1.0051,
  ];
  bahtInputs.forEach((baht) => {
    add(`toSatang/${baht}`, { baht }, toSatang(baht));
    add(`round2/${baht}`, { baht }, round2(baht));
    add(`formatPlain/${baht}`, { baht }, formatPlain(baht));
  });
  [0, 1, -1, 101, 12345, -12345, 9999999999].forEach((satang) =>
    add(`fromSatang/${satang}`, { satang }, fromSatang(satang))
  );

  const sums: [string, number[]][] = [
    ['empty', []],
    ['0.1+0.2', [0.1, 0.2]],
    ['invoice-lines', [10640, 6895, 16800, 13055, 17570]],
    ['each-rounded-first', [1.005, 1.005, 1.005]],
    ['mixed-sign', [-0.01, 0.01, 100.555, -50.005]],
    ['many-small', Array.from({ length: 100 }, () => 0.07)],
    ['large', [99999999.99, 99999999.99, 0.02]],
  ];
  sums.forEach(([name, values]) => add(`sumBaht/${name}`, { values }, sumBaht(values)));

  const subs: [number, number][] = [
    [0.3, 0.1],
    [100, 33.33],
    [0, 0.005],
    [1.005, 2.675],
    [-5.555, 5.555],
    [1000000.01, 0.02],
  ];
  subs.forEach(([a, b]) => add(`subBaht/${a}-${b}`, { a, b }, subBaht(a, b)));

  const prorates: [number, number, number][] = [
    [100, 1, 3],
    [100, 2, 3],
    [0.01, 1, 2],
    [0.03, 1, 2],
    [0.05, 1, 2],
    [-0.05, 1, 2],
    [-100, 1, 3],
    [100, -1, 3],
    [100, 1, -3],
    [-100, -2, 3],
    [1000, 0, 10],
    [1000, 5, 0],
    [9345.79, 3000, 10000],
    [9999999.99, 1234567.89, 9999999.99],
    [123456789.01, 98765432.1, 222222222.22],
    [70000, 35000.5, 107000],
    [1, 1, 3],
    [2, 1, 3],
  ];
  prorates.forEach(([amount, part, whole]) =>
    add(`prorateBaht/${amount}*${part}/${whole}`, { amount, part, whole }, prorateBaht(amount, part, whole))
  );

  const muls: [number, number][] = [
    [3, 0.335],
    [1.5, 33.33],
    [0.333, 3],
    [2, -1.005],
    [1.25, 0.1],
    [7, 0.145],
    [0.5, 0.01],
    [0.5, 0.03],
    [12, 1234.56],
    [2.25, 199.99],
    [1000, 99.995],
    [0, 123],
    [-3, 0.335],
    // ผลคูณตกครึ่งสตางค์พอดีที่ยอดสูง — float เคยปัดลงผิด 1 สตางค์
    [0.3, 12345678.95],
    [0.7, 12345678.95],
    [2.5, 0.001],
    [1e-7, 50000000],
  ];
  muls.forEach(([a, b]) => add(`mulBaht/${a}*${b}`, { a, b }, mulBaht(a, b)));

  const percents: [number, number][] = [
    [100000, 7],
    [98500, 3],
    [33.33, 7],
    [0.07, 7],
    [0.5, 7],
    [-0.5, 7],
    [0.71, 7],
    [-33.33, 7],
    [1234.56, 1.5],
    [1234.56, 0.75],
    [999.99, 3],
    [0.01, 50],
    [0.03, 50],
    [-0.03, 50],
    [1000, 0],
    [12345678.91, 7],
    [100, 100],
    [100, 15],
  ];
  percents.forEach(([baht, rate]) => add(`percentOf/${baht}@${rate}`, { baht, rate }, percentOf(baht, rate)));
  return list;
}

// ---------------- thai tax id ----------------

function taxIdVectors(): GoldenVector[] {
  const { list, add } = collector();
  const valid = [withCheckDigit('010556501234'), withCheckDigit('310100123456'), withCheckDigit('099999999999')];
  const wrongCheck = `${valid[0].slice(0, 12)}${(Number(valid[0][12]) + 1) % 10}`;
  const values: (string | null)[] = [
    ...valid,
    wrongCheck,
    `${valid[0][0]}-${valid[0].slice(1, 5)}-${valid[0].slice(5, 10)}-${valid[0].slice(10, 12)}-${valid[0][12]}`,
    ` ${valid[1].slice(0, 6)} ${valid[1].slice(6)} `,
    `${valid[2]}\t`,
    '',
    null,
    '123456789012',
    '12345678901234',
    '01055650123AB',
    '๐๑๐๕๕๖๕๐๑๒๓๔๕',
    '0000000000000',
    '1111111111119',
  ];
  values.forEach((value, i) => {
    const label = `${i}:${JSON.stringify(value)}`;
    add(`isValidThaiTaxId/${label}`, { value }, isValidThaiTaxId(value));
    add(`normalizeTaxId/${label}`, { value }, normalizeTaxId(value));
    add(`formatTaxId/${label}`, { value }, formatTaxId(value));
  });
  const branches: (string | null)[] = ['', null, '0', '1', '00001', '12', '123456', 'สาขา 2', '00-002', '๐๐๐๐๑', '  7 '];
  branches.forEach((value, i) => {
    const label = `${i}:${JSON.stringify(value)}`;
    add(`normalizeBranch5/${label}`, { value }, normalizeBranch5(value));
    add(`toBranch6/${label}`, { value }, toBranch6(value));
    add(`branchLabel/${label}`, { value }, branchLabel(value));
  });
  return list;
}

// ---------------- document calc ----------------

type CalcLine = CalcInput['lines'][number];

const line = (qty: number, unitPrice: number, discount = 0, accountCode = '4100'): CalcLine => ({
  qty,
  unitPrice,
  discount,
  accountCode,
});

function randomDoc(rand: () => number): CalcInput {
  const pick = <T>(values: T[]): T => values[Math.floor(rand() * values.length)];
  const count = 1 + Math.floor(rand() * 5);
  const lines = Array.from({ length: count }, () => {
    const qty = pick([1, 1, 2, 3, 0.5, 1.5, 2.25, 10, 0.333, 12, 7, 100]);
    // ราคา 2–3 ตำแหน่ง (หน่วย 1/1000 บาท แล้วหาร — JSON ได้เลขทศนิยมตรงตัว)
    const unitPrice = (Math.round(rand() * pick([100, 1000, 50000, 2000000])) * 10 + pick([0, 0, 5])) / 1000;
    const gross = round2(qty * unitPrice);
    const discount = rand() < 0.3 ? round2(gross * pick([0.1, 0.05, 0.333])) : 0;
    return line(qty, unitPrice, discount, pick(['4100', '4110', '5100', 'SVC']));
  });
  const vatMode = pick<VatMode>(['exclusive', 'inclusive', 'none']);
  return { lines, vatMode, vatRate: pick([7, 7, 7, 0, 10]), whtRate: pick([0, 0, 1, 3, 5]) };
}

function docCalcVectors(): GoldenVector[] {
  const { list, add } = collector();

  const lineCases: [string, CalcLine][] = [
    ['simple', line(2, 100)],
    ['discount', line(3, 99.99, 10)],
    ['fractional-qty', line(0.333, 3)],
    ['half-satang', line(3, 0.335)],
    ['discount-more-than-amount', line(1, 50, 80)],
    ['zero-qty', line(0, 100)],
    ['negative-price', line(1, -100)],
    ['discount-odd', line(1, 10, 0.005)],
  ];
  lineCases.forEach(([name, l]) => add(`lineAmount/${name}`, { line: l }, lineAmount(l)));

  const docs: [string, CalcInput][] = [
    ['exclusive-basic', { lines: [line(1, 1000)], vatMode: 'exclusive', vatRate: 7 }],
    ['inclusive-basic', { lines: [line(1, 1070)], vatMode: 'inclusive', vatRate: 7 }],
    ['none-basic', { lines: [line(1, 1000)], vatMode: 'none', vatRate: 7 }],
    ['exclusive-wht3', { lines: [line(1, 10000)], vatMode: 'exclusive', vatRate: 7, whtRate: 3 }],
    ['inclusive-wht3', { lines: [line(1, 10700)], vatMode: 'inclusive', vatRate: 7, whtRate: 3 }],
    ['inclusive-odd-satang', { lines: [line(1, 100)], vatMode: 'inclusive', vatRate: 7 }],
    ['inclusive-one-satang', { lines: [line(1, 0.01)], vatMode: 'inclusive', vatRate: 7 }],
    [
      'inclusive-multiline-allocation',
      {
        lines: [line(1, 33.33, 0, '4100'), line(1, 33.33, 0, '4110'), line(1, 33.34, 0, '4120')],
        vatMode: 'inclusive',
        vatRate: 7,
      },
    ],
    [
      'inclusive-same-account-merge',
      {
        lines: [line(3, 0.335, 0, '4100'), line(1, 99.99, 0, '4110'), line(2, 0.01, 0, '4100')],
        vatMode: 'inclusive',
        vatRate: 7,
      },
    ],
    [
      'exclusive-discounts',
      { lines: [line(10, 150, 75), line(2, 1999.5, 0.5), line(1, 333.33, 33.33)], vatMode: 'exclusive', vatRate: 7 },
    ],
    ['exclusive-rate0', { lines: [line(1, 500)], vatMode: 'exclusive', vatRate: 0 }],
    ['inclusive-rate0', { lines: [line(1, 500)], vatMode: 'inclusive', vatRate: 0 }],
    ['inclusive-rate10', { lines: [line(1, 1234.56), line(2, 0.99)], vatMode: 'inclusive', vatRate: 10 }],
    ['empty', { lines: [], vatMode: 'exclusive', vatRate: 7 }],
    ['zero-gross', { lines: [line(1, 100), line(1, -100)], vatMode: 'inclusive', vatRate: 7 }],
    [
      'negative-line-inclusive',
      { lines: [line(1, 1000, 0, '4100'), line(1, -100.01, 0, '4190')], vatMode: 'inclusive', vatRate: 7 },
    ],
    ['credit-note-negative', { lines: [line(1, -1070)], vatMode: 'inclusive', vatRate: 7, whtRate: 3 }],
    ['exclusive-half-vat', { lines: [line(1, 0.5)], vatMode: 'exclusive', vatRate: 7 }],
    ['none-wht5', { lines: [line(12, 15000)], vatMode: 'none', vatRate: 7, whtRate: 5 }],
    [
      'large-inclusive',
      {
        lines: [line(1, 9876543.21, 0, '4100'), line(3, 1234567.89, 0, '4110'), line(0.5, 999999.99, 0, '4120')],
        vatMode: 'inclusive',
        vatRate: 7,
        whtRate: 3,
      },
    ],
  ];

  const rand = createRandom(20261024);
  for (let i = 0; i < 80; i += 1) docs.push([`random-${String(i).padStart(3, '0')}`, randomDoc(rand)]);

  docs.forEach(([name, input]) => {
    add(`calcDocument/${name}`, input, calcDocument(input));
    add(`lineNetAmounts/${name}`, { lines: input.lines, vatMode: input.vatMode, vatRate: input.vatRate }, lineNetAmounts(input));
  });
  return list;
}

// ---------------- WHT ----------------

type GoldenPurchase = { id: string; lines: PurchaseLine[]; vatMode: VatMode; vatRate: number };
type GoldenCredit = Pick<PurchaseCreditNote, 'docNo' | 'purchaseId' | 'lines' | 'vatMode' | 'vatRate' | 'refundDue'>;
type GoldenPayment = Pick<Payment, 'purchaseId' | 'amount' | 'whtItems'>;
type GoldenState = { payments: GoldenPayment[]; purchaseCredits: GoldenCredit[] };

let lineSeq = 0;
const pline = (
  qty: number,
  unitPrice: number,
  accountCode: string,
  whtIncomeType = '',
  whtRate = 0,
  discount = 0
): PurchaseLine => {
  lineSeq += 1;
  return { id: `L${lineSeq}`, description: '', qty, unitPrice, discount, accountCode, whtIncomeType, whtRate };
};

const asState = (s: GoldenState) => s as unknown as { payments: Payment[]; purchaseCredits: PurchaseCreditNote[] };

function whtVectors(): GoldenVector[] {
  const { list, add } = collector();
  lineSeq = 0;

  add('constants/rates', {}, { RECEIPT_WHT_MAX_RATE, PURCHASE_WHT_MAX_RATE });

  const receipts: [string, { net: number; total: number }, number, number][] = [
    ['full-3', { net: 10000, total: 10700 }, 10700, 3],
    ['partial-3', { net: 10000, total: 10700 }, 5000, 3],
    ['partial-odd', { net: 9345.79, total: 10000 }, 3333.33, 3],
    ['rate-5', { net: 1000, total: 1070 }, 1070, 5],
    ['rate-0', { net: 1000, total: 1070 }, 1070, 0],
    ['amount-0', { net: 1000, total: 1070 }, 0, 3],
    ['amount-negative', { net: 1000, total: 1070 }, -10, 3],
    ['no-vat', { net: 1000, total: 1000 }, 999.99, 1],
    ['rate-1.5', { net: 12345.67, total: 13209.87 }, 13209.87, 1.5],
    ['total-0', { net: 0, total: 0 }, 100, 3],
  ];
  receipts.forEach(([name, totals, amount, rate]) =>
    add(`receiptWhtAmount/${name}`, { totals, amount, rate }, receiptWhtAmount(totals, amount, rate))
  );

  const docs: [string, GoldenPurchase][] = [
    [
      'service-goods-exclusive',
      {
        id: 'P1',
        vatMode: 'exclusive',
        vatRate: 7,
        lines: [pline(1, 10000, '5300', 'ค่าบริการ', 3), pline(5, 200, '1200'), pline(1, 1500, '5310', 'ค่าขนส่ง', 1)],
      },
    ],
    [
      'two-service-lines-same-group',
      {
        id: 'P2',
        vatMode: 'inclusive',
        vatRate: 7,
        lines: [pline(1, 3333.33, '5300', 'ค่าบริการ', 3), pline(1, 6666.67, '5301', 'ค่าบริการ', 3), pline(1, 0.01, '5302', 'ค่าบริการ', 3)],
      },
    ],
    [
      'rent-none-vat',
      { id: 'P3', vatMode: 'none', vatRate: 7, lines: [pline(1, 25000, '5400', 'ค่าเช่า', 5)] },
    ],
    [
      'no-wht-goods',
      { id: 'P4', vatMode: 'exclusive', vatRate: 7, lines: [pline(10, 99.99, '1200'), pline(1, 50, '1200')] },
    ],
    [
      'mixed-rates-odd',
      {
        id: 'P5',
        vatMode: 'inclusive',
        vatRate: 7,
        lines: [
          pline(3, 0.335, '5300', 'ค่าบริการ', 3),
          pline(1, 1234.57, '5500', 'ค่าโฆษณา', 2),
          pline(2, 777.77, '5300', 'ค่าบริการ', 3, 0.77),
          pline(1, 99.99, '5310', 'ค่าขนส่ง', 1),
        ],
      },
    ],
  ];
  docs.forEach(([name, doc]) => {
    add(`purchaseWhtGroups/${name}`, { doc }, purchaseWhtGroups(doc));
    add(`purchaseTotals/${name}`, { doc }, purchaseTotals(doc));
  });

  /** จำลองการจ่ายหลายครั้ง: แต่ละครั้งใช้ผลของ planPurchasePayment ครั้งก่อนเป็นใบสำคัญจ่ายเดิม */
  const scenario = (name: string, doc: GoldenPurchase, credits: GoldenCredit[], steps: (number | 'rest')[]) => {
    const state: GoldenState = { payments: [], purchaseCredits: credits };
    steps.forEach((step, index) => {
      const amount = step === 'rest' ? purchaseOutstanding(asState(state), doc) : step;
      const input = { state: JSON.parse(JSON.stringify(state)) as GoldenState, doc, amount };
      const plan = planPurchasePayment(asState(state), doc, amount);
      add(`planPurchasePayment/${name}#${index + 1}`, input, plan);
      add(
        `purchaseOutstanding/${name}#${index + 1}`,
        { state: input.state, doc },
        purchaseOutstanding(asState(state), doc)
      );
      state.payments.push({ purchaseId: doc.id, amount, whtItems: plan.whtItems as WhtLineItem[] });
    });
  };

  const [p1, p2, p3, , p5] = docs.map((d) => d[1]);
  scenario('single-full', p1, [], ['rest']);
  scenario('three-parts', p1, [], [4000, 3333.33, 'rest']);
  scenario('thirds-inclusive', p2, [], [3333.33, 3333.33, 'rest']);
  scenario('rent-two-parts', p3, [], [12500, 'rest']);
  scenario('mixed-many', p5, [], [100, 0.01, 999.99, 'rest']);
  scenario('overpay', p1, [], [999999]);
  scenario('zero-payment', p1, [], [0, 'rest']);

  const creditOnService: GoldenCredit = {
    docNo: 'PC6910-0001',
    purchaseId: 'P1',
    vatMode: 'exclusive',
    vatRate: 7,
    lines: [{ ...pline(1, 2000, '5300'), purchaseLineId: p1.lines[0].id }] as GoldenCredit['lines'],
  };
  const creditOnGoods: GoldenCredit = {
    docNo: 'PC6910-0002',
    purchaseId: 'P1',
    vatMode: 'exclusive',
    vatRate: 7,
    lines: [pline(2, 200, '1200')],
  };
  const creditUnmatched: GoldenCredit = {
    docNo: 'PC6910-0003',
    purchaseId: 'P1',
    vatMode: 'exclusive',
    vatRate: 7,
    lines: [pline(1, 1000, '9999')],
  };
  const creditTooMuch: GoldenCredit = {
    docNo: 'PC6910-0004',
    purchaseId: 'P1',
    vatMode: 'exclusive',
    vatRate: 7,
    lines: [{ ...pline(1, 20000, '5310'), purchaseLineId: p1.lines[2].id }] as GoldenCredit['lines'],
  };
  const creditBadRef: GoldenCredit = {
    docNo: '',
    purchaseId: 'P1',
    vatMode: 'exclusive',
    vatRate: 7,
    lines: [{ ...pline(1, 10, '5300'), purchaseLineId: 'NOPE' }] as GoldenCredit['lines'],
  };
  const creditRefund: GoldenCredit = { ...creditOnService, docNo: 'PC6911-0001', refundDue: 535 };

  const allocations: [string, GoldenCredit[]][] = [
    ['by-line-ref', [creditOnService]],
    ['by-account', [creditOnGoods]],
    ['unmatched-average', [creditUnmatched]],
    ['over-line', [creditTooMuch]],
    ['bad-ref', [creditBadRef]],
    ['combined', [creditOnService, creditOnGoods, creditUnmatched]],
  ];
  allocations.forEach(([name, credits]) => {
    add(`purchaseCreditAllocation/${name}`, { doc: p1, credits }, purchaseCreditAllocation(p1, credits));
    const state = { payments: [], purchaseCredits: credits };
    add(`purchaseAdjustedWhtGroups/${name}`, { state, doc: p1 }, purchaseAdjustedWhtGroups(asState(state), p1));
    add(`purchaseAdjustedTotal/${name}`, { state, doc: p1 }, purchaseAdjustedTotal(asState(state), p1));
  });

  scenario('credit-then-pay', p1, [creditOnService], [5000, 'rest']);
  scenario('credit-goods-then-pay', p1, [creditOnGoods, creditUnmatched], [2000, 2000, 'rest']);
  scenario('credit-refund-due', p1, [creditRefund], [3000, 'rest']);

  // ลดหนี้หลังจ่ายบางส่วน: จ่ายก่อน 2 ครั้ง แล้วมีใบลดหนี้ แล้วจ่ายต่อ
  const state: GoldenState = { payments: [], purchaseCredits: [] };
  [5000, 3000].forEach((amount) => {
    const plan = planPurchasePayment(asState(state), p1, amount);
    state.payments.push({ purchaseId: p1.id, amount, whtItems: plan.whtItems });
  });
  state.purchaseCredits.push({ ...creditOnService, refundDue: 0 });
  [1000, 'rest' as const].forEach((step, index) => {
    const amount = step === 'rest' ? purchaseOutstanding(asState(state), p1) : step;
    const input = { state: JSON.parse(JSON.stringify(state)) as GoldenState, doc: p1, amount };
    const plan = planPurchasePayment(asState(state), p1, amount);
    add(`planPurchasePayment/credit-after-partial#${index + 1}`, input, plan);
    state.payments.push({ purchaseId: p1.id, amount, whtItems: plan.whtItems });
  });

  // ลดหนี้บรรทัดค่าบริการจนฐานคงเหลือน้อยกว่าที่หักไปแล้ว → ไม่หักเพิ่ม
  const heavy: GoldenState = { payments: [], purchaseCredits: [] };
  const firstPlan = planPurchasePayment(asState(heavy), p1, 10000);
  heavy.payments.push({ purchaseId: p1.id, amount: 10000, whtItems: firstPlan.whtItems });
  heavy.purchaseCredits.push({
    ...creditOnService,
    docNo: 'PC6910-0009',
    lines: [{ ...pline(1, 9000, '5300'), purchaseLineId: p1.lines[0].id }] as GoldenCredit['lines'],
  });
  const restAmount = purchaseOutstanding(asState(heavy), p1);
  add(
    'planPurchasePayment/credit-below-withheld#1',
    { state: JSON.parse(JSON.stringify(heavy)), doc: p1, amount: restAmount },
    planPurchasePayment(asState(heavy), p1, restAmount)
  );

  return list;
}

// ---------------- baht text ----------------

function bahtTextVectors(): GoldenVector[] {
  const { list, add } = collector();
  [
    0, 0.005, 0.01, 0.25, 0.5, 0.99, 1, 2, 10, 11, 12, 20, 21, 22, 100, 101, 110, 111, 121, 1000, 1001, 1011, 10000,
    100000, 999999, 1000000, 1000001, 1000011, 1000021, 1100000, 2000000.01, 11000011, 21000021, 100000000,
    1000000000000, 1000001000001, 1070.5, 1070.05, 21.21, 10.1, 20.2, 11.11, -1070.5, -0.01, 123456789.99,
    1234567890123.45, 1.005, 7.995,
  ].forEach((amount) => add(`bahtText/${amount}`, { amount }, bahtText(amount)));
  return list;
}

// ---------------- numbering ----------------

function numberingVectors(): GoldenVector[] {
  const { list, add } = collector();
  add('constants/DOC_PREFIX', {}, DOC_PREFIX);
  add('constants/DATE_ORDERED_PREFIXES', {}, DATE_ORDERED_PREFIXES);

  const dates = ['2026-10-24', '2026-01-01', '2026-12-31', '2025-02-28', '2024-02-29', '2000-01-01', '2099-12-31'];
  (Object.values(DOC_PREFIX) as (typeof DOC_PREFIX)[keyof typeof DOC_PREFIX][]).forEach((prefix) => {
    dates.forEach((date) => {
      add(`nextDocNo/${prefix}@${date}/empty`, { sequences: {}, prefix, date }, nextDocNo({}, prefix, date));
    });
  });
  const seqCases: [string, Record<string, number>, string, string][] = [
    ['existing', { IV6910: 42, IV6909: 99 }, 'IV', '2026-10-24'],
    ['other-month', { IV6910: 42 }, 'IV', '2026-11-01'],
    ['9999-rollover', { RE6910: 9999 }, 'RE', '2026-10-01'],
    ['five-digits', { PV6910: 12345 }, 'PV', '2026-10-31'],
    ['be-year-boundary', { JV6912: 7 }, 'JV', '2027-01-01'],
    ['other-prefix', { CN6910: 3 }, 'IV', '2026-10-24'],
  ];
  seqCases.forEach(([name, sequences, prefix, date]) =>
    add(`nextDocNo/${name}`, { sequences, prefix, date }, nextDocNo(sequences, prefix as 'IV', date))
  );

  [
    'IV6910-0043',
    'IV6910-10000',
    'JV6912-0001',
    'iv6910-0001',
    'IV691-0001',
    'IV6910-001',
    'IVX6910-0001',
    'IV6910-0043\n',
    ' IV6910-0043',
    'IV๖๙๑๐-0043',
    'XX0000-0000',
    '',
  ].forEach((docNo, i) => add(`parseDocNo/${i}:${JSON.stringify(docNo)}`, { docNo }, parseDocNo(docNo)));

  const conflicts: [string, string][] = [
    ['IV6911-0001', '2026-10-31'],
    ['IV6910-0001', '2026-10-31'],
    ['IV6910-0001', '2026-10-15'],
    ['JV6910-0001', '2026-10-31'],
    ['IV6909-0100', '2026-10-31'],
    [' iv6911-0001 ', '2026-10-31'],
    ['EX6911-0001', '2026-10-31'],
    ['INV-2026-001', '2026-10-31'],
    ['QT6912-0001', '2026-10-31'],
    ['PI6902-0001', '2026-02-28'],
    ['PI6902-0001', '2026-02-27'],
  ];
  conflicts.forEach(([docNo, openingDate]) =>
    add(
      `openingNumberConflict/${docNo.trim()}@${openingDate}${docNo !== docNo.trim() ? '/padded' : ''}`,
      { docNo, openingDate },
      openingNumberConflict(docNo, openingDate)
    )
  );
  return list;
}

// ---------------- thai date ----------------

function thaiDateVectors(): GoldenVector[] {
  const { list, add } = collector();
  [2000, 2026, 2100].forEach((yearAD) => add(`toBE/${yearAD}`, { yearAD }, toBE(yearAD)));

  const dates = [
    '2026-10-24',
    '2026-01-01',
    '2026-12-31',
    '2024-02-29',
    '2025-03-01',
    '2000-02-29',
    '2100-02-28',
    '2026-10-24T13:45:00.000Z',
  ];
  dates.forEach((date) => {
    add(`formatThaiDate/${date}`, { date }, formatThaiDate(date));
    add(`formatThaiDateShort/${date}`, { date }, formatThaiDateShort(date));
    add(`toRdDate/${date}`, { date }, toRdDate(date));
    add(`docPeriodCode/${date}`, { date }, docPeriodCode(date));
    add(`monthKeyOf/${date}`, { date }, monthKeyOf(date));
    add(`periodOf/${date}`, { date }, periodOf(date));
    add(`endOfPreviousMonth/${date}`, { today: date }, endOfPreviousMonth(date));
  });
  [null, ''].forEach((date) => {
    const d = date ?? undefined;
    add(`formatThaiDate/${JSON.stringify(date)}`, { date }, formatThaiDate(d));
    add(`formatThaiDateShort/${JSON.stringify(date)}`, { date }, formatThaiDateShort(d));
    add(`toRdDate/${JSON.stringify(date)}`, { date }, toRdDate(d));
  });

  const adds: [string, number][] = [
    ['2026-10-24', 0],
    ['2026-10-24', 7],
    ['2026-10-24', 30],
    ['2026-10-24', -24],
    ['2026-12-31', 1],
    ['2026-01-01', -1],
    ['2024-02-28', 1],
    ['2025-02-28', 1],
    ['2026-10-24', 365],
    ['2026-10-24', -400],
  ];
  adds.forEach(([date, days]) => add(`addDays/${date}${days >= 0 ? '+' : ''}${days}`, { date, days }, addDays(date, days)));

  const diffs: [string, string][] = [
    ['2026-10-24', '2026-10-24'],
    ['2026-10-24', '2026-11-23'],
    ['2026-11-23', '2026-10-24'],
    ['2024-01-01', '2025-01-01'],
    ['2025-01-01', '2026-01-01'],
    ['2026-03-01', '2026-02-28'],
  ];
  diffs.forEach(([from, to]) => add(`diffDays/${from}..${to}`, { from, to }, diffDays(from, to)));

  const periods = [
    { year: 2026, month: 10 },
    { year: 2026, month: 12 },
    { year: 2026, month: 1 },
    { year: 2025, month: 2 },
  ];
  periods.forEach((period) => {
    const key = periodKey(period);
    add(`periodKey/${key}`, { period }, key);
    add(`periodLabel/${key}`, { period }, periodLabel(period));
    add(`periodShortLabel/${key}`, { period }, periodShortLabel(period));
    add(`filingDueDates/${key}`, { period }, filingDueDates(period));
    [-13, -1, 0, 1, 2, 12, 25].forEach((delta) =>
      add(`shiftPeriod/${key}${delta >= 0 ? '+' : ''}${delta}`, { period, delta }, shiftPeriod(period, delta))
    );
    ['2026-10-01', '2026-12-31', '2026-01-15', '2025-02-28', '2024-02-29'].forEach((date) =>
      add(`inPeriod/${date}@${key}`, { date, period }, inPeriod(date, period))
    );
  });

  ['2026-10', '2026-01', '2026-12', '2024-02', '2025-02', '2100-02', '2000-02'].forEach((key) => {
    add(`periodFromKey/${key}`, { key }, periodFromKey(key));
    add(`endOfMonth/${key}`, { key }, endOfMonth(key));
    [-12, -1, 1, 3, 15].forEach((delta) =>
      add(`shiftMonthKey/${key}${delta >= 0 ? '+' : ''}${delta}`, { key, delta }, shiftMonthKey(key, delta))
    );
  });

  [
    '2026-10',
    '2026-13',
    '2026-00',
    '1999-12',
    '2101-01',
    '2569-10',
    '2026-1',
    '2026-10-01',
    '',
    null,
  ].forEach((value, i) => add(`isMonthKey/${i}:${JSON.stringify(value)}`, { value }, isMonthKey(value)));

  [
    '2026-10-24',
    '2026-02-29',
    '2024-02-29',
    '2100-02-29',
    '2000-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2569-10-24',
    '1999-12-31',
    '2000-01-01',
    '2100-12-31',
    '2101-01-01',
    '2026-1-01',
    '2026-10-24T00:00:00Z',
    '20261024',
    '',
    null,
  ].forEach((value, i) => add(`isValidISODate/${i}:${JSON.stringify(value)}`, { value }, isValidISODate(value)));
  return list;
}

// ----------------------------------------------------------------------

/** สร้าง golden vectors ทั้งหมด (pure — ไม่อ่าน/เขียนไฟล์) */
export function buildGoldenSet(): GoldenSet {
  return {
    'money.json': moneyVectors(),
    'thai-tax-id.json': taxIdVectors(),
    'document-calc.json': docCalcVectors(),
    'wht.json': whtVectors(),
    'baht-text.json': bahtTextVectors(),
    'numbering.json': numberingVectors(),
    'thai-date.json': thaiDateVectors(),
  };
}

/** เรียง key ของ object ทุกระดับ (array คงลำดับเดิม) ให้ไฟล์ JSON เหมือนเดิมทุกครั้ง */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeysDeep((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}

/** เนื้อหาไฟล์ golden: `{ file, generator, count, vectors: [{ name, input, output }] }` จัดรูปแบบ 2 ช่อง + newline ท้าย */
export function renderGoldenFiles(set: GoldenSet = buildGoldenSet()): Record<string, string> {
  return Object.fromEntries(
    Object.entries(set).map(([file, vectors]) => {
      const body = {
        file,
        generator: 'go-account/scripts/export-golden.ts (yarn golden)',
        count: vectors.length,
        vectors: vectors.map((v) => ({ name: v.name, input: sortKeysDeep(v.input), output: sortKeysDeep(v.output) })),
      };
      return [file, `${JSON.stringify(body, null, 2)}\n`];
    })
  );
}
