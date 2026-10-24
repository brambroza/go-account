import type { QuotationFormSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { useParams, useRouter } from 'src/routes/hooks';

import { QuotationFormSchema } from 'src/schemas/accounting/doc-schemas';
import { saveQuotation, useAccounting, useAccountLookup } from 'src/store';
import { ACC, addDays, VAT_RATE, todayISO, calcDocument, formatThaiDate, isValidISODate } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { ContactAutocomplete } from 'src/sections/shared/contact-autocomplete';
import { newLine, TotalsSummary, DocLinesEditor, RHFAmountField, formKeyHandler } from 'src/sections/shared';

// ----------------------------------------------------------------------

/**
 * สร้าง/แก้ใบเสนอราคา — ไม่ใช่เอกสารภาษีและไม่ลงบัญชี จึงบันทึกได้ทันทีไม่ต้องยืนยัน
 * แก้ได้จนกว่าจะออกเอกสารขาย (ข้อยกเว้นของกติกาเอกสารแก้ไม่ได้ — ดู `saveQuotation`)
 */
export function QuotationFormView() {
  const { id } = useParams();
  const router = useRouter();
  const { data, run } = useAccounting();
  const accounts = useAccountLookup();
  const { vatRegistered } = data.company;
  const vatRate = vatRegistered ? VAT_RATE : 0;
  const editing = id ? data.quotations.find((q) => q.id === id) : undefined;
  const today = todayISO();

  const methods = useForm<QuotationFormSchemaType>({
    resolver: zodResolver(QuotationFormSchema),
    defaultValues: editing
      ? {
          contactId: editing.contactId,
          saleType: editing.saleType ?? 'goods',
          date: editing.date,
          validDays: editing.validDays,
          vatMode: editing.vatMode,
          note: editing.note ?? '',
          lines: editing.lines,
        }
      : {
          contactId: '',
          saleType: 'goods',
          date: today,
          validDays: 30,
          vatMode: vatRegistered ? 'exclusive' : 'none',
          note: '',
          lines: [newLine(ACC.sales)],
        },
  });
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;
  const [date, validDays, vatMode, lines, saleType] = useWatch({ control, name: ['date', 'validDays', 'vatMode', 'lines', 'saleType'] });
  const totals = useMemo(() => calcDocument({ lines: lines ?? [], vatMode: vatMode ?? 'none', vatRate }), [lines, vatMode, vatRate]);
  const iso = date?.slice(0, 10);
  const validUntil = isValidISODate(iso) && Number.isInteger(validDays) ? addDays(iso, validDays ?? 0) : undefined;

  const onSubmit = handleSubmit((v) => {
    try {
      const r = run((s) =>
        saveQuotation(s, {
          id: editing?.id,
          date: v.date.slice(0, 10),
          validDays: v.validDays,
          contactId: v.contactId,
          vatMode: v.vatMode,
          saleType: v.saleType,
          note: v.note,
          lines: v.lines,
        })
      );
      toast.success(`${editing ? 'บันทึกการแก้ไข' : 'สร้าง'}ใบเสนอราคา ${r.quotation.docNo} แล้ว`);
      router.push(paths.quotations.view(r.quotation.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  if (id && !editing) {
    return <EmptyContent filled title="ไม่พบใบเสนอราคา" sx={{ py: 10 }} />;
  }
  if (editing?.convertedSalesId) {
    return (
      <EmptyContent
        filled
        title={`${editing.docNo} ออกเอกสารขายแล้ว`}
        description="ใบเสนอราคาที่แปลงเป็นเอกสารขายแล้วแก้ไขไม่ได้ — ทำใบเสนอราคาใหม่แทน"
        sx={{ py: 10 }}
      />
    );
  }

  return (
    <>
      <CustomBreadcrumbs
        heading={editing ? `แก้ไขใบเสนอราคา ${editing.docNo}` : 'สร้างใบเสนอราคา'}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ใบเสนอราคา', href: paths.quotations.root },
          { name: editing ? editing.docNo : 'สร้างใหม่' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Form methods={methods} onSubmit={onSubmit}>
        <Grid container spacing={3} onKeyDown={formKeyHandler(onSubmit)}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader title="ลูกค้าและเงื่อนไข" />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                <ContactAutocomplete name="contactId" label="ลูกค้า" side="customer" sx={{ gridColumn: { sm: 'span 2' } }} />
                <Field.DatePicker
                  name="date"
                  label="วันที่ใบเสนอราคา"
                  slotProps={{ textField: { helperText: editing ? 'แก้ได้ภายในเดือนของเลขที่เดิม' : undefined } }}
                />
                <RHFAmountField
                  name="validDays"
                  label="ยืนราคา (วัน)"
                  decimals={0}
                  helperText={validUntil ? `ถึงวันที่ ${formatThaiDate(validUntil)}` : undefined}
                />
                <Field.Select name="vatMode" label="ภาษีมูลค่าเพิ่ม" size="small" disabled={!vatRegistered}>
                  <MenuItem value="exclusive">ราคาไม่รวม VAT (บวก {VAT_RATE}%)</MenuItem>
                  <MenuItem value="inclusive">ราคารวม VAT แล้ว</MenuItem>
                  <MenuItem value="none">ไม่มี VAT</MenuItem>
                </Field.Select>
                <Field.Select name="saleType" label="เมื่อลูกค้าตอบรับ ออกเป็น" size="small">
                  <MenuItem value="goods">{vatRegistered ? 'ขายสินค้า (ใบกำกับภาษี)' : 'ขายสินค้า'}</MenuItem>
                  <MenuItem value="service">{vatRegistered ? 'งานบริการ (ใบแจ้งหนี้ ม.78/1)' : 'งานบริการ'}</MenuItem>
                </Field.Select>
                <Field.Text name="note" label="หมายเหตุ / เงื่อนไข (พิมพ์บนใบเสนอราคา)" size="small" multiline minRows={2} sx={{ gridColumn: { sm: 'span 2' } }} />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader title="รายการ" />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor
                  accounts={accounts.forLines('sales')}
                  defaultAccountCode={saleType === 'service' ? ACC.service : ACC.sales}
                  accountLabel="บัญชีรายได้ (ตอนออกเอกสารขาย)"
                />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3, position: { lg: 'sticky' }, top: { lg: 96 } }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                สรุปยอด
              </Typography>
              <TotalsSummary totals={totals} vatRate={vatRate} showVat={vatRegistered && vatMode !== 'none'} />
              <Stack spacing={1} sx={{ mt: 3 }}>
                <LoadingButton type="submit" variant="contained" size="large" loading={isSubmitting}>
                  {editing ? 'บันทึกการแก้ไข' : 'บันทึกใบเสนอราคา'}
                </LoadingButton>
                <Alert severity="info" variant="outlined">
                  ใบเสนอราคาไม่ลงบัญชีและไม่ใช่เอกสารภาษี — แก้ไขได้จนกว่าจะออกเอกสารขาย
                </Alert>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Form>
    </>
  );
}
