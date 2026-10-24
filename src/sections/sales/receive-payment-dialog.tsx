import type { SalesDoc } from 'src/domain';
import type { ReceiptSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useForm, useWatch } from 'react-hook-form';
import { useMemo, useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useBoolean } from 'src/hooks/use-boolean';

import { makeReceiptSchema } from 'src/schemas/accounting/doc-schemas';
import { outstandingOf, useAccounting, receivePayment, useAccountLookup, DEPOSIT_ACCOUNTS } from 'src/store';
import { ACC, subBaht, todayISO, toSatang, calcDocument, formatThaiDate, receiptWhtAmount } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { Money, ConfirmSummary, RHFAmountField, LockedDateAlert, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

const WHT_RATES = [
  { rate: 0, label: 'ไม่หัก' },
  { rate: 1, label: '1% ค่าขนส่ง' },
  { rate: 2, label: '2% ค่าโฆษณา' },
  { rate: 3, label: '3% ค่าบริการ / ค่าจ้างทำของ' },
  { rate: 5, label: '5% ค่าเช่า' },
];

type Props = { open: boolean; onClose: () => void; invoice: SalesDoc };

/** รับชำระใบกำกับ (บางส่วนได้) + ภาษีที่ลูกค้าหัก ณ ที่จ่าย — ยืนยันสรุปก่อนบันทึก */
export function ReceivePaymentDialog({ open, onClose, invoice }: Props) {
  const { data, run } = useAccounting();
  const accounts = useAccountLookup();
  const outstanding = outstandingOf(data, invoice);
  const totals = useMemo(() => calcDocument(invoice), [invoice]);
  const confirm = useBoolean();
  const [pending, setPending] = useState<ReceiptSchemaType | null>(null);

  const defaultValues: ReceiptSchemaType = {
    date: todayISO(),
    amount: outstanding,
    whtRate: 0,
    whtAmount: 0,
    depositAccountCode: ACC.bank,
  };

  const methods = useForm<ReceiptSchemaType>({
    resolver: zodResolver(makeReceiptSchema(outstanding, invoice.date)),
    defaultValues,
  });
  const { control, reset, setValue, handleSubmit } = methods;
  const [date, amount, whtRate, whtAmount, account] = useWatch({
    control,
    name: ['date', 'amount', 'whtRate', 'whtAmount', 'depositAccountCode'],
  });

  useEffect(() => {
    if (open) reset({ ...defaultValues, amount: outstanding });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ภาษีถูกหักคิดจากมูลค่าก่อน VAT ตามสัดส่วนที่รับครั้งนี้ (domain) — ผู้ใช้แก้ตาม 50 ทวิ ที่ได้รับได้
  useEffect(() => {
    setValue('whtAmount', receiptWhtAmount(totals, amount ?? 0, whtRate ?? 0));
  }, [whtRate, amount, totals, setValue]);

  const netReceived = subBaht(amount ?? 0, whtAmount ?? 0);

  const onReview = handleSubmit((values) => {
    setPending(values);
    confirm.onTrue();
  });

  const submit = () => {
    if (!pending) return;
    try {
      const r = run((s) =>
        receivePayment(s, {
          invoiceId: invoice.id,
          date: pending.date.slice(0, 10),
          amount: pending.amount,
          whtAmount: pending.whtAmount,
          depositAccountCode: pending.depositAccountCode,
        })
      );
      confirm.onFalse();
      toast.success(`บันทึกรับชำระ ${r.receipt.docNo} แล้ว`);
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
          <DialogTitle>รับชำระ {invoice.docNo}</DialogTitle>
          <DialogContent onKeyDown={preventEnterSubmit}>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  ยอดค้างชำระ
                </Typography>
                <Money value={outstanding} variant="subtitle1" />
              </Stack>

              <Field.DatePicker name="date" label="วันที่รับเงิน" />
              <LockedDateAlert date={date} />

              <RHFAmountField name="amount" label="ยอดที่ตัดลูกหนี้ (รับบางส่วนได้)" />

              <Field.Select name="whtRate" label="ลูกค้าหักภาษี ณ ที่จ่าย" size="small">
                {WHT_RATES.map((w) => (
                  <MenuItem key={w.rate} value={w.rate}>
                    {w.label}
                  </MenuItem>
                ))}
              </Field.Select>

              {!!whtRate && <RHFAmountField name="whtAmount" label="ภาษีที่ถูกหัก (ตาม 50 ทวิ ที่ได้รับ)" />}

              <Field.Select name="depositAccountCode" label="รับเข้าบัญชี" size="small">
                {DEPOSIT_ACCOUNTS.map((code) => (
                  <MenuItem key={code} value={code}>
                    {code} {accounts.name(code)}
                  </MenuItem>
                ))}
              </Field.Select>

              <Alert severity="info" variant="outlined">
                เงินเข้าบัญชีจริง <Money value={netReceived} sx={{ fontWeight: 600 }} /> บาท · ระบบจะลงบัญชี Dr{' '}
                {accounts.name(account ?? '')}
                {toSatang(whtAmount ?? 0) > 0 ? ' + ภาษีถูกหัก ณ ที่จ่าย' : ''} / Cr ลูกหนี้การค้า
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton variant="contained" onClick={onReview}>
              บันทึกรับชำระ
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title={`ยืนยันรับชำระ ${invoice.docNo}`}
        content={
          pending && (
            <ConfirmSummary
              rows={[
                { label: 'วันที่รับเงิน', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: 'ตัดลูกหนี้', value: pending.amount },
                { label: 'ภาษีถูกหัก ณ ที่จ่าย', value: pending.whtAmount, hidden: toSatang(pending.whtAmount) <= 0 },
                {
                  label: `เงินเข้า ${accounts.name(pending.depositAccountCode)}`,
                  value: subBaht(pending.amount, pending.whtAmount),
                  strong: true,
                },
                { label: 'ค้างชำระหลังรับ', value: subBaht(outstanding, pending.amount) },
              ]}
              note="บันทึกแล้วระบบจะออกเลขใบรับชำระและลงบัญชีทันที แก้ไขไม่ได้"
            />
          )
        }
        action={
          <LoadingButton variant="contained" onClick={submit}>
            ยืนยันรับชำระ
          </LoadingButton>
        }
      />
    </>
  );
}
