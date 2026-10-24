import type { BankAccount } from 'src/domain';

import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { useBoolean } from 'src/hooks/use-boolean';

import { useAccounting, useContactLookup, useCashAccountOptions } from 'src/store';
import { ACC, todayISO, cashBalanceOf, formatThaiDate, BANK_KIND_LABEL, bankAccountSummary } from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomTabs } from 'src/components/custom-tabs';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money } from 'src/sections/shared';

import { TransferDialog } from '../transfer-dialog';
import { PettyCashDialog } from '../petty-cash-dialog';
import { BankAccountDialog } from '../bank-account-dialog';

// ----------------------------------------------------------------------

type TabValue = 'transfers' | 'petty';

/** บรรทัดรายละเอียดใต้ชื่อบัญชี — ไม่ซ้ำธนาคาร/เลขที่ที่อยู่ในชื่อบัญชีแล้ว (UAT U13) */
function bankDetailLine(accountName: string, bank: { bankName: string; accountNo: string; branch?: string }): string {
  const parts = [bank.bankName || 'ยังไม่ระบุธนาคาร', bank.accountNo, bank.branch ? `สาขา ${bank.branch}` : ''].filter(
    (x) => x && !accountName.includes(x)
  );
  return parts.join(' · ') || 'บัญชีธนาคาร';
}

