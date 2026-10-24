import type { CreditNoteSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
import { useRouter, useParams } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { CreditNoteSchema } from 'src/schemas/accounting/doc-schemas';
import { todayISO, toSatang, calcDocument, formatThaiDate } from 'src/domain';
import { uid, outstandingOf, useAccounting, issueCreditNote, useContactLookup } from 'src/store';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, TotalsSummary, DocLinesEditor } from 'src/sections/shared';

// ----------------------------------------------------------------------

const REASONS = [
  'ลูกค้าคืนสินค้าชำรุด',
  'สินค้าไม่ตรงตามที่ตกลง',
  'ลดราคาหลังออกใบกำกับ',
  'คำนวณราคาผิด (สูงไป)',
  'ยกเลิกการขายทั้งใบ',
];

export function CreditNoteView() {
  const { id = '' } = useParams();
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const confirm = useBoolean();

  const invoice = data.sales.find((s) => s.id === id && s.kind === 'tax-invoice');
  const outstanding = invoice ? outstandingOf(data, invoice) : 0;

  const methods = useForm<CreditNoteSchemaType>({
    resolver: zodResolver(CreditNoteSchema),
    defaultValues: {
      date: todayISO(),
      reason: '',
      lines: invoice?.lines.map((l) => ({ ...l, id: uid() })) ?? [],
    },
  });

  const lines = useWatch({ control: methods.control, name: 'lines' });
  const totals = useMemo(
    () => (invoice ? calcDocument({ ...invoice, lines: lines ?? [] }) : calcDocument({ lines: [], vatMode: 'none', vatRate: 0 })),
    [invoice, lines]
  );
  const overLimit = toSatang(totals.total) > toSatang(outstanding);

  if (!invoice) {
    return (
      <EmptyContent
        filled
        title="ไม่พบใบกำกับภาษีที่จะลดหนี้"
        action={
          <Button component={RouterLink} href={paths.sales.root} variant="contained" sx={{ mt: 3 }}>
            กลับไปหน้ารายการขาย
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const save = methods.handleSubmit((values) => {
    try {
      const r = run((s) =>
        issueCreditNote(s, {
          invoiceId: invoice.id,
          date: values.date.slice(0, 10),
          reason: values.reason.trim(),
          lines: values.lines,
        })
      );
      confirm.onFalse();
      toast.success(`ออกใบลดหนี้ ${r.doc.docNo} แล้ว`);
      router.push(paths.sales.view(r.doc.id));
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  return (
    <>
      <CustomBreadcrumbs
        heading={`ออกใบลดหนี้ อ้างถึง ${invoice.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ขาย', href: paths.sales.root },
          { name: invoice.docNo, href: paths.sales.view(invoice.id) },
          { name: 'ใบลดหนี้' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Form methods={methods}>
        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader
                title="เหตุผลและวันที่"
                subheader={`${contacts.name(invoice.contactId)} · ใบเดิมลงวันที่ ${formatThaiDate(invoice.date)}`}
              />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' } }}>
                <Field.DatePicker name="date" label="วันที่ใบลดหนี้" />
                <Field.Select name="reason" label="เหตุผล (พิมพ์บนเอกสาร)" size="small">
                  {REASONS.map((r) => (
                    <MenuItem key={r} value={r}>
                      {r}
                    </MenuItem>
                  ))}
                </Field.Select>
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader title="รายการที่ลดหนี้" subheader="แก้จำนวนหรือราคาให้เหลือเฉพาะส่วนที่ลด — บัญชีรายได้ใช้ตามใบเดิม" />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor accounts={[]} defaultAccountCode={invoice.lines[0]?.accountCode ?? ''} accountLabel="" hideAccount />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  ยอดค้างชำระของใบเดิม
                </Typography>
                <Money value={outstanding} />
              </Stack>
              <TotalsSummary totals={totals} vatRate={invoice.vatRate} showVat={invoice.vatMode !== 'none'} />
              {overLimit && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  ยอดลดหนี้เกินยอดค้างชำระ — ถ้าลูกค้าจ่ายแล้วต้องคืนเงินแยกต่างหาก
                </Alert>
              )}
              <Button
                fullWidth
                size="large"
                variant="contained"
                color="error"
                sx={{ mt: 3 }}
                disabled={overLimit}
                onClick={async () => {
                  if (await methods.trigger()) confirm.onTrue();
                }}
              >
                ออกใบลดหนี้
              </Button>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title="ยืนยันออกใบลดหนี้"
        content={`ลดยอดลูกหนี้ ${contacts.name(invoice.contactId)} ลง ${totals.total.toFixed(2)} บาท (ภาษีขายลดลง ${totals.vat.toFixed(2)} บาท) ใบลดหนี้ออกแล้วแก้ไขไม่ได้`}
        action={
          <LoadingButton variant="contained" color="error" onClick={save}>
            ยืนยัน
          </LoadingButton>
        }
      />
    </>
  );
}
