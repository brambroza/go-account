import type { TransferSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useBoolean } from 'src/hooks/use-boolean';

import { TransferSchema } from 'src/schemas/accounting/doc-schemas';
import { cmd, useAccounting, useCashAccountOptions } from 'src/store';
import { ACC, todayISO, cashBalanceOf, formatThaiDate, isPettyCashAccount } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { Money, ConfirmSummary, RHFAmountField, formKeyHandler, LockedDateAlert } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  /** ค่าเริ่มต้น เช่น เบิกชดเชยเงินสดย่อย: from = ธนาคาร, to = เงินสดย่อย */
  defaultFrom?: string;
  defaultTo?: string;
};

/** โอนเงินระหว่างบัญชีของบริษัท / เบิกชดเชยเงินสดย่อย — ยืนยันก่อนออกเลข TR และลงบัญชี */
export function TransferDialog({ open, onClose, defaultFrom = ACC.bank, defaultTo = ACC.cash }: Props) {
  const { data, run, busy } = useAccounting();
  const cashAccounts = useCashAccountOptions();
  const confirm = useBoolean();
  const [pending, setPending] = useState<TransferSchemaType | null>(null);
  const defaults = (): TransferSchemaType => ({ date: todayISO(), fromAccountCode: defaultFrom, toAccountCode: defaultTo, amount: 0, note: '' });
  const methods = useForm<TransferSchemaType>({ resolver: zodResolver(TransferSchema), defaultValues: defaults() });
  const { control, reset, handleSubmit } = methods;
  const [date, from, to] = useWatch({ control, name: ['date', 'fromAccountCode', 'toAccountCode'] });
  const label = (code: string) => cashAccounts.find((a) => a.code === code)?.label ?? code;
  const title = to && isPettyCashAccount(data, to) ? 'เบิกชดเชยเงินสดย่อย' : 'โอนเงินระหว่างบัญชี';

  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFrom, defaultTo]);

  const onReview = handleSubmit((v) => {
    setPending(v);
    confirm.onTrue();
  });

  const submit = async () => {
    if (!pending) return;
    try {
      const r = await run(
        cmd.transferFunds({
          date: pending.date.slice(0, 10),
          fromAccountCode: pending.fromAccountCode,
          toAccountCode: pending.toAccountCode,
          amount: pending.amount,
          note: pending.note,
        })
      );
      confirm.onFalse();
      toast.success(`บันทึก${title} ${r.transfer.docNo} แล้ว`);
      onClose();
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <Form methods={methods}>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent onKeyDown={formKeyHandler(onReview)}>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Field.DatePicker name="date" label="วันที่โอน" />
              <LockedDateAlert date={date} />
              <Field.Select
                name="fromAccountCode"
                label="จากบัญชี"
                size="small"
                helperText={from ? `คงเหลือตามบัญชี ${cashBalanceOf(data, from).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท` : undefined}
              >
                {cashAccounts.map((a) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.label}
                  </MenuItem>
                ))}
              </Field.Select>
              <Field.Select name="toAccountCode" label="เข้าบัญชี" size="small">
                {cashAccounts.map((a) => (
                  <MenuItem key={a.code} value={a.code} disabled={a.code === from}>
                    {a.label}
                  </MenuItem>
                ))}
              </Field.Select>
              <RHFAmountField name="amount" label="จำนวนเงิน" />
              <Field.Text name="note" label="หมายเหตุ (เช่น เลขที่อ้างอิงการโอน)" size="small" />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton variant="contained" onClick={onReview}>
              บันทึก
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title={`ยืนยัน${title}`}
        content={
          pending && (
            <ConfirmSummary
              rows={[
                { label: 'วันที่', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: 'จากบัญชี', value: label(pending.fromAccountCode) },
                { label: 'เข้าบัญชี', value: label(pending.toAccountCode) },
                { label: 'จำนวนเงิน', value: <Money value={pending.amount} />, strong: true },
              ]}
              note="บันทึกแล้วระบบจะออกเลขที่ใบโอน (TR) และลงบัญชี Dr บัญชีปลายทาง / Cr บัญชีต้นทาง ทันที แก้ไขไม่ได้ — ผิดให้โอนกลับ"
            />
          )
        }
        action={
          <LoadingButton variant="contained" onClick={submit} loading={busy}>
            ยืนยัน
          </LoadingButton>
        }
      />
    </>
  );
}
