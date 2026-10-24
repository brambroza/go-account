import type { PettyCashExpenseSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo, useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, useFieldArray } from 'react-hook-form';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useBoolean } from 'src/hooks/use-boolean';

import { PettyCashExpenseSchema } from 'src/schemas/accounting/doc-schemas';
import { uid, useAccounting, useAccountLookup, recordPettyCashExpense } from 'src/store';
import {
  ACC,
  subBaht,
  VAT_RATE,
  todayISO,
  toSatang,
  calcDocument,
  cashBalanceOf,
  isValidISODate,
  formatThaiDate,
  cashAccountLabel,
  vatClaimPeriodOptions,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { ContactAutocomplete } from 'src/sections/shared/contact-autocomplete';
import { Money, ConfirmSummary, RHFAmountField, formKeyHandler, LockedDateAlert } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; pettyAccountCode: string };

const emptyLine = () => ({ id: uid(), description: '', accountCode: ACC.supplies, amount: 0 });

/**
 * ใบสำคัญจ่ายเงินสดย่อย — บันทึกเป็นเอกสารซื้อที่จ่ายทันทีจากเงินสดย่อย (PI + PV) ไม่มีหัก ณ ที่จ่าย
 * ขอคืนภาษีซื้อได้เมื่อมีใบกำกับเต็มรูปและเลือกผู้ขายที่มีเลขผู้เสียภาษี (ม.82/5) — ไม่ระบุผู้ขาย = ผู้รับเงินทั่วไป
 */
