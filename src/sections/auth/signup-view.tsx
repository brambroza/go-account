import type { SignupSchemaType } from 'src/schemas/auth/auth-schemas';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { useAuth } from 'src/auth';
import { SignupSchema } from 'src/schemas/auth/auth-schemas';
import { normalizeTaxId, normalizeBranch5 } from 'src/domain';

import { Form, Field } from 'src/components/hook-form';

import { AuthLayout } from './auth-layout';

// ----------------------------------------------------------------------

/**
 * สมัครบริษัทใหม่ + ผู้ใช้เจ้าของ (โหมด api) — เซิร์ฟเวอร์สร้างผังบัญชีตั้งต้นและทะเบียนเงินสดย่อย/ธนาคารให้
 * จากนั้นเริ่มสมุดด้วยยอดยกมา (ตั้งค่า → ยอดยกมา) — ไม่อัปโหลดข้อมูล localStorage ขึ้นเซิร์ฟเวอร์
 */
export function SignupView() {
  const { signup } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const methods = useForm<SignupSchemaType>({
    resolver: zodResolver(SignupSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      companyName: '',
      taxId: '',
      branchNo: '00000',
      vatRegistered: true,
    },
  });
  const { formState } = methods;

  const onSubmit = methods.handleSubmit(async (v) => {
    setError(null);
    try {
      await signup({
        email: v.email.trim(),
        password: v.password,
        displayName: v.displayName.trim(),
        company: {
          name: v.companyName.trim(),
          taxId: v.taxId.trim() ? normalizeTaxId(v.taxId) : undefined,
          branchNo: normalizeBranch5(v.branchNo || '0'),
          vatRegistered: v.vatRegistered,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สมัครไม่สำเร็จ');
    }
  });

  return (
    <AuthLayout
      title="สมัครใช้งาน GO Account"
      subtitle="สร้างบริษัทใหม่ คุณจะเป็นเจ้าของบริษัทและเชิญพนักงานบัญชีภายหลังได้"
      maxWidth={560}
    >
      <Form methods={methods} onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
          <Typography variant="subtitle2">ผู้ใช้งาน</Typography>
          <Field.Text name="displayName" label="ชื่อ-นามสกุล" autoComplete="name" autoFocus />
          <Field.Text
            name="email"
            label="อีเมล (ใช้เข้าสู่ระบบ)"
            type="email"
            autoComplete="username"
          />
          <Field.Text
            name="password"
            label="รหัสผ่าน"
            type="password"
            autoComplete="new-password"
            helperText="อย่างน้อย 10 ตัวอักษร"
          />
          <Divider sx={{ borderStyle: 'dashed' }} />
          <Typography variant="subtitle2">บริษัท</Typography>
          <Field.Text name="companyName" label="ชื่อบริษัท (ตามที่พิมพ์บนใบกำกับภาษี)" />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
            <Field.Text
              name="taxId"
              label="เลขประจำตัวผู้เสียภาษี 13 หลัก"
              inputProps={{ inputMode: 'numeric' }}
            />
            <Field.Text
              name="branchNo"
              label="สาขา (00000 = สำนักงานใหญ่)"
              inputProps={{ inputMode: 'numeric' }}
            />
          </Box>
          <Field.Switch name="vatRegistered" label="จดทะเบียนภาษีมูลค่าเพิ่ม" />
          <LoadingButton
            type="submit"
            variant="contained"
            size="large"
            loading={formState.isSubmitting}
          >
            สมัครและเริ่มใช้งาน
          </LoadingButton>
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            มีบัญชีแล้ว?{' '}
            <Link component={RouterLink} href={paths.auth.login}>
              เข้าสู่ระบบ
            </Link>
          </Typography>
        </Stack>
      </Form>
    </AuthLayout>
  );
}
