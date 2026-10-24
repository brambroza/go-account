import type { JournalSource } from 'src/domain';

import { useMemo, useState } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';

import { useBoolean } from 'src/hooks/use-boolean';

import { useAccounting, useAccountLookup } from 'src/store';
import {
  sumBaht,
  todayISO,
  entryTotals,
  trialBalance,
  profitAndLoss,
  formatThaiDate,
  ACCOUNT_TYPE_LABEL,
} from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomTabs } from 'src/components/custom-tabs';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { useTable, rowInPage, TablePaginationCustom } from 'src/components/table';

import { Money } from 'src/sections/shared';

import { ManualEntryDialog } from './manual-entry-dialog';

// ----------------------------------------------------------------------

type TabValue = 'journal' | 'tb' | 'pl' | 'accounts';

const SOURCE_LABEL: Record<JournalSource, string> = {
  sales: 'ขาย',
  'credit-note': 'ลดหนี้',
  receipt: 'รับชำระ',
  purchase: 'ซื้อ',
  payment: 'จ่ายชำระ',
  manual: 'ปรับปรุง',
};

export function LedgerView() {
  const { data } = useAccounting();
  const accounts = useAccountLookup();
  const manual = useBoolean();
  const [tab, setTab] = useState<TabValue>('journal');
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const table = useTable({ defaultRowsPerPage: 10 });

  const journal = useMemo(
    () => data.journal.slice().sort((a, b) => (b.date + b.docNo).localeCompare(a.date + a.docNo)),
    [data.journal]
  );
  const tb = useMemo(() => trialBalance(data.accounts, data.journal, to), [data.accounts, data.journal, to]);
  const pl = useMemo(() => profitAndLoss(data.accounts, data.journal, from, to), [data.accounts, data.journal, from, to]);

  const dateRange = (
    <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
      {tab === 'pl' && (
        <TextField type="date" size="small" label="ตั้งแต่" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
      )}
      <TextField type="date" size="small" label={tab === 'pl' ? 'ถึง' : 'ณ วันที่'} value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
    </Stack>
  );

  return (
    <>
      <CustomBreadcrumbs
        heading="สมุดบัญชี / งบ"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'สมุดบัญชี' }]}
        action={
          <Button variant="contained" startIcon={<Iconify icon="mingcute:add-line" />} onClick={manual.onTrue}>
            รายการปรับปรุง
          </Button>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Card>
        <CustomTabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}>
          <Tab value="journal" label="สมุดรายวัน" />
          <Tab value="tb" label="งบทดลอง" />
          <Tab value="pl" label="กำไรขาดทุน" />
          <Tab value="accounts" label="ผังบัญชี" />
        </CustomTabs>

        <Box sx={{ p: 3 }}>
          {tab === 'journal' && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                รายการจากเอกสารลงบัญชีให้อัตโนมัติและแก้ไม่ได้ — ปรับยอดด้วย “รายการปรับปรุง”
              </Typography>
              <Stack spacing={2}>
                {rowInPage(journal, table.page, table.rowsPerPage).map((j) => {
                  const t = entryTotals(j.lines);
                  return (
                    <Card key={j.id} variant="outlined" sx={{ p: 2, boxShadow: 'none' }}>
                      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                        <Label>{j.docNo}</Label>
                        <Typography variant="subtitle2">{j.description}</Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {formatThaiDate(j.date)} · {SOURCE_LABEL[j.source]}
                          {j.sourceDocNo ? ` · ${j.sourceDocNo}` : ''}
                        </Typography>
                      </Stack>
                      <Scrollbar>
                        <Table size="small" sx={{ minWidth: 520 }}>
                          <TableBody>
                            {j.lines.map((l, i) => (
                              <TableRow key={i}>
                                <TableCell sx={{ width: 72, color: 'text.secondary' }}>{l.accountCode}</TableCell>
                                <TableCell sx={{ pl: l.credit ? 5 : 2 }}>{accounts.name(l.accountCode)}</TableCell>
                                <TableCell align="right" sx={{ width: 140 }}>
                                  <Money value={l.debit} hideZero />
                                </TableCell>
                                <TableCell align="right" sx={{ width: 140 }}>
                                  <Money value={l.credit} hideZero />
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow>
                              <TableCell colSpan={2} />
                              <TableCell align="right">
                                <Money value={t.debit} sx={{ fontWeight: 600 }} />
                              </TableCell>
                              <TableCell align="right">
                                <Money value={t.credit} sx={{ fontWeight: 600 }} />
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </Scrollbar>
                    </Card>
                  );
                })}
              </Stack>
              <TablePaginationCustom
                page={table.page}
                count={journal.length}
                rowsPerPage={table.rowsPerPage}
                onPageChange={table.onChangePage}
                onRowsPerPageChange={table.onChangeRowsPerPage}
                rowsPerPageOptions={[10, 25, 50]}
              />
            </>
          )}

          {tab === 'tb' && (
            <>
              {dateRange}
              <Scrollbar>
                <Table size="small" sx={{ minWidth: 640 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>รหัส</TableCell>
                      <TableCell>ชื่อบัญชี</TableCell>
                      <TableCell align="right">เดบิต</TableCell>
                      <TableCell align="right">เครดิต</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tb.map((r) => {
                      const debitSide = r.debit - r.credit >= 0;
                      const amount = Math.abs(r.debit - r.credit);
                      return (
                        <TableRow key={r.account.code}>
                          <TableCell>{r.account.code}</TableCell>
                          <TableCell>{r.account.name}</TableCell>
                          <TableCell align="right">{debitSide && <Money value={amount} hideZero />}</TableCell>
                          <TableCell align="right">{!debitSide && <Money value={amount} hideZero />}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow>
                      <TableCell colSpan={2}>
                        <Typography variant="subtitle2">รวม</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Money value={sumBaht(tb.map((r) => Math.max(r.debit - r.credit, 0)))} sx={{ fontWeight: 600 }} />
                      </TableCell>
                      <TableCell align="right">
                        <Money value={sumBaht(tb.map((r) => Math.max(r.credit - r.debit, 0)))} sx={{ fontWeight: 600 }} />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Scrollbar>
            </>
          )}

          {tab === 'pl' && (
            <>
              {dateRange}
              <Stack spacing={1} sx={{ maxWidth: 640 }}>
                <Typography variant="subtitle2">รายได้</Typography>
                {pl.revenue.map((r) => (
                  <Stack key={r.account.code} direction="row" justifyContent="space-between" sx={{ pl: 2 }}>
                    <Typography variant="body2">{r.account.name}</Typography>
                    <Money value={r.balance} />
                  </Stack>
                ))}
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle2">รวมรายได้</Typography>
                  <Money value={pl.totalRevenue} sx={{ fontWeight: 600 }} />
                </Stack>
                <Typography variant="subtitle2" sx={{ pt: 2 }}>
                  ค่าใช้จ่าย
                </Typography>
                {pl.expense.map((r) => (
                  <Stack key={r.account.code} direction="row" justifyContent="space-between" sx={{ pl: 2 }}>
                    <Typography variant="body2">{r.account.name}</Typography>
                    <Money value={r.balance} />
                  </Stack>
                ))}
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="subtitle2">รวมค่าใช้จ่าย</Typography>
                  <Money value={pl.totalExpense} sx={{ fontWeight: 600 }} />
                </Stack>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{ pt: 2, mt: 1, borderTop: (theme) => `dashed 1px ${theme.vars.palette.divider}` }}
                >
                  <Typography variant="subtitle1">{pl.netProfit >= 0 ? 'กำไรสุทธิ (ก่อนภาษีเงินได้)' : 'ขาดทุนสุทธิ'}</Typography>
                  <Money value={pl.netProfit} variant="subtitle1" signed />
                </Stack>
              </Stack>
            </>
          )}

          {tab === 'accounts' && (
            <Scrollbar>
              <Table size="small" sx={{ minWidth: 560 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>รหัส</TableCell>
                    <TableCell>ชื่อบัญชี</TableCell>
                    <TableCell>หมวด</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.accounts.map((a) => (
                    <TableRow key={a.code}>
                      <TableCell>{a.code}</TableCell>
                      <TableCell>
                        {a.name}
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                          {a.nameEn}
                        </Typography>
                      </TableCell>
                      <TableCell>{ACCOUNT_TYPE_LABEL[a.type]}</TableCell>
                      <TableCell>{a.system && <Label variant="soft">ระบบใช้ลงอัตโนมัติ</Label>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scrollbar>
          )}
        </Box>
      </Card>

      <ManualEntryDialog open={manual.value} onClose={manual.onFalse} />
    </>
  );
}
