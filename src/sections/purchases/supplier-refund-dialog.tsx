import type { SupplierRefundSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useBoolean } from 'src/hooks/use-boolean';

import { makeSupplierRefundSchema } from 'src/schemas/accounting/doc-schemas';
import { ACC, subBaht, todayISO, formatThaiDate, supplierRefundDueOf } from 'src/domain';
import { cmd, useAccounting, useAccountLookup, useContactLookup, useCashAccountOptions } from 'src/store';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { Money, ConfirmSummary, RHFAmountField, formKeyHandler, LockedDateAlert } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; contactId: string };

/**
 * D1 — รับเงินคืนจากผู้ขาย (SR) จากยอดเงินคืนที่เกิดจากใบลดหนี้หลังจ่ายเงินแล้ว (ลูกหนี้-เงินคืนจากผู้ขาย 1150)
 * กติกา (ยอดคงค้าง ณ วันที่รับ, บัญชีรับเงิน, งวดปิด) ตรวจที่ `receiveSupplierRefund` — ยืนยันสรุปก่อนบันทึก
 */
export function SupplierRefundDialog({ open, onClose, contactId }: Props) {
  const { data, run, busy } = useAccounting();
  const accounts = useAccountLookup();
  const cashAccounts = useCashAccountOptions();
  const contacts = useContactLookup();
  const confirm = useBoolean();
  const [pending, setPending] = useState<SupplierRefundSchemaType | null>(null);
  const available = supplierRefundDueOf(data, contactId);
  const initial = (): SupplierRefundSchemaType => ({ date: todayISO(), amount: available, accountCode: ACC.bank, note: '' });

  const methods = useForm<SupplierRefundSchemaType>({ resolver: zodResolver(makeSupplierRefundSchema(available)), defaultValues: initial() });
  const { control, reset, handleSubmit } = methods;
  const date = useWatch({ control, name: 'date' });

  useEffect(() => {
    if (open) reset(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onReview = handleSubmit((values) => {
    setPending(values);
    confirm.onTrue();
  });

  const submit = async () => {
    if (!pending) return;
    try {
      const r = await run(
        cmd.receiveSupplierRefund({
          contactId,
          date: pending.date.slice(0, 10),
          amount: pending.amount,
          accountCode: pending.accountCode,
          note: pending.note?.trim() || undefined,
        })
      );
      confirm.onFalse();
      toast.success(`บันทึกรับเงินคืนจากผู้ขาย ${r.refund.docNo} แล้ว`);
      onClose();
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <Form methods={methods}>
          <DialogTitle>รับเงินคืนจากผู้ขาย</DialogTitle>
          <DialogContent onKeyDown={formKeyHandler(onReview)}>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  เงินคืนค้างรับจาก {contacts.name(contactId)}
                </Typography>
                <Money value={available} variant="subtitle1" />
              </Stack>
              <Field.DatePicker name="date" label="วันที่รับเงินคืน" />
              <LockedDateAlert date={date} />
              <RHFAmountField name="amount" label="ยอดรับเงินคืน" />
              <Field.Select name="accountCode" label="รับเข้าบัญชี" size="small">
                {cashAccounts.map((a) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.label}
                  </MenuItem>
                ))}
              </Field.Select>
              <Field.Text name="note" label="หมายเหตุ (เช่น เลขที่โอน)" size="small" />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton variant="contained" onClick={onReview} disabled={!(available > 0)}>
              บันทึกรับเงินคืน
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title="ยืนยันรับเงินคืนจากผู้ขาย"
        content={
          pending && (
            <ConfirmSummary
              rows={[
                { label: 'ผู้ขาย', value: contacts.name(contactId) },
                { label: 'วันที่รับเงินคืน', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: `รับเข้า ${accounts.name(pending.accountCode)}`, value: pending.amount, strong: true },
                { label: 'เงินคืนค้างรับคงเหลือ', value: subBaht(available, pending.amount) },
              ]}
              note={`บันทึกแล้วระบบจะออกเลขที่รับเงินคืน (SR) และลงบัญชี Dr เงินสด-ธนาคาร / Cr ลูกหนี้-เงินคืนจากผู้ขาย (${ACC.supplierRefundReceivable}) ทันที แก้ไขไม่ได้`}
            />
          )
        }
        action={
          <LoadingButton variant="contained" onClick={submit} loading={busy}>
            ยืนยันรับเงินคืน
          </LoadingButton>
        }
      />
    </>
  );
}
