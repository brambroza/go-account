import type { AccountingData } from 'src/domain';
import type { OpeningBalanceFormSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useMemo, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, useFieldArray, useFormContext } from 'react-hook-form';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import CardHeader from '@mui/material/CardHeader';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { OpeningBalanceFormSchema } from 'src/schemas/accounting/doc-schemas';
import { useAccounting, useContactLookup, setOpeningBalances } from 'src/store';
import {
  ACC,
  sumBaht,
  todayISO,
  toSatang,
  endOfMonth,
  monthKeyOf,
  calcDocument,
  formatThaiDate,
  isValidISODate,
  isControlAccount,
  WHT_INCOME_TYPES,
  endOfPreviousMonth,
  openingEntryTotals,
  isOpeningReconciled,
  openingBlockedReason,
  openingReconciliation,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, ConfirmSummary, RHFAmountField, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type FormValues = OpeningBalanceFormSchemaType;

/** ค่าตั้งต้นของฟอร์ม — มียอดยกมาแล้ว (ยังแก้ได้) ดึงจากข้อมูลเดิม ไม่อย่างนั้นบัญชีที่พบบ่อยเป็นศูนย์ */
function initialValues(data: AccountingData): FormValues {
  const ob = data.openingBalance;
  const ar = data.sales.filter((s) => s.opening);
  const ap = data.purchases.filter((p) => p.opening);
  const receivables = ar.map((s) => ({
    contactId: s.contactId,
    docNo: s.docNo,
    date: s.date,
    dueDate: s.dueDate,
    amount: calcDocument(s).total,
    serviceVat: s.saleType === 'service' ? calcDocument(s).vat : 0,
  }));
  const payables = ap.map((p) => ({
    contactId: p.contactId,
    docNo: p.docNo,
    date: p.date,
    amount: calcDocument(p).total,
    vatAmount: p.lines[1]?.unitPrice ?? 0,
    whtIncomeType: p.lines[0]?.whtIncomeType ?? '',
    whtRate: p.lines[0]?.whtRate ?? 0,
  }));
  return {
    date: ob?.date ?? endOfPreviousMonth(todayISO()),
    vatCredit: ob?.vatCredit ?? 0,
    whtReceivable: ob?.whtReceivable ?? 0,
    receivableControl: sumBaht(receivables.map((r) => r.amount)),
    payableControl: sumBaht(payables.map((p) => p.amount)),
    lines: ob?.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit })) ?? [
      { accountCode: ACC.cash, debit: 0, credit: 0 },
      { accountCode: ACC.bank, debit: 0, credit: 0 },
      { accountCode: ACC.capital, debit: 0, credit: 0 },
      { accountCode: ACC.retained, debit: 0, credit: 0 },
    ],
    receivables,
    payables,
  };
}

/** เลือกประเภทเงินได้แล้วเติมอัตราปกติ (แก้เองได้) */
function WhtRateSync({ index }: { index: number }) {
  const { setValue } = useFormContext<FormValues>();
  const incomeType = useWatch<FormValues>({ name: `payables.${index}.whtIncomeType` }) as string | undefined;
  useEffect(() => {
    const preset = WHT_INCOME_TYPES.find((w) => w.label === incomeType);
    if (preset) setValue(`payables.${index}.whtRate`, preset.rate, { shouldValidate: true });
    if (incomeType === '') setValue(`payables.${index}.whtRate`, 0, { shouldValidate: true });
  }, [incomeType, index, setValue]);
  return null;
}

/**
 * ยกยอดจากระบบเดิม (Express): วันที่ยอดยกมา, ยอดคงเหลือบัญชีแยกประเภท, ใบค้างรับ/ค้างจ่ายทีละใบ
 * ตรวจสมดุลและกระทบยอดลูกหนี้/เจ้าหนี้กับงบทดลองเดิมด้วย domain ก่อนยืนยัน — บันทึกได้ก่อนมีรายการอื่นเท่านั้น
 */
