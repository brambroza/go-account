import type { PurchaseDoc } from 'src/domain';

import { useState, useEffect } from 'react';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { ACC, todayISO, calcDocument } from 'src/domain';
import { payPurchase, useAccounting, useAccountLookup, DEPOSIT_ACCOUNTS } from 'src/store';

import { toast } from 'src/components/snackbar';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; doc: PurchaseDoc | null };

export function PayPurchaseDialog({ open, onClose, doc }: Props) {
  const { run } = useAccounting();
  const accounts = useAccountLookup();
  const [date, setDate] = useState(todayISO());
  const [account, setAccount] = useState<string>(ACC.bank);

  useEffect(() => {
    if (open) setDate(todayISO());
  }, [open]);

  if (!doc) return null;
  const t = calcDocument(doc);
  const invalidDate = date < doc.date;

  const submit = () => {
    try {
      run((s) => payPurchase(s, { purchaseId: doc.id, date, accountCode: account }));
      toast.success(
        doc.whtRate > 0
          ? `จ่ายชำระ ${doc.docNo} แล้ว — หนังสือรับรอง 50 ทวิ และรายการ ภ.ง.ด. พร้อมในศูนย์ภาษี`
          : `จ่ายชำระ ${doc.docNo} แล้ว`
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>จ่ายชำระ {doc.docNo}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            type="date"
            size="small"
            label="วันที่จ่าย"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            error={invalidDate}
            helperText={invalidDate ? 'วันที่จ่ายต้องไม่ก่อนวันที่เอกสาร' : 'ภาษีหัก ณ ที่จ่ายจะเข้างวดของวันที่จ่าย'}
          />
          <TextField select size="small" label="จ่ายจากบัญชี" value={account} onChange={(e) => setAccount(e.target.value)}>
            {DEPOSIT_ACCOUNTS.map((code) => (
              <MenuItem key={code} value={code}>
                {code} {accounts.name(code)}
              </MenuItem>
            ))}
          </TextField>
          <Alert severity="info" variant="outlined">
            โอนจริง <Money value={t.payable} sx={{ fontWeight: 600 }} /> บาท
            {doc.whtRate > 0 && (
              <>
                {' '}
                · หัก ณ ที่จ่าย {doc.whtRate}% = <Money value={t.wht} /> บาท (นำส่งพร้อม ภ.ง.ด.)
              </>
            )}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="contained" onClick={submit} disabled={invalidDate}>
          บันทึกจ่ายชำระ
        </Button>
      </DialogActions>
    </Dialog>
  );
}
