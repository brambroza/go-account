import type { ISODate, StatementMapping, StatementEncoding } from 'src/domain';

import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Switch from '@mui/material/Switch';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';

import { cmd, useAccounting } from 'src/store';
import {
  formatThaiDate,
  mapStatementRows,
  readStatementCsv,
  decodeStatementBytes,
  statementEndingBalance,
  STATEMENT_ENCODING_LABEL,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  accountCode: string;
  /** นำเข้าสำเร็จ — ยอดคงเหลือปลายงวดจากช่องคงเหลือ (ถ้ามี) ให้หน้ากระทบยอดเติมให้ */
  onImported?: (ending: { date: ISODate; balance: number } | null) => void;
};

type ColumnKey = 'date' | 'description' | 'amount' | 'withdrawal' | 'deposit' | 'balance';

const COLUMN_LABEL: Record<ColumnKey, string> = {
  date: 'วันที่',
  description: 'รายการ / คำอธิบาย',
  amount: 'จำนวนเงิน (ลบ = ออก)',
  withdrawal: 'ถอน / เงินออก',
  deposit: 'ฝาก / เงินเข้า',
  balance: 'ยอดคงเหลือ (ไม่บังคับ)',
};

/**
 * นำเข้า statement จาก CSV ที่ธนาคารส่งออก — ระบบเดาคอลัมน์จากหัวตาราง ผู้ใช้เลือกใหม่ได้ ดูตัวอย่างก่อนนำเข้า
 * วันที่ พ.ศ./ค.ศ. และจำนวนเงินมีคอมม่าอ่านได้ (`mapStatementRows`) — นำเข้าไฟล์เดิมซ้ำ รายการที่มีแล้วถูกข้าม
 */
