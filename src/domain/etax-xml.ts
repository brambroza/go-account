import { lineAmount, calcDocument } from './document-calc';
import { resolveParty, partyDisplayName } from './snapshot';
import { normalizeTaxId, normalizeBranch5 } from './thai-tax-id';
import { subBaht, toSatang, fromSatang, formatPlain } from './money';
import { salesSign, isTaxDocument, TAX_INVOICE_TITLE } from './sales-doc';
import { resolveAddressCodes, hasCompleteAddressCodes } from './thai-address';
import { effectiveReasonCode, adjustmentPurposeText } from './adjustment-reason';

import type { Address, Company, Contact, Receipt, SalesDoc, PartySnapshot, CompanySnapshot } from './types';

// ----------------------------------------------------------------------
// สร้าง XML ใบกำกับภาษีอิเล็กทรอนิกส์ตามโครงสร้าง ETDA ขมธอ. 3-2560
// (TaxInvoice_CrossIndustryInvoice ซึ่งอิง UN/CEFACT CII)
//
// ⚠️ ไฟล์ที่ได้จากฟังก์ชันนี้ "ยังไม่ได้ลงลายมือชื่อดิจิทัล"
// การลงลายมือชื่อ (XAdES) ต้องทำฝั่ง backend ด้วยใบรับรอง CA ของลูกค้าที่เก็บใน KMS/HSM
// และต้องตรวจกับ XML Schema + ตัวตรวจสอบของ ETDA/กรมสรรพากรก่อนใช้งานจริง
// ----------------------------------------------------------------------

const NS_RSM = 'urn:etda:uncefact:data:standard:TaxInvoice_CrossIndustryInvoice:2';
const NS_RAM =
  'urn:etda:uncefact:data:standard:TaxInvoice_ReusableAggregateBusinessInformationEntity:2';

/**
 * รหัสประเภทเอกสาร ETDA (ขมธอ.3-2560 ภาคผนวก B.2): T02 ใบแจ้งหนี้/ใบกำกับภาษี, 81 ใบลดหนี้, 80 ใบเพิ่มหนี้
 *
 * การเลือก (ต.ค. 2569): เอกสารขาย `tax-invoice` ของบริษัทจด VAT เป็นทั้งใบแจ้งหนี้และใบกำกับภาษี (ยอดค้างรับชำระภายหลัง)
 * จึงใช้ T02 และพิมพ์ชื่อ "ใบแจ้งหนี้/ใบกำกับภาษี" ตรงกับ `Name` ใน XML (§8.3 ชื่อเอกสารต้องตรงกับ TypeCode)
 * — ไม่ใช้ 388 (ใบกำกับภาษีอย่างเดียว) เพราะระบบไม่มีเอกสารที่พิมพ์ชื่อ "ใบกำกับภาษี" อย่างเดียว
 * ใบลด/เพิ่มหนี้อ้างเอกสารเดิมด้วยรหัสของเอกสารนั้น (T02 หรือ T03 ใบเสร็จรับเงิน/ใบกำกับภาษี) ใน AdditionalReferencedDocument
 */
export const ETAX_TYPE_CODE = {
  'tax-invoice': 'T02',
  'credit-note': '81',
  'debit-note': '80',
} as const;

/** ชื่อเอกสารใน XML (`ExchangedDocument/Name`) — ใบกำกับใช้ชื่อเดียวกับหัวกระดาษ (`salesDocTitle`) */
export const ETAX_TYPE_NAME = {
  'tax-invoice': TAX_INVOICE_TITLE,
  'credit-note': 'ใบลดหนี้',
  'debit-note': 'ใบเพิ่มหนี้',
} as const;

/**
 * ใบเสร็จรับเงิน/ใบกำกับภาษี (งานบริการ ม.78/1) = T03 ตามตารางรหัสประเภทเอกสาร ETDA
 * ⚠️ ยืนยันรหัส T03 และโครงสร้างที่ต้องมี (เช่น การอ้างใบแจ้งหนี้) กับ ขมธอ.3-2560 ฉบับล่าสุดก่อนใช้งานจริง
 */
export const ETAX_RECEIPT_TYPE_CODE = 'T03';

