import data from './data/thai-address.json';

import type { Address } from './types';

// ----------------------------------------------------------------------
// จังหวัด / อำเภอ / ตำบล + รหัส TIS 1099 (ข้อมูล: `data/thai-address.json`, ที่มาและสัญญาอนุญาตใน `data/README.md`)
// XML e-Tax (ขมธอ.3-2560 §8.8–8.10) ใช้รหัส ไม่ใช่ชื่อ: CountrySubDivisionID = จังหวัด 2 หลัก, CityName = อำเภอ 4 หลัก,
// CitySubDivisionName = ตำบล 6 หลัก — รหัสเป็นลำดับชั้น (ตำบล 100101 อยู่ในอำเภอ 1001 จังหวัด 10)
// ที่อยู่เก่าที่มีแต่ชื่อ: จับคู่ชื่อแบบ best-effort (`resolveAddressCodes`) ไล่จากจังหวัด → อำเภอ → ตำบล
// ฝั่ง C# (go-account-api `ThaiAddressBook`) port ทุกขั้น — พิสูจน์ด้วย golden/thai-address.json
// ----------------------------------------------------------------------

export type ThaiProvince = { code: string; name: string };
export type ThaiDistrict = { code: string; name: string; provinceCode: string };
export type ThaiSubDistrict = { code: string; name: string; districtCode: string; postalCode: string };

/** รหัสที่อยู่ (ไม่มีค่า = หาไม่ได้) */
export type AddressCodes = { provinceCode?: string; districtCode?: string; subDistrictCode?: string };

type Level = 'province' | 'district' | 'subDistrict';

const PREFIXES: Record<Level, string[]> = {
  province: ['จังหวัด', 'จ.'],
  district: ['กิ่งอำเภอ', 'อำเภอ', 'อ.', 'เขต'],
  subDistrict: ['ตำบล', 'ต.', 'แขวง'],
};

/** ชื่อเรียกกรุงเทพฯ ที่พบบ่อย (หลังตัดช่องว่าง/NFKC) */
const BANGKOK_ALIASES = ['กทม', 'กทม.', 'กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพมหานครฯ'];
const BANGKOK = '10';

/**
 * รูปชื่อสำหรับเทียบ: NFKC (รวม "ํา" กับ "ำ"), ตัดช่องว่างทุกตัว, ตัดคำนำหน้า 1 คำ (จังหวัด/อำเภอ/เขต/ตำบล/แขวง/จ./อ./ต.)
 * ตามระดับ — ชื่อที่เหลือว่าง = ''
 */
export function normalizePlaceName(level: Level, name: string | undefined): string {
  const s = (name ?? '').normalize('NFKC').replace(/\s+/g, '');
  const prefix = PREFIXES[level].map((p) => p.normalize('NFKC')).find((p) => s.startsWith(p) && s.length > p.length);
  return prefix ? s.slice(prefix.length) : s;
}

type Index = {
  provinces: ThaiProvince[];
  districts: Map<string, ThaiDistrict[]>;
  subDistricts: Map<string, ThaiSubDistrict[]>;
  provinceByCode: Map<string, ThaiProvince>;
  districtByCode: Map<string, ThaiDistrict>;
  subDistrictByCode: Map<string, ThaiSubDistrict>;
  provinceByName: Map<string, string>;
  /** `${provinceCode}|${ชื่อ}` → รหัสอำเภอ */
  districtByName: Map<string, string>;
  /** `${districtCode}|${ชื่อ}` → รหัสตำบล */
  subDistrictByName: Map<string, string>;
};

let cache: Index | null = null;

function index(): Index {
  if (cache) return cache;
  const provinces = (data.provinces as [string, string][]).map(([code, name]) => ({ code, name }));
  const districtList = (data.districts as [string, string][]).map(([code, name]) => ({ code, name, provinceCode: code.slice(0, 2) }));
  const subList = (data.subdistricts as [string, string, string][]).map(([code, name, postalCode]) => ({
    code,
    name,
    postalCode,
    districtCode: code.slice(0, 4),
  }));
  const group = <T, K>(rows: T[], key: (row: T) => K) => {
    const map = new Map<K, T[]>();
    rows.forEach((r) => map.set(key(r), [...(map.get(key(r)) ?? []), r]));
    return map;
  };
  const provinceByName = new Map(provinces.map((p) => [normalizePlaceName('province', p.name), p.code]));
  BANGKOK_ALIASES.forEach((alias) => provinceByName.set(normalizePlaceName('province', alias), BANGKOK));
  cache = {
    provinces,
    districts: group(districtList, (d) => d.provinceCode),
    subDistricts: group(subList, (s) => s.districtCode),
    provinceByCode: new Map(provinces.map((p) => [p.code, p])),
    districtByCode: new Map(districtList.map((d) => [d.code, d])),
    subDistrictByCode: new Map(subList.map((s) => [s.code, s])),
    provinceByName,
    districtByName: new Map(districtList.map((d) => [`${d.provinceCode}|${normalizePlaceName('district', d.name)}`, d.code])),
    subDistrictByName: new Map(subList.map((s) => [`${s.districtCode}|${normalizePlaceName('subDistrict', s.name)}`, s.code])),
  };
  return cache;
}

/** จังหวัดทั้งหมด (เรียงตามรหัส) */
export function thaiProvinces(): ThaiProvince[] {
  return index().provinces;
}

/** อำเภอ/เขตของจังหวัด (เรียงตามรหัส) — รหัสไม่ถูกต้อง = [] */
export function thaiDistricts(provinceCode: string | undefined): ThaiDistrict[] {
  return index().districts.get(provinceCode ?? '') ?? [];
}

