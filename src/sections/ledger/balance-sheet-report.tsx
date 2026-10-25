import type { BalanceSheet, BalanceSheetRow } from 'src/domain';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';

import { formatThaiDate } from 'src/domain';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { report: BalanceSheet; companyName: string };

function Section({ title, rows, total, totalLabel }: { title: string; rows: BalanceSheetRow[]; total: number; totalLabel: string }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{title}</Typography>
      {rows.map((r) => (
        <Stack key={r.account.code} direction="row" justifyContent="space-between" sx={{ pl: 2 }}>
          <Typography variant="body2">
            <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>
              {r.account.code}
            </Box>
            {r.account.name}
          </Typography>
          <Money value={r.balance} signed />
        </Stack>
      ))}
      {!rows.length && (
        <Typography variant="body2" sx={{ pl: 2, color: 'text.disabled' }}>
          -
        </Typography>
      )}
      <Stack direction="row" justifyContent="space-between" sx={{ borderTop: (theme) => `dashed 1px ${theme.vars.palette.divider}`, pt: 1 }}>
        <Typography variant="subtitle2">{totalLabel}</Typography>
        <Money value={total} sx={{ fontWeight: 600 }} signed />
      </Stack>
    </Stack>
  );
}

/** งบแสดงฐานะการเงิน ณ วันที่ — ตัวเลขทั้งหมดจาก `balanceSheet` (domain) พิมพ์ได้ */
export function BalanceSheetReport({ report, companyName }: Props) {
  return (
    <Card variant="outlined" sx={{ p: { xs: 2, md: 4 }, boxShadow: 'none', maxWidth: 760 }} className="print-area">
      <Stack spacing={0.5} alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h6">{companyName}</Typography>
        <Typography variant="subtitle1">งบแสดงฐานะการเงิน</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          ณ วันที่ {formatThaiDate(report.asOf)} (หน่วย: บาท)
        </Typography>
      </Stack>

      {!report.balanced && (
        <Alert severity="error" sx={{ mb: 2 }}>
          สินทรัพย์ไม่เท่ากับหนี้สินและส่วนของเจ้าของ — ตรวจรายการบัญชีที่ไม่สมดุล
        </Alert>
      )}

      <Stack spacing={3}>
        <Section title="สินทรัพย์" rows={report.assets} total={report.totalAssets} totalLabel="รวมสินทรัพย์" />
        <Section title="หนี้สิน" rows={report.liabilities} total={report.totalLiabilities} totalLabel="รวมหนี้สิน" />
        <Stack spacing={1}>
          <Section title="ส่วนของเจ้าของ" rows={report.equity} total={report.totalEquityAccounts} totalLabel="รวมทุนและกำไรสะสม" />
          <Stack direction="row" justifyContent="space-between" sx={{ pl: 2 }}>
            <Typography variant="body2">กำไร (ขาดทุน) งวดปัจจุบันที่ยังไม่ปิดบัญชี</Typography>
            <Money value={report.unclosedProfit} signed />
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="subtitle2">รวมส่วนของเจ้าของ</Typography>
            <Money value={report.totalEquity} sx={{ fontWeight: 600 }} signed />
          </Stack>
        </Stack>
        <Stack
          direction="row"
          justifyContent="space-between"
          sx={{ pt: 1.5, borderTop: (theme) => `solid 2px ${theme.vars.palette.divider}` }}
        >
          <Typography variant="subtitle1">รวมหนี้สินและส่วนของเจ้าของ</Typography>
          <Money value={report.totalLiabilitiesAndEquity} variant="subtitle1" sx={{ ...(!report.balanced && { color: 'error.main' }) }} />
        </Stack>
      </Stack>
    </Card>
  );
}
