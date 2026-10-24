import type { Theme, SxProps } from '@mui/material/styles';

import dayjs from 'dayjs';

import { DatePicker } from '@mui/x-date-pickers/DatePicker';

import { isValidISODate } from 'src/domain';
import { PICKER_DATE_FORMAT } from 'src/locales/buddhist-era';

// ----------------------------------------------------------------------

type Props = {
  label: string;
  /** ISO ค.ศ. `YYYY-MM-DD` (ว่าง = ไม่เลือก) */
  value: string;
  onChange: (iso: string) => void;
  sx?: SxProps<Theme>;
};

/**
 * ช่องวันที่นอกฟอร์ม (ตัวกรองรายงาน) — แสดงปี พ.ศ. แบบเดียวกับฟอร์ม ค่าเข้า/ออกเป็น ISO ค.ศ.
 * เรียก `onChange` เฉพาะเมื่อวันที่ครบและถูกต้อง (ระหว่างพิมพ์ยังไม่เปลี่ยนรายงาน)
 */
export function IsoDatePicker({ label, value, onChange, sx }: Props) {
  return (
    <DatePicker
      label={label}
      value={isValidISODate(value) ? dayjs(value) : null}
      onChange={(v) => {
        const iso = v && v.isValid() ? v.format('YYYY-MM-DD') : '';
        if (isValidISODate(iso)) onChange(iso);
      }}
      format={PICKER_DATE_FORMAT}
      slotProps={{ textField: { size: 'small', sx: { width: 180, ...sx } } }}
    />
  );
}
