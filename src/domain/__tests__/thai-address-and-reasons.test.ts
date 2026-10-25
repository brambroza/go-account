import data from '../data/thai-address.json';
import {
  otherReasonCode,
  isOtherReasonCode,
  ADJUSTMENT_REASONS,
  effectiveReasonCode,
  adjustmentReasonLabel,
  adjustmentPurposeText,
  adjustmentReasonProblem,
  adjustmentReasonOptions,
  adjustmentReasonDisplay,
} from '../adjustment-reason';
import {
  findProvince,
  findDistrict,
  thaiDistricts,
  thaiProvinces,
  thaiPlaceLabels,
  findSubDistrict,
  withAddressCodes,
  thaiSubDistricts,
  addressCodeProblem,
  normalizePlaceName,
  resolveAddressCodes,
  hasCompleteAddressCodes,
} from '../thai-address';

// ----------------------------------------------------------------------

describe('Thai address dataset (TIS 1099 codes)', () => {
  it('has 77 provinces, 928 districts, 7,436 subdistricts with hierarchical codes and 5-digit postcodes', () => {
    expect(thaiProvinces()).toHaveLength(77);
    expect(data.districts).toHaveLength(928);
    expect(data.subdistricts).toHaveLength(7436);
    const provinces = new Set(thaiProvinces().map((p) => p.code));
    (data.districts as string[][]).forEach(([code]) => {
      expect(code).toMatch(/^\d{4}$/);
      expect(provinces.has(code.slice(0, 2))).toBe(true);
    });
    (data.subdistricts as string[][]).forEach(([code, , zip]) => {
      expect(code).toMatch(/^\d{6}$/);
      expect(zip).toMatch(/^\d{5}$/);
    });
    const sorted = (data.subdistricts as string[][]).map(([c]) => c);
    expect([...sorted].sort()).toEqual(sorted);
  });

  it('looks up provinces, districts and subdistricts by code', () => {
    expect(findProvince('10')?.name).toBe('กรุงเทพมหานคร');
    expect(findDistrict('1001')).toEqual({ code: '1001', name: 'พระนคร', provinceCode: '10' });
    expect(findSubDistrict('100101')).toEqual({ code: '100101', name: 'พระบรมมหาราชวัง', districtCode: '1001', postalCode: '10200' });
    expect(thaiDistricts('10')).toHaveLength(50);
    expect(thaiDistricts('99')).toEqual([]);
    expect(thaiDistricts(undefined)).toEqual([]);
    expect(thaiSubDistricts('1105').map((s) => s.name)).toContain('ในคลองบางปลากด');
    expect(thaiSubDistricts('1105').every((s) => s.districtCode === '1105')).toBe(true);
    expect(findProvince(undefined)).toBeUndefined();
    expect(thaiPlaceLabels('10')).toEqual({ district: 'เขต', subDistrict: 'แขวง' });
    expect(thaiPlaceLabels('50')).toEqual({ district: 'อำเภอ', subDistrict: 'ตำบล' });
  });

  it('normalizes place names: NFKC, whitespace and one level prefix', () => {
    expect(normalizePlaceName('province', ' จังหวัด เชียงใหม่ ')).toBe('เชียงใหม่');
    expect(normalizePlaceName('province', 'จ.ระยอง')).toBe('ระยอง');
    expect(normalizePlaceName('district', 'อำเภอเมืองระยอง')).toBe(normalizePlaceName('district', 'เมืองระยอง'));
    expect(normalizePlaceName('district', 'เขตบางนา')).toBe('บางนา');
    expect(normalizePlaceName('district', 'อ. บางพลี')).toBe('บางพลี');
    expect(normalizePlaceName('subDistrict', 'แขวงบางนาใต้')).toBe('บางนาใต้');
    expect(normalizePlaceName('subDistrict', 'ต.บางกระสอ')).toBe('บางกระสอ');
    // ชื่อตำบลที่ขึ้นต้นด้วย "จ." ไม่ถูกตัด (คำนำหน้าจังหวัด)
    expect(normalizePlaceName('subDistrict', 'จ.ป.ร.')).toBe('จ.ป.ร.');
    // "ํา" (นิคหิต + สระอา) = "ำ"
    expect(normalizePlaceName('district', 'อําเภอ')).toBe(normalizePlaceName('district', 'อำเภอ'));
    expect(normalizePlaceName('district', 'เขต')).toBe('เขต');
    expect(normalizePlaceName('district', undefined)).toBe('');
  });

  it('resolves codes from stored codes first, then names within the parent level', () => {
    expect(resolveAddressCodes({ subDistrictCode: '104703' })).toEqual({ provinceCode: '10', districtCode: '1047', subDistrictCode: '104703' });
    expect(resolveAddressCodes({ districtCode: '1047', subDistrict: 'แขวงบางนาเหนือ' })).toEqual({
      provinceCode: '10',
      districtCode: '1047',
      subDistrictCode: '104702',
    });
    expect(resolveAddressCodes({ provinceCode: '11', district: 'พระสมุทรเจดีย์', subDistrict: 'ในคลองบางปลากด' })).toEqual({
      provinceCode: '11',
      districtCode: '1105',
      subDistrictCode: '110505',
    });
    expect(resolveAddressCodes({ province: 'กทม.', district: 'เขตพระนคร' })).toEqual({ provinceCode: '10', districtCode: '1001' });
    expect(resolveAddressCodes({ province: 'กรุงเทพฯ' })).toEqual({ provinceCode: '10' });
    // "อ.เมือง" = อำเภอเมือง + ชื่อจังหวัด
    expect(resolveAddressCodes({ province: 'นนทบุรี', district: 'อ.เมือง', subDistrict: 'ต.บางกระสอ' })).toMatchObject({
      provinceCode: '12',
      districtCode: '1201',
    });
    expect(resolveAddressCodes({ province: 'นนทบุรี', district: 'อ.เมือง', subDistrict: 'ต.บางกระสอ' }).subDistrictCode).toMatch(/^1201\d\d$/);
    // ชื่อตำบลที่อยู่อำเภออื่น / รหัสที่ไม่มีจริง = ไม่ได้รหัสระดับนั้น
    expect(resolveAddressCodes({ province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'ในคลองบางปลากด' })).toEqual({
      provinceCode: '11',
      districtCode: '1103',
    });
    expect(resolveAddressCodes({ subDistrictCode: '999999', province: 'ระยอง' })).toEqual({ provinceCode: '21' });
    expect(resolveAddressCodes({ province: 'ไม่มี' })).toEqual({});
    expect(resolveAddressCodes(undefined)).toEqual({});
    expect(hasCompleteAddressCodes({ subDistrictCode: '100101' })).toBe(true);
    expect(hasCompleteAddressCodes({ province: 'กรุงเทพมหานคร' })).toBe(false);
  });

  it('validates submitted codes: must exist and nest under the submitted parent codes', () => {
    expect(addressCodeProblem({})).toBeNull();
    expect(addressCodeProblem(undefined)).toBeNull();
    expect(addressCodeProblem({ provinceCode: '10', districtCode: '1047', subDistrictCode: '104703' })).toBeNull();
    expect(addressCodeProblem({ subDistrictCode: '104703' })).toBeNull();
    expect(addressCodeProblem({ provinceCode: '99' })).toContain('ไม่ถูกต้อง');
    expect(addressCodeProblem({ districtCode: '1099' })).toContain('ไม่ถูกต้อง');
    expect(addressCodeProblem({ subDistrictCode: '999999' })).toContain('ไม่ถูกต้อง');
    expect(addressCodeProblem({ provinceCode: '11', districtCode: '1047' })).toContain('ไม่ถูกต้อง');
    expect(addressCodeProblem({ provinceCode: '11', subDistrictCode: '104703' })).toContain('ไม่ถูกต้อง');
    expect(addressCodeProblem({ districtCode: '1001', subDistrictCode: '104703' })).toContain('ไม่ถูกต้อง');
  });

  it('withAddressCodes keeps names and replaces codes with the resolved ones', () => {
    expect(withAddressCodes({ addressNo: '1', province: 'ระยอง', provinceCode: '99' })).toEqual({
      addressNo: '1',
      province: 'ระยอง',
      provinceCode: '21',
    });
    expect(withAddressCodes({ province: 'x' })).toEqual({ province: 'x' });
  });
});

