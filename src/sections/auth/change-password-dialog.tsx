import type { ChangePasswordSchemaType } from 'src/schemas/auth/auth-schemas';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { ApiError } from 'src/utils/api-client';

import { useAuth, AUTH_CODES } from 'src/auth';
import { ChangePasswordSchema } from 'src/schemas/auth/auth-schemas';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void };

const EMPTY: ChangePasswordSchemaType = { currentPassword: '', newPassword: '', confirm: '' };

/** เปลี่ยนรหัสผ่าน (โหมด api) — อุปกรณ์อื่นที่เข้าสู่ระบบอยู่ถูกออกจากระบบ, อุปกรณ์นี้ใช้ต่อได้ */
export function ChangePasswordDialog({ open, onClose }: Props) {
  const { changePassword } = useAuth();
  const methods = useForm<ChangePasswordSchemaType>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: EMPTY,
  });
  const { reset, setError, formState } = methods;

  useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  const onSubmit = methods.handleSubmit(async (v) => {
    try {
      const revoked = await changePassword(v.currentPassword, v.newPassword);
      toast.success(
        revoked > 0 ? 'เปลี่ยนรหัสผ่านแล้ว — อุปกรณ์อื่นถูกออกจากระบบ' : 'เปลี่ยนรหัสผ่านแล้ว'
      );
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === AUTH_CODES.wrongPassword) {
        setError('currentPassword', { message: e.message });
      } else if (e instanceof ApiError && e.status === 400) {
        setError('newPassword', { message: e.message });
      } else {
        toast.error(e instanceof Error ? e.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
      }
    }
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Form methods={methods} onSubmit={onSubmit}>
        <DialogTitle>เปลี่ยนรหัสผ่าน</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              อุปกรณ์อื่นที่เข้าสู่ระบบด้วยบัญชีนี้จะถูกออกจากระบบ และเราจะส่งอีเมลแจ้ง
            </Typography>
            <Field.Text
              name="currentPassword"
              label="รหัสผ่านปัจจุบัน"
              type="password"
              autoComplete="current-password"
              autoFocus
            />
            <Field.Text
              name="newPassword"
              label="รหัสผ่านใหม่"
              type="password"
              autoComplete="new-password"
              helperText="อย่างน้อย 10 ตัวอักษร"
            />
            <Field.Text name="confirm" label="ยืนยันรหัสผ่านใหม่" type="password" autoComplete="new-password" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={onClose}>
            ยกเลิก
          </Button>
          <LoadingButton type="submit" variant="contained" loading={formState.isSubmitting}>
            เปลี่ยนรหัสผ่าน
          </LoadingButton>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