/** ตำบล/แขวงของอำเภอ (เรียงตามรหัส) พร้อมรหัสไปรษณีย์ */
export function thaiSubDistricts(districtCode: string | undefined): ThaiSubDistrict[] {
  return index().subDistricts.get(districtCode ?? '') ?? [];
}

export function findProvince(code: string | undefined): ThaiProvince | undefined {
  return index().provinceByCode.get(code ?? '');
}

export function findDistrict(code: string | undefined): ThaiDistrict | undefined {
  return index().districtByCode.get(code ?? '');
}

export function findSubDistrict(code: string | undefined): ThaiSubDistrict | undefined {
  return index().subDistrictByCode.get(code ?? '');
}

/** คำเรียกตามจังหวัด: กรุงเทพฯ = เขต/แขวง, จังหวัดอื่น = อำเภอ/ตำบล */
export function thaiPlaceLabels(provinceCode: string | undefined): { district: string; subDistrict: string } {
  return provinceCode === BANGKOK ? { district: 'เขต', subDistrict: 'แขวง' } : { district: 'อำเภอ', subDistrict: 'ตำบล' };
}

function matchProvince(name: string | undefined): string | undefined {
  const key = normalizePlaceName('province', name);
  return key ? index().provinceByName.get(key) : undefined;
}

function matchDistrict(provinceCode: string, name: string | undefined): string | undefined {
  let key = normalizePlaceName('district', name);
  if (!key) return undefined;
  // "เมือง" / "อ.เมือง" = อำเภอเมือง{ชื่อจังหวัด}
  if (key === 'เมือง') key = normalizePlaceName('district', `เมือง${findProvince(provinceCode)?.name ?? ''}`);
  return index().districtByName.get(`${provinceCode}|${key}`);
}

function matchSubDistrict(districtCode: string, name: string | undefined): string | undefined {
  const key = normalizePlaceName('subDistrict', name);
  return key ? index().subDistrictByName.get(`${districtCode}|${key}`) : undefined;
}

/**
 * รหัสจังหวัด/อำเภอ/ตำบลของที่อยู่: รหัสที่เก็บไว้ (ที่มีอยู่จริง — ตำบลกำหนดอำเภอ/จังหวัด, อำเภอกำหนดจังหวัด)
 * แล้วเติมระดับที่ขาดด้วยการจับคู่ชื่อภายในระดับบน (ชื่อตำบลไม่ซ้ำกันในอำเภอเดียวกัน) — หาไม่ได้ = ไม่มีค่า
 */
export function resolveAddressCodes(a: Address | undefined): AddressCodes {
  if (!a) return {};
  let provinceCode: string | undefined;
  let districtCode: string | undefined;
  let subDistrictCode: string | undefined;
  const sub = findSubDistrict(a.subDistrictCode);
  const district = findDistrict(a.districtCode);
  if (sub) {
    subDistrictCode = sub.code;
    ({ districtCode } = sub);
    provinceCode = sub.code.slice(0, 2);
  } else if (district) {
    districtCode = district.code;
    ({ provinceCode } = district);
  } else {
    provinceCode = findProvince(a.provinceCode)?.code;
  }
  provinceCode = provinceCode ?? matchProvince(a.province);
  if (provinceCode && !districtCode) districtCode = matchDistrict(provinceCode, a.district);
  if (districtCode && !subDistrictCode) subDistrictCode = matchSubDistrict(districtCode, a.subDistrict);
  return {
    ...(provinceCode ? { provinceCode } : {}),
    ...(districtCode ? { districtCode } : {}),
    ...(subDistrictCode ? { subDistrictCode } : {}),
  };
}

/** หาได้ครบ 3 ระดับ (พร้อมออก XML e-Tax) */
export function hasCompleteAddressCodes(a: Address | undefined): boolean {
  const c = resolveAddressCodes(a);
  return Boolean(c.provinceCode && c.districtCode && c.subDistrictCode);
}

/**
 * ตรวจรหัสที่ส่งมากับที่อยู่ (ฟอร์มเลือกจากรายการ) — แต่ละรหัสต้องมีอยู่จริง และระดับล่างต้องอยู่ใต้ระดับบนที่ส่งมา
 * คืนข้อความปัญหา หรือ null
 */
export function addressCodeProblem(a: Address | undefined): string | null {
  if (!a) return null;
  const { provinceCode: p, districtCode: d, subDistrictCode: s } = a;
  const bad =
    (p !== undefined && !findProvince(p)) ||
    (d !== undefined && !findDistrict(d)) ||
    (s !== undefined && !findSubDistrict(s)) ||
    (p !== undefined && d !== undefined && d.slice(0, 2) !== p) ||
    (p !== undefined && s !== undefined && s.slice(0, 2) !== p) ||
    (d !== undefined && s !== undefined && s.slice(0, 4) !== d);
  return bad ? 'รหัสจังหวัด/อำเภอ/ตำบลในที่อยู่ไม่ถูกต้อง — เลือกจากรายการใหม่' : null;
}

/** ที่อยู่พร้อมรหัสที่หาได้ (คงชื่อตามที่กรอก) — ใช้ตอนบันทึกผู้ติดต่อ/บริษัท และ migration v7 → v8 */
export function withAddressCodes(a: Address): Address {
  const rest: Address = { ...a };
  delete rest.provinceCode;
  delete rest.districtCode;
  delete rest.subDistrictCode;
  return { ...rest, ...resolveAddressCodes(a) };
}
