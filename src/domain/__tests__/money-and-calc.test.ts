import { ACC } from '../chart-of-accounts';
import { lineAmount, calcDocument } from '../document-calc';
import { round2, sumBaht, percentOf, formatPlain } from '../money';
import { toBranch6, formatTaxId, isValidThaiTaxId, normalizeBranch5 } from '../thai-tax-id';

// ----------------------------------------------------------------------

describe('money', () => {
  it('rounds half-up to satang', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('sums without floating point drift', () => {
    expect(sumBaht([0.1, 0.2])).toBe(0.3);
    expect(sumBaht([10640, 6895, 16800, 13055, 17570])).toBe(64960);
  });

  it('calculates percent in satang', () => {
    expect(percentOf(100000, 7)).toBe(7000);
    expect(percentOf(98500, 3)).toBe(2955);
    expect(percentOf(33.33, 7)).toBe(2.33);
  });

  it('formats plain numbers for RD files', () => {
    expect(formatPlain(1234.5)).toBe('1234.50');
    expect(formatPlain(0)).toBe('0.00');
  });
});

describe('thai tax id', () => {
  it('accepts a valid check digit', () => {
    // ตัวอย่างเลขที่ check digit ถูกต้อง
    expect(isValidThaiTaxId('0105556012345')).toBe(false);
    expect(isValidThaiTaxId('1101700230708')).toBe(true);
    expect(isValidThaiTaxId('1-1017-00230-70-8')).toBe(true);
  });

  it('rejects wrong length or digits', () => {
    expect(isValidThaiTaxId('123')).toBe(false);
    expect(isValidThaiTaxId('110170023070A')).toBe(false);
    expect(isValidThaiTaxId(undefined)).toBe(false);
  });

  it('formats and normalizes branches', () => {
    expect(formatTaxId('1101700230708')).toBe('1-1017-00230-70-8');
    expect(normalizeBranch5('2')).toBe('00002');
    expect(normalizeBranch5('')).toBe('00000');
    expect(toBranch6('00001')).toBe('000001');
  });
});

describe('calcDocument', () => {
  const line = (qty: number, unitPrice: number, discount = 0, accountCode: string = ACC.sales) => ({
    qty,
    unitPrice,
    discount,
    accountCode,
  });

  it('computes VAT-exclusive totals', () => {
    const t = calcDocument({
      lines: [line(2000, 38.5), line(1, 45000, 0, ACC.service)],
      vatMode: 'exclusive',
      vatRate: 7,
    });
    expect(t.net).toBe(122000);
    expect(t.vat).toBe(8540);
    expect(t.total).toBe(130540);
    expect(t.netByAccount).toEqual({ [ACC.sales]: 77000, [ACC.service]: 45000 });
  });

  it('extracts VAT from inclusive prices and keeps the split summing to net', () => {
    const t = calcDocument({
      lines: [line(1, 107), line(3, 33.33)],
      vatMode: 'inclusive',
      vatRate: 7,
    });
    expect(t.total).toBe(206.99);
    expect(t.net).toBe(193.45);
    expect(t.vat).toBe(13.54);
    expect(sumBaht(Object.values(t.netByAccount))).toBe(t.net);
  });

  it('computes withholding on the pre-VAT amount', () => {
    const t = calcDocument({ lines: [line(1, 10000)], vatMode: 'exclusive', vatRate: 7, whtRate: 3 });
    expect(t.wht).toBe(300);
    expect(t.payable).toBe(10400);
  });

  it('handles no-VAT documents and discounts', () => {
    expect(lineAmount({ qty: 3, unitPrice: 100, discount: 50 })).toBe(250);
    const t = calcDocument({ lines: [line(3, 100, 50)], vatMode: 'none', vatRate: 7 });
    expect(t.vat).toBe(0);
    expect(t.total).toBe(250);
  });
});
