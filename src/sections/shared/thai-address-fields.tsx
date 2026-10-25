import type { Address, ThaiDistrict, ThaiProvince, ThaiSubDistrict } from 'src/domain';

import { useMemo, useEffect } from 'react';
import { useWatch, useFormContext } from 'react-hook-form';

import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';

import {
  findProvince,
  findDistrict,
  thaiDistricts,
  thaiProvinces,
  findSubDistrict,
  thaiPlaceLabels,
  thaiSubDistricts,
  resolveAddressCodes,
  hasCompleteAddressCodes,
} from 'src/domain';

import { Field } from 'src/components/hook-form';

// ----------------------------------------------------------------------

type Props = {
  /** prefix ของที่อยู่ในฟอร์ม เช่น `address` */
  name: string;
  disabled?: boolean;
};

const byThaiName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'th');

/**
 * เลือกจังหวัด → อำเภอ/เขต → ตำบล/แขวง จากตาราง TIS 1099 (`thai-address.ts`) แล้วเก็บทั้งชื่อและรหัส
 * (XML e-Tax ใช้รหัส) — เลือกตำบลแล้วเติมรหัสไปรษณีย์ให้ (แก้เองได้)
 * ที่อยู่เดิมที่มีแต่ชื่อ: เติมรหัสจากการจับคู่ชื่อตอนเปิดฟอร์ม จับคู่ไม่ได้ = แสดงชื่อเดิมพร้อมคำเตือน
 */
export function ThaiAddressFields({ name, disabled }: Props) {
  const { control, setValue, getValues } = useFormContext();
  const address = (useWatch({ control, name }) ?? {}) as Address;
  const key = (field: keyof Address) => `${name}.${field}`;
  const set = (field: keyof Address, value: string) => setValue(key(field), value, { shouldDirty: true });

  // ที่อยู่เดิม (ชื่ออย่างเดียว) — เติมรหัสที่จับคู่ได้ครั้งเดียวตอนเปิดฟอร์ม
  useEffect(() => {
    const current = (getValues(name) ?? {}) as Address;
    const codes = resolveAddressCodes(current);
    (['provinceCode', 'districtCode', 'subDistrictCode'] as const).forEach((field) => {
      if (!current[field] && codes[field]) setValue(key(field), codes[field]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const provinces = useMemo(() => [...thaiProvinces()].sort(byThaiName), []);
  const districts = useMemo(() => [...thaiDistricts(address.provinceCode)].sort(byThaiName), [address.provinceCode]);
  const subDistricts = useMemo(() => [...thaiSubDistricts(address.districtCode)].sort(byThaiName), [address.districtCode]);
  const labels = thaiPlaceLabels(address.provinceCode);

  const province = findProvince(address.provinceCode) ?? null;
  const district = findDistrict(address.districtCode) ?? null;
  const subDistrict = findSubDistrict(address.subDistrictCode) ?? null;
  const legacy = Boolean(address.province || address.district || address.subDistrict) && !hasCompleteAddressCodes(address);
  /** ชื่อเดิมที่ยังไม่ได้เลือกจากรายการ */
  const typed = (code: unknown, value: string | undefined) => (!code && value ? `เดิม: ${value}` : undefined);

  const onProvince = (p: ThaiProvince | null) => {
    set('province', p?.name ?? '');
    set('provinceCode', p?.code ?? '');
    ['district', 'districtCode', 'subDistrict', 'subDistrictCode'].forEach((f) => set(f as keyof Address, ''));
  };
  const onDistrict = (d: ThaiDistrict | null) => {
    set('district', d?.name ?? '');
    set('districtCode', d?.code ?? '');
    set('subDistrict', '');
    set('subDistrictCode', '');
  };
  const onSubDistrict = (s: ThaiSubDistrict | null) => {
    set('subDistrict', s?.name ?? '');
    set('subDistrictCode', s?.code ?? '');
    if (s) set('postalCode', s.postalCode);
  };

  return (
    <>
      <Autocomplete
        size="small"
        disabled={disabled}
        options={provinces}
        value={province}
        onChange={(_, v) => onProvince(v)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        renderInput={(params) => (
          <TextField {...params} label="จังหวัด" helperText={typed(province, address.province)} placeholder={address.province} />
        )}
      />
      <Autocomplete
        size="small"
        disabled={disabled || !province}
        options={districts}
        value={district}
        onChange={(_, v) => onDistrict(v)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        renderInput={(params) => (
          <TextField
            {...params}
            label={`${labels.district} (อำเภอ / เขต)`}
            helperText={typed(district, address.district)}
            placeholder={address.district}
          />
        )}
      />
      <Autocomplete
        size="small"
        disabled={disabled || !district}
        options={subDistricts}
        value={subDistrict}
        onChange={(_, v) => onSubDistrict(v)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        renderOption={(props, o) => (
          <li {...props} key={o.code}>
            {o.name}
            <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
              {o.postalCode}
            </Typography>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label={`${labels.subDistrict} (ตำบล / แขวง)`}
            helperText={typed(subDistrict, address.subDistrict)}
            placeholder={address.subDistrict}
          />
        )}
      />
      <Field.Text
        name={key('postalCode')}
        label="รหัสไปรษณีย์"
        size="small"
        disabled={disabled}
        inputProps={{ inputMode: 'numeric', maxLength: 5 }}
      />
      {legacy && (
        <Typography variant="caption" sx={{ gridColumn: '1 / -1', color: 'warning.main' }}>
          ที่อยู่เดิมยังไม่มีรหัส — เลือกจากรายการเพื่อใช้กับ e-Tax
        </Typography>
      )}
    </>
  );
}
