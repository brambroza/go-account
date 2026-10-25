import type { AcceptedResponse } from 'src/auth';
import type { EmailOnlySchemaType } from 'src/schemas/auth/auth-schemas';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { useAuth } from 'src/auth';
import { EmailOnlySchema } from 'src/schemas/auth/auth-schemas';

import { Form, Field } from 'src/components/hook-form';

import { AuthLayout } from './auth-layout';

// ----------------------------------------------------------------------

/** ลืมรหัสผ่าน — ส่งลิงก์ตั้งรหัสผ่านใหม่ (ใช้ได้ 30 นาที); ข้อความตอบกลับเหมือนกันทุกกรณี (ไม่บอกว่ามีบัญชี) */
export function ForgotPasswordView() {
  const { client } = useAuth();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const methods = useForm<EmailOnlySchemaType>({
    resolver: zodResolver(EmailOnlySchema),
    defaultValues: { email: '' },
  });

  const onSubmit = methods.handleSubmit(async (v) => {
    if (!client) return;
    setError(null);
    try {
      const res = await client.request<AcceptedResponse>('/auth/password/forgot', {
        method: 'POST',
        body: { email: v.email.trim() },
        noRefresh: true,
      });
      setSent(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งลิงก์ไม่สำเร็จ');
    }
  });

  return (
    <AuthLayout title="ลืมรหัสผ่าน" subtitle="กรอกอีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่">
      <Form methods={methods} onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
          {sent ? (
            <Alert severity="success" variant="outlined">
              {sent}
            </Alert>
          ) : (
            <>
              <Field.Text name="email" label="อีเมล" type="email" autoComplete="username" autoFocus />
              <LoadingButton
                type="submit"
                variant="contained"
                size="large"
                loading={methods.formState.isSubmitting}
              >
                ส่งลิงก์ตั้งรหัสผ่านใหม่
              </LoadingButton>
            </>
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            นึกออกแล้ว?{' '}
            <Link component={RouterLink} href={paths.auth.login}>
              กลับไปเข้าสู่ระบบ
            </Link>
          </Typography>
        </Stack>
      </Form>
    </AuthLayout>
  );
}
