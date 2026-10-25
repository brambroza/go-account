import type { SessionResponse } from 'src/auth';

import { z as zod } from 'zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { useAuth, tokenFromHash } from 'src/auth';

import { Form, Field } from 'src/components/hook-form';

import { AuthLayout } from './auth-layout';

// ----------------------------------------------------------------------

const NewUserSchema = zod.object({
  displayName: zod.string().trim().min(1, { message: 'กรอกชื่อผู้ใช้' }).max(100),
  password: zod.string().min(10, { message: 'รหัสผ่านอย่างน้อย 10 ตัวอักษร' }).max(128),
});

type NewUserSchemaType = zod.input<typeof NewUserSchema>;

/** token อยู่ใน fragment (`/accept-invite#token=…`) — ไม่ถูกส่งไปเซิร์ฟเวอร์ใน URL/log; ไม่ลบจาก URL เพราะใช้ใน returnTo ตอน login ก่อนตอบรับ */
const readToken = () => tokenFromHash(window.location.hash);

/**
 * ตอบรับคำเชิญเข้าบริษัท: login อยู่แล้ว = ตอบรับด้วยบัญชีนี้ (อีเมลต้องตรงกับคำเชิญ) แล้วสลับไปบริษัทนั้น,
 * ยังไม่มีบัญชี = ตั้งชื่อ + รหัสผ่าน (อีเมลตามคำเชิญ)
 */
export function AcceptInviteView() {
  const { client, status, user, switchTenant, refreshMe } = useAuth();
  const router = useRouter();
  const [token] = useState(readToken);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const methods = useForm<NewUserSchemaType>({
    resolver: zodResolver(NewUserSchema),
    defaultValues: { displayName: '', password: '' },
  });

  const acceptExisting = async () => {
    if (!client) return;
    setAccepting(true);
    setError(null);
    try {
      const m = await client.request<{ id: string }>('/auth/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      await switchTenant(m.id);
      router.replace(paths.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตอบรับคำเชิญไม่สำเร็จ');
    } finally {
      setAccepting(false);
    }
  };

  const acceptNew = methods.handleSubmit(async (v) => {
    if (!client) return;
    setError(null);
    try {
      const s = await client.request<SessionResponse>('/auth/invitations/accept-new', {
        method: 'POST',
        body: { token, displayName: v.displayName.trim(), password: v.password },
        noRefresh: true,
      });
      client.setSession(s);
      await refreshMe();
      router.replace(paths.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตอบรับคำเชิญไม่สำเร็จ');
    }
  });

  if (!token) {
    return (
      <AuthLayout
        title="ลิงก์คำเชิญไม่ถูกต้อง"
        subtitle="เปิดลิงก์จากอีเมลคำเชิญอีกครั้ง หรือขอให้เจ้าของบริษัทส่งคำเชิญใหม่"
      >
        <Link component={RouterLink} href={paths.auth.login}>
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="ตอบรับคำเชิญเข้าบริษัท"
      subtitle="คุณได้รับเชิญให้ใช้ GO Account ร่วมกับบริษัท"
    >
      <Stack spacing={2.5}>
        {error && (
          <Alert severity="error" variant="outlined">
            {error}
          </Alert>
        )}
        {status === 'authenticated' ? (
          <>
            <Typography variant="body2">
              เข้าสู่ระบบอยู่ในชื่อ <strong>{user?.email}</strong> — อีเมลต้องตรงกับที่ได้รับเชิญ
            </Typography>
            <LoadingButton
              variant="contained"
              size="large"
              loading={accepting}
              onClick={acceptExisting}
            >
              ตอบรับคำเชิญ
            </LoadingButton>
          </>
        ) : (
          <Form methods={methods} onSubmit={acceptNew}>
            <Stack spacing={2.5}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                ยังไม่มีบัญชี — ตั้งชื่อและรหัสผ่าน (ใช้อีเมลที่ได้รับเชิญเข้าสู่ระบบ) ·{' '}
                <Link
                  component={RouterLink}
                  href={`${paths.auth.login}?returnTo=${encodeURIComponent(`/accept-invite#token=${token}`)}`}
                >
                  มีบัญชีแล้ว เข้าสู่ระบบก่อน
                </Link>
              </Typography>
              <Field.Text name="displayName" label="ชื่อ-นามสกุล" autoComplete="name" autoFocus />
              <Field.Text
                name="password"
                label="รหัสผ่าน"
                type="password"
                autoComplete="new-password"
                helperText="อย่างน้อย 10 ตัวอักษร"
              />
              <LoadingButton
                type="submit"
                variant="contained"
                size="large"
                loading={methods.formState.isSubmitting}
              >
                ตั้งรหัสผ่านและเข้าร่วม
              </LoadingButton>
            </Stack>
          </Form>
        )}
      </Stack>
    </AuthLayout>
  );
}
