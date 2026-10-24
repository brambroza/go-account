import type { BankMatch } from 'src/domain';

import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Checkbox from '@mui/material/Checkbox';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import CardHeader from '@mui/material/CardHeader';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
import { useParams, useRouter } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { cmd, useAccounting } from 'src/store';
import { CanWrite, usePermissions } from 'src/auth';
import {
  sumBaht,
  todayISO,
  toSatang,
  matchIndex,
  bankAccountOf,
  bankMovements,
  formatThaiDate,
  cashAccountLabel,
  statementLinesOf,
  bankReconciliation,
} from 'src/domain';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money } from 'src/sections/shared';
import { IsoDatePicker } from 'src/sections/shared/iso-date-picker';

import { StatementLineDialog } from '../statement-line-dialog';
import { StatementImportDialog } from '../statement-import-dialog';

// ----------------------------------------------------------------------

/**
 * กระทบยอดธนาคาร: statement (นำเข้า CSV / คีย์เอง) ฝั่งซ้าย ↔ รายการเคลื่อนไหวในสมุดบัญชีฝั่งขวา
 * จับคู่อัตโนมัติ (ยอดเท่ากัน + วันที่ใกล้กัน) หรือเลือกเองหลายรายการให้ยอดรวมเท่ากัน — การจับคู่ไม่ลงบัญชี
 * รายงาน: ยอดตามบัญชี ± รายการค้าง = ยอดที่ statement ควรเป็น เทียบยอดคงเหลือตาม statement
 */
