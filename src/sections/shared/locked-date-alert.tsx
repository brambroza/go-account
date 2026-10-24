import type { Theme, SxProps } from '@mui/material/styles';

import Alert from '@mui/material/Alert';

import { useAccounting } from 'src/store';
import { formatThaiDate } from 'src/domain';

// ----------------------------------------------------------------------

/** วันที่ (ISO, ตัดเวลาออก) อยู่ในงวดที่ปิดแล้วหรือไม่ */
export function isInLockedPeriod(lockedThrough: string | undefined, date: string | undefined): boolean {
  if (!lockedThrough || !date) return false;
  return date.slice(0, 10) <= lockedThrough;
}

type Props = { date: string | undefined; sx?: SxProps<Theme> };

/**
 * เตือนเมื่อวันที่ที่เลือกอยู่ในงวดที่ปิดแล้ว (≤ `company.lockedThrough`)
 * action จะปฏิเสธอยู่แล้ว — Alert นี้ช่วยให้ผู้ใช้รู้ก่อนกดบันทึก
 */
export function LockedDateAlert({ date, sx }: Props) {
  const { data } = useAccounting();
  const lock = data.company.lockedThrough;
  if (!lock || !isInLockedPeriod(lock, date)) return null;
  return (
    <Alert severity="warning" variant="outlined" sx={sx}>
      ปิดงวดถึงวันที่ {formatThaiDate(lock)} แล้ว — บันทึกวันที่นี้ไม่ได้ ให้เลือกวันที่หลังจากนั้น
    </Alert>
  );
}
