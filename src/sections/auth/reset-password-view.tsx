import type { ResetPasswordSchemaType } from 'src/schemas/auth/auth-schemas';

import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';

import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { ApiError } from 'src/utils/api-client';

import { ResetPasswordSchema } from 'src/schemas/auth/auth-schemas';
import { useAuth, AUTH_CODES, tokenFromLocation, clearLocationHash } from 'src/auth';

import { Form, Field } from 'src/components/hook-form';

import { AuthLayout } from './auth-layout';

// ----------------------------------------------------------------------

/**
 * ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล (`/reset-password#token=…`, ใช้ครั้งเดียว 30 นาที) — สำเร็จ = ทุกอุปกรณ์ออกจากระบบ
 * แล้วไปหน้าเข้าสู่ระบบ; token ถูกลบจาก URL ตั้งแต่เปิดหน้า
 */
export function ResetPasswordView() {
  const { client, status, mode, logout } = useAuth();
  const router = useRouter();
  const [token] = useState(tokenFromLocation);
  useEffect(() => clearLocationHash(), []);
  const [error, setError] = useState<{ message: string; invalidLink: boolean } | null>(null);
  const methods = useForm<ResetPasswordSchemaType>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = methods.handleSubmit(async (v) => {
    if (!client) return;
    setError(null);
    try {
      await client.request('/auth/password/reset', {
        method: 'POST',
        body: { token, password: v.password },
        noRefresh: true,
      });
      // เซิร์ฟเวอร์ยกเลิกทุก session แล้ว — ล้างสถานะฝั่งหน้าเว็บด้วย
      if (status === 'authenticated') await logout().catch(() => undefined);
      router.replace(`${paths.auth.login}?reset=1`);
    } catch (e) {
      // 400 ที่ไม่ใช่ลิงก์เสีย = รหัสผ่านไม่ผ่านนโยบายของเซิร์ฟเวอร์ (ข้อความไทย)
      if (e instanceof ApiError && e.status === 400 && e.code !== AUTH_CODES.tokenInvalid) {
        methods.setError('password', { message: e.message });
        return;
      }
      setError({
        message: e instanceof Error ? e.message : 'ตั้งรหัสผ่านไม่สำเร็จ',
        invalidLink: e instanceof ApiError && e.code === AUTH_CODES.tokenInvalid,
      });
    }
  });

  // โหมด local (ข้อมูลในเครื่อง) ไม่มีบัญชีผู้ใช้
  if (mode === 'local') return <Navigate to={paths.dashboard} replace />;

  if (!token || error?.invalidLink) {
    return (
      <AuthLayout title="ลิงก์ตั้งรหัสผ่านใช้ไม่ได้" subtitle="ลิงก์อาจถูกใช้แล้ว หมดอายุ (30 นาที) หรือคัดลอกไม่ครบ">
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" variant="outlined">
              {error.message}
            </Alert>
          )}
          <Button component={RouterLink} href={paths.auth.forgotPassword} variant="contained" size="large">
            ขอลิงก์ใหม่
          </Button>
          <Link component={RouterLink} href={paths.auth.login} variant="body2">
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="ตั้งรหัสผ่านใหม่" subtitle="ตั้งรหัสผ่านใหม่แล้ว ทุกอุปกรณ์ที่เข้าสู่ระบบอยู่จะถูกออกจากระบบ">
      <Form methods={methods} onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" variant="outlined">
              {error.message}
            </Alert>
          )}
          <Field.Text
            name="password"
            label="รหัสผ่านใหม่"
            type="password"
            autoComplete="new-password"
            helperText="อย่างน้อย 10 ตัวอักษร"
            autoFocus
          />
          <Field.Text name="confirm" label="ยืนยันรหัสผ่านใหม่" type="password" autoComplete="new-password" />
          <LoadingButton type="submit" variant="contained" size="large" loading={methods.formState.isSubmitting}>
            ตั้งรหัสผ่านใหม่
          </LoadingButton>
        </Stack>
      </Form>
    </AuthLayout>
  );
}
