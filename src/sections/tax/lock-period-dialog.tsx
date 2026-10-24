import type { LockPeriodSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useForm, useWatch } from 'react-hook-form';
import { useMemo, useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useBoolean } from 'src/hooks/use-boolean';

import { cmd, lockPeriod, useAccounting } from 'src/store';
import { monthEndOf, makeLockPeriodSchema } from 'src/schemas/accounting/doc-schemas';
import {
  addDays,
  periodOf,
  todayISO,
  periodLabel,
  eTaxWaiting,
  periodFromKey,
  formatThaiDate,
  endOfPreviousMonth,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { ConfirmSummary, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void };

/** เดือนเริ่มต้นที่เสนอ: เดือนถัดจากงวดที่ปิดแล้ว (ไม่เกินเดือนที่แล้ว) หรือเดือนก่อนหน้าวันนี้ */
function suggestedMonth(lockedThrough: string | undefined): string {
  const lastEnded = `${endOfPreviousMonth(todayISO()).slice(0, 7)}-01`;
  if (lockedThrough) {
    const next = `${addDays(lockedThrough, 1).slice(0, 7)}-01`;
    return next < lastEnded ? next : lastEnded;
  }
  return lastEnded;
}

/**
 * ปิดงวดถึงสิ้นเดือนที่เลือก (เลื่อนไปข้างหน้าได้อย่างเดียว) — ยืนยันก่อนเพราะเปิดย้อนไม่ได้
 * หลังปิด ทุกรายการที่ลงวันที่ ≤ วันปิดงวดจะถูกปฏิเสธ
 */
export function LockPeriodDialog({ open, onClose }: Props) {
  const { data, run, busy } = useAccounting();
  const current = data.company.lockedThrough;
  const confirm = useBoolean();
  const [through, setThrough] = useState<string | null>(null);

  const methods = useForm<LockPeriodSchemaType>({
    resolver: zodResolver(makeLockPeriodSchema(current)),
    defaultValues: { month: suggestedMonth(current) },
  });
  const { control, reset, handleSubmit } = methods;
  const month = useWatch({ control, name: 'month' });
  const preview = month && month.length >= 7 ? monthEndOf(month.slice(0, 10)) : null;

  useEffect(() => {
    if (open) reset({ month: suggestedMonth(current) });
  }, [open, current, reset]);

  const notEnded = !!preview && preview > endOfPreviousMonth(todayISO());
  const etaxWaiting = preview
    ? eTaxWaiting(data).filter((d) => d.date <= preview).length
    : 0;

  // รายการปิดภาษีเดือนที่จะเกิดขึ้น — จำลองด้วย action เดียวกัน (pure) เพื่อแสดงก่อนยืนยัน
  const vatPreview = useMemo(() => {
    if (!through) return [];
    try {
      const next = lockPeriod(data, through);
      return next.vatCloses.slice(data.vatCloses.length);
    } catch {
      return [];
    }
  }, [data, through]);

  const onReview = handleSubmit((values) => {
    setThrough(monthEndOf(values.month.slice(0, 10)));
    confirm.onTrue();
  });

  const submit = async () => {
    if (!through) return;
    try {
      await run(cmd.lockPeriod(through));
      confirm.onFalse();
      toast.success(`ปิดงวดถึงวันที่ ${formatThaiDate(through)} แล้ว`);
      onClose();
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'ปิดงวดไม่สำเร็จ');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <Form methods={methods}>
          <DialogTitle>ปิดงวดบัญชี</DialogTitle>
          <DialogContent onKeyDown={preventEnterSubmit}>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {current ? `ปัจจุบันปิดงวดถึงวันที่ ${formatThaiDate(current)}` : 'ยังไม่เคยปิดงวด'} · ปิดหลังยื่นแบบ ภ.พ.30 / ภ.ง.ด.
                ของเดือนนั้นแล้ว เพื่อไม่ให้ตัวเลขที่ยื่นไปเปลี่ยน
              </Typography>
              <Field.DatePicker
                name="month"
                label="ปิดถึงสิ้นเดือน"
                views={['year', 'month']}
                openTo="month"
                format="MM/BBBB"
              />
              {preview && (
                <Typography variant="body2">
                  จะปิดถึงวันที่ <strong>{formatThaiDate(preview)}</strong>
                </Typography>
              )}
              {notEnded && (
                <Alert severity="error" variant="outlined">
                  เดือนนี้ยังไม่สิ้นสุด — ปิดได้ถึงสิ้นเดือนที่แล้ว ({formatThaiDate(endOfPreviousMonth(todayISO()))}) เท่านั้น
                </Alert>
              )}
              {etaxWaiting > 0 && (
                <Alert severity="warning" variant="outlined">
                  มีใบกำกับ {etaxWaiting} ฉบับในงวดนี้ยังไม่ได้นำส่ง e-Tax (ยังนำส่งได้หลังปิดงวด)
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton variant="contained" color="warning" onClick={onReview}>
              ปิดงวด
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title="ยืนยันปิดงวด"
        content={
          through && (
            <ConfirmSummary
              rows={[
                { label: 'ปิดถึงวันที่', value: formatThaiDate(through) },
                { label: 'งวดล่าสุดที่ปิด', value: `เดือน${periodLabel(periodOf(through))}` },
                { label: 'เดิมปิดถึง', value: current ? formatThaiDate(current) : '-' },
                ...vatPreview.map((c) => ({
                  label: `ปิดภาษีเดือน${periodLabel(periodFromKey(c.period))}`,
                  value: c.payable > 0 ? `ชำระ ${c.payable.toFixed(2)} บาท` : `ชำระเกินยกไป ${c.carriedForward.toFixed(2)} บาท`,
                })),
              ]}
              severity="error"
              note={`หลังปิด จะออกเอกสาร รับชำระ จ่ายชำระ ลด/เพิ่มหนี้ ใช้สิทธิภาษีซื้อในเดือนที่ปิด หรือลงรายการปรับปรุงที่ลงวันที่ถึง ${formatThaiDate(through)} ไม่ได้ และเลื่อนวันปิดงวดย้อนกลับไม่ได้${vatPreview.length ? ' — ระบบจะลงรายการปิดภาษีเดือน (Dr ภาษีขาย / Cr ภาษีซื้อ → VAT ค้างจ่าย หรือภาษีชำระเกินยกไป) ณ วันสิ้นเดือนให้' : ''}`}
            />
          )
        }
        action={
          <LoadingButton variant="contained" color="warning" onClick={submit} loading={busy}>
            ยืนยันปิดงวด
          </LoadingButton>
        }
      />
    </>
  );
}