export function OpeningBalanceView() {
  const router = useRouter();
  const { data, run } = useAccounting();
  const contacts = useContactLookup();
  const confirm = useBoolean();
  const blocked = openingBlockedReason(data);

  const methods = useForm<FormValues>({ resolver: zodResolver(OpeningBalanceFormSchema), defaultValues: initialValues(data) });
  const { control, handleSubmit, formState } = methods;
  const lines = useFieldArray({ control, name: 'lines' });
  const receivables = useFieldArray({ control, name: 'receivables' });
  const payables = useFieldArray({ control, name: 'payables' });
  const values = useWatch({ control }) as FormValues;

  const glAccounts = useMemo(() => data.accounts.filter((a) => !isControlAccount(a.code)), [data.accounts]);
  const customers = data.contacts.filter((c) => c.kind !== 'vendor');
  const {vatRegistered} = data.company;
  const vendors = data.contacts.filter((c) => c.kind !== 'customer');

  const input = {
    lines: values.lines ?? [],
    vatCredit: values.vatCredit ?? 0,
    whtReceivable: values.whtReceivable ?? 0,
    receivables: values.receivables ?? [],
    payables: values.payables ?? [],
  };
  const totals = openingEntryTotals(input);
  const recon = openingReconciliation({
    ...input,
    receivableControl: values.receivableControl ?? 0,
    payableControl: values.payableControl ?? 0,
  });
  const balanced = toSatang(totals.difference) === 0 && toSatang(totals.debit) > 0;
  // ยังไม่กรอกยอดเลย — ไม่ขึ้น "ต่างกัน 0.00" (UAT U13)
  const nothingEntered = toSatang(totals.debit) === 0 && toSatang(totals.credit) === 0;
  // D4: ยกยอด ณ วันสิ้นเดือนเท่านั้น — เลือกวันอื่นแล้วเสนอปรับเป็นวันสิ้นเดือนของเดือนนั้น
  const openingDate = (values.date ?? '').slice(0, 10);
  const monthEnd = isValidISODate(openingDate) ? endOfMonth(monthKeyOf(openingDate)) : null;
  const notMonthEnd = !!monthEnd && monthEnd !== openingDate;
  const reconciled = isOpeningReconciled(recon);

  const onReview = handleSubmit(() => confirm.onTrue());

  const submit = () => {
    const v = methods.getValues();
    try {
      run((s) =>
        setOpeningBalances(s, {
          date: v.date.slice(0, 10),
          lines: v.lines,
          vatCredit: v.vatCredit,
          whtReceivable: v.whtReceivable,
          receivableControl: v.receivableControl,
          payableControl: v.payableControl,
          receivables: v.receivables.map((r) => ({
            ...r,
            date: r.date.slice(0, 10),
            dueDate: r.dueDate.slice(0, 10),
            serviceVat: vatRegistered ? r.serviceVat ?? 0 : 0,
          })),
          payables: v.payables.map((p) => ({ ...p, date: p.date.slice(0, 10) })),
        })
      );
      confirm.onFalse();
      toast.success('บันทึกยอดยกมาแล้ว');
      router.push(paths.settings);
    } catch (error) {
      confirm.onFalse();
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  const removeButton = (label: string, onClick: () => void) => (
    <IconButton aria-label={label} onClick={onClick}>
      <Iconify icon="solar:trash-bin-trash-bold" width={18} />
    </IconButton>
  );

  return (
    <>
      <CustomBreadcrumbs
        heading="ยอดยกมาจากระบบเดิม"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ตั้งค่า', href: paths.settings }, { name: 'ยอดยกมา' }]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      {blocked && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {blocked}
        </Alert>
      )}
      {data.openingBalance && !blocked && (
        <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
          บันทึกยอดยกมา ณ {formatThaiDate(data.openingBalance.date)} ไว้แล้ว — แก้ได้จนกว่าจะมีรายการแรก
        </Alert>
      )}

      <Form methods={methods}>
        <Grid container spacing={3} onKeyDown={preventEnterSubmit}>
          <Grid item xs={12} xl={8}>
            <Stack spacing={3}>
              <Card>
                <CardHeader
                  title="1. วันที่และยอดตามงบทดลองของระบบเดิม"
                  subheader="ยอด ณ สิ้นวันที่เลือก — รายการใหม่ในระบบนี้ต้องลงวันที่หลังวันนี้"
                />
                <Box sx={{ p: 3, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
                  <Field.DatePicker
                    name="date"
                    label="วันที่ยอดยกมา"
                    shouldDisableDate={(d) => d.date() !== d.daysInMonth()}
                    slotProps={{ textField: { helperText: 'วันสิ้นเดือนเท่านั้น — เดือนถัดไปเริ่มในระบบนี้ทั้งเดือน' } }}
                  />
                  {notMonthEnd && monthEnd ? (
                    <Alert
                      severity="warning"
                      variant="outlined"
                      action={
                        <Button color="inherit" size="small" onClick={() => methods.setValue('date', monthEnd, { shouldValidate: true })}>
                          ใช้ {formatThaiDate(monthEnd)}
                        </Button>
                      }
                    >
                      ยกยอดได้ ณ วันสิ้นเดือนเท่านั้น
                    </Alert>
                  ) : (
                    <Box />
                  )}
                  <RHFAmountField name="receivableControl" label={`${ACC.receivable} ลูกหนี้การค้า (ตามงบทดลองเดิม)`} />
                  <RHFAmountField name="payableControl" label={`${ACC.payable} เจ้าหนี้การค้า (ตามงบทดลองเดิม)`} />
                  <RHFAmountField name="vatCredit" label={`${ACC.vatCredit} ภาษีชำระเกินยกมา (ภ.พ.30 เดือนสุดท้าย)`} />
                  <RHFAmountField name="whtReceivable" label={`${ACC.whtReceivable} ภาษีถูกหัก ณ ที่จ่าย`} />
                </Box>
              </Card>

              <Card>
                <CardHeader title="2. ยอดคงเหลือบัญชีอื่น" subheader="เงินสด ธนาคาร สินทรัพย์ หนี้สินอื่น ทุน กำไรสะสม (และรายได้/ค่าใช้จ่ายสะสมถ้ายกยอดกลางปี)" />
                <Box sx={{ p: 3 }}>
                  <Scrollbar>
                    <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 300 + 160 * 2 + 48, '& td, & th': { px: 1 } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 300 }}>บัญชี</TableCell>
                          <TableCell align="right" sx={{ width: 160 }}>
                            เดบิต
                          </TableCell>
                          <TableCell align="right" sx={{ width: 160 }}>
                            เครดิต
                          </TableCell>
                          <TableCell sx={{ width: 48 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {lines.fields.map((f, i) => (
                          <TableRow key={f.id}>
                            <TableCell>
                              <Field.Select name={`lines.${i}.accountCode`} label="" size="small">
                                {glAccounts.map((a) => (
                                  <MenuItem key={a.code} value={a.code}>
                                    {a.code} {a.name}
                                  </MenuItem>
                                ))}
                              </Field.Select>
                            </TableCell>
                            <TableCell>
                              <RHFAmountField name={`lines.${i}.debit`} />
                            </TableCell>
                            <TableCell>
                              <RHFAmountField name={`lines.${i}.credit`} />
                            </TableCell>
                            <TableCell>{removeButton(`ลบบรรทัดที่ ${i + 1}`, () => lines.remove(i))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Scrollbar>
                  <Button size="small" sx={{ mt: 1 }} startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => lines.append({ accountCode: '', debit: 0, credit: 0 })}>
                    เพิ่มบัญชี
                  </Button>
                </Box>
              </Card>

              <Card>
                <CardHeader
                  title="3. ลูกหนี้คงค้างรายใบ"
                  subheader={
                    vatRegistered
                      ? 'ใบกำกับ/ใบแจ้งหนี้ที่ยังไม่ได้รับเงิน — ภาษีขายยื่นในระบบเดิมแล้วให้เว้นช่อง VAT งานบริการ · ใบแจ้งหนี้งานบริการที่ภาษีขายยังไม่ถึงกำหนด (ม.78/1) กรอก VAT ที่รวมอยู่ แล้วรับเงินจะออกใบเสร็จรับเงิน/ใบกำกับภาษี'
                      : 'ใบแจ้งหนี้ที่ยังไม่ได้รับเงิน — รับชำระต่อในระบบนี้ได้'
                  }
                />
                <Box sx={{ p: 3 }}>
                  <Scrollbar>
                    <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 220 + 130 + 160 * 2 + 130 + (vatRegistered ? 130 : 0) + 48, '& td, & th': { px: 1 } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 220 }}>ลูกค้า</TableCell>
                          <TableCell sx={{ width: 130 }}>เลขที่เดิม</TableCell>
                          <TableCell sx={{ width: 160 }}>วันที่</TableCell>
                          <TableCell sx={{ width: 160 }}>ครบกำหนด</TableCell>
                          <TableCell align="right" sx={{ width: 130 }}>
                            ยอดค้าง (รวม VAT)
                          </TableCell>
                          {vatRegistered && (
                            <TableCell align="right" sx={{ width: 130 }}>
                              VAT งานบริการ ที่ยังไม่ถึงกำหนด
                            </TableCell>
                          )}
                          <TableCell sx={{ width: 48 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {receivables.fields.map((f, i) => (
                          <TableRow key={f.id}>
                            <TableCell>
                              <Field.Select name={`receivables.${i}.contactId`} label="" size="small">
                                {customers.map((c) => (
                                  <MenuItem key={c.id} value={c.id}>
                                    {c.code} · {contacts.name(c.id)}
                                  </MenuItem>
                                ))}
                              </Field.Select>
                            </TableCell>
                            <TableCell>
                              <Field.Text name={`receivables.${i}.docNo`} size="small" />
                            </TableCell>
                            <TableCell>
                              <Field.DatePicker name={`receivables.${i}.date`} />
                            </TableCell>
                            <TableCell>
                              <Field.DatePicker name={`receivables.${i}.dueDate`} />
                            </TableCell>
                            <TableCell>
                              <RHFAmountField name={`receivables.${i}.amount`} />
                            </TableCell>
                            {vatRegistered && (
                              <TableCell>
                                <RHFAmountField name={`receivables.${i}.serviceVat`} inputProps={{ 'aria-label': `VAT งานบริการรายการที่ ${i + 1}` }} />
                              </TableCell>
                            )}
                            <TableCell>{removeButton(`ลบลูกหนี้รายการที่ ${i + 1}`, () => receivables.remove(i))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Scrollbar>
                  <Button
                    size="small"
                    sx={{ mt: 1 }}
                    startIcon={<Iconify icon="mingcute:add-line" />}
                    onClick={() =>
                      receivables.append({
                        contactId: '',
                        docNo: '',
                        date: values.date ?? todayISO(),
                        dueDate: values.date ?? todayISO(),
                        amount: 0,
                        serviceVat: 0,
                      })
                    }
                  >
                    เพิ่มลูกหนี้
                  </Button>
                </Box>
              </Card>

              <Card>
                <CardHeader title="4. เจ้าหนี้คงค้างรายใบ" subheader="ใบกำกับผู้ขายที่ยังไม่ได้จ่าย (ภาษีซื้อใช้สิทธิในระบบเดิมแล้ว) — ระบุหัก ณ ที่จ่ายเพื่อออก 50 ทวิ ตอนจ่าย" />
                <Box sx={{ p: 3 }}>
                  <Scrollbar>
                    <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 200 + 130 + 160 + 130 + 120 + 180 + 80 + 48, '& td, & th': { px: 1 } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 200 }}>ผู้ขาย</TableCell>
                          <TableCell sx={{ width: 130 }}>เลขที่ใบกำกับ</TableCell>
                          <TableCell sx={{ width: 160 }}>วันที่</TableCell>
                          <TableCell align="right" sx={{ width: 130 }}>
                            ยอดค้าง (รวม VAT)
                          </TableCell>
                          <TableCell align="right" sx={{ width: 120 }}>
                            VAT ที่รวมอยู่
                          </TableCell>
                          <TableCell sx={{ width: 180 }}>หัก ณ ที่จ่าย</TableCell>
                          <TableCell sx={{ width: 80 }}>อัตรา %</TableCell>
                          <TableCell sx={{ width: 48 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {payables.fields.map((f, i) => (
                          <TableRow key={f.id}>
                            <TableCell>
                              <Field.Select name={`payables.${i}.contactId`} label="" size="small">
                                {vendors.map((c) => (
                                  <MenuItem key={c.id} value={c.id}>
                                    {c.code} · {contacts.name(c.id)}
                                  </MenuItem>
                                ))}
                              </Field.Select>
                            </TableCell>
                            <TableCell>
                              <Field.Text name={`payables.${i}.docNo`} size="small" />
                            </TableCell>
                            <TableCell>
                              <Field.DatePicker name={`payables.${i}.date`} />
                            </TableCell>
                            <TableCell>
                              <RHFAmountField name={`payables.${i}.amount`} />
                            </TableCell>
                            <TableCell>
                              <RHFAmountField name={`payables.${i}.vatAmount`} />
                            </TableCell>
                            <TableCell>
                              <WhtRateSync index={i} />
                              <Field.Select name={`payables.${i}.whtIncomeType`} label="" size="small">
                                <MenuItem value="">ไม่หัก</MenuItem>
                                {WHT_INCOME_TYPES.map((w) => (
                                  <MenuItem key={w.label} value={w.label}>
                                    {w.label}
                                  </MenuItem>
                                ))}
                              </Field.Select>
                            </TableCell>
                            <TableCell>
                              <RHFAmountField name={`payables.${i}.whtRate`} decimals={0} />
                            </TableCell>
                            <TableCell>{removeButton(`ลบเจ้าหนี้รายการที่ ${i + 1}`, () => payables.remove(i))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Scrollbar>
                  <Button
                    size="small"
                    sx={{ mt: 1 }}
                    startIcon={<Iconify icon="mingcute:add-line" />}
                    onClick={() =>
                      payables.append({
                        contactId: '',
                        docNo: '',
                        date: values.date ?? todayISO(),
                        amount: 0,
                        vatAmount: 0,
                        whtIncomeType: '',
                        whtRate: 0,
                      })
                    }
                  >
                    เพิ่มเจ้าหนี้
                  </Button>
                </Box>
              </Card>
            </Stack>
          </Grid>

          <Grid item xs={12} xl={4}>
            <Card sx={{ p: 3, position: { xl: 'sticky' }, top: { xl: 96 } }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                ตรวจก่อนบันทึก
              </Typography>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    รวมเดบิต
                  </Typography>
                  <Money value={totals.debit} />
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    รวมเครดิต
                  </Typography>
                  <Money value={totals.credit} />
                </Stack>
                {nothingEntered ? (
                  <Alert severity="info" variant="outlined">
                    ยังไม่ได้กรอกยอด — กรอกตามงบทดลอง ณ วันยอดยกมาของระบบเดิม
                  </Alert>
                ) : (
                  <Alert severity={balanced ? 'success' : 'warning'} variant="outlined">
                    {balanced ? 'ยอดยกมาสมดุล' : `ยังไม่สมดุล ต่างกัน ${Math.abs(totals.difference).toFixed(2)} บาท`}
                  </Alert>
                )}
                {recon.map((r) => (
                  <Stack key={r.accountCode} spacing={0.5}>
                    <Typography variant="subtitle2">
                      {r.accountCode} {r.label}
                    </Typography>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        งบทดลองเดิม / รวมรายใบ
                      </Typography>
                      <Typography variant="caption">
                        <Money value={r.control} sx={{ typography: 'caption' }} /> / <Money value={r.items} sx={{ typography: 'caption' }} />
                      </Typography>
                    </Stack>
                    {toSatang(r.difference) !== 0 && (
                      <Typography variant="caption" sx={{ color: 'error.main' }}>
                        ต่าง <Money value={r.difference} sx={{ typography: 'caption' }} /> — กรอกใบค้างให้ครบหรือแก้ยอด
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
              <LoadingButton
                fullWidth
                size="large"
                variant="contained"
                sx={{ mt: 3 }}
                loading={formState.isSubmitting}
                disabled={!!blocked || !balanced || !reconciled}
                onClick={onReview}
              >
                บันทึกยอดยกมา
              </LoadingButton>
              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                ลูกหนี้/เจ้าหนี้ ภาษีชำระเกิน และภาษีถูกหัก ณ ที่จ่ายลงบัญชีจากช่องข้างบน บรรทัดบัญชีอื่นห้ามใช้บัญชีคุม
              </Typography>
            </Card>
          </Grid>
        </Grid>
      </Form>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title="ยืนยันบันทึกยอดยกมา"
        content={
          <ConfirmSummary
            rows={[
              { label: 'ยอดยกมา ณ วันที่', value: formatThaiDate((values.date ?? '').slice(0, 10)) },
              { label: 'ลูกหนี้คงค้าง', value: `${input.receivables.length} ใบ` },
              { label: 'เจ้าหนี้คงค้าง', value: `${input.payables.length} ใบ` },
              { label: 'รวมเดบิต = เครดิต', value: totals.debit, strong: true },
            ]}
            note="หลังบันทึก รายการใหม่ทุกประเภทต้องลงวันที่หลังวันยอดยกมา และแก้ยอดยกมาได้จนกว่าจะมีรายการแรกเท่านั้น"
          />
        }
        action={
          <LoadingButton variant="contained" onClick={submit}>
            ยืนยันบันทึก
          </LoadingButton>
        }
      />
    </>
  );
}
