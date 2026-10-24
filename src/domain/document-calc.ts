import { round2, sumBaht, mulBaht, toSatang, percentOf, fromSatang } from './money';

import type { DocLine, VatMode, DocTotals } from './types';

// ----------------------------------------------------------------------

/** อัตราภาษีมูลค่าเพิ่มที่ใช้ทั้งระบบ (%) — เปลี่ยนอัตราต้องแก้ที่นี่ที่เดียว */
export const VAT_RATE = 7;

export type CalcInput = {
  lines: Pick<DocLine, 'qty' | 'unitPrice' | 'discount' | 'accountCode'>[];
  vatMode: VatMode;
  vatRate: number;
  /** อัตราหัก ณ ที่จ่าย (%) — 0 ถ้าไม่หัก */
  whtRate?: number;
};

export function lineAmount(line: Pick<DocLine, 'qty' | 'unitPrice' | 'discount'>): number {
  return round2(mulBaht(line.qty || 0, line.unitPrice || 0) - (line.discount || 0));
}

/**
 * คำนวณยอดเอกสาร
 * - exclusive: ราคาที่กรอกยังไม่รวม VAT → VAT = net × rate
 * - inclusive: ราคาที่กรอกรวม VAT แล้ว → net = total × 100 / (100 + rate)
 * - none: ไม่มี VAT (ผู้ขายไม่จด VAT / สินค้ายกเว้น)
 * หัก ณ ที่จ่ายคิดจากมูลค่าก่อน VAT เสมอ
 */
export function calcDocument(input: CalcInput): DocTotals {
  const amounts = input.lines.map(lineAmount);
  const gross = sumBaht(amounts);
  const rate = input.vatMode === 'none' ? 0 : input.vatRate;

  let net: number;
  let vat: number;
  let total: number;

  if (input.vatMode === 'inclusive' && rate > 0) {
    total = gross;
    net = fromSatang(Math.round((toSatang(gross) * 100) / (100 + rate)));
    vat = round2(total - net);
  } else {
    net = gross;
    vat = percentOf(net, rate);
    total = round2(net + vat);
  }

  // แบ่งมูลค่าก่อน VAT ตามบัญชี (inclusive ต้องถอด VAT ออกตามสัดส่วน ให้ผลรวมเท่ากับ net พอดี)
  const netByAccount: Record<string, number> = {};
  if (gross !== 0) {
    let allocated = 0;
    const netSatang = toSatang(net);
    const grossSatang = toSatang(gross);
    input.lines.forEach((line, index) => {
      const share =
        index === input.lines.length - 1
          ? netSatang - allocated
          : Math.round((toSatang(amounts[index]) * netSatang) / grossSatang);
      allocated += share;
      netByAccount[line.accountCode] = round2((netByAccount[line.accountCode] ?? 0) + fromSatang(share));
    });
  }

  const wht = input.whtRate ? percentOf(net, input.whtRate) : 0;

  return {
    gross,
    net,
    vat,
    total,
    wht,
    payable: round2(total - wht),
    netByAccount,
  };
}
