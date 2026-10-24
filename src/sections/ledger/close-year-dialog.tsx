import type { CloseYearSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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

import { closeYear, useAccounting } from 'src/store';
import { CloseYearSchema } from 'src/schemas/accounting/doc-schemas';
import {
  ACC,
  formatThaiDate,
  isValidISODate,
  sortedYearCloses,
  yearCloseProblem,
  yearCloseBalances,
  suggestedFiscalYearEnd,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { Money, ConfirmSummary, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void };

/**
 * ปิดบัญชีสิ้นปี: โอนรายได้/ค่าใช้จ่ายสะสมถึงวันสิ้นปีเข้า 3200 กำไรสะสม — ตรวจกติกาด้วย domain ก่อนยืนยัน
 * (ต้องปิดงวดถึงวันสิ้นปีแล้ว, ปีละครั้ง, ปีถัดไปต่อกัน 12 เดือน)
 */
export function CloseYearDialog({ open, onClose }: Props) {
  const { data, run } = useAccounting();
  const confirm = useBoolean();
  const suggested = suggestedFiscalYearEnd(data) ?? '';
  const methods = useForm<CloseYearSchemaType>({
    resolver: zodResolver(CloseYearSchema),
    defaultValues: { fiscalYearEnd: suggested },
  });
  const { control, reset, handleSubmit, formState } = methods;
  const value = useWatch({ control, name: 'fiscalYearEnd' });
  const fye = (value ?? '').slice(0, 10);

  useEffect(() => {
    if (open) reset({ fiscalYearEnd: suggested });
  }, [open, suggested, reset]);

  const closes = sortedYearCloses(data);
  const already = closes.find((c) => c.fiscalYearEnd === fye);
  const problem = isValidISODate(fye) && !already ? yearCloseProblem(data, fye) : null;
  const preview = useMemo(() => (isValidISODate(fye) ? yearCloseBalances(data, fye) : null), [data, fye]);

  const onReview = handleSubmit(() => {
    if (problem || already) return;
    confirm.onTrue();
  });

  const submit = () => {
    try {
      const r = run((s) => closeYear(s, fye));
      confirm.onFalse();
      toast.success(r.already ? `ปีที่สิ้นสุด ${formatThaiDate(fye)} ปิดบัญชีไว้แล้ว` : `ปิดบัญชีสิ้นปี ${formatThaiDate(fye)} แล้ว`);
      onClose();
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'ปิดบัญชีไม่สำเร็จ');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <Form methods={methods}>
          <DialogTitle>ปิดบัญชีสิ้นปี</DialogTitle>
          <DialogContent onKeyDown={preventEnterSubmit}>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                โอนกำไร (ขาดทุน) สุทธิของรอบบัญชีเข้า {ACC.retained} กำไรสะสม · ต้องปิดงวดถึงวันสิ้นปีก่อน
                {closes.length ? ` · ปิดล่าสุด ${formatThaiDate(closes[closes.length - 1].fiscalYearEnd)}` : ''}
              </Typography>
              <Field.DatePicker name="fiscalYearEnd" label="วันสิ้นรอบบัญชี" />
              {already && (
                <Alert severity="info" variant="outlined">
                  ปีนี้ปิดบัญชีแล้ว (กำไรสุทธิ <Money value={already.netProfit} /> บาท) — ปิดซ้ำไม่มีผล
                </Alert>
              )}
              {problem && (
                <Alert severity="error" variant="outlined">
                  {problem}
                </Alert>
              )}
              {preview && !already && (
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    กำไร (ขาดทุน) ที่จะโอน
                  </Typography>
                  <Money value={preview.netProfit} variant="subtitle2" signed />
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton
              variant="contained"
              color="warning"
              onClick={onReview}
              loading={formState.isSubmitting}
              disabled={!!problem || !!already}
            >
              ปิดบัญชี
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title="ยืนยันปิดบัญชีสิ้นปี"
        content={
          preview && (
            <ConfirmSummary
              rows={[
                { label: 'วันสิ้นรอบบัญชี', value: formatThaiDate(fye) },
                { label: 'จำนวนบัญชีรายได้/ค่าใช้จ่ายที่ปิด', value: `${preview.balances.length} บัญชี` },
                { label: `โอนเข้า ${ACC.retained} กำไรสะสม`, value: preview.netProfit, strong: true },
              ]}
              severity="warning"
              note="ระบบจะลงรายการปิดบัญชี ณ วันสิ้นปี (Dr รายได้ / Cr ค่าใช้จ่าย / Cr หรือ Dr กำไรสะสม) — ยกเลิกไม่ได้ งบกำไรขาดทุนของปีนั้นยังดูได้ตามเดิม"
            />
          )
        }
        action={
          <LoadingButton variant="contained" color="warning" onClick={submit}>
            ยืนยันปิดบัญชี
          </LoadingButton>
        }
      />
    </>
  );
}
