import { useState } from 'react';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import LoadingButton from '@mui/lab/LoadingButton';

import { useAuth } from 'src/auth';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

/**
 * แถบเตือนผู้ใช้ที่ยังไม่ยืนยันอีเมล (โหมด api) — อ่านได้ แต่บันทึก/แก้ข้อมูลไม่ได้จนกว่าจะยืนยัน;
 * ส่งลิงก์ใหม่ได้ และกด "ยืนยันแล้ว" เพื่อโหลดสถานะใหม่ (กรณียืนยันจากอุปกรณ์/แท็บอื่น)
 */
export function EmailVerificationBanner() {
  const { mode, user, emailVerified, resendVerification, refreshMe } = useAuth();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);

  if (mode !== 'api' || !user || emailVerified) return null;

  const resend = async () => {
    setSending(true);
    try {
      toast.success(await resendVerification());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งลิงก์ไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      await refreshMe();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Alert
      severity="warning"
      variant="outlined"
      icon={<Iconify icon="solar:letter-unread-bold-duotone" />}
      sx={{ mb: 3, alignItems: 'center' }}
      action={
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <LoadingButton color="inherit" size="small" variant="outlined" loading={sending} onClick={resend}>
            ส่งลิงก์อีกครั้ง
          </LoadingButton>
          <Button color="inherit" size="small" disabled={checking} onClick={recheck}>
            ยืนยันแล้ว
          </Button>
        </Stack>
      }
    >
      ยังไม่ได้ยืนยันอีเมล <strong>{user.email}</strong> — เปิดลิงก์ในอีเมลที่เราส่งให้ก่อนบันทึกเอกสารหรือแก้ไขข้อมูล (ดูรายงานได้ตามปกติ)
    </Alert>
  );
}