describe('ETDA purpose codes for credit / debit notes (B.3)', () => {
  it('lists the 17 official codes with Thai labels, grouped by kind and sale type', () => {
    expect(ADJUSTMENT_REASONS.map((r) => r.code)).toEqual([
      'CDNG01',
      'CDNG02',
      'CDNG03',
      'CDNG04',
      'CDNG05',
      'CDNG99',
      'CDNS01',
      'CDNS02',
      'CDNS03',
      'CDNS04',
      'CDNS99',
      'DBNG01',
      'DBNG02',
      'DBNG99',
      'DBNS01',
      'DBNS02',
      'DBNS99',
    ]);
    expect(adjustmentReasonOptions('credit-note', undefined).map((r) => r.code)).toEqual(['CDNG01', 'CDNG02', 'CDNG03', 'CDNG04', 'CDNG05', 'CDNG99']);
    expect(adjustmentReasonOptions('credit-note', 'service').map((r) => r.code)).toEqual(['CDNS01', 'CDNS02', 'CDNS03', 'CDNS04', 'CDNS99']);
    expect(adjustmentReasonOptions('debit-note', 'goods').map((r) => r.code)).toEqual(['DBNG01', 'DBNG02', 'DBNG99']);
    expect(adjustmentReasonOptions('debit-note', 'service').map((r) => r.code)).toEqual(['DBNS01', 'DBNS02', 'DBNS99']);
    expect(adjustmentReasonLabel('CDNS01')).toBe('ลดราคาค่าบริการ (บริการผิดข้อกำหนดที่ตกลงกัน)');
    expect(adjustmentReasonLabel('X')).toBeUndefined();
  });

  it('defaults to the "other" code by kind and sale type', () => {
    expect(otherReasonCode('credit-note', undefined)).toBe('CDNG99');
    expect(otherReasonCode('credit-note', 'service')).toBe('CDNS99');
    expect(otherReasonCode('debit-note', 'goods')).toBe('DBNG99');
    expect(otherReasonCode('debit-note', 'service')).toBe('DBNS99');
    expect(effectiveReasonCode('credit-note', 'goods', undefined)).toBe('CDNG99');
    expect(effectiveReasonCode('credit-note', 'goods', 'CDNG03')).toBe('CDNG03');
    expect(isOtherReasonCode(undefined)).toBe(true);
    expect(isOtherReasonCode('DBNS99')).toBe(true);
    expect(isOtherReasonCode('DBNS01')).toBe(false);
  });

  it('requires a free-text reason only for "other", and a code of the same kind and sale type', () => {
    expect(adjustmentReasonProblem('credit-note', 'goods', 'CDNG02', '', 'ใบลดหนี้')).toBeNull();
    expect(adjustmentReasonProblem('credit-note', 'goods', undefined, 'ลดราคา', 'ใบลดหนี้')).toBeNull();
    expect(adjustmentReasonProblem('credit-note', 'goods', undefined, ' ', 'ใบลดหนี้')).toBe('ใบลดหนี้ต้องระบุเหตุผล');
    expect(adjustmentReasonProblem('credit-note', 'goods', 'CDNG99', '', 'ใบลดหนี้')).toBe('ใบลดหนี้ต้องระบุเหตุผล');
    expect(adjustmentReasonProblem('credit-note', 'goods', 'CDNS01', '', 'ใบลดหนี้')).toBe('รหัสเหตุผล CDNS01 ใช้กับใบลดหนี้ขายสินค้าไม่ได้');
    expect(adjustmentReasonProblem('credit-note', 'service', 'DBNS01', 'x', 'ใบลดหนี้')).toBe('รหัสเหตุผล DBNS01 ใช้กับใบลดหนี้งานบริการไม่ได้');
    expect(adjustmentReasonProblem('debit-note', 'goods', 'DBNG01', undefined, 'ใบเพิ่มหนี้')).toBeNull();
  });

  it('XML purpose = code label for specific codes, typed text for "other"; print shows both', () => {
    expect(adjustmentPurposeText({ kind: 'credit-note', reasonCode: 'CDNG02', reason: 'กล่องบุบ' })).toBe('สินค้าชำรุดเสียหาย');
    expect(adjustmentPurposeText({ kind: 'credit-note', reason: ' คืนของ ' })).toBe('คืนของ');
    expect(adjustmentPurposeText({ kind: 'credit-note' })).toBe('');
    expect(adjustmentReasonDisplay({ kind: 'credit-note', reasonCode: 'CDNG02', reason: 'กล่องบุบ' })).toBe('สินค้าชำรุดเสียหาย — กล่องบุบ');
    expect(adjustmentReasonDisplay({ kind: 'credit-note', reasonCode: 'CDNG02' })).toBe('สินค้าชำรุดเสียหาย');
    expect(adjustmentReasonDisplay({ kind: 'debit-note', reasonCode: 'DBNG99', reason: 'ค่าขนส่ง' })).toBe('ค่าขนส่ง');
  });
});