export function BankReconcileView() {
  const { code = '' } = useParams();
  const router = useRouter();
  const { data, run, busy } = useAccounting();
  const { canWrite } = usePermissions();
  const importDialog = useBoolean();
  const lineDialog = useBoolean();
  const [asOf, setAsOf] = useState(todayISO());
  const [statementInput, setStatementInput] = useState('');
  const [showMatched, setShowMatched] = useState(false);
  const [windowDays, setWindowDays] = useState(3);
  const [pickedLines, setPickedLines] = useState<string[]>([]);
  const [pickedJournal, setPickedJournal] = useState<string[]>([]);

  const bank = bankAccountOf(data, code);
  const account = data.accounts.find((a) => a.code === code);
  const banks = data.bankAccounts.filter((b) => b.kind === 'bank');
  const from = bank?.reconcileFrom;

  const lines = useMemo(() => statementLinesOf(data, code), [data, code]);
  const movements = useMemo(() => bankMovements(data, code).filter((m) => !from || m.date >= from), [data, code, from]);
  const index = useMemo(() => matchIndex(data, code), [data, code]);
  const statementBalance = statementInput.trim() === '' ? undefined : Number(statementInput.replace(/,/g, ''));
  const rec = useMemo(
    () => bankReconciliation(data, code, asOf, statementBalance !== undefined && Number.isFinite(statementBalance) ? statementBalance : undefined),
    [data, code, asOf, statementBalance]
  );

  const visibleLines = lines.filter((l) => showMatched || !index.byLine.has(l.id));
  const visibleMovements = movements.filter((m) => showMatched || !index.byJournal.has(m.journalId));
  const lineSum = sumBaht(lines.filter((l) => pickedLines.includes(l.id)).map((l) => l.amount));
  const bookSum = sumBaht(movements.filter((m) => pickedJournal.includes(m.journalId)).map((m) => m.amount));
  const canMatch = pickedLines.length > 0 && pickedJournal.length > 0 && toSatang(lineSum) === toSatang(bookSum);

  if (!bank || bank.kind !== 'bank' || !account) {
    return (
      <EmptyContent
        filled
        title="ไม่พบบัญชีธนาคารที่ลงทะเบียน"
        action={
          <Button component={RouterLink} href={paths.bank.root} sx={{ mt: 2 }}>
            กลับไปหน้าธนาคาร
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const act = async (fn: () => Promise<string>) => {
    if (busy) return;
    try {
      toast.success(await fn());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const matchSelected = () =>
    act(async () => {
      await run(
        cmd.matchBankItems({
          accountCode: code,
          statementLineIds: pickedLines,
          journalIds: pickedJournal,
        })
      );
      setPickedLines([]);
      setPickedJournal([]);
      return 'จับคู่แล้ว';
    });

  const matchLabel = (match: BankMatch | undefined) =>
    match ? (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Label variant="soft" color="success">
          {match.auto ? 'จับคู่อัตโนมัติ' : 'จับคู่แล้ว'}
        </Label>
        {canWrite && (
          <Tooltip title="ยกเลิกการจับคู่">
            <IconButton
              size="small"
              onClick={() =>
                act(async () => {
                  await run(cmd.unmatchBank(match.id));
                  return 'ยกเลิกการจับคู่แล้ว';
                })
              }
            >
              <Iconify icon="solar:link-broken-bold" width={16} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    ) : null;

  return (
    <>
      <CustomBreadcrumbs
        heading={`กระทบยอด ${cashAccountLabel(account, bank)}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ธนาคาร / เงินสด', href: paths.bank.root },
          { name: 'กระทบยอด' },
        ]}
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {banks.length > 1 && (
              <TextField select size="small" label="บัญชี" value={code} onChange={(e) => router.push(paths.bank.reconcile(e.target.value))} sx={{ minWidth: 200 }}>
                {banks.map((b) => (
                  <MenuItem key={b.accountCode} value={b.accountCode}>
                    {b.accountCode} {b.bankName}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <CanWrite>
              <Button variant="outlined" startIcon={<Iconify icon="solar:upload-bold" />} onClick={importDialog.onTrue}>
                นำเข้า statement (CSV)
              </Button>
              <Button variant="outlined" startIcon={<Iconify icon="mingcute:add-line" />} onClick={lineDialog.onTrue}>
                เพิ่มรายการเอง
              </Button>
            </CanWrite>
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Card sx={{ mb: 3 }}>
        <CardHeader
          title="รายงานกระทบยอด"
          subheader="ยอดตามบัญชี − รายการในสมุดที่ธนาคารยังไม่ผ่าน + รายการใน statement ที่ยังไม่ลงบัญชี = ยอดที่ statement ควรเป็น"
        />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ p: 3 }}>
          <Stack spacing={2} sx={{ minWidth: 220 }}>
            <IsoDatePicker label="ณ วันที่" value={asOf} onChange={setAsOf} />
            <TextField
              size="small"
              label="ยอดคงเหลือตาม statement"
              value={statementInput}
              onChange={(e) => setStatementInput(e.target.value)}
              placeholder={rec.statementBalance !== undefined && !statementInput ? String(rec.statementBalance) : 'จากไฟล์ หรือกรอกเอง'}
              helperText={!statementInput && rec.statementBalance !== undefined ? 'ใช้ยอดคงเหลือรายการล่าสุดในไฟล์' : undefined}
              inputProps={{ inputMode: 'decimal' }}
            />
            <IsoDatePicker
              label="เริ่มกระทบยอดตั้งแต่ (จำไว้ต่อบัญชี)"
              disabled={!canWrite}
              value={from ?? ''}
              onChange={(iso) =>
                act(async () => {
                  await run(cmd.updateBankAccount(code, { reconcileFrom: iso }));
                  return 'บันทึกวันที่เริ่มกระทบยอดแล้ว';
                })
              }
            />
          </Stack>
          <Stack spacing={1.25} sx={{ flexGrow: 1, maxWidth: 520 }}>
            <SummaryRow label={`ยอดตามบัญชี ณ ${formatThaiDate(asOf)}`} value={rec.bookBalance} />
            <SummaryRow label={`หัก รายการในสมุดที่ธนาคารยังไม่ผ่าน (${rec.outstanding.length})`} value={-sumBaht(rec.outstanding.map((m) => m.amount))} />
            <SummaryRow label={`บวก รายการใน statement ที่ยังไม่ลงบัญชี (${rec.unbooked.length})`} value={sumBaht(rec.unbooked.map((l) => l.amount))} />
            <Divider sx={{ borderStyle: 'dashed' }} />
            <SummaryRow label="ยอดที่ statement ควรเป็น" value={rec.expectedStatementBalance} strong />
            {rec.statementBalance !== undefined && <SummaryRow label="ยอดตาม statement" value={rec.statementBalance} />}
            {rec.difference !== undefined && (
              <Alert severity={toSatang(rec.difference) === 0 ? 'success' : 'warning'} variant="outlined">
                {toSatang(rec.difference) === 0 ? (
                  'กระทบยอดลงตัว'
                ) : (
                  <>
                    ผลต่าง <Money value={rec.difference} sx={{ fontWeight: 600 }} /> — ตรวจรายการที่ยังไม่จับคู่ หรือนำเข้า statement ให้ครบช่วงวันที่
                  </>
                )}
              </Alert>
            )}
            {rec.unbooked.length > 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                รายการใน statement ที่ยังไม่ลงบัญชี (เช่น ค่าธรรมเนียม ดอกเบี้ย) ให้บันทึกเป็น{' '}
                <Typography component={RouterLink} href={paths.ledger} variant="body2" sx={{ color: 'primary.main' }}>
                  รายการปรับปรุง
                </Typography>{' '}
                หรือเอกสารรับ/จ่าย แล้วกลับมาจับคู่
              </Typography>
            )}
          </Stack>
        </Stack>
      </Card>

      {canWrite && (
        <Card sx={{ mb: 3, p: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <TextField
              select
              size="small"
              label="ช่วงวันที่จับคู่อัตโนมัติ"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              sx={{ minWidth: 200 }}
            >
              {[0, 1, 3, 5, 7].map((d) => (
                <MenuItem key={d} value={d}>
                  {d === 0 ? 'วันเดียวกัน' : `± ${d} วัน`}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:magic-stick-3-bold" />}
              onClick={() => act(async () => `จับคู่อัตโนมัติ ${(await run(cmd.autoMatchBank(code, windowDays))).matched} คู่`)}
            >
              จับคู่อัตโนมัติ (ยอดเท่ากัน)
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              เลือก statement <Money value={lineSum} /> · สมุดบัญชี <Money value={bookSum} />
            </Typography>
            <Button variant="outlined" disabled={!canMatch || busy} onClick={matchSelected} startIcon={<Iconify icon="solar:link-bold" />}>
              จับคู่รายการที่เลือก
            </Button>
            <FormControlLabel
              control={<Checkbox checked={showMatched} onChange={(e) => setShowMatched(e.target.checked)} />}
              label="แสดงที่จับคู่แล้ว"
            />
          </Stack>
        </Card>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={6}>
          <Card>
            <CardHeader title={`Statement ธนาคาร (${lines.length})`} subheader={`ยังไม่จับคู่ ${lines.filter((l) => !index.byLine.has(l.id)).length} รายการ`} />
            <ItemTable
              rows={visibleLines.map((l) => ({ id: l.id, date: l.date, title: l.description || '-', amount: l.amount, match: index.byLine.get(l.id) }))}
              picked={pickedLines}
              onPick={(id) => setPickedLines((p) => toggle(p, id))}
              matchLabel={matchLabel}
              onDelete={
                canWrite
                  ? (id) =>
                      act(async () => {
                        await run(cmd.deleteBankStatementLines([id]));
                        return 'ลบรายการ statement แล้ว';
                      })
                  : undefined
              }
              empty="ยังไม่มี statement — นำเข้าไฟล์ CSV หรือเพิ่มรายการเอง"
            />
          </Card>
        </Grid>
        <Grid item xs={12} lg={6}>
          <Card>
            <CardHeader
              title={`สมุดบัญชี ${code} (${movements.length})`}
              subheader={`ยังไม่จับคู่ ${movements.filter((m) => !index.byJournal.has(m.journalId)).length} รายการ${from ? ` · ตั้งแต่ ${formatThaiDate(from)}` : ''}`}
            />
            <ItemTable
              rows={visibleMovements.map((m) => ({
                id: m.journalId,
                date: m.date,
                title: `${m.sourceDocNo ?? m.docNo} · ${m.description}`,
                amount: m.amount,
                match: index.byJournal.get(m.journalId),
              }))}
              picked={pickedJournal}
              onPick={(id) => setPickedJournal((p) => toggle(p, id))}
              matchLabel={matchLabel}
              empty="ไม่มีรายการเคลื่อนไหวในช่วงที่กระทบยอด"
            />
          </Card>
        </Grid>
      </Grid>

      <StatementImportDialog
        open={importDialog.value}
        onClose={importDialog.onFalse}
        accountCode={code}
        onImported={(ending) => {
          // U7: เติมยอดคงเหลือปลายงวดและวันที่ของรายการล่าสุดจากช่องคงเหลือในไฟล์ (แก้ได้)
          if (!ending) return;
          setAsOf(ending.date);
          setStatementInput(ending.balance.toFixed(2));
        }}
      />
      <StatementLineDialog open={lineDialog.value} onClose={lineDialog.onFalse} accountCode={code} />
    </>
  );
}

// ----------------------------------------------------------------------

function SummaryRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant={strong ? 'subtitle2' : 'body2'} sx={{ color: strong ? 'text.primary' : 'text.secondary' }}>
        {label}
      </Typography>
      <Money value={value} signed sx={strong ? { fontWeight: 600 } : undefined} />
    </Stack>
  );
}

type ItemRow = {
  id: string;
  date: string;
  title: string;
  amount: number;
  match?: BankMatch;
};

function ItemTable({
  rows,
  picked,
  onPick,
  matchLabel,
  onDelete,
  empty,
}: {
  rows: ItemRow[];
  picked: string[];
  onPick: (id: string) => void;
  matchLabel: (m: BankMatch | undefined) => React.ReactNode;
  onDelete?: (id: string) => void;
  empty: string;
}) {
  return (
    <Scrollbar sx={{ maxHeight: 560 }}>
      <Table size="small" stickyHeader sx={{ minWidth: 560 }}>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>วันที่</TableCell>
            <TableCell>รายการ</TableCell>
            <TableCell align="right">เข้า</TableCell>
            <TableCell align="right">ออก</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover selected={picked.includes(r.id)}>
              <TableCell padding="checkbox">
                {!r.match && <Checkbox size="small" checked={picked.includes(r.id)} onChange={() => onPick(r.id)} inputProps={{ 'aria-label': `เลือก ${r.title}` }} />}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatThaiDate(r.date)}</TableCell>
              <TableCell sx={{ maxWidth: 240 }}>
                <Typography variant="body2" noWrap title={r.title}>
                  {r.title}
                </Typography>
              </TableCell>
              <TableCell align="right">{r.amount > 0 ? <Money value={r.amount} /> : ''}</TableCell>
              <TableCell align="right">{r.amount < 0 ? <Money value={-r.amount} /> : ''}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {r.match
                  ? matchLabel(r.match)
                  : onDelete && (
                      <Tooltip title="ลบรายการ statement">
                        <IconButton size="small" onClick={() => onDelete(r.id)}>
                          <Iconify icon="solar:trash-bin-trash-bold" width={16} />
                        </IconButton>
                      </Tooltip>
                    )}
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6}>
                <EmptyContent filled title={empty} sx={{ py: 6 }} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Scrollbar>
  );
}
