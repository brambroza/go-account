import { formatPlain } from './money';
import { isTaxDocument } from './sales-doc';
import { lineAmount, calcDocument } from './document-calc';
import { resolveParty, partyDisplayName } from './snapshot';
import { normalizeTaxId, normalizeBranch5 } from './thai-tax-id';

import type { Address, Company, Contact, SalesDoc } from './types';

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
 * รหัสประเภทเอกสาร ETDA (ขมธอ.3-2560 ตารางรหัสประเภทเอกสาร): 388 ใบกำกับภาษี, 81 ใบลดหนี้, 80 ใบเพิ่มหนี้
 * ⚠️ รหัส 80 ตรวจกับตาราง ETDA ฉบับล่าสุดก่อนใช้งานจริง
 */
export const ETAX_TYPE_CODE = {
  'tax-invoice': '388',
  'credit-note': '81',
  'debit-note': '80',
} as const;

const ETAX_TYPE_NAME = {
  'tax-invoice': 'ใบกำกับภาษี',
  'credit-note': 'ใบลดหนี้',
  'debit-note': 'ใบเพิ่มหนี้',
} as const;

/**
 * รหัสเหตุผลการออกใบลด/เพิ่มหนี้ — ใช้ "เหตุอื่น" ของสินค้า (CDNG99 / DBNG99) พร้อมข้อความเหตุผลจริงใน Purpose
 * ⚠️ ตรวจรหัสกับตาราง ETDA ก่อนใช้งานจริง (มีรหัสแยกสินค้า/บริการ เช่น CDNS99, DBNS99)
 */
const ETAX_PURPOSE_CODE = { 'credit-note': 'CDNG99', 'debit-note': 'DBNG99' } as const;

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

function addressXml(a: Address): string {
  const line1 = [a.buildingName, a.roomNo, a.floorNo, a.village].filter(Boolean).join(' ');
  return [
    '<ram:PostalTradeAddress>',
    el('PostcodeCode', a.postalCode),
    el('LineOne', line1 || undefined),
    el('StreetName', a.street),
    el('CityName', a.district),
    el('CitySubDivisionName', a.subDistrict),
    el('CountryID', 'TH', 'schemeID="3166-1 alpha-2"'),
    el('CountrySubDivisionID', a.province),
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
  /** เวลาสร้างไฟล์ (ISO) */
  createdAt?: string;
};

/**
 * สร้าง XML ของเอกสาร — ผู้ขาย/ผู้ซื้ออ่านจาก snapshot ณ วันออกเอกสาร
 * throw ถ้าไม่ใช่เอกสารภาษี (บริษัทไม่จด VAT) หรือไม่มีข้อมูลผู้ซื้อ
 */
export function buildETaxXml({ doc, company, buyer, referenced, createdAt }: ETaxXmlInput): string {
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
  const referencedXml =
    adjustment && referenced
      ? [
          '<ram:AdditionalReferencedDocument>',
          el('IssuerAssignedID', referenced.docNo),
          el('IssueDateTime', `${referenced.date}T00:00:00`),
          el('ReferenceTypeCode', ETAX_TYPE_CODE[referenced.kind]),
          '</ram:AdditionalReferencedDocument>',
        ].join('')
      : '';

  const purposeXml = adjustment
    ? `${el('Purpose', doc.reason || ETAX_TYPE_NAME[adjustment])}${el('PurposeCode', ETAX_PURPOSE_CODE[adjustment])}`
    : '';

  // ม.86/9, 86/10: มูลค่าตามใบกำกับเดิม / ผลต่าง (ก่อน VAT) — ⚠️ ตรวจลำดับ element กับ XSD ของ ETDA
  const originalXml = adjustment ? el('OriginalInformationAmount', formatPlain(doc.originalNet ?? 0)) : '';
  const differenceXml = adjustment ? el('DifferenceInformationAmount', formatPlain(t.net)) : '';

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
    el('LineTotalAmount', formatPlain(t.gross)),
    differenceXml,
    el('TaxBasisTotalAmount', formatPlain(t.net)),
    el('TaxTotalAmount', formatPlain(t.vat)),
    el('GrandTotalAmount', formatPlain(t.total)),
    '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '</ram:ApplicableHeaderTradeSettlement>',
    lineItems,
    '</rsm:SupplyChainTradeTransaction>',
    '</rsm:TaxInvoice_CrossIndustryInvoice>',
  ].join('\n');
}

/** ตรวจข้อมูลขั้นต่ำก่อนออก e-Tax: ผู้ซื้อที่จด VAT ต้องมีเลขผู้เสียภาษีและสาขา */
export function eTaxReadiness(company: Company, buyer: Contact | undefined): string[] {
  const problems: string[] = [];
  if (!company.vatRegistered) problems.push('บริษัทยังไม่ได้ตั้งค่าเป็นผู้จดทะเบียน VAT');
  if (!buyer) problems.push('ไม่พบข้อมูลลูกค้า');
  if (buyer && !normalizeTaxId(buyer.taxId)) problems.push('ลูกค้ายังไม่มีเลขผู้เสียภาษี');
  if (buyer && !buyer.address?.province) problems.push('ที่อยู่ลูกค้ายังไม่ครบ (จังหวัด)');
  return problems;
}
