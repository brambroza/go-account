import { normalizeTaxId, normalizeBranch5 } from './thai-tax-id';

import type { Company, Contact, PartySnapshot, CompanySnapshot } from './types';

// ----------------------------------------------------------------------
// Snapshot ข้อมูลผู้ขาย/ผู้ซื้อ ณ วันที่ออกเอกสาร
// กฎหมายภาษีอ้างข้อมูลที่พิมพ์บนเอกสาร ณ วันออก — แก้ผู้ติดต่อภายหลังต้องไม่ทำให้รายงานย้อนหลังเปลี่ยน
// ----------------------------------------------------------------------

/** เก็บข้อมูลบริษัทที่ต้องพิมพ์บนเอกสาร */
export function companySnapshot(company: Company): CompanySnapshot {
  return {
    name: company.name,
    taxId: company.taxId,
    branchNo: company.branchNo,
    address: { ...company.address },
    email: company.email,
    phone: company.phone,
    vatRegistered: company.vatRegistered,
  };
}

/** เก็บข้อมูลคู่ค้า (ชื่อ เลขผู้เสียภาษี สาขา ที่อยู่ ประเภทบุคคล) */
export function partySnapshot(contact: Contact): PartySnapshot {
  return {
    title: contact.title,
    name: contact.name,
    lastName: contact.lastName,
    taxId: normalizeTaxId(contact.taxId),
    branchNo: normalizeBranch5(contact.branchNo),
    address: { ...contact.address },
    legalForm: contact.legalForm,
    email: contact.email,
  };
}

/** ชื่อเต็มสำหรับแสดง/รายงาน: คำนำหน้า ชื่อ นามสกุล */
export function partyDisplayName(party: Pick<PartySnapshot, 'title' | 'name' | 'lastName'> | undefined): string {
  if (!party) return '-';
  return [party.title, party.name, party.lastName].filter(Boolean).join(' ').trim();
}

/**
 * snapshot ของเอกสาร ถ้าไม่มี (ข้อมูลทดสอบ/ข้อมูลเก่าก่อน migration) ใช้ผู้ติดต่อปัจจุบันแทน
 * ข้อมูลจริงหลัง migration v2 มี snapshot ทุกใบ
 */
export function resolveParty(snapshot: PartySnapshot | undefined, contact: Contact | undefined): PartySnapshot | undefined {
  if (snapshot) return snapshot;
  return contact ? partySnapshot(contact) : undefined;
}
