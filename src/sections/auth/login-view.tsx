import type { LoginSchemaType } from 'src/schemas/auth/auth-schemas';

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
import { useSearchParams } from 'src/routes/hooks';

import { useAuth } from 'src/auth';
import { LoginSchema } from 'src/schemas/auth/auth-schemas';

import { Form, Field } from 'src/components/hook-form';

import { AuthLayout } from './auth-layout';

// ----------------------------------------------------------------------

/** เข้าสู่ระบบ (โหมด api) — สำเร็จแล้ว GuestGuard พากลับหน้าที่ขอไว้ (`returnTo`) */
export function LoginView() {
  const { login } = useAuth();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const methods = useForm<LoginSchemaType>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { formState } = methods;

  const onSubmit = methods.handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.email.trim(), v.password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ');
    }
  });

  const returnTo = searchParams.get('returnTo');

  return (
    <AuthLayout title="เข้าสู่ระบบ GO Account" subtitle="โปรแกรมบัญชีออนไลน์สำหรับ SME">
      <Form methods={methods} onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
          <Field.Text name="email" label="อีเมล" type="email" autoComplete="username" autoFocus />
          <Field.Text
            name="password"
            label="รหัสผ่าน"
            type="password"
            autoComplete="current-password"
          />
          <LoadingButton
            type="submit"
            variant="contained"
            size="large"
            loading={formState.isSubmitting}
          >
            เข้าสู่ระบบ
          </LoadingButton>
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            ยังไม่มีบัญชี?{' '}
            <Link
              component={RouterLink}
              href={
                returnTo
                  ? `${paths.auth.signup}?returnTo=${encodeURIComponent(returnTo)}`
                  : paths.auth.signup
              }
            >
              สมัครบริษัทใหม่
            </Link>
          </Typography>
        </Stack>
      </Form>
    </AuthLayout>
  );
}
