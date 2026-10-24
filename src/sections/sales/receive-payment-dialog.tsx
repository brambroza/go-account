import type { SalesDoc } from 'src/domain';

import { useState, useEffect } from 'react';
import { NumericFormat } from 'react-number-format';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { ACC, round2, todayISO, toSatang, percentOf, calcDocument } from 'src/domain';
import { outstandingOf, useAccounting, receivePayment, useAccountLookup, DEPOSIT_ACCOUNTS } from 'src/store';

import { toast } from 'src/components/snackbar';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; invoice: SalesDoc };

export function ReceivePaymentDialog({ open, onClose, invoice }: Props) {
  const { data, run } = useAccounting();
  const accounts = useAccountLookup();
  const outstanding = outstandingOf(data, invoice);
  const totals = calcDocument(invoice);

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(outstanding);
  const [whtRate, setWhtRate] = useState(0);
  const [wht, setWht] = useState(0);
  const [account, setAccount] = useState<string>(ACC.bank);

  useEffect(() => {
    if (open) {
      setAmount(outstanding);
      setDate(todayISO());
      setWhtRate(0);
      setWht(0);
    }
  }, [open, outstanding]);

  // ภาษีถูกหักคิดจากมูลค่าก่อน VAT ตามสัดส่วนที่รับชำระครั้งนี้
  useEffect(() => {
    if (!whtRate) {
      setWht(0);
      return;
    }
    const base = totals.total ? (totals.net * amount) / totals.total : 0;
    setWht(percentOf(round2(base), whtRate));
  }, [whtRate, amount, totals.net, totals.total]);

  const invalidAmount = !(amount > 0) || toSatang(amount) > toSatang(outstanding);
  const invalidDate = date < invoice.date;

  const submit = () => {
    try {
      const r = run((s) =>
        receivePayment(s, { invoiceId: invoice.id, date, amount, whtAmount: wht, depositAccountCode: account })
      );
      toast.success(`บันทึกรับชำระ ${r.receipt.docNo} แล้ว`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>รับชำระ {invoice.docNo}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              ยอดค้างชำระ
            </Typography>
            <Money value={outstanding} variant="subtitle1" />
          </Stack>

          <TextField
            type="date"
            label="วันที่รับเงิน"
            size="small"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={invalidDate}
            helperText={invalidDate ? 'วันที่รับเงินต้องไม่ก่อนวันที่ใบกำกับ' : undefined}
            InputLabelProps={{ shrink: true }}
          />

          <NumericFormat
            customInput={TextField}
            label="ยอดที่ตัดลูกหนี้"
            size="small"
            value={amount}
            thousandSeparator
            decimalScale={2}
            allowNegative={false}
            onValueChange={(v) => setAmount(v.floatValue ?? 0)}
            error={invalidAmount}
            helperText={invalidAmount ? `ระบุ 0.01 – ${outstanding.toFixed(2)} บาท` : 'รับบางส่วนได้'}
          />

          <TextField
            select
            size="small"
            label="ลูกค้าหักภาษี ณ ที่จ่าย"
            value={whtRate}
            onChange={(e) => setWhtRate(Number(e.target.value))}
          >
            <MenuItem value={0}>ไม่หัก</MenuItem>
            <MenuItem value={1}>1% ค่าขนส่ง</MenuItem>
            <MenuItem value={2}>2% ค่าโฆษณา</MenuItem>
            <MenuItem value={3}>3% ค่าบริการ / ค่าจ้างทำของ</MenuItem>
            <MenuItem value={5}>5% ค่าเช่า</MenuItem>
          </TextField>

          {!!whtRate && (
            <NumericFormat
              customInput={TextField}
              label="ภาษีที่ถูกหัก (ตาม 50 ทวิ ที่ได้รับ)"
              size="small"
              value={wht}
              thousandSeparator
              decimalScale={2}
              allowNegative={false}
              onValueChange={(v) => setWht(v.floatValue ?? 0)}
            />
          )}

          <TextField select size="small" label="รับเข้าบัญชี" value={account} onChange={(e) => setAccount(e.target.value)}>
            {DEPOSIT_ACCOUNTS.map((code) => (
              <MenuItem key={code} value={code}>
                {code} {accounts.name(code)}
              </MenuItem>
            ))}
          </TextField>

          <Alert severity="info" variant="outlined">
            เงินเข้าบัญชีจริง <Money value={round2(amount - wht)} sx={{ fontWeight: 600 }} /> บาท · ระบบจะลงบัญชี Dr{' '}
            {accounts.name(account)}
            {wht ? ' + ภาษีถูกหัก ณ ที่จ่าย' : ''} / Cr ลูกหนี้การค้า
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="contained" onClick={submit} disabled={invalidAmount || invalidDate}>
          บันทึกรับชำระ
        </Button>
      </DialogActions>
    </Dialog>
  );
}
