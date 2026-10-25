import { useState } from 'react';

import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { useAuth, ROLE_LABEL, usePermissions } from 'src/auth';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { usePopover, CustomPopover } from 'src/components/custom-popover';

import { ChangePasswordDialog } from 'src/sections/auth/change-password-dialog';

// ----------------------------------------------------------------------

/** เมนูผู้ใช้ (โหมด api): บริษัท + บทบาท, สลับบริษัท (มีหลายบริษัท), ผู้ใช้งาน (owner), เปลี่ยนรหัสผ่าน, ออกจากระบบ */
export function AccountMenu() {
  const { user, tenant, memberships, switchTenant, logout } = useAuth();
  const { isOwner } = usePermissions();
  const router = useRouter();
  const popover = usePopover();
  const changePassword = useBoolean();
  const [switching, setSwitching] = useState(false);

  if (!user) return null;
  const initial = (user.displayName || user.email).trim().charAt(0).toUpperCase();

  const onSwitch = async (id: string) => {
    if (id === tenant?.id) return;
    setSwitching(true);
    try {
      await switchTenant(id);
      popover.onClose();
      router.push(paths.dashboard);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สลับบริษัทไม่สำเร็จ');
    } finally {
      setSwitching(false);
    }
  };

  const onLogout = async () => {
    popover.onClose();
    try {
      await logout();
    } catch {
      // ลบ session ฝั่งหน้าเว็บแล้ว — เซิร์ฟเวอร์ล้มก็ถือว่าออกจากระบบ
    }
  };

  return (
    <>
      <ButtonBase
        onClick={popover.onOpen}
        aria-label="เมนูผู้ใช้"
        sx={{ borderRadius: 1, px: 0.75, py: 0.5, gap: 1, flexShrink: 0, minWidth: 0 }}
      >
        <Avatar
          sx={{
            width: 32,
            height: 32,
            typography: 'subtitle2',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          {initial}
        </Avatar>
        <Box
          sx={{
            display: { xs: 'none', md: 'block' },
            textAlign: 'left',
            minWidth: 0,
            maxWidth: 200,
          }}
        >
          <Typography variant="subtitle2" noWrap>
            {user.displayName}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap>
            {tenant?.role ? ROLE_LABEL[tenant.role] : ''}
          </Typography>
        </Box>
      </ButtonBase>

      <CustomPopover
        open={popover.open}
        anchorEl={popover.anchorEl}
        onClose={popover.onClose}
        slotProps={{ arrow: { placement: 'top-right' } }}
      >
        <Box sx={{ px: 2, py: 1.5, maxWidth: 300 }}>
          <Typography variant="subtitle2" noWrap>
            {user.displayName}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
            {user.email}
          </Typography>
          {!user.emailVerified && (
            <Label variant="soft" color="warning" sx={{ mt: 0.5 }}>
              ยังไม่ยืนยันอีเมล
            </Label>
          )}
        </Box>
        <Divider sx={{ borderStyle: 'dashed' }} />
        <MenuList sx={{ py: 1 }}>
          {memberships.length > 1 && (
            <Typography
              variant="caption"
              sx={{ px: 1.5, color: 'text.disabled', display: 'block' }}
            >
              สลับบริษัท
            </Typography>
          )}
          {memberships.map((m) => (
            <MenuItem
              key={m.id}
              selected={m.id === tenant?.id}
              disabled={switching}
              onClick={() => onSwitch(m.id)}
            >
              <Iconify icon="solar:buildings-2-bold-duotone" width={20} />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" noWrap>
                  {m.name}
                </Typography>
              </Box>
              <Label variant="soft" color={m.role === 'viewer' ? 'default' : 'info'}>
                {ROLE_LABEL[m.role]}
              </Label>
            </MenuItem>
          ))}
        </MenuList>
        <Divider sx={{ borderStyle: 'dashed' }} />
        <MenuList sx={{ py: 1 }}>
          {isOwner && (
            <MenuItem
              onClick={() => {
                popover.onClose();
                router.push(paths.members);
              }}
            >
              <Iconify icon="solar:users-group-rounded-bold-duotone" width={20} />
              ผู้ใช้งานของบริษัท
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              popover.onClose();
              changePassword.onTrue();
            }}
          >
            <Iconify icon="solar:lock-password-bold-duotone" width={20} />
            เปลี่ยนรหัสผ่าน
          </MenuItem>
          <MenuItem onClick={onLogout} sx={{ color: 'error.main' }}>
            <Iconify icon="solar:logout-2-bold-duotone" width={20} />
            ออกจากระบบ
          </MenuItem>
        </MenuList>
      </CustomPopover>

      <ChangePasswordDialog open={changePassword.value} onClose={changePassword.onFalse} />
    </>
  );
}