export function PettyCashDialog({ open, onClose, pettyAccountCode }: Props) {
  const { data, run } = useAccounting();
  const accounts = useAccountLookup();
  const confirm = useBoolean();
  const [pending, setPending] = useState<PettyCashExpenseSchemaType | null>(null);
  const { vatRegistered, lockedThrough } = data.company;
  const pettyAccounts = data.bankAccounts.filter((b) => b.kind === 'petty-cash');

  const defaults = (): PettyCashExpenseSchemaType => ({
    pettyAccountCode,
    date: todayISO(),
    contactId: '',
    vatMode: 'none',
    claimVat: false,
    supplierInvoiceNo: '',
    supplierInvoiceDate: todayISO(),
    note: '',
    lines: [emptyLine()],
  });
  const methods = useForm<PettyCashExpenseSchemaType>({ resolver: zodResolver(PettyCashExpenseSchema), defaultValues: defaults() });
  const { control, reset, handleSubmit } = methods;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: 'key' });
  const [date, petty, vatMode, claimVat, lines, invoiceDate] = useWatch({
    control,
    name: ['date', 'pettyAccountCode', 'vatMode', 'claimVat', 'lines', 'supplierInvoiceDate'],
  });
  const claim = vatRegistered && vatMode !== 'none' && !!claimVat;
  const totals = useMemo(
    () =>
      calcDocument({
        lines: (lines ?? []).map((l) => ({ ...l, qty: 1, unitPrice: l.amount ?? 0, discount: 0 })),
        vatMode: vatMode ?? 'none',
        vatRate: vatMode === 'none' ? 0 : VAT_RATE,
      }),
    [lines, vatMode]
  );
  const claimPeriod = claim ? vatClaimPeriodOptions(invoiceDate?.slice(0, 10), lockedThrough, data.openingBalance?.date)[0] : undefined;
  const balance = petty ? cashBalanceOf(data, petty) : 0;

  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pettyAccountCode]);

  const onReview = handleSubmit((v) => {
    setPending(v);
    confirm.onTrue();
  });

  const toInput = (v: PettyCashExpenseSchemaType) => {
    const claiming = vatRegistered && v.vatMode !== 'none' && !!v.claimVat;
    return {
      pettyAccountCode: v.pettyAccountCode,
      date: v.date.slice(0, 10),
      contactId: v.contactId || undefined,
      vatMode: v.vatMode,
      claimVat: claiming,
      supplierInvoiceNo: (v.supplierInvoiceNo ?? '').trim(),
      supplierInvoiceDate: v.supplierInvoiceDate?.slice(0, 10) || undefined,
      vatClaimPeriod: claiming ? claimPeriod : undefined,
      note: v.note,
      lines: v.lines.map((l) => ({ id: l.id, description: (l.description ?? '').trim(), accountCode: l.accountCode, amount: l.amount })),
    };
  };

  // U13: ทดลองบันทึก (ไม่เปลี่ยนข้อมูล) เพื่อบอกปัญหาที่ตรวจได้เฉพาะตอนบันทึก — เงินสดย่อยไม่พอ, วันที่ก่อนเอกสารล่าสุด, งวดปิด
  // แสดงก่อนกดยืนยันและปิดปุ่มยืนยันพร้อมเหตุผล (เดิมรู้หลังกดยืนยันเท่านั้น)
  const dryRunProblem = (v: PettyCashExpenseSchemaType | null): string | null => {
    if (!v || !isValidISODate((v.date ?? '').slice(0, 10))) return null;
    try {
      recordPettyCashExpense(data, toInput(v));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'บันทึกไม่ได้';
    }
  };
  const draft = methods.getValues();
  const liveProblem = open && toSatang(totals.total) > 0 && (lines ?? []).every((l) => (l.description ?? '').trim()) ? dryRunProblem(draft) : null;
  const pendingProblem = confirm.value ? dryRunProblem(pending) : null;

  const submit = () => {
    if (!pending) return;
    try {
      const r = run((s) => recordPettyCashExpense(s, toInput(pending)));
      confirm.onFalse();
      toast.success(`บันทึกจ่ายเงินสดย่อย ${r.payment?.docNo ?? r.doc.docNo} แล้ว`);
      onClose();
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <Form methods={methods}>
          <DialogTitle>จ่ายเงินสดย่อย</DialogTitle>
          <DialogContent onKeyDown={formKeyHandler(onReview)}>
            <Box sx={{ pt: 1, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
              <Field.Select
                name="pettyAccountCode"
                label="จ่ายจากเงินสดย่อย"
                size="small"
                helperText={`คงเหลือ ${balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`}
              >
                {pettyAccounts.map((b) => (
                  <MenuItem key={b.accountCode} value={b.accountCode}>
                    {cashAccountLabel({ code: b.accountCode, name: accounts.name(b.accountCode) }, { bankName: b.bankName, accountNo: '' })}
                  </MenuItem>
                ))}
              </Field.Select>
              <Field.DatePicker name="date" label="วันที่จ่าย" />
              <LockedDateAlert date={date} sx={{ gridColumn: { sm: 'span 2' } }} />

              <Field.Select name="vatMode" label="ภาษีมูลค่าเพิ่ม" size="small">
                <MenuItem value="none">ไม่มี VAT / ใบเสร็จอย่างย่อ</MenuItem>
                <MenuItem value="inclusive">ราคารวม VAT แล้ว</MenuItem>
                <MenuItem value="exclusive">ราคาไม่รวม VAT</MenuItem>
              </Field.Select>
              {vatRegistered && vatMode !== 'none' ? (
                <Field.Switch name="claimVat" label="ขอคืนภาษีซื้อ (มีใบกำกับภาษีเต็มรูป)" />
              ) : (
                <Box />
              )}

              {claim && (
                <>
                  <ContactAutocomplete name="contactId" label="ผู้ขาย (ต้องมีเลขผู้เสียภาษี/สาขา)" side="vendor" sx={{ gridColumn: { sm: 'span 2' } }} />
                  <Field.Text name="supplierInvoiceNo" label="เลขที่ใบกำกับภาษี" size="small" />
                  <Field.DatePicker name="supplierInvoiceDate" label="วันที่ในใบกำกับ" />
                  <Alert severity={claimPeriod ? 'info' : 'error'} variant="outlined" sx={{ gridColumn: { sm: 'span 2' } }}>
                    {claimPeriod ? `ภาษีซื้อเข้าเดือน ${claimPeriod}` : 'ใบกำกับเกิน 6 เดือนหรือเดือนภาษีปิดแล้ว — ขอคืนไม่ได้'}
                  </Alert>
                </>
              )}
              {!claim && (
                <Typography variant="body2" sx={{ color: 'text.secondary', gridColumn: { sm: 'span 2' } }}>
                  ไม่ขอคืนภาษีซื้อ — VAT (ถ้ามี) รวมเป็นค่าใช้จ่าย ผู้รับเงิน = “ผู้รับเงินทั่วไป (เงินสดย่อย)”
                </Typography>
              )}
            </Box>

            <Stack spacing={1.5} sx={{ mt: 3 }}>
              <Typography variant="subtitle2">รายการค่าใช้จ่าย</Typography>
              {fields.map((f, i) => (
                <Stack key={f.key} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                  <Field.Text name={`lines.${i}.description`} size="small" placeholder="เช่น ค่าน้ำมัน ค่าส่งเอกสาร" inputProps={{ 'aria-label': `รายการที่ ${i + 1}` }} />
                  <Field.Select name={`lines.${i}.accountCode`} size="small" sx={{ minWidth: 220 }} inputProps={{ 'aria-label': 'บัญชีค่าใช้จ่าย' }}>
                    {accounts.forLines('purchase').map((a) => (
                      <MenuItem key={a.code} value={a.code}>
                        {a.code} {a.name}
                      </MenuItem>
                    ))}
                  </Field.Select>
                  <RHFAmountField name={`lines.${i}.amount`} sx={{ maxWidth: { sm: 160 } }} inputProps={{ 'aria-label': 'จำนวนเงิน' }} />
                  <IconButton aria-label={`ลบรายการที่ ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}>
                    <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                  </IconButton>
                </Stack>
              ))}
              <Box>
                <Button size="small" startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => append(emptyLine())}>
                  เพิ่มรายการ
                </Button>
              </Box>
              {liveProblem && (
                <Alert severity="warning" variant="outlined">
                  {liveProblem}
                </Alert>
              )}
              <Stack direction="row" justifyContent="flex-end" spacing={3}>
                {vatMode !== 'none' && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    VAT <Money value={totals.vat} />
                  </Typography>
                )}
                <Typography variant="subtitle2">
                  จ่ายรวม <Money value={totals.total} sx={{ fontWeight: 600 }} />
                </Typography>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton variant="contained" onClick={onReview} disabled={!!liveProblem}>
              บันทึกจ่าย
            </LoadingButton>
          </DialogActions>
        </Form>
      </Dialog>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        maxWidth="sm"
        title="ยืนยันจ่ายเงินสดย่อย"
        content={
          pending && (
            <Stack spacing={2}>
            {pendingProblem && <Alert severity="error">{pendingProblem}</Alert>}
            <ConfirmSummary
              rows={[
                { label: 'วันที่จ่าย', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: 'จ่ายจาก', value: `${pending.pettyAccountCode} ${accounts.name(pending.pettyAccountCode)}` },
                { label: 'มูลค่าก่อนภาษี', value: totals.net },
                { label: claim ? `ภาษีซื้อ (ขอคืน เดือน ${claimPeriod ?? '-'})` : 'VAT (เป็นค่าใช้จ่าย)', value: totals.vat, hidden: !(totals.vat > 0) },
                { label: 'จ่ายรวม', value: totals.total, strong: true },
                { label: 'เงินสดย่อยคงเหลือหลังจ่าย', value: subBaht(balance, totals.total) },
              ]}
              note="บันทึกแล้วระบบจะออกเอกสารซื้อ (PI) + ใบสำคัญจ่าย (PV) และลงบัญชีทันที แก้ไขไม่ได้"
            />
            </Stack>
          )
        }
        action={
          <LoadingButton variant="contained" onClick={submit} disabled={!!pendingProblem}>
            ยืนยันจ่าย
          </LoadingButton>
        }
      />
    </>
  );
}
