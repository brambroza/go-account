import type { PurchaseDoc } from 'src/domain';
import type { PayPurchaseSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useBoolean } from 'src/hooks/use-boolean';

import { makePayPurchaseSchema } from 'src/schemas/accounting/doc-schemas';
import { ACC, todayISO, periodOf, periodLabel, calcDocument, formatThaiDate } from 'src/domain';
import { payPurchase, useAccounting, useAccountLookup, useContactLookup, DEPOSIT_ACCOUNTS } from 'src/store';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { Money, ConfirmSummary, LockedDateAlert, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; doc: PurchaseDoc | null };

/** จ่ายชำระเจ้าหนี้ — ออกใบสำคัญจ่าย (PV) และ 50 ทวิ เมื่อมีหัก ณ ที่จ่าย; ยืนยันสรุปก่อนบันทึก */
export function PayPurchaseDialog({ open, onClose, doc }: Props) {
  const { run } = useAccounting();
  const accounts = useAccountLookup();
  const contacts = useContactLookup();
  const confirm = useBoolean();
  const [pending, setPending] = useState<PayPurchaseSchemaType | null>(null);

  const methods = useForm<PayPurchaseSchemaType>({
    resolver: zodResolver(makePayPurchaseSchema(doc?.date ?? '')),
    defaultValues: { date: todayISO(), accountCode: ACC.bank },
  });
  const { control, reset, handleSubmit } = methods;
  const date = useWatch({ control, name: 'date' });

  useEffect(() => {
    if (open) reset({ date: todayISO(), accountCode: ACC.bank });
  }, [open, reset]);

  if (!doc) return null;
  const t = calcDocument(doc);
  const hasWht = doc.whtRate > 0;
  const pndForm = contacts.get(doc.contactId)?.legalForm === 'individual' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53';

  const onReview = handleSubmit((values) => {
    setPending(values);
    confirm.onTrue();
  });

  const submit = () => {
    if (!pending) return;
    try {
      const r = run((s) =>
        payPurchase(s, { purchaseId: doc.id, date: pending.date.slice(0, 10), accountCode: pending.accountCode })
      );
      confirm.onFalse();
      toast.success(
        r.payment.whtCertNo
          ? `จ่ายชำระ ${doc.docNo} แล้ว — ใบสำคัญจ่าย ${r.payment.docNo} · 50 ทวิ ${r.payment.whtCertNo} (รายการ ภ.ง.ด. พร้อมในศูนย์ภาษี)`
          : `จ่ายชำระ ${doc.docNo} แล้ว — ใบสำคัญจ่าย ${r.payment.docNo}`
      );
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
          <DialogTitle>จ่ายชำระ {doc.docNo}</DialogTitle>
          <DialogContent onKeyDown={preventEnterSubmit}>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Field.DatePicker
                name="date"
                label="วันที่จ่าย"
                slotProps={{ textField: { helperText: 'ภาษีหัก ณ ที่จ่ายจะเข้างวดของวันที่จ่าย' } }}
              />
              <LockedDateAlert date={date} />
              <Field.Select name="accountCode" label="จ่ายจากบัญชี" size="small">
                {DEPOSIT_ACCOUNTS.map((code) => (
                  <MenuItem key={code} value={code}>
                    {code} {accounts.name(code)}
                  </MenuItem>
                ))}
              </Field.Select>
              <Alert severity="info" variant="outlined">
                โอนจริง <Money value={t.payable} sx={{ fontWeight: 600 }} /> บาท
                {hasWht && (
                  <>
                    {' '}
                    · หัก ณ ที่จ่าย {doc.whtRate}% = <Money value={t.wht} /> บาท (นำส่งพร้อม {pndForm})
                  </>
                )}
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton variant="contained" onClick={onReview}>
              บันทึกจ่ายชำระ
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title={`ยืนยันจ่ายชำระ ${doc.docNo}`}
        content={
          pending && (
            <ConfirmSummary
              rows={[
                { label: 'ผู้รับเงิน', value: contacts.name(doc.contactId) },
                { label: 'วันที่จ่าย', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: 'ตัดเจ้าหนี้', value: t.total },
                { label: `หัก ณ ที่จ่าย ${doc.whtRate}%`, value: t.wht, hidden: !hasWht },
                {
                  label: 'แบบยื่น',
                  value: `${pndForm} เดือน${periodLabel(periodOf(pending.date.slice(0, 10)))}`,
                  hidden: !hasWht,
                },
                { label: `จ่ายจริงจาก ${accounts.name(pending.accountCode)}`, value: t.payable, strong: true },
              ]}
              note={
                hasWht
                  ? 'บันทึกแล้วระบบจะออกเลขใบสำคัญจ่าย (PV) และหนังสือรับรอง 50 ทวิ แล้วลงบัญชีทันที แก้ไขไม่ได้'
                  : 'บันทึกแล้วระบบจะออกเลขใบสำคัญจ่าย (PV) และลงบัญชีทันที แก้ไขไม่ได้'
              }
            />
          )
        }
        action={
          <LoadingButton variant="contained" onClick={submit}>
            ยืนยันจ่ายชำระ
          </LoadingButton>
        }
      />
    </>
  );
}
