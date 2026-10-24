import type { PurchaseDoc } from 'src/domain';
import type { PayPurchaseSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useForm, useWatch } from 'react-hook-form';
import { useMemo, useState, useEffect } from 'react';
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
import { payPurchase, useAccounting, useAccountLookup, useContactLookup, DEPOSIT_ACCOUNTS } from 'src/store';
import {
  ACC,
  toSatang,
  todayISO,
  periodOf,
  periodLabel,
  calcDocument,
  formatThaiDate,
  whtSummaryLabel,
  purchaseWhtGroups,
  planPurchasePayment,
  purchaseOutstanding,
  whtSmallPaymentWarning,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { Money, ConfirmSummary, RHFAmountField, LockedDateAlert, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; doc: PurchaseDoc | null };

/**
 * จ่ายชำระเจ้าหนี้ (แบ่งจ่ายได้) — ออกใบสำคัญจ่าย (PV) และ 50 ทวิ ของการจ่ายครั้งนี้เมื่อมีหัก ณ ที่จ่าย
 * หัก ณ ที่จ่ายตามสัดส่วนยอดที่จ่าย คำนวณโดย `planPurchasePayment` (กฎเดียวกับ action) ยืนยันสรุปก่อนบันทึก
 */
export function PayPurchaseDialog({ open, onClose, doc }: Props) {
  const { data, run } = useAccounting();
  const accounts = useAccountLookup();
  const contacts = useContactLookup();
  const confirm = useBoolean();
  const [pending, setPending] = useState<PayPurchaseSchemaType | null>(null);
  const outstanding = doc ? purchaseOutstanding(data, doc) : 0;

  const methods = useForm<PayPurchaseSchemaType>({
    resolver: zodResolver(makePayPurchaseSchema(doc?.date ?? '', outstanding)),
    defaultValues: { date: todayISO(), accountCode: ACC.bank, amount: outstanding },
  });
  const { control, reset, handleSubmit } = methods;
  const [date, amount] = useWatch({ control, name: ['date', 'amount'] });

  useEffect(() => {
    if (open) reset({ date: todayISO(), accountCode: ACC.bank, amount: outstanding });
  }, [open, reset, outstanding]);

  const plan = useMemo(() => {
    if (!doc || !(toSatang(amount ?? 0) > 0) || toSatang(amount ?? 0) > toSatang(outstanding)) return null;
    return planPurchasePayment(data, doc, amount ?? 0);
  }, [data, doc, amount, outstanding]);

  if (!doc) return null;
  const {total} = calcDocument(doc);
  const groups = purchaseWhtGroups(doc);
  const hasWht = !!plan && toSatang(plan.whtAmount) > 0;
  const smallPayment = plan ? whtSmallPaymentWarning(plan) : null;
  const pndForm = contacts.get(doc.contactId)?.legalForm === 'individual' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53';

  const onReview = handleSubmit((values) => {
    setPending(values);
    confirm.onTrue();
  });

  const submit = () => {
    if (!pending) return;
    try {
      const r = run((s) =>
        payPurchase(s, {
          purchaseId: doc.id,
          date: pending.date.slice(0, 10),
          accountCode: pending.accountCode,
          amount: pending.amount,
        })
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
              <Alert severity="info" variant="outlined">
                ยอดเอกสาร <Money value={total} /> · ค้างจ่าย <Money value={outstanding} sx={{ fontWeight: 600 }} /> บาท
                {groups.length > 0 && <> · หัก ณ ที่จ่าย {whtSummaryLabel(groups)}</>}
              </Alert>
              <Field.DatePicker
                name="date"
                label="วันที่จ่าย"
                slotProps={{ textField: { helperText: 'ภาษีหัก ณ ที่จ่ายของครั้งนี้จะเข้างวดของวันที่จ่าย' } }}
              />
              <LockedDateAlert date={date} />
              <RHFAmountField name="amount" label="ยอดตัดเจ้าหนี้ครั้งนี้ (รวม VAT)" />
              <Field.Select name="accountCode" label="จ่ายจากบัญชี" size="small">
                {DEPOSIT_ACCOUNTS.map((code) => (
                  <MenuItem key={code} value={code}>
                    {code} {accounts.name(code)}
                  </MenuItem>
                ))}
              </Field.Select>
              {plan && (
                <Alert severity="info" variant="outlined">
                  โอนจริง <Money value={plan.netPaid} sx={{ fontWeight: 600 }} /> บาท
                  {hasWht && (
                    <>
                      {' '}
                      · หัก ณ ที่จ่าย <Money value={plan.whtAmount} /> บาท (นำส่งพร้อม {pndForm})
                    </>
                  )}
                  {!plan.final && ' · แบ่งจ่าย (ยังค้างหลังจ่ายครั้งนี้)'}
                </Alert>
              )}
              {smallPayment && (
                <Alert severity="warning" variant="outlined">
                  {smallPayment}
                </Alert>
              )}
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
          pending &&
          plan && (
            <ConfirmSummary
              rows={[
                { label: 'ผู้รับเงิน', value: contacts.name(doc.contactId) },
                { label: 'วันที่จ่าย', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: plan.final ? 'ตัดเจ้าหนี้ (ครบยอด)' : 'ตัดเจ้าหนี้ (แบ่งจ่าย)', value: pending.amount ?? outstanding },
                ...plan.whtItems.map((i) => ({ label: `หัก ณ ที่จ่าย ${i.incomeType} ${i.rate}% ของ ${i.base.toFixed(2)}`, value: i.tax })),
                {
                  label: 'แบบยื่น',
                  value: `${pndForm} เดือน${periodLabel(periodOf(pending.date.slice(0, 10)))}`,
                  hidden: !hasWht,
                },
                { label: `จ่ายจริงจาก ${accounts.name(pending.accountCode)}`, value: plan.netPaid, strong: true },
              ]}
              note={
                hasWht
                  ? 'บันทึกแล้วระบบจะออกเลขใบสำคัญจ่าย (PV) และหนังสือรับรอง 50 ทวิ ของครั้งนี้ แล้วลงบัญชีทันที แก้ไขไม่ได้'
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
