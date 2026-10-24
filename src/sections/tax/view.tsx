import type { Period } from 'src/domain';

import { useMemo, useState } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';

import { useAccounting } from 'src/store';
import {
  periodOf,
  todayISO,
  whtTotals,
  periodLabel,
  shiftPeriod,
  pp30Summary,
  salesVatReport,
  filingDueDates,
  purchaseVatReport,
  whtPayeesForPeriod,
  formatThaiDateShort,
} from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { CustomTabs } from 'src/components/custom-tabs';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money } from 'src/sections/shared';

import { WhtTab } from './wht-tab';
import { ETaxTab } from './etax-tab';
import { VatReportTab } from './vat-tab';

// ----------------------------------------------------------------------

type TabValue = 'sales' | 'purchase' | 'pp30' | 'pnd3' | 'pnd53' | 'etax';

export function TaxView() {
  const { data } = useAccounting();
  const [period, setPeriod] = useState<Period>(() => periodOf(todayISO()));
  const [tab, setTab] = useState<TabValue>('pp30');

  const report = useMemo(() => {
    const sales = salesVatReport(data.sales, data.contacts, period);
    const purchases = purchaseVatReport(data.purchases, data.contacts, period);
    const pnd3 = whtTotals(whtPayeesForPeriod(data.purchases, data.contacts, period, 'PND3'));
    const pnd53 = whtTotals(whtPayeesForPeriod(data.purchases, data.contacts, period, 'PND53'));
    const etaxWaiting = data.sales.filter(
      (s) => (s.etax === 'pending-sign' || s.etax === 'signed') && periodOf(s.date).year === period.year && periodOf(s.date).month === period.month
    ).length;
    return { sales, purchases, pp30: pp30Summary(sales, purchases), pnd3, pnd53, etaxWaiting };
  }, [data, period]);

  const due = filingDueDates(period);

  const cards = [
    { key: 'pp30' as const, form: 'ภ.พ.30', desc: 'ภาษีมูลค่าเพิ่ม', amount: report.pp30.netVat, due: due.vat },
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
                { label: 'ยอดขายที่ต้องเสียภาษี (สุทธิหลังลดหนี้)', value: report.pp30.salesNet },
                { label: 'ภาษีขายเดือนนี้', value: report.pp30.outputVat },
                { label: 'ยอดซื้อที่มีสิทธินำภาษีซื้อมาหัก', value: report.pp30.purchaseNet },
                { label: 'ภาษีซื้อเดือนนี้', value: report.pp30.inputVat },
              ].map((r) => (
                <Stack key={r.label} direction="row" justifyContent="space-between" spacing={2}>
                  <Typography variant="body2">{r.label}</Typography>
                  <Money value={r.value} />
                </Stack>
              ))}
              <Stack direction="row" justifyContent="space-between" sx={{ pt: 1.5, borderTop: (theme) => `dashed 1px ${theme.vars.palette.divider}` }}>
                <Typography variant="subtitle1">
                  {report.pp30.netVat >= 0 ? 'ภาษีที่ต้องชำระเดือนนี้' : 'ภาษีที่ชำระเกินเดือนนี้'}
                </Typography>
                <Money value={Math.abs(report.pp30.netVat)} variant="subtitle1" />
              </Stack>
              <Alert severity="info" variant="outlined">
                ภาษีซื้อในต้นแบบนี้นับตามวันที่ในใบกำกับ ถ้าต้องการยกไปใช้เดือนหลัง (ภายใน 6 เดือน) ให้บันทึกในเดือนที่ต้องการใช้สิทธิ
              </Alert>
            </Stack>
          )}
          {tab === 'sales' && <VatReportTab rows={report.sales} period={period} kind="sales" />}
          {tab === 'purchase' && <VatReportTab rows={report.purchases} period={period} kind="purchase" />}
          {tab === 'pnd3' && <WhtTab form="PND3" period={period} />}
          {tab === 'pnd53' && <WhtTab form="PND53" period={period} />}
          {tab === 'etax' && <ETaxTab period={period} />}
        </Box>
      </Card>
    </>
  );
}