/** ภาพรวมบัญชีเงิน: ยอดคงเหลือต่อบัญชี, โอนเงินระหว่างบัญชี, เงินสดย่อย (จ่าย/เบิกชดเชย), ทางเข้าไปกระทบยอด */
export function BankView() {
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const cashAccounts = useCashAccountOptions();
  const today = todayISO();
  const accountDialog = useBoolean();
  const transferDialog = useBoolean();
  const pettyDialog = useBoolean();
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [transferPreset, setTransferPreset] = useState<{ from?: string; to?: string }>({});
  const [pettyCode, setPettyCode] = useState<string>(ACC.pettyCash);
  const [tab, setTab] = useState<TabValue>('transfers');
  const label = (code: string) => cashAccounts.find((a) => a.code === code)?.label ?? code;

  const pettyCodes = useMemo(() => new Set(data.bankAccounts.filter((b) => b.kind === 'petty-cash').map((b) => b.accountCode)), [data.bankAccounts]);
  const pettyPayments = useMemo(
    () =>
      data.payments
        .filter((p) => pettyCodes.has(p.accountCode))
        .slice()
        .sort((a, b) => (b.date + b.docNo).localeCompare(a.date + a.docNo)),
    [data.payments, pettyCodes]
  );
  const transfers = useMemo(() => data.transfers.slice().sort((a, b) => (b.date + b.docNo).localeCompare(a.date + a.docNo)), [data.transfers]);

  const openTransfer = (from?: string, to?: string) => {
    setTransferPreset({ from, to });
    transferDialog.onTrue();
  };

  return (
    <>
      <CustomBreadcrumbs
        heading="ธนาคาร / เงินสดย่อย"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ธนาคาร / เงินสด' }]}
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<Iconify icon="solar:transfer-horizontal-bold" />} onClick={() => openTransfer()}>
              โอนเงินระหว่างบัญชี
            </Button>
            <Button
              variant="contained"
              startIcon={<Iconify icon="mingcute:add-line" />}
              onClick={() => {
                setEditing(null);
                accountDialog.onTrue();
              }}
            >
              เพิ่มบัญชี
            </Button>
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, mb: 3 }}>
        {cashAccounts.map((a) => {
          const bank = data.bankAccounts.find((b) => b.accountCode === a.code);
          const summary = bank?.kind === 'bank' ? bankAccountSummary(data, a.code, today) : null;
          return (
            <Card key={a.code} sx={{ p: 2.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap>
                    {a.code} {data.accounts.find((x) => x.code === a.code)?.name}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
                    {bank ? bankDetailLine(data.accounts.find((x) => x.code === a.code)?.name ?? '', bank) : 'เงินสดในมือ'}
                  </Typography>
                </Box>
                <Label variant="soft" color={a.kind === 'bank' ? 'info' : a.kind === 'petty-cash' ? 'warning' : 'default'}>
                  {bank ? BANK_KIND_LABEL[bank.kind] : 'เงินสด'}
                </Label>
              </Stack>
              <Money value={cashBalanceOf(data, a.code, today)} signed variant="h5" sx={{ display: 'block', mt: 2 }} />
              {summary && (
                <Typography variant="body2" sx={{ color: summary.unmatchedStatement || summary.unmatchedBook ? 'warning.dark' : 'text.secondary' }}>
                  ยังไม่กระทบยอด: statement {summary.unmatchedStatement} · สมุดบัญชี {summary.unmatchedBook} รายการ
                </Typography>
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                {bank?.kind === 'bank' && (
                  <Button size="small" variant="contained" component={RouterLink} href={paths.bank.reconcile(a.code)}>
                    กระทบยอด
                  </Button>
                )}
                {bank?.kind === 'petty-cash' && (
                  <>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        setPettyCode(a.code);
                        pettyDialog.onTrue();
                      }}
                    >
                      จ่ายเงินสดย่อย
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => openTransfer(ACC.bank, a.code)}>
                      เบิกชดเชย
                    </Button>
                  </>
                )}
                {bank && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => {
                      setEditing(bank);
                      accountDialog.onTrue();
                    }}
                  >
                    แก้ไข
                  </Button>
                )}
              </Stack>
            </Card>
          );
        })}
      </Box>

      <Card>
        <CustomTabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}>
          <Tab value="transfers" label="โอนเงินระหว่างบัญชี" iconPosition="end" icon={<Label>{transfers.length}</Label>} />
          <Tab value="petty" label="จ่ายเงินสดย่อย" iconPosition="end" icon={<Label>{pettyPayments.length}</Label>} />
        </CustomTabs>
        <Scrollbar>
          {tab === 'transfers' ? (
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>เลขที่</TableCell>
                  <TableCell>วันที่</TableCell>
                  <TableCell>จากบัญชี</TableCell>
                  <TableCell>เข้าบัญชี</TableCell>
                  <TableCell align="right">จำนวนเงิน</TableCell>
                  <TableCell>หมายเหตุ</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2">{t.docNo}</Typography>
                    </TableCell>
                    <TableCell>{formatThaiDate(t.date)}</TableCell>
                    <TableCell>{label(t.fromAccountCode)}</TableCell>
                    <TableCell>{label(t.toAccountCode)}</TableCell>
                    <TableCell align="right">
                      <Money value={t.amount} />
                    </TableCell>
                    <TableCell>{t.note ?? ''}</TableCell>
                  </TableRow>
                ))}
                {!transfers.length && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyContent filled title="ยังไม่มีการโอนเงิน" description="โอนระหว่างบัญชีธนาคาร หรือเบิกชดเชยเงินสดย่อยจากธนาคาร" sx={{ py: 6 }} />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>ใบสำคัญจ่าย</TableCell>
                  <TableCell>วันที่</TableCell>
                  <TableCell>ผู้รับเงิน</TableCell>
                  <TableCell>จากเงินสดย่อย</TableCell>
                  <TableCell align="right">จำนวนเงิน</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pettyPayments.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2" component={RouterLink} href={paths.purchases.payment(p.id)} sx={{ color: 'inherit' }}>
                        {p.docNo}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatThaiDate(p.date)}</TableCell>
                    <TableCell>{contacts.name(p.contactId)}</TableCell>
                    <TableCell>{label(p.accountCode)}</TableCell>
                    <TableCell align="right">
                      <Money value={p.netPaid} />
                    </TableCell>
                  </TableRow>
                ))}
                {!pettyPayments.length && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyContent filled title="ยังไม่มีรายการจ่ายเงินสดย่อย" sx={{ py: 6 }} />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Scrollbar>
      </Card>

      <BankAccountDialog open={accountDialog.value} onClose={accountDialog.onFalse} editing={editing} />
      <TransferDialog open={transferDialog.value} onClose={transferDialog.onFalse} defaultFrom={transferPreset.from} defaultTo={transferPreset.to} />
      <PettyCashDialog open={pettyDialog.value} onClose={pettyDialog.onFalse} pettyAccountCode={pettyCode} />
    </>
  );
}