/**
 * รหัสอ้างอิงใบแจ้งหนี้ใน AdditionalReferencedDocument ของใบเสร็จรับเงิน/ใบกำกับภาษี (UN/CEFACT 1001: 380 = Commercial invoice)
 * ⚠️ ยังไม่ได้ยืนยันกับ ETDA ว่าใช้ 380 หรือรหัสอื่นสำหรับใบแจ้งหนี้ที่ไม่ใช่ใบกำกับภาษี
 */
export const ETAX_INVOICE_REF_CODE = '380';

/**
 * รหัสเหตุผลของใบลด/เพิ่มหนี้ (ภาคผนวก B.3): รหัสที่เลือก (`reasonCode`) หรือ "เหตุอื่น" ตามประเภทการขาย
 * (สินค้า CDNG99 / DBNG99, บริการ CDNS99 / DBNS99 — U11) — ดู `adjustment-reason.ts`
 */
export function eTaxPurposeCode(doc: {
  kind: 'credit-note' | 'debit-note';
  saleType?: 'goods' | 'service';
  reasonCode?: string;
}): string {
  return effectiveReasonCode(doc.kind, doc.saleType, doc.reasonCode);
}

export function escapeXml(value: string | number | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function el(tag: string, value: string | number | undefined, attrs = ''): string {
  if (value === undefined || value === '') return '';
  return `<ram:${tag}${attrs ? ` ${attrs}` : ''}>${escapeXml(value)}</ram:${tag}>`;
}

/**
 * ที่อยู่ (§8.8–8.10): CityName = รหัสอำเภอ/เขต 4 หลัก, CitySubDivisionName = รหัสตำบล/แขวง 6 หลัก (TIS 1099),
 * CountrySubDivisionID = รหัสจังหวัด 2 หลัก (code list ETDA ThaiISOCountrySubdivisionCode) — จาก `resolveAddressCodes`
 * (รหัสที่เลือกไว้ หรือจับคู่ชื่อ) หาไม่ได้ = ไม่เขียน element นั้น (`eTaxReadiness` เตือนก่อนออก)
 */
function addressXml(a: Address): string {
  const line1 = [a.buildingName, a.roomNo, a.floorNo, a.village].filter(Boolean).join(' ');
  const codes = resolveAddressCodes(a);
  return [
    '<ram:PostalTradeAddress>',
    el('PostcodeCode', a.postalCode),
    el('LineOne', line1 || undefined),
    el('StreetName', a.street),
    el('CityName', codes.districtCode),
    el('CitySubDivisionName', codes.subDistrictCode),
    el('CountryID', 'TH', 'schemeID="3166-1 alpha-2"'),
    el('CountrySubDivisionID', codes.provinceCode),
    el('BuildingNumber', a.addressNo),
    '</ram:PostalTradeAddress>',
  ].join('');
}

/** TXID = เลขผู้เสียภาษี 13 หลัก + สาขา 5 หลัก */
function partyXml(
  tag: 'SellerTradeParty' | 'BuyerTradeParty',
  name: string,
  taxId: string,
  branch: string,
  address: Address,
  email?: string
): string {
  const txid = `${normalizeTaxId(taxId)}${normalizeBranch5(branch)}`;
  return [
    `<ram:${tag}>`,
    el('Name', name),
    '<ram:SpecifiedTaxRegistration>',
    el('ID', txid, 'schemeID="TXID"'),
    '</ram:SpecifiedTaxRegistration>',
    email ? `<ram:DefinedTradeContact><ram:EmailURIUniversalCommunication>${el('URIID', email)}</ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>` : '',
    addressXml(address),
    `</ram:${tag}>`,
  ].join('');
}

export type ETaxXmlInput = {
  doc: SalesDoc;
  /** ใช้เมื่อเอกสารไม่มี snapshot ผู้ขาย (`doc.seller`) */
  company: Company;
  /** ใช้เมื่อเอกสารไม่มี snapshot ผู้ซื้อ (`doc.buyer`) */
  buyer?: Contact;
  /** ใบลดหนี้/ใบเพิ่มหนี้: ใบกำกับเดิม */
  referenced?: SalesDoc;
  /** ใบลดหนี้ของงานบริการ (หลังรับเงินครบ): ใบเสร็จรับเงิน/ใบกำกับภาษีที่อ้างถึง (แทนใบแจ้งหนี้) */
  referencedReceipt?: Receipt;
  /** เวลาสร้างไฟล์ (ISO) */
  createdAt?: string;
};

/**
 * สร้าง XML ของเอกสาร — ผู้ขาย/ผู้ซื้ออ่านจาก snapshot ณ วันออกเอกสาร
 * throw ถ้าไม่ใช่เอกสารภาษี (บริษัทไม่จด VAT) หรือไม่มีข้อมูลผู้ซื้อ
 */
export function buildETaxXml({ doc, company, buyer, referenced, referencedReceipt, createdAt }: ETaxXmlInput): string {
  if (!isTaxDocument(doc)) throw new Error(`${doc.docNo} ไม่ใช่ใบกำกับภาษี — ไม่ต้องออก e-Tax`);
  const party = resolveParty(doc.buyer, buyer);
  if (!party) throw new Error(`${doc.docNo} ไม่มีข้อมูลผู้ซื้อ`);
  const seller = doc.seller ?? company;
  const t = calcDocument(doc);
  const buyerName = partyDisplayName(party);
  const rate = doc.vatMode === 'none' ? 0 : doc.vatRate;

  const lineItems = doc.lines
    .map((line, index) => {
      const amount = lineAmount(line);
      return [
        '<ram:IncludedSupplyChainTradeLineItem>',
        `<ram:AssociatedDocumentLineDocument>${el('LineID', index + 1)}</ram:AssociatedDocumentLineDocument>`,
        `<ram:SpecifiedTradeProduct>${el('Name', line.description)}</ram:SpecifiedTradeProduct>`,
        '<ram:SpecifiedLineTradeAgreement>',
        `<ram:GrossPriceProductTradePrice>${el('ChargeAmount', formatPlain(line.unitPrice))}</ram:GrossPriceProductTradePrice>`,
        '</ram:SpecifiedLineTradeAgreement>',
        `<ram:SpecifiedLineTradeDelivery>${el('BilledQuantity', line.qty, 'unitCode="C62"')}</ram:SpecifiedLineTradeDelivery>`,
        '<ram:SpecifiedLineTradeSettlement>',
        `<ram:ApplicableTradeTax>${el('TypeCode', 'VAT')}${el('CalculatedRate', formatPlain(rate))}</ram:ApplicableTradeTax>`,
        line.discount
          ? `<ram:SpecifiedTradeAllowanceCharge>${el('ChargeIndicator', 'false')}${el('ActualAmount', formatPlain(line.discount))}</ram:SpecifiedTradeAllowanceCharge>`
          : '',
        `<ram:SpecifiedTradeSettlementLineMonetarySummation>${el('NetLineTotalAmount', formatPlain(amount))}</ram:SpecifiedTradeSettlementLineMonetarySummation>`,
        '</ram:SpecifiedLineTradeSettlement>',
        '</ram:IncludedSupplyChainTradeLineItem>',
      ].join('');
    })
    .join('');

  const adjustment = doc.kind === 'credit-note' || doc.kind === 'debit-note' ? doc.kind : null;
  const ref = referencedReceipt
    ? { docNo: referencedReceipt.docNo, date: referencedReceipt.date, code: ETAX_RECEIPT_TYPE_CODE }
    : referenced && { docNo: referenced.docNo, date: referenced.date, code: ETAX_TYPE_CODE[referenced.kind] };
  const referencedXml = adjustment && ref ? referencedDocXml(ref) : '';

  const saleType = doc.saleType ?? referenced?.saleType;
  const purposeXml = adjustment
    ? `${el('Purpose', adjustmentPurposeText({ ...doc, kind: adjustment, saleType }) || ETAX_TYPE_NAME[adjustment])}${el(
        'PurposeCode',
        eTaxPurposeCode({ kind: adjustment, saleType, reasonCode: doc.reasonCode })
      )}`
    : '';

  const summary = adjustment ? adjustmentSummary(doc, t) : null;
  const originalXml = summary ? el('OriginalInformationAmount', formatPlain(summary.original)) : '';
  const differenceXml = summary ? el('DifferenceInformationAmount', formatPlain(summary.difference)) : '';

  const sellerAddressName = seller.name;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rsm:TaxInvoice_CrossIndustryInvoice xmlns:rsm="${NS_RSM}" xmlns:ram="${NS_RAM}">`,
    '<rsm:ExchangedDocumentContext>',
    '<ram:GuidelineSpecifiedDocumentContextParameter>',
    el('ID', 'ER3-2560', 'schemeAgencyID="ETDA" schemeVersionID="v2.0"'),
    '</ram:GuidelineSpecifiedDocumentContextParameter>',
    '</rsm:ExchangedDocumentContext>',
    '<rsm:ExchangedDocument>',
    el('ID', doc.docNo),
    el('Name', ETAX_TYPE_NAME[doc.kind]),
    el('TypeCode', ETAX_TYPE_CODE[doc.kind]),
    el('IssueDateTime', `${doc.date}T00:00:00`),
    purposeXml,
    el('CreationDateTime', createdAt ?? new Date().toISOString().slice(0, 19)),
    '</rsm:ExchangedDocument>',
    '<rsm:SupplyChainTradeTransaction>',
    '<ram:ApplicableHeaderTradeAgreement>',
    partyXml(
      'SellerTradeParty',
      sellerAddressName,
      seller.taxId,
      seller.branchNo,
      seller.address,
      seller.email
    ),
    partyXml('BuyerTradeParty', buyerName, party.taxId, party.branchNo, party.address, party.email),
    referencedXml,
    '</ram:ApplicableHeaderTradeAgreement>',
    '<ram:ApplicableHeaderTradeDelivery/>',
    '<ram:ApplicableHeaderTradeSettlement>',
    el('InvoiceCurrencyCode', 'THB', 'listID="ISO 4217 3A"'),
    '<ram:ApplicableTradeTax>',
    el('TypeCode', 'VAT'),
    el('CalculatedRate', formatPlain(rate)),
    el('BasisAmount', formatPlain(t.net)),
    el('CalculatedAmount', formatPlain(t.vat)),
    '</ram:ApplicableTradeTax>',
    `<ram:SpecifiedTradePaymentTerms>${el('DueDateDateTime', `${doc.dueDate}T00:00:00`)}</ram:SpecifiedTradePaymentTerms>`,
    '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    originalXml,
    el('LineTotalAmount', formatPlain(summary ? summary.lineTotal : t.gross)),
    differenceXml,
    el('TaxBasisTotalAmount', formatPlain(t.net)),
    el('TaxTotalAmount', formatPlain(t.vat)),
    el('GrandTotalAmount', formatPlain(summary ? summary.grandTotal : t.total)),
    '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '</ram:ApplicableHeaderTradeSettlement>',
    lineItems,
    '</rsm:SupplyChainTradeTransaction>',
    '</rsm:TaxInvoice_CrossIndustryInvoice>',
  ].join('\n');
}

/**
 * ยอดสรุปของใบลด/เพิ่มหนี้ตาม ขมธอ.3-2560 §7 (กฎข้อมูลของใบเพิ่มหนี้/ใบลดหนี้) และไฟล์ตัวอย่าง ETDA:
 * - OriginalInformationAmount = มูลค่าตามใบกำกับเดิม (ก่อน VAT, หลังลด/เพิ่มหนี้ครั้งก่อน) — `doc.originalNet`
 * - LineTotalAmount = มูลค่าที่ถูกต้องหลังเอกสารนี้ — `doc.correctNet` (ข้อมูลเก่าไม่มี = เดิม ∓ ผลต่าง)
 * - R3 DifferenceInformationAmount = |Original − LineTotal| (ผลต่าง = มูลค่าของเอกสารนี้)
 * - R2 GrandTotalAmount = DifferenceInformationAmount + TaxTotalAmount
 * TaxBasisTotalAmount / ApplicableTradeTax.BasisAmount = ฐานภาษีของผลต่าง (`calcDocument(doc).net`)
 * ⚠️ R1 (LineTotalAmount = ผลรวม BasisAmount) ขัดกับ R3 เมื่อ BasisAmount เป็นฐานของผลต่าง — ใช้ R2/R3 + ตัวอย่าง ETDA (LineTotal = มูลค่าที่ถูกต้อง)
 * ตรวจกับ XSD/Schematron ของ RD ก่อนใช้งานจริง
 */
export function adjustmentSummary(
  doc: Pick<SalesDoc, 'kind' | 'originalNet' | 'correctNet'>,
  totals: Pick<ReturnType<typeof calcDocument>, 'net' | 'vat'>
): { original: number; lineTotal: number; difference: number; grandTotal: number } {
  const original = doc.originalNet ?? 0;
  const lineTotal = doc.correctNet ?? fromSatang(toSatang(original) + salesSign(doc) * toSatang(totals.net));
  const difference = fromSatang(Math.abs(toSatang(original) - toSatang(lineTotal)));
  return { original, lineTotal, difference, grandTotal: fromSatang(toSatang(difference) + toSatang(totals.vat)) };
}

function referencedDocXml(ref: { docNo: string; date: string; code: string }): string {
  return [
    '<ram:AdditionalReferencedDocument>',
    el('IssuerAssignedID', ref.docNo),
    el('IssueDateTime', `${ref.date}T00:00:00`),
    el('ReferenceTypeCode', ref.code),
    '</ram:AdditionalReferencedDocument>',
  ].join('');
}

export type ReceiptETaxXmlInput = {
  receipt: Receipt;
  /** ใบแจ้งหนี้งานบริการที่รับชำระ */
  invoice: SalesDoc;
  company: Company;
  buyer?: Contact;
  createdAt?: string;
};

/**
 * XML ใบเสร็จรับเงิน/ใบกำกับภาษี (T03) ของการรับเงินงานบริการ 1 ครั้ง — มูลค่า = ส่วนที่รับครั้งนี้
 * (ก่อน VAT = ยอดรับ − VAT ของการรับครั้งนี้) 1 บรรทัดอ้างใบแจ้งหนี้ และอ้างใบแจ้งหนี้ใน AdditionalReferencedDocument
 * ⚠️ ไฟล์ยังไม่ลงลายมือชื่อ และต้องตรวจกับ XSD ของ ETDA ก่อนใช้งานจริง (ดู `ETAX_RECEIPT_TYPE_CODE`)
 */
export function buildReceiptETaxXml({ receipt, invoice, company, buyer, createdAt }: ReceiptETaxXmlInput): string {
  if (!receipt.isTaxInvoice) throw new Error(`${receipt.docNo} ไม่ใช่ใบเสร็จรับเงิน/ใบกำกับภาษี — ไม่ต้องออก e-Tax`);
  const party: PartySnapshot | undefined = resolveParty(receipt.buyer, buyer);
  if (!party) throw new Error(`${receipt.docNo} ไม่มีข้อมูลผู้ซื้อ`);
  const seller: CompanySnapshot | Company = receipt.seller ?? company;
  const vat = receipt.vat ?? 0;
  const net = subBaht(receipt.amount, vat);
  const rate = invoice.vatRate;
  const line = [
    '<ram:IncludedSupplyChainTradeLineItem>',
    `<ram:AssociatedDocumentLineDocument>${el('LineID', 1)}</ram:AssociatedDocumentLineDocument>`,
    `<ram:SpecifiedTradeProduct>${el('Name', `รับชำระค่าบริการตามใบแจ้งหนี้ ${invoice.docNo}`)}</ram:SpecifiedTradeProduct>`,
    '<ram:SpecifiedLineTradeAgreement>',
    `<ram:GrossPriceProductTradePrice>${el('ChargeAmount', formatPlain(net))}</ram:GrossPriceProductTradePrice>`,
    '</ram:SpecifiedLineTradeAgreement>',
    `<ram:SpecifiedLineTradeDelivery>${el('BilledQuantity', 1, 'unitCode="C62"')}</ram:SpecifiedLineTradeDelivery>`,
    '<ram:SpecifiedLineTradeSettlement>',
    `<ram:ApplicableTradeTax>${el('TypeCode', 'VAT')}${el('CalculatedRate', formatPlain(rate))}</ram:ApplicableTradeTax>`,
    `<ram:SpecifiedTradeSettlementLineMonetarySummation>${el('NetLineTotalAmount', formatPlain(net))}</ram:SpecifiedTradeSettlementLineMonetarySummation>`,
    '</ram:SpecifiedLineTradeSettlement>',
    '</ram:IncludedSupplyChainTradeLineItem>',
  ].join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rsm:TaxInvoice_CrossIndustryInvoice xmlns:rsm="${NS_RSM}" xmlns:ram="${NS_RAM}">`,
    '<rsm:ExchangedDocumentContext>',
    '<ram:GuidelineSpecifiedDocumentContextParameter>',
    el('ID', 'ER3-2560', 'schemeAgencyID="ETDA" schemeVersionID="v2.0"'),
    '</ram:GuidelineSpecifiedDocumentContextParameter>',
    '</rsm:ExchangedDocumentContext>',
    '<rsm:ExchangedDocument>',
    el('ID', receipt.docNo),
    el('Name', 'ใบเสร็จรับเงิน/ใบกำกับภาษี'),
    el('TypeCode', ETAX_RECEIPT_TYPE_CODE),
    el('IssueDateTime', `${receipt.date}T00:00:00`),
    el('CreationDateTime', createdAt ?? new Date().toISOString().slice(0, 19)),
    '</rsm:ExchangedDocument>',
    '<rsm:SupplyChainTradeTransaction>',
    '<ram:ApplicableHeaderTradeAgreement>',
    partyXml('SellerTradeParty', seller.name, seller.taxId, seller.branchNo, seller.address, seller.email),
    partyXml('BuyerTradeParty', partyDisplayName(party), party.taxId, party.branchNo, party.address, party.email),
    referencedDocXml({ docNo: invoice.docNo, date: invoice.date, code: ETAX_INVOICE_REF_CODE }),
    '</ram:ApplicableHeaderTradeAgreement>',
    '<ram:ApplicableHeaderTradeDelivery/>',
    '<ram:ApplicableHeaderTradeSettlement>',
    el('InvoiceCurrencyCode', 'THB', 'listID="ISO 4217 3A"'),
    '<ram:ApplicableTradeTax>',
    el('TypeCode', 'VAT'),
    el('CalculatedRate', formatPlain(rate)),
    el('BasisAmount', formatPlain(net)),
    el('CalculatedAmount', formatPlain(vat)),
    '</ram:ApplicableTradeTax>',
    '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    el('LineTotalAmount', formatPlain(net)),
    el('TaxBasisTotalAmount', formatPlain(net)),
    el('TaxTotalAmount', formatPlain(vat)),
    el('GrandTotalAmount', formatPlain(receipt.amount)),
    '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '</ram:ApplicableHeaderTradeSettlement>',
    line,
    '</rsm:SupplyChainTradeTransaction>',
    '</rsm:TaxInvoice_CrossIndustryInvoice>',
  ].join('\n');
}

