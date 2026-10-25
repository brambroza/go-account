import { ACC } from '../chart-of-accounts';
import { whtPayeesForPeriod } from '../wht';
import { salesDocTitle } from '../sales-doc';
import { calcDocument } from '../document-calc';
import { planPurchasePayment } from '../purchase';
import { importContactsCsv, defaultContactTitle } from '../csv-import';
import { buildETaxXml, eTaxReadiness, buildReceiptETaxXml } from '../etax-xml';
import { rdBranchType, whtDetailRows, buildRdWhtFile, sanitizeRdText } from '../rd-wht-file';

import type { Company, Contact, Payment, Receipt, SalesDoc, PurchaseDoc } from '../types';

// ----------------------------------------------------------------------

const company: Company = {
  name: 'บริษัท สาธิต แมนูแฟคเจอริ่ง จำกัด',
  taxId: '0105562077778',
  branchNo: '00000',
  address: { addressNo: '918/288', moo: '10', district: 'พระสมุทรเจดีย์', province: 'สมุทรปราการ', postalCode: '10290' },
  rdUserId: 'DEMO0001',
  vatRegistered: true,
  email: 'account@example.com',
};

const person: Contact = {
  id: 'v-ind',
  code: 'V0002',
  kind: 'vendor',
  legalForm: 'individual',
  title: 'นาย',
  name: 'สมชาย',
  lastName: 'ใจดี',
  taxId: '3109900123453',
  address: { addressNo: '12/3', district: 'เมือง', province: 'นนทบุรี', postalCode: '11000' },
  creditDays: 0,
};

const firm: Contact = {
  id: 'v-jur',
  code: 'V0001',
  kind: 'vendor',
  legalForm: 'juristic',
  title: 'บริษัท',
  name: 'ขนส่งด่วน จำกัด',
  taxId: '0105559076545',
  branchNo: '00001',
  address: { province: 'กรุงเทพมหานคร' },
  creditDays: 30,
};

/** เอกสารซื้อ — `lines` = [มูลค่า, อัตรา, ประเภทเงินได้][] */
function purchase(id: string, contactId: string, lines: [number, number, string][]): PurchaseDoc {
  return {
    id,
    docNo: `PI-${id}`,
    supplierInvoiceNo: '',
    date: '2026-10-10',
    contactId,
    lines: lines.map(([amount, rate, type], i) => ({
      id: `l${i}`,
      description: type,
      qty: 1,
      unitPrice: amount,
      discount: 0,
      accountCode: ACC.misc,
      whtRate: rate,
      whtIncomeType: type,
    })),
    vatMode: 'exclusive',
    vatRate: 7,
    claimVat: false,
    whtCondition: '1',
    paid: true,
    journalId: 'j',
    createdAt: '',
  };
}

/** ใบสำคัญจ่ายของเอกสาร — `parts` = [วันที่จ่าย, ยอด (ไม่ส่ง = ที่เหลือทั้งหมด)][] คิดหัก ณ ที่จ่ายด้วย planPurchasePayment */
function pay(doc: PurchaseDoc, parts: [string, number?][], prior: Payment[] = []): Payment[] {
  const out: Payment[] = [];
  parts.forEach(([date, amount], i) => {
    const state = { payments: [...prior, ...out] };
    const paidSoFar = state.payments.filter((p) => p.purchaseId === doc.id).reduce((a, p) => a + p.amount, 0);
    const value = amount ?? Math.round((calcDocument(doc).total - paidSoFar) * 100) / 100;
    const plan = planPurchasePayment(state, doc, value);
    out.push({
      id: `${doc.id}-pv${i}`,
      docNo: `PV-${doc.id}-${i}`,
      date,
      purchaseId: doc.id,
      contactId: doc.contactId,
      amount: value,
      whtAmount: plan.whtAmount,
      netPaid: plan.netPaid,
      whtItems: plan.whtItems,
      accountCode: ACC.bank,
      whtCertNo: plan.whtAmount > 0 ? `WT-${doc.id}-${i}` : undefined,
      journalId: 'j',
    });
  });
  return out;
}

const october = { year: 2026, month: 10 };