export function StatementImportDialog({ open, onClose, accountCode, onImported }: Props) {
  const { run, busy } = useAccounting();
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState<StatementEncoding>('auto');
  const [detected, setDetected] = useState<Exclude<StatementEncoding, 'auto'> | null>(null);
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [split, setSplit] = useState(false);

  const result = useMemo(() => (mapping ? mapStatementRows(table, mapping) : null), [table, mapping]);
  const header = (mapping?.hasHeader ? table[0] : undefined) ?? [];
  const width = Math.max(0, ...table.slice(0, 20).map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => ({ index: i, label: header[i]?.trim() || `คอลัมน์ ${i + 1}` }));

  const close = () => {
    setFileName('');
    setBytes(null);
    setEncoding('auto');
    setDetected(null);
    setTable([]);
    setMapping(null);
    onClose();
  };

  // U7: อ่านเป็นไบต์แล้วถอดรหัสเอง — ไฟล์ Windows-874/TIS-620 อ่านด้วย UTF-8 แล้วภาษาไทยเพี้ยน
  const load = (raw: Uint8Array, choice: StatementEncoding) => {
    const decoded = decodeStatementBytes(raw, choice);
    const read = readStatementCsv(decoded.text);
    setDetected(decoded.encoding);
    setTable(read.table);
    setMapping(read.mapping);
    setSplit(read.mapping.withdrawal !== undefined || read.mapping.deposit !== undefined);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const raw = new Uint8Array(await file.arrayBuffer());
    setFileName(file.name);
    setBytes(raw);
    load(raw, encoding);
  };

  const changeEncoding = (next: StatementEncoding) => {
    setEncoding(next);
    if (bytes) load(bytes, next);
  };

  const setColumn = (key: ColumnKey, value: string) => {
    if (!mapping) return;
    const index = value === '' ? undefined : Number(value);
    setMapping({ ...mapping, [key]: index } as StatementMapping);
  };

  const toggleSplit = (next: boolean) => {
    if (!mapping) return;
    setSplit(next);
    setMapping(
      next
        ? { ...mapping, amount: undefined, withdrawal: mapping.withdrawal ?? mapping.amount, deposit: mapping.deposit }
        : { ...mapping, withdrawal: undefined, deposit: undefined, amount: mapping.amount ?? mapping.deposit ?? 2 }
    );
  };

  const doImport = async () => {
    if (!result?.rows.length) return;
    try {
      const r = await run(cmd.addBankStatementLines({ accountCode, lines: result.rows, imported: true }));
      toast.success(`นำเข้า ${r.added} รายการ${r.skipped ? ` (ข้าม ${r.skipped} รายการที่มีอยู่แล้ว)` : ''}`);
      onImported?.(statementEndingBalance(result.rows));
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'นำเข้าไม่สำเร็จ');
    }
  };

  const select = (key: ColumnKey, optional = false) => (
    <TextField
      select
      size="small"
      label={COLUMN_LABEL[key]}
      value={mapping?.[key] === undefined ? '' : String(mapping[key])}
      onChange={(e) => setColumn(key, e.target.value)}
      sx={{ minWidth: 180 }}
    >
      {optional && <MenuItem value="">— ไม่ใช้ —</MenuItem>}
      {columns.map((c) => (
        <MenuItem key={c.index} value={String(c.index)}>
          {c.label}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      <DialogTitle>นำเข้า statement ธนาคาร (CSV)</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Button component="label" variant="outlined" startIcon={<Iconify icon="solar:upload-bold" />}>
              เลือกไฟล์ .csv
              <input hidden type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
            </Button>
            <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
              {fileName || 'ส่งออกจาก internet banking เป็น CSV (UTF-8 หรือ Windows-874 ก็ได้)'}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              select
              size="small"
              label="การเข้ารหัสไฟล์"
              value={encoding}
              onChange={(e) => changeEncoding(e.target.value as StatementEncoding)}
              sx={{ minWidth: 260 }}
            >
              {(Object.keys(STATEMENT_ENCODING_LABEL) as StatementEncoding[]).map((k) => (
                <MenuItem key={k} value={k}>
                  {STATEMENT_ENCODING_LABEL[k]}
                </MenuItem>
              ))}
            </TextField>
            {detected && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                อ่านเป็น {STATEMENT_ENCODING_LABEL[detected]}
                {encoding === 'auto' ? ' (ตรวจอัตโนมัติ)' : ''} — ภาษาไทยเพี้ยนให้เลือกการเข้ารหัสอื่น
              </Typography>
            )}
          </Stack>

          {mapping && (
            <>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
                <FormControlLabel
                  control={<Switch checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} />}
                  label="แถวแรกเป็นหัวคอลัมน์"
                />
                <FormControlLabel control={<Switch checked={split} onChange={(e) => toggleSplit(e.target.checked)} />} label="แยกช่องถอน / ฝาก" />
              </Stack>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                {select('date')}
                {select('description')}
                {split ? select('withdrawal', true) : select('amount')}
                {split && select('deposit', true)}
                {select('balance', true)}
              </Stack>

              {result && (
                <>
                  <Alert severity={result.errors.length ? 'warning' : 'success'} variant="outlined">
                    อ่านได้ {result.rows.length} รายการ
                    {result.errors.length
                      ? ` · อ่านไม่ได้ ${result.errors.length} แถว เช่น แถว ${result.errors[0].row}: ${result.errors[0].message}`
                      : ''}
                  </Alert>
                  <Scrollbar sx={{ maxHeight: 320 }}>
                    <Table size="small" sx={{ minWidth: 560 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>วันที่</TableCell>
                          <TableCell>รายการ</TableCell>
                          <TableCell align="right">เงินเข้า</TableCell>
                          <TableCell align="right">เงินออก</TableCell>
                          <TableCell align="right">คงเหลือ</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {result.rows.slice(0, 50).map((r, i) => (
                          <TableRow key={i}>
                            <TableCell>{formatThaiDate(r.date)}</TableCell>
                            <TableCell>{r.description}</TableCell>
                            <TableCell align="right">{r.amount > 0 ? <Money value={r.amount} /> : ''}</TableCell>
                            <TableCell align="right">{r.amount < 0 ? <Money value={-r.amount} /> : ''}</TableCell>
                            <TableCell align="right">{r.balance !== undefined ? <Money value={r.balance} /> : ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Scrollbar>
                  {result.rows.length > 50 && (
                    <Box sx={{ typography: 'caption', color: 'text.secondary' }}>แสดง 50 รายการแรกจาก {result.rows.length}</Box>
                  )}
                </>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={close}>
          ยกเลิก
        </Button>
        <LoadingButton variant="contained" loading={busy} disabled={!result?.rows.length} onClick={doImport}>
          นำเข้า {result?.rows.length ?? 0} รายการ
        </LoadingButton>
      </DialogActions>
    </Dialog>
  );
}
