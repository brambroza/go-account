import type { FilingDueDateSource } from 'src/domain';
import type { Theme, SxProps } from '@mui/material/styles';

import Alert from '@mui/material/Alert';

// ----------------------------------------------------------------------

type Props = { source: FilingDueDateSource | undefined; sx?: SxProps<Theme> };

/**
 * เตือนเมื่อกำหนดยื่นของงวดเป็นวันตามกฎหมาย (`filingDueDates(...).dueDateSource === 'statutory'`) —
 * งวดหลังประกาศขยายเวลายื่นออนไลน์ฉบับล่าสุด ต้องตรวจประกาศใหม่ก่อนยื่น
 */
export function StatutoryDueDateAlert({ source, sx }: Props) {
  if (source !== 'statutory') return null;
  return (
    <Alert severity="warning" variant="outlined" sx={sx}>
      กำหนดยื่นตามกฎหมาย (ภ.ง.ด. วันที่ 7 / ภ.พ.30 วันที่ 15) — ประกาศขยายเวลายื่นออนไลน์ฉบับที่ 8 ใช้ถึงงวด ธ.ค. 2569
      ตรวจประกาศฉบับใหม่ก่อนยื่น
    </Alert>
  );
}
