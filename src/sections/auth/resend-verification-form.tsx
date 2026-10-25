import type { EmailOnlySchemaType } from 'src/schemas/auth/auth-schemas';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import LoadingButton from '@mui/lab/LoadingButton';

import { useAuth } from 'src/auth';
import { EmailOnlySchema } from 'src/schemas/auth/auth-schemas';

import { Form, Field } from 'src/components/hook-form';

// ----------------------------------------------------------------------

type Props = {
  /** login อยู่ = ส่งให้บัญชีนี้ (ไม่ต้องกรอกอีเมล) */
  loggedIn: boolean;
  /** อีเมลตั้งต้น (เช่นจากหน้าสมัคร) */
  defaultEmail?: string;
};

/** ขอลิงก์ยืนยันอีเมลใหม่ — เซิร์ฟเวอร์ตอบข้อความเดียวกันทุกกรณี (ไม่บอกว่ามีบัญชี) */
export function ResendVerificationForm({ loggedIn, defaultEmail = '' }: Props) {
  const { resendVerification } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const methods = useForm<EmailOnlySchemaType>({
    resolver: zodResolver(EmailOnlySchema),
    defaultValues: { email: defaultEmail },
  });

  const send = async (email?: string) => {
    setError(null);
    setSending(true);
    try {
      setMessage(await resendVerification(email));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งลิงก์ไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  const feedback = (
    <>
      {message && (
        <Alert severity="success" variant="outlined">
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      )}
    </>
  );

  if (loggedIn) {
    return (
      <Stack spacing={2}>
        {feedback}
        <LoadingButton variant="outlined" loading={sending} onClick={() => send()}>
          ส่งลิงก์ยืนยันอีกครั้ง
        </LoadingButton>
      </Stack>
    );
  }

  return (
    <Form methods={methods} onSubmit={methods.handleSubmit((v) => send(v.email.trim()))}>
      <Stack spacing={2}>
        {feedback}
        <Field.Text name="email" label="อีเมลที่ใช้สมัคร" type="email" autoComplete="email" />
        <LoadingButton type="submit" variant="outlined" loading={sending}>
          ส่งลิงก์ยืนยันอีกครั้ง
        </LoadingButton>
      </Stack>
    </Form>
  );
}
