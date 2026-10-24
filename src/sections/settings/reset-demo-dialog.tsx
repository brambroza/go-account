import { useState, useEffect } from 'react';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';

import { useAccounting } from 'src/store';

import { toast } from 'src/components/snackbar';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { backupCounts, downloadBackup } from './backup';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void };

/**
 * ล้างข้อมูลทั้งหมดแล้วสร้างข้อมูลตัวอย่างใหม่ — ไม่มีแบบคลิกเดียว:
 * ต้องติ๊กยอมรับว่าลบทุกอย่าง และระบบดาวน์โหลดไฟล์สำรองให้อัตโนมัติก่อนล้าง
 */
export function ResetDemoDialog({ open, onClose }: Props) {
  const { data, resetDemo } = useAccounting();
  const [accepted, setAccepted] = useState(false);
  const counts = backupCounts(data).filter((c) => c.count > 0);

  useEffect(() => {
    if (open) setAccepted(false);
  }, [open]);

  const reset = () => {
    try {
      downloadBackup(data, '-before-reset');
    } catch (error) {
      toast.error(`ดาวน์โหลดไฟล์สำรองไม่สำเร็จ จึงยังไม่ล้างข้อมูล: ${error instanceof Error ? error.message : ''}`);
      return;
    }
    try {
      resetDemo();
    } catch (error) {
      toast.error(`ล้างข้อมูลไม่สำเร็จ: ${error instanceof Error ? error.message : ''}`);
      return;
    }
    onClose();
    toast.success('ดาวน์โหลดไฟล์สำรองแล้ว และสร้างข้อมูลตัวอย่างใหม่แล้ว');
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      title="ล้างข้อมูลทั้งหมดและสร้างข้อมูลตัวอย่าง"
      content={
        <Stack spacing={2}>
          <Alert severity="error">
            ข้อมูลทุกอย่างในเบราว์เซอร์นี้จะถูกลบ ได้แก่{' '}
            {counts.length ? counts.map((c) => `${c.label} ${c.count.toLocaleString('th-TH')}`).join(' · ') : 'ไม่มีรายการ'} ·
            ข้อมูลบริษัทและการปิดงวด แล้วแทนด้วยข้อมูลตัวอย่าง ย้อนกลับไม่ได้
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            ก่อนล้าง ระบบจะดาวน์โหลดไฟล์สำรอง (.json) ให้อัตโนมัติ — กู้คืนได้ที่หน้าตั้งค่า &gt; กู้คืนจากไฟล์สำรอง
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />}
            label="เข้าใจแล้วว่าข้อมูลจริงทั้งหมดจะถูกลบ"
          />
        </Stack>
      }
      action={
        <Button variant="contained" color="error" disabled={!accepted} onClick={reset}>
          ดาวน์โหลดไฟล์สำรองแล้วล้างข้อมูล
        </Button>
      }
    />
  );
}
