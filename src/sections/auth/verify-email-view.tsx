import { Navigate } from 'react-router-dom';
import { useRef, useState, useEffect } from 'react';

import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { ApiError } from 'src/utils/api-client';

import { useAuth, tokenFromLocation, clearLocationHash } from 'src/auth';

import { Iconify } from 'src/components/iconify';

import { AuthLayout } from './auth-layout';
import { ResendVerificationForm } from './resend-verification-form';

// ----------------------------------------------------------------------

type State = { kind: 'verifying' } | { kind: 'done' } | { kind: 'error'; message: string; expired: boolean };

/**
 * เปิดจากลิงก์ในอีเมล (`/verify-email#token=…`) — ยืนยันทันทีครั้งเดียว (กัน StrictMode เรียกซ้ำ) แล้วลบ token ออกจาก URL
 * login อยู่ = โหลดสถานะใหม่ (แถบเตือนหาย บันทึกได้ทันที), ยังไม่ login = ไปหน้าเข้าสู่ระบบ
 */
export function VerifyEmailView() {
  const { client, status, mode, refreshMe } = useAuth();
  const [token] = useState(tokenFromLocation);
  useEffect(() => clearLocationHash(), []);
  const [state, setState] = useState<State>(() =>
    token ? { kind: 'verifying' } : { kind: 'error', message: 'ลิงก์ยืนยันไม่ถูกต้อง', expired: true }
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || !client || started.current) return;
    started.current = true;
    (async () => {
      try {
        await client.request('/auth/verify-email', { method: 'POST', body: { token }, noRefresh: true });
        setState({ kind: 'done' });
        refreshMe().catch(() => undefined);
      } catch (e) {
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'ยืนยันอีเมลไม่สำเร็จ',
          expired: e instanceof ApiError && e.status === 400,
        });
      }
    })();
  }, [client, token, refreshMe]);

  // โหมด local (ข้อมูลในเครื่อง) ไม่มีบัญชีผู้ใช้
  if (mode === 'local') return <Navigate to={paths.dashboard} replace />;

  const loggedIn = status === 'authenticated';

  if (state.kind === 'verifying') {
    return (
      <AuthLayout title="กำลังยืนยันอีเมล" subtitle="รอสักครู่">
        <Stack alignItems="center" sx={{ py: 3 }}>
          <CircularProgress aria-label="กำลังยืนยัน" />
        </Stack>
      </AuthLayout>
    );
  }

  if (state.kind === 'done') {
    return (
      <AuthLayout title="ยืนยันอีเมลแล้ว" subtitle="บัญชีของคุณพร้อมบันทึกเอกสารและรายการบัญชี">
        <Stack spacing={2.5}>
          <Alert severity="success" variant="outlined" icon={<Iconify icon="solar:check-circle-bold-duotone" />}>
            ขอบคุณที่ยืนยันอีเมล
          </Alert>
          <Button
            component={RouterLink}
            href={loggedIn ? paths.dashboard : `${paths.auth.login}?verified=1`}
            variant="contained"
            size="large"
          >
            {loggedIn ? 'ไปหน้าแรก' : 'เข้าสู่ระบบ'}
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="ยืนยันอีเมลไม่สำเร็จ" subtitle="ลิงก์อาจถูกใช้แล้ว หมดอายุ (24 ชั่วโมง) หรือคัดลอกไม่ครบ">
      <Stack spacing={2.5}>
        <Alert severity="error" variant="outlined">
          {state.message}
        </Alert>
        {state.expired && <ResendVerificationForm loggedIn={loggedIn} />}
        <Link component={RouterLink} href={loggedIn ? paths.dashboard : paths.auth.login} variant="body2">
          {loggedIn ? 'กลับหน้าแรก' : 'ไปหน้าเข้าสู่ระบบ'}
        </Link>
      </Stack>
    </AuthLayout>
  );
}
