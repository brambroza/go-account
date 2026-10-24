import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { Money } from './money';

// ----------------------------------------------------------------------

export type ConfirmRow = {
  label: string;
  /** ตัวเลขเงิน (แสดงด้วย `Money`) หรือข้อความ */
  value: number | React.ReactNode;
  /** ตัวหนา + เส้นคั่นด้านบน (ยอดรวม/ยอดสุทธิ) */
  strong?: boolean;
  hidden?: boolean;
};

type Props = {
  rows: ConfirmRow[];
  /** ข้อความเตือนท้ายสรุป เช่น "ออกแล้วแก้ไขไม่ได้" */
  note?: React.ReactNode;
  severity?: 'warning' | 'info' | 'error';
};

/**
 * สรุปสิ่งที่จะเกิดขึ้นใน dialog ยืนยัน (ชนิดเอกสาร วันที่ ยอด งวดภาษี)
 * ใช้คู่กับ `ConfirmDialog` ก่อนทำรายการที่ย้อนกลับไม่ได้
 */
export function ConfirmSummary({ rows, note, severity = 'warning' }: Props) {
  return (
    <Stack spacing={1.25} sx={{ pt: 0.5 }}>
      {rows
        .filter((r) => !r.hidden)
        .map((r) => (
          <Stack key={r.label} spacing={1.25}>
            {r.strong && <Divider sx={{ borderStyle: 'dashed' }} />}
            <Stack direction="row" justifyContent="space-between" spacing={2}>
              <Typography variant={r.strong ? 'subtitle2' : 'body2'} sx={{ color: r.strong ? 'text.primary' : 'text.secondary' }}>
                {r.label}
              </Typography>
              {typeof r.value === 'number' ? (
                <Money value={r.value} variant={r.strong ? 'subtitle2' : 'body2'} />
              ) : (
                <Typography variant={r.strong ? 'subtitle2' : 'body2'} sx={{ textAlign: 'right' }}>
                  {r.value}
                </Typography>
              )}
            </Stack>
          </Stack>
        ))}
      {note && (
        <Alert severity={severity} variant="outlined" sx={{ mt: 1 }}>
          {note}
        </Alert>
      )}
    </Stack>
  );
}