/**
 * ตรวจข้อมูลขั้นต่ำก่อนออก e-Tax: ผู้ซื้อต้องมีเลขผู้เสียภาษี และที่อยู่บริษัท/ลูกค้าต้องได้รหัสจังหวัด/อำเภอ/ตำบลครบ
 * (XML ใช้รหัส TIS 1099 — ที่อยู่เก่าที่จับคู่ชื่อไม่ได้ต้องเลือกจากรายการใหม่)
 * `buyerAddress` = ที่อยู่ใน snapshot ของเอกสารที่ออกแล้ว (ไม่ส่ง = ที่อยู่ปัจจุบันของลูกค้า)
 */
export function eTaxReadiness(
  company: Pick<Company, 'vatRegistered' | 'address'>,
  buyer: Pick<Contact, 'taxId' | 'address'> | undefined,
  buyerAddress?: Address
): string[] {
  const problems: string[] = [];
  if (!company.vatRegistered) problems.push('บริษัทยังไม่ได้ตั้งค่าเป็นผู้จดทะเบียน VAT');
  if (!hasCompleteAddressCodes(company.address)) {
    problems.push('ที่อยู่บริษัทยังไม่มีรหัสจังหวัด/อำเภอ/ตำบล — เลือกที่อยู่จากรายการในตั้งค่าบริษัท');
  }
  if (!buyer) problems.push('ไม่พบข้อมูลลูกค้า');
  if (buyer && !normalizeTaxId(buyer.taxId)) problems.push('ลูกค้ายังไม่มีเลขผู้เสียภาษี');
  const address = buyerAddress ?? buyer?.address;
  if (buyer && !address?.province) problems.push('ที่อยู่ลูกค้ายังไม่ครบ (จังหวัด)');
  else if (buyer && !hasCompleteAddressCodes(address)) {
    problems.push('ที่อยู่ลูกค้ายังไม่มีรหัสจังหวัด/อำเภอ/ตำบล — แก้ผู้ติดต่อแล้วเลือกที่อยู่จากรายการ');
  }
  return problems;
}
