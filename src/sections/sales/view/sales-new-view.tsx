import type { SalesInvoiceSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useForm, useWatch } from 'react-hook-form';
import { useMemo, useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { useRouter, useSearchParams } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { SalesInvoiceSchema } from 'src/schemas/accounting/doc-schemas';
import { uid, useAccounting, issueTaxInvoice, useAccountLookup, useContactLookup, issueFromQuotation } from 'src/store';
import {
  ACC,
  addDays,
  VAT_RATE,
  todayISO,
  periodOf,
  formatTaxId,
  branchLabel,
  periodLabel,
  calcDocument,
  eTaxReadiness,
  salesDocTitle,
  formatThaiDate,
  isValidISODate,
  buyerTaxIdWarning,
  quotationToSalesDraft,
  quotationConvertProblem,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { ContactAutocomplete } from 'src/sections/shared/contact-autocomplete';
import {
  newLine,
  TotalsSummary,
  ConfirmSummary,
  DocLinesEditor,
  formKeyHandler,
  LockedDateAlert,
} from 'src/sections/shared';

// ----------------------------------------------------------------------

/** ฟอร์มออกใบกำกับภาษี (บริษัทจด VAT) หรือใบแจ้งหนี้ (ไม่จด VAT) — ยืนยันสรุปยอดก่อนออกเลขที่ */
export function SalesNewView() {
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const { vatRegistered } = data.company;
  const vatRate = vatRegistered ? VAT_RATE : 0;
  const confirm = useBoolean();
  const [pending, setPending] = useState<SalesInvoiceSchemaType | null>(null);

  const today = todayISO();
  // แปลงจากใบเสนอราคา (?quotation=<id>): คัดลอกลูกค้า ประเภทการขาย VAT หมายเหตุ และทุกบรรทัด — แก้ได้ก่อนออก
  const params = useSearchParams();
  const quotation = data.quotations.find((q) => q.id === params.get('quotation'));
  const quotationProblem = quotation ? quotationConvertProblem(quotation, today) : null;
  const [fromQuotation] = useState(() => (quotation && !quotationProblem ? quotationToSalesDraft(quotation, uid) : null));

  const methods = useForm<SalesInvoiceSchemaType>({
    resolver: zodResolver(SalesInvoiceSchema),
    defaultValues: {
      contactId: fromQuotation?.contactId ?? '',
      saleType: fromQuotation?.saleType ?? 'goods',
      date: today,
      dueDate: addDays(today, 30),
      vatMode: vatRegistered ? (fromQuotation?.vatMode ?? 'exclusive') : 'none',
      note: fromQuotation?.note ?? '',
      lines: fromQuotation?.lines ?? [newLine(ACC.sales)],
    },
  });

  const {
    control,
    setValue,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const [contactId, date, vatMode, lines, saleType] = useWatch({
    control,
    name: ['contactId', 'date', 'vatMode', 'lines', 'saleType'],
  });
  const isService = saleType === 'service';
  // งานบริการของบริษัทจด VAT: ใบแจ้งหนี้ (ไม่ใช่ใบกำกับภาษี) — ภาษีขายเกิดเมื่อรับชำระ
  const isTaxInvoice = vatRegistered && !isService;
  const customer = contacts.get(contactId);

  // วันครบกำหนดตามเครดิตเทอมของลูกค้า — คำนวณเฉพาะเมื่อวันที่ครบและถูกต้อง
  // (ระหว่างพิมพ์ด้วยคีย์บอร์ดค่าจะเป็น "Invalid Date" / ปีไม่ครบ ห้ามคำนวณ ไม่อย่างนั้นหน้าแตกและข้อมูลที่กรอกหาย)
  useEffect(() => {
    const iso = date?.slice(0, 10);
    if (customer && isValidISODate(iso)) setValue('dueDate', addDays(iso, customer.creditDays));
  }, [customer, date, setValue]);

  const totals = useMemo(
    () => calcDocument({ lines: lines ?? [], vatMode: vatMode ?? 'none', vatRate }),
    [lines, vatMode, vatRate]
  );
  const docTitle = salesDocTitle({
    kind: 'tax-invoice',
    isTaxInvoice,
    vatMode: vatMode ?? 'none',
    saleType: isService ? 'service' : undefined,
    vatRate,
  });
  const docShortTitle = isTaxInvoice ? 'ใบกำกับภาษี' : 'ใบแจ้งหนี้';
  const showVat = vatRegistered && vatMode !== 'none';

  const readiness = customer && vatRegistered ? eTaxReadiness(data.company, customer) : [];
  // ม.86/4: ใบกำกับเต็มรูปให้ลูกค้าที่ไม่มีเลขผู้เสียภาษี — เตือนอย่างเดียว (ลูกค้าบุคคลทั่วไปออกได้)
  // งานบริการ: ใบเสร็จรับเงิน/ใบกำกับภาษีออกตอนรับเงิน จึงเตือนตั้งแต่ตอนนี้ด้วย
  const buyerWarning = buyerTaxIdWarning(vatRegistered, customer);
  const pendingBuyerWarning = pending ? buyerTaxIdWarning(vatRegistered, contacts.get(pending.contactId)) : null;

  // ผ่าน validation แล้วเปิดสรุปให้ยืนยันก่อน — ออกแล้วแก้ไม่ได้
  const onSubmit = handleSubmit((values) => {
    setPending(values);
    confirm.onTrue();
  });

  const issue = () => {
    const values = pending;
    if (!values) return;
    try {
      const input = {
        saleType: values.saleType,
        contactId: values.contactId,
        date: values.date.slice(0, 10),
        dueDate: values.dueDate.slice(0, 10),
        vatMode: values.vatMode,
        note: values.note,
        lines: values.lines.map((l) => ({ ...l, description: l.description.trim() })),
      };
      const result = run((s) => (fromQuotation && quotation ? issueFromQuotation(s, quotation.id, input) : issueTaxInvoice(s, input)));
      confirm.onFalse();
      toast.success(`ออก${salesDocTitle(result.doc)} ${result.doc.docNo} แล้ว`);
      router.push(paths.sales.view(result.doc.id));
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <>
      <CustomBreadcrumbs
        heading={vatRegistered ? 'ออกใบกำกับภาษี / ใบแจ้งหนี้' : 'ออกใบแจ้งหนี้ / ใบเสร็จรับเงิน'}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ขาย', href: paths.sales.root },
          { name: 'ออกใบใหม่' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      {quotation && (
        <Alert severity={quotationProblem ? 'error' : 'info'} variant="outlined" sx={{ mb: 3 }}>
          {quotationProblem
            ? `${quotationProblem} — ออกเอกสารขายใหม่โดยไม่อ้างใบเสนอราคา`
            : `คัดลอกรายการจากใบเสนอราคา ${quotation.docNo} แล้ว — ตรวจ/แก้ก่อนออก ออกแล้วใบเสนอราคาจะถูกล็อกเป็น "ออกเอกสารขายแล้ว" (ลูกค้าต้องตรงกับใบเสนอราคา)`}
        </Alert>
      )}

      <Form methods={methods} onSubmit={onSubmit}>
        <Grid container spacing={3} onKeyDown={formKeyHandler(onSubmit)}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader title="ลูกค้าและวันที่" />
              <Box
                sx={{
                  p: 3,
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)' },
                }}
              >
                <Box sx={{ gridColumn: { sm: 'span 2' } }}>
                  <Field.RadioGroup
                    row
                    name="saleType"
                    label="ประเภทการขาย"
                    options={[
                      { value: 'goods', label: vatRegistered ? 'ขายสินค้า (ออกใบกำกับภาษีทันที)' : 'ขายสินค้า' },
                      { value: 'service', label: vatRegistered ? 'งานบริการ (ใบแจ้งหนี้ก่อน ใบกำกับภาษีตอนรับเงิน)' : 'งานบริการ' },
                    ]}
                  />
                </Box>
                {isService && vatRegistered && (
                  <Alert severity="info" variant="outlined" sx={{ gridColumn: { sm: 'span 2' } }}>
                    งานบริการ (ม.78/1): ภาษีขายเกิดเมื่อได้รับชำระ — ระบบออก “ใบแจ้งหนี้” ตอนนี้ (ยังไม่เข้ารายงานภาษีขาย)
                    และออก “ใบเสร็จรับเงิน/ใบกำกับภาษี” ทุกครั้งที่รับเงินตามยอดที่รับ ภาษีเข้าเดือนที่รับเงิน
                  </Alert>
                )}

                <ContactAutocomplete
                  name="contactId"
                  label="ลูกค้า"
                  side="customer"
                  disabled={!!fromQuotation}
                  sx={{ gridColumn: { sm: 'span 2' } }}
                />

                {customer && vatRegistered && (
                  <Alert
                    severity={readiness.length ? 'warning' : 'success'}
                    variant="outlined"
                    sx={{ gridColumn: { sm: 'span 2' } }}
                  >
                    {readiness.length ? (
                      <>
                        {readiness.join(' · ')} — ออกได้แต่ยังส่ง e-Tax ไม่ได้ ให้แก้ข้อมูลลูกค้าก่อนลงนาม
                      </>
                    ) : (
                      <>
                        เลขผู้เสียภาษี {formatTaxId(customer.taxId)} · {branchLabel(customer.branchNo)} · เครดิต{' '}
                        {customer.creditDays} วัน — ข้อมูลครบสำหรับใบกำกับเต็มรูปและ e-Tax
                      </>
                    )}
                  </Alert>
                )}
                {buyerWarning && (
                  <Alert severity="warning" variant="outlined" sx={{ gridColumn: { sm: 'span 2' } }}>
                    {buyerWarning}
                  </Alert>
                )}

                <Field.DatePicker name="date" label="วันที่เอกสาร" />
                <Field.DatePicker name="dueDate" label="วันครบกำหนด" />
                <LockedDateAlert date={date} sx={{ gridColumn: { sm: 'span 2' } }} />

                <Field.Select name="vatMode" label="ภาษีมูลค่าเพิ่ม" size="small" disabled={!vatRegistered}>
                  <MenuItem value="exclusive">ราคาไม่รวม VAT (บวก {VAT_RATE}%)</MenuItem>
                  <MenuItem value="inclusive">ราคารวม VAT แล้ว</MenuItem>
                  <MenuItem value="none">ไม่มี VAT</MenuItem>
                </Field.Select>
                <Field.Text name="note" label="หมายเหตุบนเอกสาร" size="small" />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader title="รายการ" />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor
                  accounts={accounts.forLines('sales')}
                  defaultAccountCode={isService ? ACC.service : ACC.sales}
                  accountLabel="บัญชีรายได้"
                />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3, position: { lg: 'sticky' }, top: { lg: 96 } }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                สรุปยอด
              </Typography>
              <TotalsSummary totals={totals} vatRate={vatRate} showVat={showVat} />

              <Stack spacing={1} sx={{ mt: 3 }}>
                <LoadingButton type="submit" variant="contained" size="large" loading={isSubmitting}>
                  ออก{docShortTitle}
                </LoadingButton>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  ออกแล้วระบบจะออกเลขที่ต่อเนื่อง ลงบัญชีให้อัตโนมัติ และแก้ไขไม่ได้ — ถ้าผิดต้องออกใบลดหนี้
                </Typography>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title={`ยืนยันออก${docTitle}`}
        content={
          pending && (
            <ConfirmSummary
              rows={[
                { label: 'ชนิดเอกสาร', value: docTitle },
                { label: 'จากใบเสนอราคา', value: quotation?.docNo ?? '', hidden: !fromQuotation },
                { label: 'ลูกค้า', value: contacts.name(pending.contactId) },
                { label: 'วันที่เอกสาร', value: formatThaiDate(pending.date.slice(0, 10)) },
                { label: 'ครบกำหนด', value: formatThaiDate(pending.dueDate.slice(0, 10)) },
                { label: 'มูลค่าก่อนภาษี', value: totals.net },
                { label: `ภาษีขาย ${vatRate}%`, value: totals.vat, hidden: !showVat },
                { label: 'รวมทั้งสิ้น', value: totals.total, strong: true },
                {
                  label: 'งวดภาษี',
                  value: isService
                    ? 'ภาษีขายเข้าเดือนที่รับเงิน (ออกใบเสร็จรับเงิน/ใบกำกับภาษีตอนรับชำระ)'
                    : `ภาษีขายเดือน${periodLabel(periodOf(pending.date.slice(0, 10)))}`,
                  hidden: !showVat,
                },
              ]}
              note={
                <>
                  {pendingBuyerWarning && <strong>{pendingBuyerWarning} · </strong>}
                  ออกแล้วระบบจะออกเลขที่ต่อเนื่องและลงบัญชีทันที แก้ไขหรือลบไม่ได้ — ถ้าผิดต้องออกใบลดหนี้/ใบเพิ่มหนี้
                </>
              }
              severity={pendingBuyerWarning ? 'warning' : undefined}
            />
          )
        }
        action={
          <LoadingButton variant="contained" onClick={issue}>
            ยืนยันออกเอกสาร
          </LoadingButton>
        }
      />
    </>
  );
}
