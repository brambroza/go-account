import type { StatementLineSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { todayISO } from 'src/domain';
import { useAccounting, addBankStatementLines } from 'src/store';
import { StatementLineSchema } from 'src/schemas/accounting/doc-schemas';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';

import { RHFAmountField, formKeyHandler } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; accountCode: string };

/** คีย์รายการ statement เอง (กรณีไม่มีไฟล์ CSV) — ไม่ลงบัญชี ใช้จับคู่กระทบยอดเท่านั้น */
export function StatementLineDialog({ open, onClose, accountCode }: Props) {
  const { run } = useAccounting();
  const defaults: StatementLineSchemaType = { date: todayISO(), description: '', direction: 'in', amount: 0 };
  const methods = useForm<StatementLineSchemaType>({ resolver: zodResolver(StatementLineSchema), defaultValues: defaults });

  useEffect(() => {
    if (open) methods.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = methods.handleSubmit((v) => {
    try {
      const amount = v.direction === 'in' ? v.amount : -v.amount;
      const r = run((s) => addBankStatementLines(s, { accountCode, lines: [{ date: v.date.slice(0, 10), description: v.description, amount }] }));
      toast.success(r.added ? 'เพิ่มรายการ statement แล้ว' : 'มีรายการนี้อยู่แล้ว');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  const submit = (event?: React.BaseSyntheticEvent) => {
    event?.stopPropagation();
    return onSubmit(event);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Form methods={methods} onSubmit={submit}>
        <DialogTitle>เพิ่มรายการ statement</DialogTitle>
        <DialogContent onKeyDown={formKeyHandler(onSubmit)}>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Field.DatePicker name="date" label="วันที่ตาม statement" />
            <Field.RadioGroup
              row
              name="direction"
              options={[
                { value: 'in', label: 'เงินเข้า' },
                { value: 'out', label: 'เงินออก' },
              ]}
            />
            <RHFAmountField name="amount" label="จำนวนเงิน" />
            <Field.Text name="description" label="รายการ (เช่น ค่าธรรมเนียม ดอกเบี้ย)" size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={onClose}>
            ยกเลิก
          </Button>
          <LoadingButton type="submit" variant="contained">
            เพิ่ม
          </LoadingButton>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
