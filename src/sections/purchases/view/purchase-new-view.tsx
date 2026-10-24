import type { PurchaseSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useForm, useWatch } from 'react-hook-form';
import { useMemo, useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { PurchaseSchema } from 'src/schemas/accounting/doc-schemas';
import { useAccounting, recordPurchase, useAccountLookup, useContactLookup, useCashAccountOptions } from 'src/store';
import {
  ACC,
  VAT_RATE,
  todayISO,
  periodOf,
  periodLabel,
  partySnapshot,
  periodFromKey,
  formatThaiDate,
  purchaseTotals,
  whtSummaryLabel,
  purchaseWhtGroups,
  planPurchasePayment,
  findDuplicatePurchase,
  vatClaimPeriodOptions,
  whtSmallPaymentWarning,
  supplierVatClaimProblem,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { ContactAutocomplete } from 'src/sections/shared/contact-autocomplete';
import {
  TotalsSummary,
  ConfirmSummary,
  DocLinesEditor,
  formKeyHandler,
  newPurchaseLine,
  LockedDateAlert,
} from 'src/sections/shared';

// ----------------------------------------------------------------------

/** บันทึกซื้อ/ค่าใช้จ่าย (+ จ่ายทันทีได้) — ยืนยันสรุป VAT / หัก ณ ที่จ่าย / ยอดจ่ายก่อนบันทึก */
export function PurchaseNewView() {
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const cashAccounts = useCashAccountOptions();
  const { vatRegistered, lockedThrough } = data.company;
  const confirm = useBoolean();
  const [pending, setPending] = useState<PurchaseSchemaType | null>(null);

  const methods = useForm<PurchaseSchemaType>({
    resolver: zodResolver(PurchaseSchema),
    defaultValues: {
      contactId: '',
      supplierInvoiceNo: '',
      supplierInvoiceDate: todayISO(),
      vatClaimPeriod: vatClaimPeriodOptions(todayISO(), lockedThrough, data.openingBalance?.date)[0] ?? '',
      date: todayISO(),
      vatMode: 'exclusive',
      claimVat: vatRegistered,
      whtCondition: '1',
      payNow: false,
      paidDate: todayISO(),
      paymentAccountCode: ACC.bank,
      note: '',
      lines: [newPurchaseLine(ACC.misc)],
    },
  });

  const { control, setValue, getValues, handleSubmit, formState } = methods;
  const [contactId, date, paidDate, vatMode, claimVatInput, payNow, lines, supplierInvoiceNo, supplierInvoiceDate] = useWatch({
    control,
    name: ['contactId', 'date', 'paidDate', 'vatMode', 'claimVat', 'payNow', 'lines', 'supplierInvoiceNo', 'supplierInvoiceDate'],
  });
  const vendor = contacts.get(contactId);
  // เตือนเลขใบกำกับซ้ำตั้งแต่ตอนกรอก (กฎเดียวกับที่ action ใช้ปฏิเสธ)
  const duplicate = useMemo(
    () =>
      contactId
        ? findDuplicatePurchase(data.purchases, data.contacts, { contactId, supplierInvoiceNo: supplierInvoiceNo ?? '' })
        : undefined,
    [data.purchases, data.contacts, contactId, supplierInvoiceNo]
  );

  const wantClaim = vatRegistered && vatMode !== 'none' && !!claimVatInput;
  // ม.82/5: ผู้ขายไม่มีเลขผู้เสียภาษี/สาขาที่ถูกต้อง → ภาษีซื้อต้องห้าม บันทึกเป็นค่าใช้จ่าย (action ทำแบบเดียวกัน)
  const supplierProblem = vendor && wantClaim ? supplierVatClaimProblem(partySnapshot(vendor)) : null;
  const claim = wantClaim && !supplierProblem;

  // เดือนใช้สิทธิภาษีซื้อ: เดือนในใบกำกับ ถึง +6 เดือน ที่ยังไม่ปิดงวด (ม.82/3)
  const claimOptions = useMemo(
    () => vatClaimPeriodOptions(supplierInvoiceDate?.slice(0, 10), lockedThrough, data.openingBalance?.date),
    [supplierInvoiceDate, lockedThrough, data.openingBalance?.date]
  );
  useEffect(() => {
    const current = getValues('vatClaimPeriod') ?? '';
    if (!claimOptions.includes(current)) setValue('vatClaimPeriod', claimOptions[0] ?? '');
  }, [claimOptions, getValues, setValue]);

  const draft = useMemo(
    () => ({ lines: lines ?? [], vatMode: vatMode ?? 'none', vatRate: VAT_RATE }),
    [lines, vatMode]
  );
  const totals = useMemo(() => purchaseTotals(draft), [draft]);
  const whtGroups = useMemo(() => purchaseWhtGroups(draft), [draft]);
  const whtText = whtGroups.length ? `หัก ณ ที่จ่าย (${whtSummaryLabel(whtGroups)})` : undefined;
  // จ่ายทันที = จ่ายครั้งเดียวเต็มจำนวน — เตือนตาม ท.ป.4/2528 ข้อ 12 ถ้าเงินได้ต่ำกว่า 1,000 บาท
  const smallPayment = payNow
    ? whtSmallPaymentWarning(
        planPurchasePayment({ payments: [] }, { ...draft, id: '' }, totals.total)
      )
    : null;

  // ผ่าน validation แล้วเปิดสรุปให้ยืนยันก่อน
  const onSubmit = handleSubmit((v) => {
    setPending(v);
    confirm.onTrue();
  });

  const save = () => {
    const v = pending;
    if (!v) return;
    try {
      const r = run((s) =>
        recordPurchase(s, {
          contactId: v.contactId,
          supplierInvoiceNo: v.supplierInvoiceNo.trim(),
          supplierInvoiceDate: v.supplierInvoiceDate ? v.supplierInvoiceDate.slice(0, 10) : undefined,
          vatClaimPeriod: v.vatClaimPeriod || undefined,
          date: v.date.slice(0, 10),
          vatMode: v.vatMode,
          claimVat: v.claimVat,
          whtCondition: v.whtCondition,
          note: v.note,
          lines: v.lines,
          payNow: v.payNow ? { date: (v.paidDate ?? v.date).slice(0, 10), accountCode: v.paymentAccountCode } : undefined,
        })
      );
      confirm.onFalse();
      toast.success(
        r.payment
          ? `บันทึก ${r.doc.docNo} และจ่ายชำระ ${r.payment.docNo}${r.payment.whtCertNo ? ` (50 ทวิ ${r.payment.whtCertNo})` : ''} แล้ว`
          : `บันทึก ${r.doc.docNo} แล้ว`
      );
      router.push(paths.purchases.root);
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  const pendingVendor = pending ? contacts.get(pending.contactId) : undefined;
  const pendingClaim =
    !!pending &&
    vatRegistered &&
    pending.vatMode !== 'none' &&
    pending.claimVat &&
    !supplierVatClaimProblem(pendingVendor && partySnapshot(pendingVendor));
  const pndForm = pendingVendor?.legalForm === 'individual' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53';
  const pendingPaidDate = pending ? (pending.paidDate ?? pending.date).slice(0, 10) : '';

  return (
    <>
      <CustomBreadcrumbs
        heading="บันทึกซื้อ / ค่าใช้จ่าย"
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ซื้อ / ค่าใช้จ่าย', href: paths.purchases.root },
          { name: 'บันทึกใหม่' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Form methods={methods} onSubmit={onSubmit}>
        <Grid container spacing={3} onKeyDown={formKeyHandler(onSubmit)}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader title="ผู้ขายและใบกำกับภาษี" />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                <ContactAutocomplete name="contactId" label="ผู้ขาย / ผู้รับเงิน" side="vendor" sx={{ gridColumn: { sm: 'span 2' } }} />
                <Field.DatePicker
                  name="date"
                  label="วันที่บันทึก"
                  slotProps={{ textField: { helperText: 'วันที่ลงบัญชี — เลขที่ PI เรียงตามวันที่นี้' } }}
                />
                <Field.Text name="supplierInvoiceNo" label="เลขที่ใบกำกับภาษีของผู้ขาย" size="small" />
                <Field.DatePicker name="supplierInvoiceDate" label="วันที่ในใบกำกับของผู้ขาย" />
                <Field.Select name="vatMode" label="ภาษีมูลค่าเพิ่ม" size="small">
                  <MenuItem value="exclusive">ราคาไม่รวม VAT</MenuItem>
                  <MenuItem value="inclusive">ราคารวม VAT แล้ว</MenuItem>
                  <MenuItem value="none">ไม่มี VAT (ผู้ขายไม่จด VAT)</MenuItem>
                </Field.Select>
                <Field.Switch
                  name="claimVat"
                  label={vatRegistered ? 'ขอคืนภาษีซื้อ (มีใบกำกับเต็มรูป)' : 'ขอคืนภาษีซื้อไม่ได้ (บริษัทไม่จด VAT)'}
                  disabled={vatMode === 'none' || !vatRegistered}
                />
                {wantClaim && (
                  <Field.Select
                    name="vatClaimPeriod"
                    label="ใช้สิทธิภาษีซื้อในเดือนภาษี"
                    size="small"
                    disabled={!claimOptions.length}
                    helperText={
                      claimOptions.length
                        ? 'เดือนในใบกำกับ หรือเดือนถัดไปไม่เกิน 6 เดือน (ม.82/3) — เดือนที่ปิดงวดแล้วเลือกไม่ได้'
                        : 'ใบกำกับเกิน 6 เดือนหรือทุกเดือนในช่วงปิดงวดแล้ว — ใช้สิทธิไม่ได้ ปิดสวิตช์ขอคืนเพื่อบันทึกเป็นค่าใช้จ่าย'
                    }
                  >
                    {claimOptions.map((m) => (
                      <MenuItem key={m} value={m}>
                        {periodLabel(periodFromKey(m))}
                      </MenuItem>
                    ))}
                  </Field.Select>
                )}
                {supplierProblem && (
                  <Alert severity="warning" variant="outlined" sx={{ gridColumn: { sm: 'span 2' } }}>
                    {supplierProblem} — ใบกำกับไม่มีรายการตาม ม.86/4 ใช้เป็นภาษีซื้อไม่ได้ (ม.82/5) ระบบจะบันทึกภาษีซื้อรวมเป็นค่าใช้จ่าย
                    แก้ข้อมูลผู้ขายก่อนถ้าต้องการขอคืน
                  </Alert>
                )}
                <LockedDateAlert date={date} sx={{ gridColumn: { sm: 'span 2' } }} />
                {duplicate && (
                  <Alert severity="error" variant="outlined" sx={{ gridColumn: { sm: 'span 2' } }}>
                    ใบกำกับเลขที่นี้ของผู้ขายรายนี้บันทึกไปแล้วใน {duplicate.docNo} (เลขที่ {duplicate.supplierInvoiceNo}) —
                    บันทึกซ้ำไม่ได้เพื่อไม่ให้ขอคืนภาษีซื้อสองครั้ง
                  </Alert>
                )}
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader
                title="รายการ"
                subheader="หัก ณ ที่จ่ายรายบรรทัด — สินค้าเลือก “ไม่หัก”, ค่าบริการ/ค่าเช่า/ค่าขนส่ง เลือกประเภทเงินได้ (ฐาน = มูลค่าก่อน VAT ของบรรทัด)"
              />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor
                  accounts={accounts.forLines('purchase')}
                  defaultAccountCode={ACC.misc}
                  accountLabel="บัญชีค่าใช้จ่าย"
                  withWht
                />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader title="หัก ณ ที่จ่าย" subheader="เข้างวด ภ.ง.ด. ตามวันที่จ่ายจริง · แบ่งจ่ายได้ (หักตามสัดส่วนของแต่ละครั้ง)" />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' } }}>
                <Field.Select name="whtCondition" label="เงื่อนไข" size="small">
                  <MenuItem value="1">หัก ณ ที่จ่าย</MenuItem>
                  <MenuItem value="2">ออกให้ตลอดไป</MenuItem>
                  <MenuItem value="3">ออกให้ครั้งเดียว</MenuItem>
                </Field.Select>
                <Typography variant="body2" sx={{ color: 'text.secondary', alignSelf: 'center' }}>
                  {whtGroups.length
                    ? whtGroups.map((g) => `${g.incomeType} ${g.rate}% ของ ${g.base.toLocaleString('th-TH', { minimumFractionDigits: 2 })} = ${g.tax.toFixed(2)}`).join(' · ')
                    : 'ไม่มีบรรทัดที่หัก ณ ที่จ่าย'}
                </Typography>
                {vendor && whtGroups.length > 0 && (
                  <Alert severity="info" variant="outlined" sx={{ gridColumn: { sm: 'span 2' } }}>
                    รายการนี้จะเข้า {vendor.legalForm === 'individual' ? 'ภ.ง.ด.3 (บุคคลธรรมดา)' : 'ภ.ง.ด.53 (นิติบุคคล)'} ของเดือนที่จ่าย
                  </Alert>
                )}
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3, position: { lg: 'sticky' }, top: { lg: 96 } }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                สรุปยอด
              </Typography>
              <TotalsSummary
                totals={totals}
                vatRate={VAT_RATE}
                showVat={vatMode !== 'none'}
                whtText={whtText}
                payableLabel="ยอดโอนจริง (จ่ายครั้งเดียว)"
              />
              {vatMode !== 'none' && vatRegistered && !claim && (
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                  ภาษีซื้อไม่ขอคืน — รวมเป็นต้นทุน/ค่าใช้จ่าย
                </Typography>
              )}

              <Stack spacing={2} sx={{ mt: 3 }}>
                <Field.Switch name="payNow" label="จ่ายเงินแล้ว / จ่ายทันที" />
                {payNow && (
                  <>
                    <Field.DatePicker name="paidDate" label="วันที่จ่าย" />
                    <LockedDateAlert date={paidDate} />
                    {smallPayment && (
                      <Alert severity="warning" variant="outlined">
                        {smallPayment}
                      </Alert>
                    )}
                    <Field.Select name="paymentAccountCode" label="จ่ายจากบัญชี" size="small">
                      {cashAccounts.map((a) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.label}
                  </MenuItem>
                ))}
                    </Field.Select>
                  </>
                )}
                <LoadingButton type="submit" variant="contained" size="large" loading={formState.isSubmitting} disabled={!!duplicate}>
                  บันทึก
                </LoadingButton>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title="ยืนยันบันทึกซื้อ / ค่าใช้จ่าย"
        content={
          pending && (
            <ConfirmSummary
              rows={[
                { label: 'ผู้ขาย', value: contacts.name(pending.contactId) },
                { label: 'เลขที่ใบกำกับผู้ขาย', value: pending.supplierInvoiceNo.trim() || '-' },
                {
                  label: 'วันที่ในใบกำกับผู้ขาย',
                  value: pending.supplierInvoiceDate ? formatThaiDate(pending.supplierInvoiceDate.slice(0, 10)) : '-',
                },
                { label: 'วันที่บันทึก', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: 'มูลค่าก่อนภาษี', value: totals.net },
                { label: `ภาษีซื้อ ${VAT_RATE}%`, value: totals.vat, hidden: pending.vatMode === 'none' },
                {
                  label: 'ภาษีซื้อ',
                  value:
                    pendingClaim && pending.vatClaimPeriod
                      ? `ใช้สิทธิในเดือนภาษี${periodLabel(periodFromKey(pending.vatClaimPeriod))}`
                      : 'ไม่ขอคืน — บันทึกรวมเป็นต้นทุน/ค่าใช้จ่าย',
                  hidden: pending.vatMode === 'none',
                },
                { label: 'รวมทั้งสิ้น', value: totals.total, strong: true },
                { label: whtText ?? 'หัก ณ ที่จ่าย', value: totals.wht, hidden: !whtGroups.length },
                {
                  label: 'แบบยื่น',
                  value: pending.payNow
                    ? `${pndForm} เดือน${periodLabel(periodOf(pendingPaidDate))}`
                    : `${pndForm} ของเดือนที่จ่ายชำระ`,
                  hidden: !whtGroups.length,
                },
                {
                  label: `จ่ายทันที ${formatThaiDate(pendingPaidDate)} จาก ${accounts.name(pending.paymentAccountCode)}`,
                  value: totals.payable,
                  strong: true,
                  hidden: !pending.payNow,
                },
              ]}
              note={
                pending.payNow
                  ? 'บันทึกแล้วระบบจะออกเลขเอกสารซื้อ ใบสำคัญจ่าย (PV) และหนังสือรับรอง 50 ทวิ (ถ้ามีหัก) แล้วลงบัญชีทันที แก้ไขไม่ได้'
                  : 'บันทึกแล้วระบบจะออกเลขเอกสารและลงบัญชีทันที แก้ไขไม่ได้'
              }
            />
          )
        }
        action={
          <LoadingButton variant="contained" onClick={save}>
            ยืนยันบันทึก
          </LoadingButton>
        }
      />
    </>
  );
}
