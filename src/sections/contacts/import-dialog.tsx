import type { ContactImportResult } from 'src/domain';

import { useState } from 'react';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { downloadText } from 'src/utils/download';

import { importContactsCsv } from 'src/domain';
import { useAccounting, importContacts } from 'src/store';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

const TEMPLATE =
  '\uFEFFรหัส,คำนำหน้า,ชื่อ,นามสกุล,เลขผู้เสียภาษี,สาขา,ที่อยู่,อำเภอ/เขต,จังหวัด,รหัสไปรษณีย์,โทรศัพท์,อีเมล,ประเภท,เครดิต\r\n' +
  'C0101,บริษัท,ตัวอย่างการค้า จำกัด,,0105565012341,00000,99 ถ.บางนา-ตราด,บางนา,กรุงเทพมหานคร,10260,02-000-0000,ap@example.com,ลูกค้า,30\r\n';

type Props = { open: boolean; onClose: () => void };

export function ImportContactsDialog({ open, onClose }: Props) {
  const { run } = useAccounting();
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [fileName, setFileName] = useState('');

  const close = () => {
    setResult(null);
    setFileName('');
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(importContactsCsv(await file.text()));
  };

  const confirm = () => {
    if (!result) return;
    try {
      const r = run((s) => importContacts(s, result.contacts));
      toast.success(`นำเข้า ${r.added} รายการ${r.skipped ? ` (ข้ามรหัสซ้ำ ${r.skipped})` : ''}`);
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'นำเข้าไม่สำเร็จ');
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>นำเข้าลูกค้า / ผู้ขายจากไฟล์ CSV</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Export รายชื่อจากโปรแกรมบัญชีเดิม (เช่น Express) เป็น CSV แล้วเลือกไฟล์ที่นี่ หัวคอลัมน์รองรับทั้งภาษาไทยและอังกฤษ
            รายการที่รหัสซ้ำกับที่มีอยู่จะถูกข้าม
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" component="label" startIcon={<Iconify icon="solar:upload-bold" />}>
              เลือกไฟล์ CSV
              <input hidden type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
            </Button>
            <Button color="inherit" onClick={() => downloadText('go-account-contacts-template.csv', TEMPLATE, 'text/csv;charset=utf-8')}>
              ดาวน์โหลดไฟล์ตัวอย่าง
            </Button>
          </Stack>
          {fileName && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {fileName}
            </Typography>
          )}
          {result && (
            <Alert severity={result.contacts.length ? 'success' : 'error'} variant="outlined">
              พร้อมนำเข้า {result.contacts.length} รายการ
            </Alert>
          )}
          {result?.errors.map((e) => (
            <Alert key={`${e.row}-${e.message}`} severity="warning" variant="outlined">
              แถว {e.row}: {e.message}
            </Alert>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={close}>
          ยกเลิก
        </Button>
        <Button variant="contained" disabled={!result?.contacts.length} onClick={confirm}>
          นำเข้า
        </Button>
      </DialogActions>
    </Dialog>
  );
}
