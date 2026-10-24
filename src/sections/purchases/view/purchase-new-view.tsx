import type { PurchaseSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo, useEffect } from 'react';
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
import { useRouter } from 'src/routes/hooks';

import { PurchaseSchema } from 'src/schemas/accounting/doc-schemas';
import { ACC, todayISO, calcDocument, WHT_INCOME_TYPES } from 'src/domain';
import { useAccounting, recordPurchase, useAccountLookup, useContactLookup, DEPOSIT_ACCOUNTS } from 'src/store';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { newLine, TotalsSummary, DocLinesEditor } from 'src/sections/shared';

// ----------------------------------------------------------------------

export function PurchaseNewView() {
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const vendors = useMemo(() => data.contacts.filter((c) => c.kind !== 'customer'), [data.contacts]);

  const methods = useForm<PurchaseSchemaType>({
    resolver: zodResolver(PurchaseSchema),
    defaultValues: {
      contactId: '',
      supplierInvoiceNo: '',
      date: todayISO(),
      vatMode: 'exclusive',
      claimVat: true,
      whtRate: 0,
      whtIncomeType: '',
      whtCondition: '1',
      payNow: false,
      paidDate: todayISO(),
      paymentAccountCode: ACC.bank,
      note: '',
      lines: [newLine(ACC.misc)],
    },
  });

  const { control, setValue, handleSubmit, formState } = methods;
  const [contactId, vatMode, whtRate, whtIncomeType, payNow, lines] = useWatch({
    control,
    name: ['contactId', 'vatMode', 'whtRate', 'whtIncomeType', 'payNow', 'lines'],
  });
  const vendor = contacts.get(contactId);

  // เลือกประเภทเงินได้แล้วเติมอัตราให้
  useEffect(() => {
    const preset = WHT_INCOME_TYPES.find((w) => w.label === whtIncomeType);
    if (preset) setValue('whtRate', preset.rate);
  }, [whtIncomeType, setValue]);

  const totals = useMemo(
    () => calcDocument({ lines: lines ?? [], vatMode: vatMode ?? 'none', vatRate: 7, whtRate: whtRate ?? 0 }),
    [lines, vatMode, whtRate]
  );

  const onSubmit = handleSubmit((v) => {
    try {
      const r = run((s) =>
        recordPurchase(s, {
          contactId: v.contactId,
          supplierInvoiceNo: v.supplierInvoiceNo.trim(),
          date: v.date.slice(0, 10),
          vatMode: v.vatMode,
          claimVat: v.claimVat,
          whtRate: v.whtRate,
          whtIncomeType: v.whtRate > 0 ? v.whtIncomeType : '',
          whtCondition: v.whtCondition,
          note: v.note,
          lines: v.lines,
          payNow: v.payNow ? { date: (v.paidDate ?? v.date).slice(0, 10), accountCode: v.paymentAccountCode } : undefined,
        })
      );
      toast.success(`บันทึก ${r.doc.docNo} แล้ว`);
      router.push(paths.purchases.root);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

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
        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardHeader title="ผู้ขายและใบกำกับภาษี" />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                <Field.Select name="contactId" label="ผู้ขาย / ผู้รับเงิน" size="small" sx={{ gridColumn: { sm: 'span 2' } }}>
                  {vendors.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.code} · {contacts.name(c.id)} {c.legalForm === 'individual' ? '(บุคคลธรรมดา)' : ''}
                    </MenuItem>
                  ))}
                </Field.Select>
                <Field.DatePicker name="date" label="วันที่ตามใบกำกับ" />
                <Field.Text name="supplierInvoiceNo" label="เลขที่ใบกำกับภาษีของผู้ขาย" size="small" />
                <Field.Select name="vatMode" label="ภาษีมูลค่าเพิ่ม" size="small">
                  <MenuItem value="exclusive">ราคาไม่รวม VAT</MenuItem>
                  <MenuItem value="inclusive">ราคารวม VAT แล้ว</MenuItem>
                  <MenuItem value="none">ไม่มี VAT (ผู้ขายไม่จด VAT)</MenuItem>
                </Field.Select>
                <Field.Switch
                  name="claimVat"
                  label="ขอคืนภาษีซื้อ (มีใบกำกับเต็มรูป)"
                  disabled={vatMode === 'none'}
                />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader title="รายการ" />
              <Box sx={{ p: 3 }}>
                <DocLinesEditor
                  accounts={accounts.byType('expense', 'asset')}
                  defaultAccountCode={ACC.misc}
                  accountLabel="บัญชีค่าใช้จ่าย"
                />
              </Box>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader title="หัก ณ ที่จ่าย" subheader="คิดจากมูลค่าก่อน VAT · เข้างวด ภ.ง.ด. ตามวันที่จ่ายจริง" />
              <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' } }}>
                <Field.Select name="whtIncomeType" label="ประเภทเงินได้" size="small">
                  <MenuItem value="">ไม่หัก</MenuItem>
                  {WHT_INCOME_TYPES.map((w) => (
                    <MenuItem key={w.label} value={w.label}>
                      {w.label} ({w.rate}%)
                    </MenuItem>
                  ))}
                </Field.Select>
                <Field.Select name="whtRate" label="อัตรา" size="small">
                  {[0, 1, 2, 3, 5, 10].map((r) => (
                    <MenuItem key={r} value={r}>
                      {r}%
                    </MenuItem>
                  ))}
                </Field.Select>
                <Field.Select name="whtCondition" label="เงื่อนไข" size="small">
                  <MenuItem value="1">หัก ณ ที่จ่าย</MenuItem>
                  <MenuItem value="2">ออกให้ตลอดไป</MenuItem>
                  <MenuItem value="3">ออกให้ครั้งเดียว</MenuItem>
                </Field.Select>
                {vendor && whtRate > 0 && (
                  <Alert severity="info" variant="outlined" sx={{ gridColumn: { sm: 'span 3' } }}>
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
                vatRate={7}
                showVat={vatMode !== 'none'}
                whtRate={whtRate}
                whtLabel="หัก ณ ที่จ่าย"
                payableLabel="ยอดโอนจริง"
              />

              <Stack spacing={2} sx={{ mt: 3 }}>
                <Field.Switch name="payNow" label="จ่ายเงินแล้ว / จ่ายทันที" />
                {payNow && (
                  <>
                    <Field.DatePicker name="paidDate" label="วันที่จ่าย" />
                    <Field.Select name="paymentAccountCode" label="จ่ายจากบัญชี" size="small">
                      {DEPOSIT_ACCOUNTS.map((code) => (
                        <MenuItem key={code} value={code}>
                          {code} {accounts.name(code)}
                        </MenuItem>
                      ))}
                    </Field.Select>
                  </>
                )}
                <LoadingButton type="submit" variant="contained" size="large" loading={formState.isSubmitting}>
                  บันทึก
                </LoadingButton>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Form>
    </>
  );
}