describe('ภ.ง.ด. Format กลาง v2.0', () => {
  it('sanitizes prohibited characters', () => {
    expect(sanitizeRdText('918/288 "A&B", #1', 100)).toBe('918-288 A B 1');
    expect(sanitizeRdText('x'.repeat(50), 40)).toHaveLength(40);
  });

  it('strips curly quotes copied from Word/LINE like the straight quotes', () => {
    expect(sanitizeRdText('บริษัท “เอ” จำกัด', 100)).toBe('บริษัท เอ จำกัด');
    expect(sanitizeRdText('ร้าน‘สมใจ’', 100)).toBe('ร้าน สมใจ');
    expect(sanitizeRdText('“”‘’', 100)).toBe('');
  });

  it('writes BRANCH_TYPE V / S / empty from VAT and SBT registration (header field 16)', () => {
    expect(rdBranchType({ vatRegistered: true })).toBe('V');
    expect(rdBranchType({ vatRegistered: true, sbtRegistered: true })).toBe('V');
    expect(rdBranchType({ vatRegistered: false, sbtRegistered: true })).toBe('S');
    expect(rdBranchType({ vatRegistered: false })).toBe('');
    const header = (c: Company) => buildRdWhtFile({ form: 'PND53', company: c, period: october, payees: [] }).content.split('\r\n')[0].split('|');
    expect(header(company)[15]).toBe('V');
    expect(header({ ...company, vatRegistered: false, sbtRegistered: true })[15]).toBe('S');
    expect(header({ ...company, vatRegistered: false })[15]).toBe('');
    expect(header({ ...company, vatRegistered: false, sbtRegistered: true })).toHaveLength(25);
  });

  it('builds a PND53 file with 25-field header and 38-field details', () => {
    // ใบเดียวจ่ายครั้งเดียว 4 ประเภทเงินได้ → 2 ลำดับ (3 + 1), บุคคลธรรมดาไม่เข้า 53, จ่ายนอกงวดไม่นับ
    const multi = purchase('1', 'v-jur', [
      [20000, 1, 'ค่าขนส่ง'],
      [10000, 3, 'ค่าบริการ'],
      [5000, 5, 'ค่าเช่า'],
      [1000, 2, 'ค่าโฆษณา'],
    ]);
    const ind = purchase('5', 'v-ind', [[3000, 3, 'ค่าบริการ']]);
    const later = purchase('6', 'v-jur', [[999, 3, 'นอกงวด']]);
    const purchases = [multi, ind, later];
    const payments = [...pay(multi, [['2026-10-28']]), ...pay(ind, [['2026-10-28']]), ...pay(later, [['2026-11-02']])];
    const payees = whtPayeesForPeriod({ purchases, payments, contacts: [person, firm] }, october, 'PND53');
    expect(payees).toHaveLength(1);
    expect(payees[0].items).toHaveLength(4);

    const file = buildRdWhtFile({ form: 'PND53', company, period: october, payees });
    expect(file.errors).toEqual([]);
    expect(file.fileName).toBe('PND53_0105562077778_000000_2569_10_00_00.txt');

    const lines = file.content.split('\r\n');
    expect(lines[lines.length - 1]).toBe('');
    const header = lines[0].split('|');
    expect(header).toHaveLength(25);
    expect(header.slice(0, 6)).toEqual(['H', '0000', '0105562077778', '000000', '1', 'PND53']);
    expect(header[13]).toBe('10');
    expect(header[14]).toBe('2569');
    expect(header[17]).toBe('1');
    expect(header[18]).toBe('36000.00');
    expect(header[19]).toBe('770.00');

    const d1 = lines[1].split('|');
    const d2 = lines[2].split('|');
    expect(lines).toHaveLength(4);
    expect(d1).toHaveLength(38);
    expect(d1[1]).toBe('1');
    expect(d2[1]).toBe('2');
    expect(d1[8]).toBe('28102569');
    expect(d1.slice(9, 14)).toEqual(['1.00', '20000.00', '200.00', 'ค่าขนส่ง', '1']);
    expect(d2.slice(8, 14)).toEqual(['28102569', '2.00', '1000.00', '20.00', 'ค่าโฆษณา', '1']);
    expect(d2.slice(14, 20)).toEqual(['00000000', '0.00', '0.00', '0.00', '', '']);
    expect(lines.join('')).not.toMatch(/[,'"]/);
  });

  it('writes one detail row per payment voucher with its own pay date (partial payments)', () => {
    const doc = purchase('7', 'v-jur', [[10000, 3, 'ค่าบริการ']]); // รวม VAT 10,700 หัก 300
    const payments = pay(doc, [['2026-10-05', 3333.33], ['2026-10-20', 3333.33], ['2026-10-28']]);
    expect(payments.map((p) => p.whtAmount)).toEqual([93.46, 93.46, 113.08]);
    const payees = whtPayeesForPeriod({ purchases: [doc], payments, contacts: [firm] }, october, 'PND53');
    expect(payees[0].items.map((i) => i.paidDate)).toEqual(['2026-10-05', '2026-10-20', '2026-10-28']);
    expect(whtDetailRows(payees).map((r) => [r.seq, r.items.map((i) => i.paymentId)])).toEqual([
      [1, ['7-pv0']],
      [2, ['7-pv1']],
      [3, ['7-pv2']],
    ]);
    const file = buildRdWhtFile({ form: 'PND53', company, period: october, payees });
    const rows = file.content.split('\r\n').filter(Boolean);
    expect(rows).toHaveLength(4);
    expect(rows[0].split('|').slice(18, 20)).toEqual(['10000.00', '300.00']);
    expect(rows.slice(1).map((r) => r.split('|')[8])).toEqual(['05102569', '20102569', '28102569']);
  });

  it('requires district, province and postcode for PND3', () => {
    const doc = purchase('5', 'v-ind', [[3000, 3, 'ค่าบริการ']]);
    const payees = whtPayeesForPeriod(
      { purchases: [doc], payments: pay(doc, [['2026-10-28']]), contacts: [{ ...person, address: {} }, firm] },
      october,
      'PND3'
    );
    // snapshot ในใบสำคัญจ่ายไม่มี — ใช้ผู้ติดต่อปัจจุบัน (ที่อยู่ว่าง)
    const file = buildRdWhtFile({ form: 'PND3', company, period: october, payees });
    expect(file.errors.join()).toContain('ภ.ง.ด.3');
    const d = file.content.split('\r\n')[1].split('|');
    expect(d.slice(5, 8)).toEqual(['นาย', 'สมชาย', 'ใจดี']);
  });
});

describe('e-Tax XML', () => {
  const buyer: Contact = { ...firm, kind: 'customer', email: 'ap@buyer.example' };
  const doc: SalesDoc = {
    id: 's1',
    kind: 'tax-invoice',
    docNo: 'IV6910-0043',
    date: '2026-10-24',
    dueDate: '2026-11-23',
    contactId: buyer.id,
    lines: [{ id: 'l', description: 'ชิ้นส่วน <PX-120> & อะไหล่', qty: 2000, unitPrice: 38.5, discount: 0, accountCode: ACC.sales }],
    vatMode: 'exclusive',
    vatRate: 7,
    status: 'issued',
    paidAmount: 0,
    etax: 'pending-sign',
    journalId: 'j',
    createdAt: '',
  };

  it('builds the ETDA structure with escaped text and TXID', () => {
    const xml = buildETaxXml({ doc, company, buyer, createdAt: '2026-10-24T10:00:00' });
    expect(xml).toContain('<ram:ID schemeID="TXID">010556207777800000</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="TXID">010555907654500001</ram:ID>');
    expect(xml).toContain('<ram:GrandTotalAmount>82390.00</ram:GrandTotalAmount>');
    expect(xml).toContain('&lt;PX-120&gt; &amp;');
  });

  it('uses T02 "ใบแจ้งหนี้/ใบกำกับภาษี" for a tax invoice — same name as the printed title (B.2, §8.3)', () => {
    const xml = buildETaxXml({ doc, company, buyer, createdAt: '2026-10-24T10:00:00' });
    expect(xml).toContain('<ram:TypeCode>T02</ram:TypeCode>');
    expect(xml).not.toContain('<ram:TypeCode>388</ram:TypeCode>');
    expect(xml).toContain(`<ram:Name>${salesDocTitle(doc)}</ram:Name>`);
    expect(salesDocTitle(doc)).toBe('ใบแจ้งหนี้/ใบกำกับภาษี');
  });

  it('writes TIS 1099 / ETDA codes, not names, for province, district and subdistrict (§8.8–8.10)', () => {
    const picked: Contact = {
      ...buyer,
      address: {
        addressNo: '99',
        subDistrict: 'บางนาใต้',
        district: 'บางนา',
        province: 'กรุงเทพมหานคร',
        postalCode: '10260',
        provinceCode: '10',
        districtCode: '1047',
        subDistrictCode: '104703',
      },
    };
    const xml = buildETaxXml({ doc, company: { ...company, address: { ...company.address, subDistrict: 'ในคลองบางปลากด' } }, buyer: picked });
    const buyerXml = xml.slice(xml.indexOf('<ram:BuyerTradeParty>'));
    expect(buyerXml).toContain('<ram:PostcodeCode>10260</ram:PostcodeCode>');
    expect(buyerXml).toContain('<ram:CityName>1047</ram:CityName>');
    expect(buyerXml).toContain('<ram:CitySubDivisionName>104703</ram:CitySubDivisionName>');
    expect(buyerXml).toContain('<ram:CountrySubDivisionID>10</ram:CountrySubDivisionID>');
    // ที่อยู่บริษัทมีแต่ชื่อ → จับคู่ชื่อ (สมุทรปราการ 11 / พระสมุทรเจดีย์ 1105 / ในคลองบางปลากด)
    const sellerXml = xml.slice(xml.indexOf('<ram:SellerTradeParty>'), xml.indexOf('<ram:BuyerTradeParty>'));
    expect(sellerXml).toContain('<ram:CityName>1105</ram:CityName>');
    expect(sellerXml).toMatch(/<ram:CitySubDivisionName>1105\d\d<\/ram:CitySubDivisionName>/);
    expect(sellerXml).toContain('<ram:CountrySubDivisionID>11</ram:CountrySubDivisionID>');
    expect(xml).not.toContain('<ram:CityName>บางนา</ram:CityName>');
    expect(xml).not.toContain('กรุงเทพมหานคร</ram:CountrySubDivisionID>');
  });

  it('omits address code elements that cannot be resolved (never writes a name)', () => {
    const xml = buildETaxXml({ doc, company, buyer: { ...buyer, address: { province: 'ไม่มีจังหวัดนี้', district: 'x' } } });
    const buyerXml = xml.slice(xml.indexOf('<ram:BuyerTradeParty>'));
    expect(buyerXml).not.toContain('<ram:CityName>');
    expect(buyerXml).not.toContain('<ram:CountrySubDivisionID>');
  });

  const cnBase: SalesDoc = { ...doc, id: 's2', kind: 'credit-note', docNo: 'CN6910-0001', refDocId: 's1', reason: 'คืนสินค้า' };
  const amount = (xml: string, tag: string) => xml.match(new RegExp(`<ram:${tag}>([^<]*)</ram:${tag}>`))?.[1];

  it('references the original invoice on a credit note with the original TypeCode (T02)', () => {
    const xml = buildETaxXml({ doc: cnBase, company, buyer, referenced: doc });
    expect(xml).toContain('<ram:TypeCode>81</ram:TypeCode>');
    expect(xml).toContain('<ram:IssuerAssignedID>IV6910-0043</ram:IssuerAssignedID>');
    expect(xml).toContain('<ram:ReferenceTypeCode>T02</ram:ReferenceTypeCode>');
  });

  it('references a receipt/tax invoice (T03) on a service credit note after full payment', () => {
    const receipt: Receipt = {
      id: 'r1',
      docNo: 'RT6910-0001',
      date: '2026-10-25',
      invoiceId: 's1',
      contactId: buyer.id,
      amount: 107,
      whtAmount: 0,
      depositAccountCode: ACC.bank,
      isTaxInvoice: true,
      vat: 7,
      journalId: 'j',
    };
    const xml = buildETaxXml({ doc: { ...cnBase, saleType: 'service' }, company, buyer, referenced: doc, referencedReceipt: receipt });
    expect(xml).toContain('<ram:IssuerAssignedID>RT6910-0001</ram:IssuerAssignedID>');
    expect(xml).toContain('<ram:ReferenceTypeCode>T03</ram:ReferenceTypeCode>');
  });

  it('credit note R3/R2: LineTotal = correct value, Difference = Original − LineTotal, GrandTotal = Difference + Tax', () => {
    // ใบเดิม 77,000 ลด 1 ชิ้น 38.50 → ถูกต้อง 76,961.50
    const lines = [{ id: 'c', description: 'คืน', qty: 1, unitPrice: 38.5, discount: 0, accountCode: ACC.sales }];
    const cn: SalesDoc = { ...cnBase, lines, originalNet: 77_000, correctNet: 76_961.5 };
    const xml = buildETaxXml({ doc: cn, company, buyer, referenced: doc });
    expect(amount(xml, 'OriginalInformationAmount')).toBe('77000.00');
    expect(amount(xml, 'LineTotalAmount')).toBe('76961.50');
    expect(amount(xml, 'DifferenceInformationAmount')).toBe('38.50');
    expect(amount(xml, 'TaxBasisTotalAmount')).toBe('38.50');
    expect(amount(xml, 'TaxTotalAmount')).toBe('2.70');
    expect(amount(xml, 'GrandTotalAmount')).toBe('41.20');
    const order = ['OriginalInformationAmount', 'LineTotalAmount', 'DifferenceInformationAmount', 'TaxBasisTotalAmount', 'TaxTotalAmount', 'GrandTotalAmount'];
    const positions = order.map((tag) => xml.indexOf(`<ram:${tag}>`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('debit note R3/R2: Difference = |Original − LineTotal| (LineTotal greater than Original)', () => {
    const lines = [{ id: 'd', description: 'เพิ่มราคา', qty: 1, unitPrice: 1_000, discount: 0, accountCode: ACC.sales }];
    const dn: SalesDoc = { ...cnBase, kind: 'debit-note', docNo: 'DN6910-0001', lines, originalNet: 77_000, correctNet: 78_000 };
    const xml = buildETaxXml({ doc: dn, company, buyer, referenced: doc });
    expect(xml).toContain('<ram:TypeCode>80</ram:TypeCode>');
    expect(amount(xml, 'LineTotalAmount')).toBe('78000.00');
    expect(amount(xml, 'DifferenceInformationAmount')).toBe('1000.00');
    expect(amount(xml, 'GrandTotalAmount')).toBe('1070.00');
  });

  it('legacy adjustment without correctNet derives LineTotal = Original ∓ difference', () => {
    const lines = [{ id: 'c', description: 'คืน', qty: 2, unitPrice: 100, discount: 0, accountCode: ACC.sales }];
    const cnXml = buildETaxXml({ doc: { ...cnBase, lines, originalNet: 1_000 }, company, buyer, referenced: doc });
    expect(amount(cnXml, 'LineTotalAmount')).toBe('800.00');
    expect(amount(cnXml, 'DifferenceInformationAmount')).toBe('200.00');
    const dnXml = buildETaxXml({ doc: { ...cnBase, kind: 'debit-note', lines, originalNet: 1_000 }, company, buyer, referenced: doc });
    expect(amount(dnXml, 'LineTotalAmount')).toBe('1200.00');
    expect(amount(dnXml, 'GrandTotalAmount')).toBe('214.00');
  });

  it('writes the selected ETDA purpose code with its label, and free text for "other" (…99)', () => {
    const coded = buildETaxXml({ doc: { ...cnBase, reasonCode: 'CDNG02', reason: '' }, company, buyer, referenced: doc });
    expect(coded).toContain('<ram:Purpose>สินค้าชำรุดเสียหาย</ram:Purpose><ram:PurposeCode>CDNG02</ram:PurposeCode>');
    const other = buildETaxXml({ doc: cnBase, company, buyer, referenced: doc });
    expect(other).toContain('<ram:Purpose>คืนสินค้า</ram:Purpose><ram:PurposeCode>CDNG99</ram:PurposeCode>');
    const service = buildETaxXml({ doc: { ...cnBase, saleType: 'service', reasonCode: 'CDNS04' }, company, buyer, referenced: doc });
    expect(service).toContain('<ram:PurposeCode>CDNS04</ram:PurposeCode>');
    const dn = buildETaxXml({ doc: { ...cnBase, kind: 'debit-note', reason: 'ค่าขนส่ง' }, company, buyer, referenced: doc });
    expect(dn).toContain('<ram:PurposeCode>DBNG99</ram:PurposeCode>');
  });

  it('receipt/tax invoice keeps T03 and references the invoice with 380', () => {
    const receipt: Receipt = {
      id: 'r1',
      docNo: 'RT6910-0001',
      date: '2026-10-25',
      invoiceId: 's1',
      contactId: buyer.id,
      amount: 107,
      whtAmount: 0,
      depositAccountCode: ACC.bank,
      isTaxInvoice: true,
      vat: 7,
      journalId: 'j',
    };
    const xml = buildReceiptETaxXml({ receipt, invoice: { ...doc, saleType: 'service' }, company, buyer });
    expect(xml).toContain('<ram:TypeCode>T03</ram:TypeCode>');
    expect(xml).toContain('<ram:ReferenceTypeCode>380</ram:ReferenceTypeCode>');
  });

  it('lists missing buyer data', () => {
    expect(eTaxReadiness(company, { ...buyer, taxId: '' })).toContain('ลูกค้ายังไม่มีเลขผู้เสียภาษี');
  });

  it('warns when company or buyer address cannot be resolved to province/district/subdistrict codes', () => {
    const complete = { addressNo: '1', subDistrict: 'บางนาใต้', district: 'บางนา', province: 'กรุงเทพมหานคร' };
    const ok = { ...company, address: { ...company.address, subDistrict: 'ในคลองบางปลากด' } };
    expect(eTaxReadiness(ok, { ...buyer, address: complete })).toEqual([]);
    expect(eTaxReadiness(company, { ...buyer, address: complete }).join()).toContain('ที่อยู่บริษัทยังไม่มีรหัสจังหวัด/อำเภอ/ตำบล');
    expect(eTaxReadiness(ok, buyer).join()).toContain('ที่อยู่ลูกค้ายังไม่มีรหัสจังหวัด/อำเภอ/ตำบล');
    expect(eTaxReadiness(ok, { ...buyer, address: {} })).toContain('ที่อยู่ลูกค้ายังไม่ครบ (จังหวัด)');
    // เอกสารที่ออกแล้ว: ตรวจที่อยู่ใน snapshot แทนที่อยู่ปัจจุบัน
    expect(eTaxReadiness(ok, buyer, complete)).toEqual([]);
  });
});

describe('CSV import', () => {
  it('maps Thai headers, detects juristic persons and flags bad tax ids', () => {
    const csv =
      '\uFEFFรหัส,ชื่อ,เลขผู้เสียภาษี,สาขา,จังหวัด,ประเภท\r\n' +
      'C01,"บริษัท เอ, บี จำกัด",0105565012341,0,กรุงเทพมหานคร,ลูกค้า\r\n' +
      'V01,สมชาย ใจดี,1234567890123,,นนทบุรี,ผู้ขาย\r\n';
    const result = importContactsCsv(csv);
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0].name).toBe('บริษัท เอ, บี จำกัด');
    expect(result.contacts[0].legalForm).toBe('juristic');
    expect(result.contacts[0].branchNo).toBe('00000');
    expect(result.contacts[1].kind).toBe('vendor');
    expect(result.contacts[1].legalForm).toBe('individual');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    // ชื่อมีคำนำหน้าอยู่แล้ว ไม่เติม "บริษัท" ซ้ำ
    expect(result.contacts[0].title).toBe('');
  });

  it('defaultContactTitle adds "บริษัท" only to juristic names without a prefix', () => {
    expect(defaultContactTitle('เอบีซี จำกัด', 'juristic')).toBe('บริษัท');
    ['ร้านสมใจ', 'หจก. รุ่งเรือง', 'ห้างหุ้นส่วนจำกัด ทองดี', 'บริษัท เอ จำกัด', 'บจก.ซี', 'นายสมชาย', 'มูลนิธิ ก'].forEach((n) =>
      expect(defaultContactTitle(n, 'juristic')).toBe('')
    );
    expect(defaultContactTitle('สมชาย', 'individual')).toBe('');
  });
});
