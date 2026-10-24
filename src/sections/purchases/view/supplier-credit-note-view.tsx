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
import MenuItem from '@mui/material/MenuItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
import { useRouter, useParams } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { SupplierCreditNoteSchema } from 'src/schemas/accounting/doc-schemas';
import { uid, useAccounting, useAccountLookup, useContactLookup, recordSupplierCreditNote } from 'src/store';
import {
  subBaht,
  todayISO,
  toSatang,
  periodOf,
  periodLabel,
  calcDocument,
  formatThaiDate,
  isValidISODate,
  purchaseOutstanding,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, TotalsSummary, ConfirmSummary, DocLinesEditor, formKeyHandler, LockedDateAlert } from 'src/sections/shared';

// ----------------------------------------------------------------------

const REASONS = ['คืนสินค้าชำรุด/ไม่ตรงสเปก', 'ผู้ขายลดราคาหลังออกใบกำกับ', 'ผู้ขายคำนวณราคาผิด (สูงไป)', 'ยกเลิกบริการบางส่วน'];

/**
 * บันทึกใบลดหนี้จากผู้ขาย อ้างเอกสารซื้อเดิม — ลดเจ้าหนี้ และลดภาษีซื้อในเดือนที่ได้รับ (ถ้าเอกสารเดิมขอคืน)
 * ลดได้ไม่เกินยอดค้างจ่าย กติกาทั้งหมดตรวจที่ `recordSupplierCreditNote` (ยืนยันสรุปก่อนบันทึก)
 */
export function SupplierCreditNoteView() {
  const { id = '' } = useParams();
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const confirm = useBoolean();

  const purchase = data.purchases.find((p) => p.id === id);
  const outstanding = purchase ? purchaseOutstanding(data, purchase) : 0;

  const methods = useForm<SupplierCreditNoteSchemaType>({
    resolver: zodResolver(SupplierCreditNoteSchema),
    defaultValues: {
      supplierCreditNoteNo: '',
      supplierCreditNoteDate: todayISO(),
      date: todayISO(),
      reason: '',
      lines: purchase?.lines.map((l) => ({
        id: uid(),
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount,
        accountCode: l.accountCode,
      })) ?? [],
    },
  });
  const [lines, date] = useWatch({ control: methods.control, name: ['lines', 'date'] });
  const totals = useMemo(
    () =>
      purchase
        ? calcDocument({ lines: lines ?? [], vatMode: purchase.vatMode, vatRate: purchase.vatRate })
        : calcDocument({ lines: [], vatMode: 'none', vatRate: 0 }),
    [purchase, lines]
  );

  if (!purchase || purchase.opening || toSatang(outstanding) <= 0) {
    return (
      <EmptyContent
        filled
        title={
          !purchase
            ? 'ไม่พบเอกสารซื้อ'
            : purchase.opening
              ? `${purchase.docNo} เป็นยอดยกมาจากระบบเดิม — บันทึกใบลดหนี้ในระบบเดิม`
              : `${purchase.docNo} ไม่มียอดค้างจ่าย — ส่วนที่จ่ายแล้วให้บันทึกรับเงินคืนจากผู้ขาย`
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

  const overLimit = toSatang(totals.total) > toSatang(outstanding);
  const showVat = purchase.vatMode !== 'none';
  const dateIso = (date ?? '').slice(0, 10);
  const vatMonth = isValidISODate(dateIso) ? periodLabel(periodOf(dateIso)) : '-';

  const save = methods.handleSubmit((values) => {
    try {
      const r = run((s) =>
        recordSupplierCreditNote(s, {
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
          <Grid item xs={12} lg={8}>
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
              <CardHeader title="รายการที่ลด" subheader="แก้จำนวนหรือราคาให้เหลือเฉพาะส่วนที่ลด — บัญชีตั้งต้นตามเอกสารเดิม" />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor
                  accounts={accounts.forLines('purchase')}
                  defaultAccountCode={purchase.lines[0]?.accountCode ?? ''}
                  accountLabel="บัญชีค่าใช้จ่าย/สินทรัพย์"
                />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card sx={{ p: 3 }}>
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ค้างจ่ายของเอกสารเดิม
                  </Typography>
                  <Money value={outstanding} />
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
              {overLimit && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  ยอดลดหนี้เกินยอดค้างจ่าย ({outstanding.toFixed(2)} บาท) — ส่วนที่จ่ายแล้วให้บันทึกรับเงินคืนจากผู้ขาย
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
          <ConfirmSummary
            rows={[
              { label: 'อ้างถึง', value: `${purchase.docNo} (${purchase.supplierInvoiceNo || '-'})` },
              { label: 'ผู้ขาย', value: contacts.name(purchase.contactId) },
              { label: 'เลขที่ใบลดหนี้ผู้ขาย', value: methods.getValues('supplierCreditNoteNo') || '-' },
              { label: 'วันที่ได้รับ', value: formatThaiDate(dateIso) },
              { label: 'มูลค่าที่ลด', value: totals.net },
              { label: `ภาษีซื้อลดลง ${purchase.vatRate}%`, value: totals.vat, hidden: !purchase.claimVat || !showVat },
              { label: 'ลดเจ้าหนี้', value: totals.total, strong: true },
              { label: 'ค้างจ่ายหลังลดหนี้', value: subBaht(outstanding, totals.total) },
              { label: 'งวดภาษี', value: `ลดภาษีซื้อเดือน${vatMonth}`, hidden: !purchase.claimVat || !showVat },
            ]}
            note="บันทึกแล้วแก้ไขหรือลบไม่ได้ — หัก ณ ที่จ่ายของการจ่ายครั้งถัดไปคิดจากยอดหลังลดหนี้"
          />
        }
        action={
          <LoadingButton variant="contained" color="error" onClick={save}>
            ยืนยัน
          </LoadingButton>
        }
      />
    </>
  );
}
