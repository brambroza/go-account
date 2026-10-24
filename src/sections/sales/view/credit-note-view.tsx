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
import { uid, outstandingOf, useAccounting, issueDebitNote, issueCreditNote, useContactLookup } from 'src/store';
import {
  sumBaht,
  subBaht,
  todayISO,
  toSatang,
  periodOf,
  periodLabel,
  calcDocument,
  creditableOf,
  currentNetOf,
  isTaxDocument,
  salesDocTitle,
  formatThaiDate,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import {
  Money,
  newLine,
  TotalsSummary,
  ConfirmSummary,
  DocLinesEditor,
  LockedDateAlert,
  preventEnterSubmit,
} from 'src/sections/shared';

// ----------------------------------------------------------------------

/** เหตุผลตาม ม.82/10 (ลดหนี้) และ ม.82/9 (เพิ่มหนี้) — พิมพ์บนเอกสาร */
const REASONS = {
  credit: ['ลูกค้าคืนสินค้าชำรุด', 'สินค้าไม่ตรงตามที่ตกลง', 'ลดราคาหลังออกใบกำกับ', 'คำนวณราคาผิด (สูงไป)', 'ยกเลิกการขายทั้งใบ'],
  debit: ['เพิ่มราคาสินค้า/บริการตามที่ตกลง', 'ส่งสินค้า/ให้บริการเกินจำนวนที่ตกลง', 'คำนวณราคาผิด (ต่ำไป)'],
};

type Props = {
  /** credit = ใบลดหนี้ (ม.86/10), debit = ใบเพิ่มหนี้ (ม.86/9) */
  mode?: 'credit' | 'debit';
};

/**
 * ออกใบลดหนี้ / ใบเพิ่มหนี้ อ้างใบกำกับเดิม
 * - ลดหนี้: ลดได้ถึงยอดใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ก่อนหน้า แม้รับชำระแล้ว (ส่วนเกินเป็นเงินรอคืนลูกค้า)
 * - เพิ่มหนี้: กรอกเฉพาะมูลค่าที่เพิ่ม ยอดรวมเข้ายอดค้างของใบเดิม
 * แสดงมูลค่าตามใบกำกับเดิม / มูลค่าที่ถูกต้อง ก่อนยืนยัน (พิมพ์บนเอกสาร)
 */
export function CreditNoteView({ mode = 'credit' }: Props) {
  const isDebit = mode === 'debit';
  const { id = '' } = useParams();
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const confirm = useBoolean();

  const invoice = data.sales.find((s) => s.id === id && s.kind === 'tax-invoice');
  const outstanding = invoice ? outstandingOf(data, invoice) : 0;
  const creditable = invoice ? creditableOf(data, invoice) : 0;

  const methods = useForm<CreditNoteSchemaType>({
    resolver: zodResolver(CreditNoteSchema),
    defaultValues: {
      date: todayISO(),
      reason: '',
      lines: isDebit
        ? [newLine(invoice?.lines[0]?.accountCode ?? '')]
        : (invoice?.lines.map((l) => ({ ...l, id: uid() })) ?? []),
    },
  });

  const [lines, date] = useWatch({ control: methods.control, name: ['lines', 'date'] });
  const totals = useMemo(
    () => (invoice ? calcDocument({ ...invoice, lines: lines ?? [] }) : calcDocument({ lines: [], vatMode: 'none', vatRate: 0 })),
    [invoice, lines]
  );
  const overLimit = !isDebit && toSatang(totals.total) > toSatang(creditable);
  // ส่วนที่เกินยอดค้างชำระ (ลูกค้าจ่ายแล้ว) ตั้งเป็นเงินรอคืนลูกค้า — ตรงกับ `issueCreditNote`
  const toCustomerCredit = !isDebit && toSatang(totals.total) > toSatang(outstanding) ? subBaht(totals.total, outstanding) : 0;
  const toReceivable = subBaht(totals.total, toCustomerCredit);
  const originalNet = invoice ? currentNetOf(data, invoice) : 0;
  const correctNet = isDebit ? sumBaht([originalNet, totals.net]) : subBaht(originalNet, totals.net);
  const unavailable = !invoice || (isDebit ? invoice.status === 'cancelled' : toSatang(creditable) <= 0);

  if (!invoice || unavailable) {
    const reason = isDebit ? `${invoice?.docNo} ถูกยกเลิกด้วยใบลดหนี้แล้ว` : `${invoice?.docNo} ลดหนี้เต็มจำนวนแล้ว`;
    return (
      <EmptyContent
        filled
        title={invoice ? reason : 'ไม่พบใบกำกับภาษีที่อ้างถึง'}
        action={
          <Button component={RouterLink} href={paths.sales.root} variant="contained" sx={{ mt: 3 }}>
            กลับไปหน้ารายการขาย
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const isTax = isTaxDocument(invoice);
  const docTitle = salesDocTitle({ kind: isDebit ? 'debit-note' : 'credit-note', isTaxInvoice: isTax, vatMode: invoice.vatMode });
  const verb = isDebit ? 'เพิ่ม' : 'ลด';
  const change = isDebit ? 'เพิ่มขึ้น' : 'ลดลง';
  const showVat = isTax && invoice.vatMode !== 'none';

  const save = methods.handleSubmit((values) => {
    try {
      const input = { invoiceId: invoice.id, date: values.date.slice(0, 10), reason: values.reason.trim(), lines: values.lines };
      const r = run((s) => (isDebit ? issueDebitNote(s, input) : issueCreditNote(s, input)));
      confirm.onFalse();
      toast.success(`ออก${docTitle} ${r.doc.docNo} แล้ว`);
      router.push(paths.sales.view(r.doc.id));
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  return (
    <>
      <CustomBreadcrumbs
        heading={`ออก${docTitle} อ้างถึง ${invoice.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ขาย', href: paths.sales.root },
          { name: invoice.docNo, href: paths.sales.view(invoice.id) },
          { name: isDebit ? 'ใบเพิ่มหนี้' : 'ใบลดหนี้' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Form methods={methods}>
        <Grid container spacing={3} onKeyDown={preventEnterSubmit}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader
                title="เหตุผลและวันที่"
                subheader={`${contacts.name(invoice.contactId)} · ใบเดิมลงวันที่ ${formatThaiDate(invoice.date)}`}
              />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' } }}>
                <Field.DatePicker name="date" label={`วันที่${docTitle}`} />
                <Field.Select name="reason" label="เหตุผล (พิมพ์บนเอกสาร)" size="small">
                  {REASONS[mode].map((r) => (
                    <MenuItem key={r} value={r}>
                      {r}
                    </MenuItem>
                  ))}
                </Field.Select>
                <LockedDateAlert date={date} sx={{ gridColumn: { sm: 'span 2' } }} />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader
                title={`รายการที่${verb}หนี้`}
                subheader={
                  isDebit
                    ? 'กรอกเฉพาะมูลค่าที่เพิ่มขึ้น (ผลต่าง) — บัญชีรายได้ใช้ตามใบเดิม'
                    : 'แก้จำนวนหรือราคาให้เหลือเฉพาะส่วนที่ลด — บัญชีรายได้ใช้ตามใบเดิม'
                }
              />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor accounts={[]} defaultAccountCode={invoice.lines[0]?.accountCode ?? ''} accountLabel="" hideAccount />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3 }}>
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ยอดค้างชำระของใบเดิม
                  </Typography>
                  <Money value={outstanding} />
                </Stack>
                {!isDebit && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ลดหนี้ได้อีกไม่เกิน
                    </Typography>
                    <Money value={creditable} />
                  </Stack>
                )}
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    มูลค่าตามใบกำกับเดิม (ก่อน VAT)
                  </Typography>
                  <Money value={originalNet} />
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    มูลค่าที่ถูกต้องหลังเอกสารนี้
                  </Typography>
                  <Money value={correctNet} />
                </Stack>
              </Stack>
              <TotalsSummary totals={totals} vatRate={invoice.vatRate} showVat={showVat} />
              {overLimit && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  ยอดลดหนี้เกินยอดที่ลดได้ ({creditable.toFixed(2)} บาท = ยอดใบกำกับหักใบลดหนี้ก่อนหน้า)
                </Alert>
              )}
              {!overLimit && toSatang(toCustomerCredit) > 0 && (
                <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                  ลูกค้าชำระแล้ว — ส่วนที่เกินยอดค้าง <Money value={toCustomerCredit} sx={{ fontWeight: 600 }} /> บาท
                  จะตั้งเป็นเงินรอคืนลูกค้า แล้วกด &quot;คืนเงินลูกค้า&quot; ที่หน้าเอกสารเมื่อจ่ายคืนจริง
                </Alert>
              )}
              <Button
                fullWidth
                size="large"
                variant="contained"
                color={isDebit ? 'primary' : 'error'}
                sx={{ mt: 3 }}
                disabled={overLimit}
                onClick={async () => {
                  if (await methods.trigger()) confirm.onTrue();
                }}
              >
                ออก{docTitle}
              </Button>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title={`ยืนยันออก${docTitle}`}
        content={
          <ConfirmSummary
            rows={[
              { label: 'ชนิดเอกสาร', value: `${docTitle} อ้างถึง ${invoice.docNo}` },
              { label: 'ลูกค้า', value: contacts.name(invoice.contactId) },
              { label: `วันที่${docTitle}`, value: formatThaiDate((date ?? '').slice(0, 10)) },
              { label: 'เหตุผล', value: methods.getValues('reason') || '-' },
              { label: 'มูลค่าตามใบกำกับเดิม', value: originalNet },
              { label: 'มูลค่าที่ถูกต้องตามจริง', value: correctNet },
              { label: `ผลต่าง (มูลค่าที่${change})`, value: totals.net },
              { label: `ภาษีขาย${change} ${invoice.vatRate}%`, value: totals.vat, hidden: !showVat },
              { label: `รวม${verb}หนี้`, value: totals.total, strong: true },
              { label: isDebit ? 'เพิ่มยอดลูกหนี้' : 'ลดยอดลูกหนี้', value: toReceivable },
              { label: 'ตั้งเป็นเงินรอคืนลูกค้า', value: toCustomerCredit, hidden: toSatang(toCustomerCredit) <= 0 },
              {
                label: 'งวดภาษี',
                value: `${verb}ภาษีขายเดือน${periodLabel(periodOf((date ?? todayISO()).slice(0, 10)))}`,
                hidden: !showVat,
              },
            ]}
            note={`${docTitle}ออกแล้วแก้ไขหรือลบไม่ได้`}
          />
        }
        action={
          <LoadingButton variant="contained" color={isDebit ? 'primary' : 'error'} onClick={save}>
            ยืนยัน
          </LoadingButton>
        }
      />
    </>
  );
}
