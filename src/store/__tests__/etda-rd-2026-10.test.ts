import { ACC, buildETaxXml, buildRdWhtFile, whtPayeesForPeriod } from 'src/domain';

import { cmd } from '../commands';
import { ln, demo, TODAY } from './fixtures';
import { saveContact, updateCompany, importContacts, issueDebitNote, receivePayment, issueCreditNote, issueTaxInvoice } from '../actions';

// ----------------------------------------------------------------------
// ETDA/RD ต.ค. 2569 (docs/research-etda-rd-2026-10.md): รหัสเหตุผล B.3, รหัสที่อยู่ TIS 1099, BRANCH_TYPE S
// ----------------------------------------------------------------------

function invoiceOf(saleType?: 'service') {
  const issued = issueTaxInvoice(demo(), {
    date: TODAY,
    dueDate: TODAY,
    contactId: 'c-nakhon',
    vatMode: 'exclusive',
    ...(saleType ? { saleType } : {}),
    lines: [ln(1, 1000)],
  });
  return { state: issued.state, invoice: issued.doc };
}

describe('credit / debit note reason codes (ETDA B.3)', () => {
  it('accepts a specific code without free text and stores it; XML uses the code and its label', () => {
    const { state, invoice } = invoiceOf();
    const cn = issueCreditNote(state, { invoiceId: invoice.id, date: TODAY, reason: '', reasonCode: 'CDNG02', lines: [ln(1, 100)] });
    expect(cn.doc.reasonCode).toBe('CDNG02');
    const xml = buildETaxXml({ doc: cn.doc, company: cn.state.company, referenced: invoice });
    expect(xml).toContain('<ram:Purpose>สินค้าชำรุดเสียหาย</ram:Purpose><ram:PurposeCode>CDNG02</ram:PurposeCode>');
    const dn = issueDebitNote(cn.state, { invoiceId: invoice.id, date: TODAY, reason: '', reasonCode: 'DBNG02', lines: [ln(1, 50)] });
    expect(dn.doc.reasonCode).toBe('DBNG02');
  });

  it('rejects a code of another kind or sale type, and "other" without text', () => {
    const { state, invoice } = invoiceOf();
    const input = { invoiceId: invoice.id, date: TODAY, lines: [ln(1, 100)] };
    expect(() => issueCreditNote(state, { ...input, reason: 'x', reasonCode: 'CDNS01' })).toThrow(
      'รหัสเหตุผล CDNS01 ใช้กับใบลดหนี้ขายสินค้าไม่ได้'
    );
    expect(() => issueCreditNote(state, { ...input, reason: 'x', reasonCode: 'DBNG01' })).toThrow('รหัสเหตุผล DBNG01');
    expect(() => issueDebitNote(state, { ...input, reason: 'x', reasonCode: 'CDNG01' })).toThrow('ใช้กับใบเพิ่มหนี้ขายสินค้าไม่ได้');
    expect(() => issueCreditNote(state, { ...input, reason: '  ', reasonCode: 'CDNG99' })).toThrow('ใบลดหนี้ต้องระบุเหตุผล');
    expect(() => issueCreditNote(state, { ...input, reason: '' })).toThrow('ใบลดหนี้ต้องระบุเหตุผล');
    expect(() => issueDebitNote(state, { ...input, reason: '' })).toThrow('ใบเพิ่มหนี้ต้องระบุเหตุผล');
    // ไม่ระบุรหัส = เหตุอื่นตามเดิม ไม่เก็บ reasonCode
    expect(issueCreditNote(state, { ...input, reason: 'ลดราคา' }).doc.reasonCode).toBeUndefined();
  });

  it('service invoices use the CDNS family', () => {
    const { state, invoice } = invoiceOf('service');
    const paid = receivePayment(state, { invoiceId: invoice.id, date: TODAY, amount: 1070, whtAmount: 0, depositAccountCode: ACC.bank });
    expect(() =>
      issueCreditNote(paid.state, { invoiceId: invoice.id, date: TODAY, reason: '', reasonCode: 'CDNG01', lines: [ln(1, 100, ACC.service)] })
    ).toThrow('ใช้กับใบลดหนี้งานบริการไม่ได้');
    const cn = issueCreditNote(paid.state, {
      invoiceId: invoice.id,
      date: TODAY,
      reason: '',
      reasonCode: 'CDNS04',
      lines: [ln(1, 100, ACC.service)],
    });
    expect(cn.doc.reasonCode).toBe('CDNS04');
  });

  it('sends reasonCode to the API', () => {
    const c = cmd.issueCreditNote({ invoiceId: 'i', date: TODAY, reason: '', reasonCode: 'CDNG03', lines: [ln(1, 1)] });
    expect(c.fingerprint).toContain('CDNG03');
  });
});

describe('address codes on contacts and company (TIS 1099)', () => {
  const base = demo().contacts[0];

  it('fills codes from names on save and keeps picked codes', () => {
    const named = saveContact(demo(), {
      ...base,
      id: undefined,
      code: 'C9001',
      address: { addressNo: '5', subDistrict: 'ต.บางเสาธง', district: 'อ.บางเสาธง', province: 'จ.สมุทรปราการ', postalCode: '10570' },
    });
    expect(named.contact.address).toMatchObject({ provinceCode: '11', districtCode: '1106', subDistrictCode: '110601', province: 'จ.สมุทรปราการ' });
    const picked = saveContact(demo(), {
      ...base,
      address: { province: 'กรุงเทพมหานคร', district: 'บางนา', subDistrict: 'บางนาใต้', provinceCode: '10', districtCode: '1047', subDistrictCode: '104703' },
    });
    expect(picked.contact.address.subDistrictCode).toBe('104703');
  });

  it('rejects codes that do not exist or do not nest', () => {
    expect(() => saveContact(demo(), { ...base, address: { subDistrictCode: '999999' } })).toThrow(
      'รหัสจังหวัด/อำเภอ/ตำบลในที่อยู่ไม่ถูกต้อง'
    );
    expect(() => saveContact(demo(), { ...base, address: { provinceCode: '10', districtCode: '1201' } })).toThrow('ไม่ถูกต้อง');
    expect(() => updateCompany(demo(), { ...demo().company, address: { provinceCode: '00' } })).toThrow('ไม่ถูกต้อง');
  });

  it('company update and CSV import fill codes too', () => {
    const next = updateCompany(demo(), { ...demo().company, address: { province: 'เชียงใหม่', district: 'เมืองเชียงใหม่' } });
    expect(next.company.address).toEqual({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', provinceCode: '50', districtCode: '5001' });
    const imported = importContacts(demo(), [{ ...base, code: 'C9002', address: { province: 'ระยอง', provinceCode: 'xx' } }]);
    expect(imported.state.contacts.find((c) => c.code === 'C9002')?.address).toEqual({ province: 'ระยอง', provinceCode: '21' });
  });

  it('sends sbtRegistered with the company to the API (BRANCH_TYPE S)', () => {
    const c = cmd.updateCompany({ ...demo().company, vatRegistered: false, sbtRegistered: true });
    expect(c.fingerprint).toContain('"sbtRegistered":true');
    const state = updateCompany(demo(), { ...demo().company, vatRegistered: false, sbtRegistered: true });
    const payees = whtPayeesForPeriod(state, { year: 2026, month: 10 }, 'PND53');
    const header = buildRdWhtFile({ form: 'PND53', company: state.company, period: { year: 2026, month: 10 }, payees }).content.split('|');
    expect(header[15]).toBe('S');
  });
});
