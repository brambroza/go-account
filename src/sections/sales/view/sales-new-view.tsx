import type { SalesInvoiceSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { useRouter } from 'src/routes/hooks';

import { SalesInvoiceSchema } from 'src/schemas/accounting/doc-schemas';
import { useAccounting, issueTaxInvoice, useAccountLookup, useContactLookup } from 'src/store';
import { ACC, addDays, todayISO, formatTaxId, branchLabel, calcDocument, eTaxReadiness } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { newLine, TotalsSummary, DocLinesEditor } from 'src/sections/shared';

// ----------------------------------------------------------------------

export function SalesNewView() {
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const {vatRegistered} = data.company;

  const customers = useMemo(() => data.contacts.filter((c) => c.kind !== 'vendor'), [data.contacts]);
  const today = todayISO();

  const methods = useForm<SalesInvoiceSchemaType>({
    resolver: zodResolver(SalesInvoiceSchema),
    defaultValues: {
      contactId: '',
      date: today,
      dueDate: addDays(today, 30),
      vatMode: vatRegistered ? 'exclusive' : 'none',
      note: '',
      lines: [newLine(ACC.sales)],
    },
  });

  const {
    control,
    setValue,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const [contactId, date, vatMode, lines] = useWatch({ control, name: ['contactId', 'date', 'vatMode', 'lines'] });
  const customer = contacts.get(contactId);

  // วันครบกำหนดตามเครดิตเทอมของลูกค้า
  useEffect(() => {
    if (customer && date) setValue('dueDate', addDays(date.slice(0, 10), customer.creditDays));
  }, [customer, date, setValue]);

  const totals = useMemo(
    () => calcDocument({ lines: lines ?? [], vatMode: vatMode ?? 'none', vatRate: vatRegistered ? 7 : 0 }),
    [lines, vatMode, vatRegistered]
  );

  const readiness = customer && vatRegistered ? eTaxReadiness(data.company, customer) : [];

  const onSubmit = handleSubmit((values) => {
    try {
      const result = run((s) =>
        issueTaxInvoice(s, {
          contactId: values.contactId,
          date: values.date.slice(0, 10),
          dueDate: values.dueDate.slice(0, 10),
          vatMode: values.vatMode,
          note: values.note,
          lines: values.lines.map((l) => ({ ...l, description: l.description.trim() })),
        })
      );
      toast.success(`ออกใบกำกับภาษี ${result.doc.docNo} แล้ว`);
      router.push(paths.sales.view(result.doc.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  return (
    <>
      <CustomBreadcrumbs
        heading="ออกใบกำกับภาษี / ใบแจ้งหนี้"
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ขาย', href: paths.sales.root },
          { name: 'ออกใบใหม่' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Form methods={methods} onSubmit={onSubmit}>
        <Grid container spacing={3}>
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
                <Field.Select name="contactId" label="ลูกค้า" size="small" sx={{ gridColumn: { sm: 'span 2' } }}>
                  {customers.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.code} · {contacts.name(c.id)}
                    </MenuItem>
                  ))}
                </Field.Select>

                {customer && (
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

                <Field.DatePicker name="date" label="วันที่เอกสาร" />
                <Field.DatePicker name="dueDate" label="วันครบกำหนด" />

                <Field.Select name="vatMode" label="ภาษีมูลค่าเพิ่ม" size="small" disabled={!vatRegistered}>
                  <MenuItem value="exclusive">ราคาไม่รวม VAT (บวก 7%)</MenuItem>
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
                  accounts={accounts.byType('revenue')}
                  defaultAccountCode={ACC.sales}
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
              <TotalsSummary totals={totals} vatRate={7} showVat={vatMode !== 'none'} />

              <Stack spacing={1} sx={{ mt: 3 }}>
                <LoadingButton type="submit" variant="contained" size="large" loading={isSubmitting}>
                  ออกใบกำกับภาษี
                </LoadingButton>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  ออกแล้วระบบจะออกเลขที่ต่อเนื่อง ลงบัญชีให้อัตโนมัติ และแก้ไขไม่ได้ — ถ้าผิดต้องออกใบลดหนี้
                </Typography>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Form>
    </>
  );
}
