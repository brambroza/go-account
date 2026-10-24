import type { JournalLine } from 'src/domain';

import dayjs from 'dayjs';
import { useState } from 'react';
import { NumericFormat } from 'react-number-format';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

import { sumBaht, todayISO, toSatang } from 'src/domain';
import { useAccounting, addManualJournal } from 'src/store';
import { PICKER_DATE_FORMAT } from 'src/locales/buddhist-era';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { Money, LockedDateAlert } from 'src/sections/shared';

// ----------------------------------------------------------------------

const empty = (): JournalLine => ({ accountCode: '', debit: 0, credit: 0 });

type Props = { open: boolean; onClose: () => void };

/** รายการปรับปรุง (JV) คีย์มือ — เดบิตต้องเท่าเครดิต, ห้ามลงบัญชีคุม (ตรวจที่ action) */
export function ManualEntryDialog({ open, onClose }: Props) {
  const { data, run } = useAccounting();
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([empty(), empty()]);

  const debit = sumBaht(lines.map((l) => l.debit));
  const credit = sumBaht(lines.map((l) => l.credit));
  const balanced = toSatang(debit) === toSatang(credit) && debit > 0;
  const valid = balanced && !!description.trim() && lines.every((l) => !!l.accountCode || (!l.debit && !l.credit));

  const update = (i: number, patch: Partial<JournalLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = () => {
    try {
      const r = run((s) =>
        addManualJournal(s, {
          date,
          description: description.trim(),
          lines: lines.filter((l) => l.accountCode && (l.debit || l.credit)),
        })
      );
      toast.success(`บันทึก ${r.entry.docNo} แล้ว`);
      setLines([empty(), empty()]);
      setDescription('');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>รายการปรับปรุง (Journal Voucher)</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <DatePicker
              label="วันที่"
              value={dayjs(date)}
              onChange={(v) => setDate(v && v.isValid() ? v.format('YYYY-MM-DD') : '')}
              format={PICKER_DATE_FORMAT}
              slotProps={{ textField: { size: 'small', sx: { minWidth: 180 } } }}
            />
            <TextField
              size="small"
              fullWidth
              label="คำอธิบาย"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="เช่น ปรับปรุงค่าเสื่อมราคาประจำเดือน"
            />
          </Stack>
          <LockedDateAlert date={date} />

          {lines.map((l, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <TextField
                select
                size="small"
                label="บัญชี"
                value={l.accountCode}
                onChange={(e) => update(i, { accountCode: e.target.value })}
                sx={{ flex: 2 }}
              >
                {data.accounts.map((a) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </MenuItem>
                ))}
              </TextField>
              <NumericFormat
                customInput={TextField}
                size="small"
                label="เดบิต"
                value={l.debit || ''}
                thousandSeparator
                decimalScale={2}
                allowNegative={false}
                onValueChange={(v) => update(i, { debit: v.floatValue ?? 0, ...(v.floatValue ? { credit: 0 } : {}) })}
                sx={{ flex: 1 }}
              />
              <NumericFormat
                customInput={TextField}
                size="small"
                label="เครดิต"
                value={l.credit || ''}
                thousandSeparator
                decimalScale={2}
                allowNegative={false}
                onValueChange={(v) => update(i, { credit: v.floatValue ?? 0, ...(v.floatValue ? { debit: 0 } : {}) })}
                sx={{ flex: 1 }}
              />
              <IconButton
                aria-label={`ลบบรรทัดที่ ${i + 1}`}
                disabled={lines.length <= 2}
                onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Iconify icon="solar:trash-bin-trash-bold" width={18} />
              </IconButton>
            </Stack>
          ))}

          <Button size="small" sx={{ alignSelf: 'flex-start' }} startIcon={<Iconify icon="mingcute:add-line" />} onClick={() => setLines((p) => [...p, empty()])}>
            เพิ่มบรรทัด
          </Button>

          <Stack direction="row" spacing={3} justifyContent="flex-end">
            <Typography variant="body2">
              เดบิต <Money value={debit} sx={{ fontWeight: 600 }} />
            </Typography>
            <Typography variant="body2">
              เครดิต <Money value={credit} sx={{ fontWeight: 600 }} />
            </Typography>
          </Stack>
          {!balanced && debit + credit > 0 && (
            <Alert severity="warning" variant="outlined">
              ยอดยังไม่สมดุล ต่างกัน <Money value={Math.abs(debit - credit)} /> บาท
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="contained" onClick={submit} disabled={!valid}>
          บันทึก
        </Button>
      </DialogActions>
    </Dialog>
  );
}
