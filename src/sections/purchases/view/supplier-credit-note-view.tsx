import type { SupplierCreditNoteSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import MenuItem from '@mui/material/MenuItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import FormControlLabel from '@mui/material/FormControlLabel';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
import { useRouter, useParams } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { SupplierCreditNoteSchema } from 'src/schemas/accounting/doc-schemas';
import { cmd, uid, useAccounting, useAccountLookup, useContactLookup, recordSupplierCreditNote } from 'src/store';
import {
  ACC,
  subBaht,
  todayISO,
  toSatang,
  periodOf,
  periodLabel,
  calcDocument,
  formatThaiDate,
  isValidISODate,
  purchaseCreditsOf,
  supplierCreditSplit,
  purchaseOutstanding,
  purchaseCreditableOf,
  purchaseCreditAllocation,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, TotalsSummary, ConfirmSummary, DocLinesEditor, formKeyHandler, LockedDateAlert } from 'src/sections/shared';

// ----------------------------------------------------------------------

const REASONS = ['คืนสินค้าชำรุด/ไม่ตรงสเปก', 'ผู้ขายลดราคาหลังออกใบกำกับ', 'ผู้ขายคำนวณราคาผิด (สูงไป)', 'ยกเลิกบริการบางส่วน'];

type FormLine = SupplierCreditNoteSchemaType['lines'][number];

/**
 * บันทึกใบลดหนี้จากผู้ขาย อ้างเอกสารซื้อเดิม — ลดเจ้าหนี้ และลดภาษีซื้อในเดือนที่ได้รับ (ถ้าเอกสารเดิมขอคืน)
 * D1: ลดได้แม้จ่ายแล้ว (ไม่เกินยอดเอกสาร − ใบลดหนี้ก่อนหน้า) ส่วนที่เกินยอดค้างจ่ายตั้งเป็นเงินคืนจากผู้ขาย
 * เลือกบรรทัดที่ลด (`purchaseLineId`) ให้ฐานหัก ณ ที่จ่ายลดเฉพาะบรรทัดนั้น
 * กติกาทั้งหมดตรวจที่ `recordSupplierCreditNote` — หน้าจอรันแบบทดลอง (ไม่บันทึก) เพื่อแสดงคำเตือนก่อนยืนยัน
 */
export function SupplierCreditNoteView() {
  const { id = '' } = useParams();
  const router = useRouter();
  const { data, run, busy } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const confirm = useBoolean();

  const purchase = data.purchases.find((p) => p.id === id);
  const outstanding = purchase ? purchaseOutstanding(data, purchase) : 0;
  const creditable = purchase ? purchaseCreditableOf(data, purchase) : 0;
  // มูลค่าคงเหลือ (ก่อน VAT) ที่ลดได้ต่อบรรทัด หลังใบลดหนี้ก่อนหน้า
  const prior = useMemo(
    () => (purchase ? purchaseCreditAllocation(purchase, purchaseCreditsOf(data, purchase.id)) : null),
    [data, purchase]
  );
  const lineFor = (index: number): FormLine | null => {
    const l = purchase?.lines[index];
    if (!l || !prior || !(toSatang(prior.remaining[index]) > 0)) return null;
    const untouched = toSatang(prior.remaining[index]) === toSatang(prior.lineNets[index]);
    // ลดไปแล้วบางส่วน: ให้กรอกยอดที่ลดเอง (ราคา 0) — ระบบตรวจไม่ให้เกินมูลค่าคงเหลือของบรรทัด
    return {
      id: uid(),
      purchaseLineId: l.id,
      description: l.description,
      qty: untouched ? l.qty : 1,
      unitPrice: untouched ? l.unitPrice : 0,
      discount: untouched ? l.discount : 0,
      accountCode: l.accountCode,
    };
  };

  const methods = useForm<SupplierCreditNoteSchemaType>({
    resolver: zodResolver(SupplierCreditNoteSchema),
    defaultValues: {
      supplierCreditNoteNo: '',
      supplierCreditNoteDate: todayISO(),
      date: todayISO(),
      reason: '',
      lines: (purchase?.lines.map((_, i) => lineFor(i)).filter(Boolean) as FormLine[]) ?? [],
    },
  });
  const [lines, date, supplierNo, supplierDate, reason] = useWatch({
    control: methods.control,
    name: ['lines', 'date', 'supplierCreditNoteNo', 'supplierCreditNoteDate', 'reason'],
  });
  const totals = useMemo(
    () =>
      purchase
        ? calcDocument({ lines: lines ?? [], vatMode: purchase.vatMode, vatRate: purchase.vatRate })
        : calcDocument({ lines: [], vatMode: 'none', vatRate: 0 }),
    [purchase, lines]
  );

  const dateIso = (date ?? '').slice(0, 10);
  // ทดลองบันทึก (ไม่เปลี่ยนข้อมูล) เพื่อแสดงคำเตือน/ปัญหาจาก domain ก่อนยืนยัน — เลขที่/เหตุผลที่ยังไม่กรอกใช้ค่าชั่วคราว
  const preview = useMemo(() => {
    if (!purchase || purchase.opening || !isValidISODate(dateIso) || !(lines ?? []).length) return null;
    const supplierDateIso = (supplierDate ?? '').slice(0, 10);
    try {
      const r = recordSupplierCreditNote(data, {
        purchaseId: purchase.id,
        supplierCreditNoteNo: supplierNo?.trim() || '(ตรวจ)',
        supplierCreditNoteDate: isValidISODate(supplierDateIso) ? supplierDateIso : dateIso,
        date: dateIso,
        reason: reason?.trim() || '(ตรวจ)',
        lines: (lines ?? []).map((l) => ({ ...l, description: (l.description ?? '').trim() || '(ตรวจ)' })),
      });
      return { warnings: r.warnings, error: null as string | null };
    } catch (error) {
      return { warnings: [] as string[], error: error instanceof Error ? error.message : 'ตรวจไม่ผ่าน' };
    }
  }, [data, purchase, dateIso, lines, supplierNo, supplierDate, reason]);

  if (!purchase || purchase.opening || toSatang(creditable) <= 0) {
    return (
      <EmptyContent
        filled
        title={
          !purchase
            ? 'ไม่พบเอกสารซื้อ'
            : purchase.opening
              ? `${purchase.docNo} เป็นยอดยกมาจากระบบเดิม — บันทึกใบลดหนี้ในระบบเดิม`
              : `${purchase.docNo} ลดหนี้ครบยอดเอกสารแล้ว`
        }
        action={
          <Button component={RouterLink} href={purchase ? paths.purchases.view(purchase.id) : paths.purchases.root} variant="contained" sx={{ mt: 3 }}>
            กลับ
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const split = supplierCreditSplit(data, purchase, totals.total);
  const overLimit = toSatang(totals.total) > toSatang(creditable);
  const showVat = purchase.vatMode !== 'none';
  const allocationProblems = prior
    ? purchaseCreditAllocation(purchase, [
        ...purchaseCreditsOf(data, purchase.id),
        { lines: lines ?? [], vatMode: purchase.vatMode, vatRate: purchase.vatRate, docNo: '' },
      ]).problems
    : [];
  const selected = new Set((lines ?? []).map((l) => l.purchaseLineId).filter(Boolean));
  const toggleLine = (index: number, checked: boolean) => {
    const ref = purchase.lines[index].id;
    const current = methods.getValues('lines');
    if (!checked) {
      methods.setValue('lines', current.filter((l) => l.purchaseLineId !== ref), { shouldValidate: true });
      return;
    }
    const added = lineFor(index);
    if (!added) return;
    // เรียงตามลำดับบรรทัดของเอกสารเดิม บรรทัดที่เพิ่มเอง (ไม่อ้างบรรทัด) ต่อท้าย
    const order = (l: FormLine) => {
      const i = purchase.lines.findIndex((pl) => pl.id === l.purchaseLineId);
      return i < 0 ? purchase.lines.length : i;
    };
    methods.setValue('lines', [...current, added].sort((a, b) => order(a) - order(b)), { shouldValidate: true });
  };
  const vatMonth = isValidISODate(dateIso) ? periodLabel(periodOf(dateIso)) : '-';

  const save = methods.handleSubmit(async (values) => {
    try {
      const r = await run(
        cmd.recordSupplierCreditNote({
          purchaseId: purchase.id,
          supplierCreditNoteNo: values.supplierCreditNoteNo,
          supplierCreditNoteDate: values.supplierCreditNoteDate.slice(0, 10),
          date: values.date.slice(0, 10),
          reason: values.reason,
          lines: values.lines.map((l) => ({ ...l, description: l.description.trim() })),
        })
      );
      confirm.onFalse();
      toast.success(`บันทึกใบลดหนี้จากผู้ขาย ${r.doc.docNo} แล้ว`);
      router.push(paths.purchases.view(purchase.id));
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  return (
    <>
      <CustomBreadcrumbs
        heading={`ใบลดหนี้จากผู้ขาย อ้างถึง ${purchase.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ซื้อ / ค่าใช้จ่าย', href: paths.purchases.root },
          { name: purchase.docNo, href: paths.purchases.view(purchase.id) },
          { name: 'ใบลดหนี้จากผู้ขาย' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Form methods={methods}>
        <Grid container spacing={3} onKeyDown={formKeyHandler(save)}>
          <Grid item xs={12} xl={8}>
            <Card>
              <CardHeader
                title="ใบลดหนี้ของผู้ขาย"
                subheader={`${contacts.name(purchase.contactId)} · ใบกำกับเดิม ${purchase.supplierInvoiceNo || '-'} ${purchase.supplierInvoiceDate ? formatThaiDate(purchase.supplierInvoiceDate) : ''}`}
              />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                <Field.Text name="supplierCreditNoteNo" label={purchase.claimVat ? 'เลขที่ใบลดหนี้ของผู้ขาย (บังคับ)' : 'เลขที่ใบลดหนี้ของผู้ขาย'} size="small" />
                <Field.Select name="reason" label="เหตุผล" size="small">
                  {REASONS.map((r) => (
                    <MenuItem key={r} value={r}>
                      {r}
                    </MenuItem>
                  ))}
                </Field.Select>
                <Field.DatePicker name="supplierCreditNoteDate" label="วันที่ในใบลดหนี้ของผู้ขาย" />
                <Field.DatePicker name="date" label="วันที่ได้รับ / บันทึก" />
                <LockedDateAlert date={date} sx={{ gridColumn: { sm: 'span 2' } }} />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader
                title="รายการที่ลด"
                subheader="เลือกบรรทัดของเอกสารเดิมที่ผู้ขายลด แล้วแก้จำนวนหรือราคาให้เหลือเฉพาะส่วนที่ลด — ฐานหัก ณ ที่จ่ายลดเฉพาะบรรทัดที่เลือก"
              />
              <Box sx={{ p: 3 }}>
                <Stack sx={{ mb: 2 }}>
                  {purchase.lines.map((l, i) => {
                    const remaining = prior?.remaining[i] ?? 0;
                    return (
                      <FormControlLabel
                        key={l.id}
                        disabled={!(toSatang(remaining) > 0)}
                        control={<Checkbox size="small" checked={selected.has(l.id)} onChange={(e) => toggleLine(i, e.target.checked)} />}
                        label={
                          <Typography variant="body2">
                            {i + 1}. {l.description} · {accounts.name(l.accountCode)}
                            {l.whtRate > 0 ? ` · หัก ณ ที่จ่าย ${l.whtRate}%` : ''} — ลดได้อีก <Money value={remaining} /> (ก่อน VAT)
                          </Typography>
                        }
                      />
                    );
                  })}
                </Stack>
                <DocLinesEditor
                  accounts={accounts.forLines('purchase')}
                  defaultAccountCode={purchase.lines[0]?.accountCode ?? ''}
                  accountLabel="บัญชีค่าใช้จ่าย/สินทรัพย์"
                />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} xl={4}>
            <Card sx={{ p: 3 }}>
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ค้างจ่ายของเอกสารเดิม
                  </Typography>
                  <Money value={outstanding} />
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ลดหนี้ได้สูงสุด (ยอดเอกสาร − ใบลดหนี้ก่อนหน้า)
                  </Typography>
                  <Money value={creditable} />
                </Stack>
              </Stack>
              <TotalsSummary totals={totals} vatRate={purchase.vatRate} showVat={showVat} />
              {purchase.claimVat ? (
                <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                  ภาษีซื้อลดลง <Money value={totals.vat} sx={{ fontWeight: 600 }} /> บาท ในเดือน{vatMonth} (เดือนที่ได้รับใบลดหนี้)
                </Alert>
              ) : (
                <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                  เอกสารเดิมไม่ได้ขอคืนภาษีซื้อ — ส่วนของ VAT ลดค่าใช้จ่ายแทน
                </Alert>
              )}
              {toSatang(totals.total) > 0 && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ลดเจ้าหนี้ (ยอดค้างจ่าย)
                    </Typography>
                    <Money value={split.toPayable} />
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ตั้งเป็นเงินคืนจากผู้ขาย (จ่ายไปแล้ว)
                    </Typography>
                    <Money value={split.refundDue} sx={{ color: toSatang(split.refundDue) > 0 ? 'warning.main' : undefined }} />
                  </Stack>
                </Stack>
              )}
              {overLimit && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  ยอดลดหนี้เกินยอดที่ลดได้ ({creditable.toFixed(2)} บาท = ยอดเอกสารหักใบลดหนี้ก่อนหน้า)
                </Alert>
              )}
              {!overLimit && allocationProblems.length > 0 && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {allocationProblems[allocationProblems.length - 1]}
                </Alert>
              )}
              {!overLimit && !allocationProblems.length && toSatang(totals.total) > 0 && preview?.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {preview.error}
                </Alert>
              )}
              {preview?.warnings.map((w) => (
                <Alert key={w} severity="warning" variant="outlined" sx={{ mt: 2 }}>
                  {w}
                </Alert>
              ))}
              <Button
                fullWidth
                size="large"
                variant="contained"
                color="error"
                sx={{ mt: 3 }}
                disabled={overLimit || allocationProblems.length > 0 || toSatang(totals.total) <= 0 || !!preview?.error}
                onClick={async () => {
                  if (await methods.trigger()) confirm.onTrue();
                }}
              >
                บันทึกใบลดหนี้จากผู้ขาย
              </Button>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title="ยืนยันบันทึกใบลดหนี้จากผู้ขาย"
        content={
          <Stack spacing={2}>
            <ConfirmSummary
              rows={[
                { label: 'อ้างถึง', value: `${purchase.docNo} (${purchase.supplierInvoiceNo || '-'})` },
                { label: 'ผู้ขาย', value: contacts.name(purchase.contactId) },
                { label: 'เลขที่ใบลดหนี้ผู้ขาย', value: methods.getValues('supplierCreditNoteNo') || '-' },
                { label: 'วันที่ได้รับ', value: formatThaiDate(dateIso) },
                { label: 'มูลค่าที่ลด', value: totals.net },
                { label: `ภาษีซื้อลดลง ${purchase.vatRate}%`, value: totals.vat, hidden: !purchase.claimVat || !showVat },
                { label: 'ยอดลดหนี้ (รวม VAT)', value: totals.total, strong: true },
                { label: 'ลดเจ้าหนี้', value: split.toPayable },
                { label: `ตั้งเป็นเงินคืนจากผู้ขาย (${ACC.supplierRefundReceivable})`, value: split.refundDue, hidden: toSatang(split.refundDue) <= 0 },
                { label: 'ค้างจ่ายหลังลดหนี้', value: subBaht(outstanding, split.toPayable) },
                { label: 'งวดภาษี', value: `ลดภาษีซื้อเดือน${vatMonth}`, hidden: !purchase.claimVat || !showVat },
              ]}
              note="บันทึกแล้วแก้ไขหรือลบไม่ได้ — หัก ณ ที่จ่ายของการจ่ายครั้งถัดไปคิดจากยอดหลังลดหนี้"
            />
            {preview?.warnings.map((w) => (
              <Alert key={w} severity="warning" variant="outlined">
                {w}
              </Alert>
            ))}
          </Stack>
        }
        action={
          <LoadingButton variant="contained" color="error" onClick={save} loading={busy}>
            ยืนยัน
          </LoadingButton>
        }
      />
    </>
  );
}
