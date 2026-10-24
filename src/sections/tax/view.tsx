import type { Period } from 'src/domain';
import type { VatReportDto, WhtReportDto } from 'src/sections/shared/server-reports';

import { useMemo, useState } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';

import { useBoolean } from 'src/hooks/use-boolean';

import { OwnerOnly } from 'src/auth';
import { useAccounting } from 'src/store';
import {
  inPeriod,
  periodOf,
  todayISO,
  whtTotals,
  periodKey,
  eTaxWaiting,
  periodLabel,
  shiftPeriod,
  pp30ForPeriod,
  salesVatReport,
  filingDueDates,
  formatThaiDate,
  purchaseVatReport,
  whtPayeesForPeriod,
  formatThaiDateShort,
} from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { CustomTabs } from 'src/components/custom-tabs';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money } from 'src/sections/shared';
import { toPp30, toVatRows, useServerReport } from 'src/sections/shared/server-reports';

import { WhtTab } from './wht-tab';
import { ETaxTab } from './etax-tab';
import { VatReportTab } from './vat-tab';
import { LockPeriodDialog } from './lock-period-dialog';

// ----------------------------------------------------------------------

type TabValue = 'sales' | 'purchase' | 'pp30' | 'pnd3' | 'pnd53' | 'etax';

/** ศูนย์ภาษี: ภ.พ.30, รายงานภาษีซื้อ/ขาย, ภ.ง.ด.3/53, e-Tax และการปิดงวด */
export function TaxView() {
  const { data, mode } = useAccounting();
  const lockDialog = useBoolean();
  const lock = data.company.lockedThrough;
  const [period, setPeriod] = useState<Period>(() => periodOf(todayISO()));
  const [tab, setTab] = useState<TabValue>('pp30');
  const month = periodKey(period);

  // โหมด api: ตัวเลขภาษีมาจากเซิร์ฟเวอร์ (/reports/vat, /reports/wht) — ระหว่างโหลดใช้ค่าที่คำนวณจากสมุดที่โหลดมา (preview)
  const api = mode === 'api';
  const serverVat = useServerReport<VatReportDto>(api ? `/reports/vat/${month}` : null);
  const serverPnd3 = useServerReport<WhtReportDto>(api ? `/reports/wht/${month}/pnd3` : null);
  const serverPnd53 = useServerReport<WhtReportDto>(api ? `/reports/wht/${month}/pnd53` : null);

  const report = useMemo(() => {
    const etaxWaiting = eTaxWaiting(data).filter((d) => inPeriod(d.date, period)).length;
    const v = serverVat.data;
    const totals = (w: WhtReportDto) => ({ payees: w.payeeCount, amount: w.amount, tax: w.tax });
    return {
      sales: v ? toVatRows(v.sales) : salesVatReport(data.sales, data.contacts, period, data.receipts),
      purchases: v ? toVatRows(v.purchases) : purchaseVatReport(data.purchases, data.contacts, period, data.purchaseCredits),
      pp30: v ? toPp30(v.pp30, data.vatCloses, month) : pp30ForPeriod(data, period),
      pnd3: serverPnd3.data ? totals(serverPnd3.data) : whtTotals(whtPayeesForPeriod(data, period, 'PND3')),
      pnd53: serverPnd53.data ? totals(serverPnd53.data) : whtTotals(whtPayeesForPeriod(data, period, 'PND53')),
      etaxWaiting,
    };
  }, [data, period, month, serverVat.data, serverPnd3.data, serverPnd53.data]);
  const serverError = serverVat.error ?? serverPnd3.error ?? serverPnd53.error;

  const due = filingDueDates(period);

  const cards = [
    {
      key: 'pp30' as const,
      form: 'ภ.พ.30',
      desc: report.pp30.payable > 0 ? 'ภาษีมูลค่าเพิ่มที่ต้องชำระ' : 'ภาษีชำระเกิน ยกไปเดือนถัดไป',
      amount: report.pp30.payable > 0 ? report.pp30.payable : -report.pp30.carriedForward,
      due: due.vat,
    },
    { key: 'pnd3' as const, form: 'ภ.ง.ด.3', desc: `หัก ณ ที่จ่าย บุคคล ${report.pnd3.payees} ราย`, amount: report.pnd3.tax, due: due.wht },
    { key: 'pnd53' as const, form: 'ภ.ง.ด.53', desc: `หัก ณ ที่จ่าย นิติบุคคล ${report.pnd53.payees} ราย`, amount: report.pnd53.tax, due: due.wht },
    { key: 'etax' as const, form: 'e-Tax Invoice', desc: 'รอลงนาม / รอนำส่ง', count: report.etaxWaiting, due: undefined },
  ];

  return (
    <>
      <CustomBreadcrumbs
        heading="ศูนย์ภาษี"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ศูนย์ภาษี' }]}
        action={
          <Stack direction="row" alignItems="center" spacing={1} sx={{ bgcolor: 'background.neutral', borderRadius: 1, px: 0.5 }}>
            <IconButton aria-label="เดือนก่อน" onClick={() => setPeriod((p) => shiftPeriod(p, -1))}>
              <Iconify icon="eva:arrow-ios-back-fill" />
            </IconButton>
            <Typography variant="subtitle2" sx={{ minWidth: 120, textAlign: 'center' }}>
              {periodLabel(period)}
            </Typography>
            <IconButton aria-label="เดือนถัดไป" onClick={() => setPeriod((p) => shiftPeriod(p, 1))}>
              <Iconify icon="eva:arrow-ios-forward-fill" />
            </IconButton>
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Alert
        severity={lock ? 'info' : 'warning'}
        variant="outlined"
        sx={{ mb: 3, alignItems: 'center' }}
        icon={<Iconify icon="solar:lock-keyhole-minimalistic-bold" />}
        action={
          <OwnerOnly>
            <Button color="inherit" size="small" variant="outlined" onClick={lockDialog.onTrue}>
              ปิดงวด
            </Button>
          </OwnerOnly>
        }
      >
        {lock
          ? `ปิดงวดถึงวันที่ ${formatThaiDate(lock)} — รายการที่ลงวันที่ถึงวันนี้แก้หรือเพิ่มไม่ได้`
          : 'ยังไม่ได้ปิดงวด — หลังยื่นแบบของเดือนแล้วให้ปิดงวด เพื่อกันการลงรายการย้อนหลังเข้างวดที่ยื่นแล้ว'}
      </Alert>

      {serverError && (
        <Alert severity="error" variant="outlined" sx={{ mb: 3 }}>
          โหลดรายงานภาษีจากเซิร์ฟเวอร์ไม่สำเร็จ: {serverError} — ตัวเลขด้านล่างคำนวณจากข้อมูลที่โหลดไว้ (ยังไม่ยืนยันจากเซิร์ฟเวอร์)
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
        {cards.map((c) => (
          <Card
            key={c.key}
            component="button"
            onClick={() => setTab(c.key)}
            sx={{
              p: 2.5,
              textAlign: 'left',
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
              outline: tab === c.key ? (theme) => `2px solid ${theme.vars.palette.primary.main}` : 'none',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">{c.form}</Typography>
              {c.due && <Label variant="soft">ยื่นภายใน {formatThaiDateShort(c.due)}</Label>}
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {c.desc}
            </Typography>
            <Box sx={{ mt: 1.5 }}>
              {c.amount !== undefined ? (
                <Money value={c.amount} variant="h4" signed />
              ) : (
                <Typography variant="h4">{c.count} ฉบับ</Typography>
              )}
            </Box>
          </Card>
        ))}
      </Box>

      <Card>
        <CustomTabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}
        >
          <Tab value="pp30" label="ภ.พ.30" />
          <Tab value="sales" label="รายงานภาษีขาย" />
          <Tab value="purchase" label="รายงานภาษีซื้อ" />
          <Tab value="pnd3" label="ภ.ง.ด.3" />
          <Tab value="pnd53" label="ภ.ง.ด.53" />
          <Tab value="etax" label="e-Tax Invoice" />
        </CustomTabs>

        <Box sx={{ p: 3 }}>
          {tab === 'pp30' && (
            <Stack spacing={2.5} sx={{ maxWidth: 640 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                ตัวเลขสำหรับกรอกแบบ ภ.พ.30 เดือน{periodLabel(period)} ที่ efiling.rd.go.th (คำนวณจากรายงานภาษีขายและภาษีซื้อของงวด)
              </Typography>
              {[
                { label: 'ยอดขายที่ต้องเสียภาษี (สุทธิหลังลด/เพิ่มหนี้)', value: report.pp30.salesNet },
                { label: 'ภาษีขายเดือนนี้', value: report.pp30.outputVat },
                { label: 'ยอดซื้อที่มีสิทธินำภาษีซื้อมาหัก (ตามเดือนที่ใช้สิทธิ)', value: report.pp30.purchaseNet },
                { label: 'ภาษีซื้อเดือนนี้', value: report.pp30.inputVat },
                {
                  label: report.pp30.netVat >= 0 ? 'ภาษีที่ต้องชำระเดือนนี้ (ช่อง 8)' : 'ภาษีที่ชำระเกินเดือนนี้ (ช่อง 9)',
                  value: Math.abs(report.pp30.netVat),
                },
                { label: 'ภาษีที่ชำระเกินยกมา (ช่อง 10)', value: report.pp30.broughtForward },
              ].map((r) => (
                <Stack key={r.label} direction="row" justifyContent="space-between" spacing={2}>
                  <Typography variant="body2">{r.label}</Typography>
                  <Money value={r.value} />
                </Stack>
              ))}
              <Stack direction="row" justifyContent="space-between" sx={{ pt: 1.5, borderTop: (theme) => `dashed 1px ${theme.vars.palette.divider}` }}>
                <Typography variant="subtitle1">
                  {report.pp30.payable > 0 ? 'ภาษีที่ต้องชำระสุทธิ (ช่อง 11)' : 'ภาษีที่ชำระเกินสุทธิ ยกไป (ช่อง 12)'}
                </Typography>
                <Money value={report.pp30.payable > 0 ? report.pp30.payable : report.pp30.carriedForward} variant="subtitle1" />
              </Stack>
              {report.pp30.closed ? (
                <Alert severity="success" variant="outlined">
                  ปิดภาษีเดือนนี้แล้วพร้อมการปิดงวด — ลงบัญชีโอนภาษีขาย/ภาษีซื้อเข้า
                  {report.pp30.closed.payable > 0 ? ' 2170 ภาษีมูลค่าเพิ่มค้างจ่าย' : ' 1180 ภาษีชำระเกินยกไป'} ณ วันที่{' '}
                  {formatThaiDate(report.pp30.closed.date)} (ยกไปเดือนถัดไปอัตโนมัติ)
                </Alert>
              ) : (
                <Alert severity="info" variant="outlined">
                  ยอดยกมาคำนวณต่อจากเดือนก่อนหน้า (ยังไม่ปิดงวด) — เมื่อปิดงวดเดือนนี้ ระบบจะลงรายการปิดภาษีเดือน
                  และยกยอดชำระเกินไปเดือนถัดไปให้ ภาษีซื้อนับตามเดือนที่เลือกใช้สิทธิในเอกสารซื้อ (ภายใน 6 เดือน ม.82/3)
                </Alert>
              )}
            </Stack>
          )}
          {tab === 'sales' && <VatReportTab rows={report.sales} period={period} kind="sales" />}
          {tab === 'purchase' && <VatReportTab rows={report.purchases} period={period} kind="purchase" />}
          {tab === 'pnd3' && <WhtTab form="PND3" period={period} server={serverPnd3.data} />}
          {tab === 'pnd53' && <WhtTab form="PND53" period={period} server={serverPnd53.data} />}
          {tab === 'etax' && <ETaxTab period={period} />}
        </Box>
      </Card>

      <LockPeriodDialog open={lockDialog.value} onClose={lockDialog.onFalse} />
    </>
  );
}
