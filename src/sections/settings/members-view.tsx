import type { Role, Member } from 'src/auth';
import type { InviteSchemaType } from 'src/schemas/auth/auth-schemas';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TextField from '@mui/material/TextField';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';

import { formatThaiDate } from 'src/domain';
import { useAuth, ROLE_LABEL } from 'src/auth';
import { InviteSchema } from 'src/schemas/auth/auth-schemas';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Scrollbar } from 'src/components/scrollbar';
import { Form, Field } from 'src/components/hook-form';
import { EmptyContent } from 'src/components/empty-content';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { LoadingScreen } from 'src/components/loading-screen';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// ----------------------------------------------------------------------

const ROLES: Role[] = ['owner', 'accountant', 'viewer'];

const ROLE_HINT: Record<Role, string> = {
  owner: 'จัดการผู้ใช้ แก้ข้อมูลบริษัท ปิดงวด และทำได้ทุกอย่าง',
  accountant: 'ออกเอกสาร บันทึกซื้อ รับ/จ่ายเงิน รายการปรับปรุง',
  viewer: 'ดูเอกสารและรายงานอย่างเดียว บันทึกอะไรไม่ได้',
};

/** ผู้ใช้งานของบริษัท (เจ้าของเท่านั้น) — เชิญ, เปลี่ยนบทบาท, นำออก; เจ้าของคนสุดท้ายลด/ลบไม่ได้ (เซิร์ฟเวอร์บังคับ) */
export function MembersView() {
  const { client, user, tenant, refreshMe } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const methods = useForm<InviteSchemaType>({
    resolver: zodResolver(InviteSchema),
    defaultValues: { email: '', role: 'accountant' },
  });

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setError(null);
      setMembers(await client.get<Member[]>('/tenant/members'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดรายชื่อไม่สำเร็จ');
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = methods.handleSubmit(async (v) => {
    if (!client) return;
    try {
      await client.request('/tenant/members/invitations', {
        method: 'POST',
        body: { email: v.email.trim(), role: v.role },
      });
      toast.success(`ส่งคำเชิญไปที่ ${v.email.trim()} แล้ว (ลิงก์ใช้ได้ภายในเวลาที่กำหนด)`);
      methods.reset({ email: '', role: v.role });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งคำเชิญไม่สำเร็จ');
    }
  });

  const changeRole = async (m: Member, role: Role) => {
    if (!client || role === m.role) return;
    setBusyId(m.userId);
    try {
      await client.request(`/tenant/members/${encodeURIComponent(m.userId)}`, {
        method: 'PATCH',
        body: { role },
      });
      toast.success(`${m.displayName}: ${ROLE_LABEL[role]}`);
      await load();
      if (m.userId === user?.id) await refreshMe();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปลี่ยนบทบาทไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const m = removing;
    if (!client || !m) return;
    setBusyId(m.userId);
    try {
      await client.request(`/tenant/members/${encodeURIComponent(m.userId)}`, { method: 'DELETE' });
      toast.success(`นำ ${m.displayName} ออกจากบริษัทแล้ว`);
      setRemoving(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'นำออกไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const owners = members?.filter((m) => m.role === 'owner').length ?? 0;

  let content: React.ReactNode;
  if (error) {
    content = (
      <EmptyContent
        filled
        title="โหลดรายชื่อไม่สำเร็จ"
        description={error}
        action={
          <Button variant="contained" sx={{ mt: 2 }} onClick={load}>
            ลองใหม่
          </Button>
        }
        sx={{ py: 6 }}
      />
    );
  } else if (!members) {
    content = <LoadingScreen sx={{ py: 6 }} />;
  } else if (!members.length) {
    content = <EmptyContent filled title="ยังไม่มีผู้ใช้งาน" sx={{ py: 6 }} />;
  } else {
    content = (
      <Scrollbar>
        <Table size="small" sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              <TableCell>ชื่อ</TableCell>
              <TableCell>อีเมล</TableCell>
              <TableCell sx={{ width: 200 }}>บทบาท</TableCell>
              <TableCell>เข้าร่วมเมื่อ</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((m) => {
              const lastOwner = m.role === 'owner' && owners <= 1;
              return (
                <TableRow key={m.userId}>
                  <TableCell>
                    {m.displayName}
                    {m.userId === user?.id && (
                      <Label variant="soft" color="info" sx={{ ml: 1 }}>
                        คุณ
                      </Label>
                    )}
                  </TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      fullWidth
                      value={m.role}
                      disabled={busyId === m.userId || lastOwner}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      inputProps={{ 'aria-label': `บทบาทของ ${m.displayName}` }}
                      helperText={lastOwner ? 'เจ้าของคนสุดท้าย' : undefined}
                    >
                      {ROLES.map((r) => (
                        <MenuItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>{formatThaiDate(m.joinedAt.slice(0, 10))}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      disabled={lastOwner || busyId === m.userId}
                      onClick={() => setRemoving(m)}
                    >
                      นำออก
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Scrollbar>
    );
  }

  return (
    <>
      <CustomBreadcrumbs
        heading="ผู้ใช้งานของบริษัท"
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ตั้งค่าบริษัท', href: paths.settings },
          { name: 'ผู้ใช้งาน' },
        ]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Stack spacing={3}>
        <Card>
          <CardHeader
            title="เชิญผู้ใช้งาน"
            subheader={`เข้าร่วม ${tenant?.name ?? 'บริษัทนี้'} — ผู้รับเปิดลิงก์ในอีเมลเพื่อตั้งรหัสผ่านหรือเข้าสู่ระบบ`}
          />
          <Form methods={methods} onSubmit={invite}>
            <Box
              sx={{
                p: 3,
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', md: '2fr 1fr auto' },
                alignItems: 'start',
              }}
            >
              <Field.Text name="email" label="อีเมล" size="small" type="email" />
              <Field.Select name="role" label="บทบาท" size="small">
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </MenuItem>
                ))}
              </Field.Select>
              <LoadingButton
                type="submit"
                variant="contained"
                loading={methods.formState.isSubmitting}
              >
                ส่งคำเชิญ
              </LoadingButton>
            </Box>
          </Form>
          <Alert severity="info" variant="outlined" sx={{ mx: 3, mb: 3 }}>
            {ROLES.map((r) => (
              <Typography key={r} variant="body2">
                <strong>{ROLE_LABEL[r]}</strong> — {ROLE_HINT[r]}
              </Typography>
            ))}
          </Alert>
        </Card>

        <Card>
          <CardHeader title={`ผู้ใช้งาน${members ? ` (${members.length})` : ''}`} sx={{ mb: 2 }} />
          {content}
        </Card>
      </Stack>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="นำผู้ใช้ออกจากบริษัท"
        content={
          removing
            ? `${removing.displayName} (${removing.email}) จะเข้าบริษัทนี้ไม่ได้ทันที — เอกสารที่เคยบันทึกยังอยู่ครบ`
            : ''
        }
        action={
          <LoadingButton
            variant="contained"
            color="error"
            loading={!!removing && busyId === removing.userId}
            onClick={remove}
          >
            นำออก
          </LoadingButton>
        }
      />
    </>
  );
}
