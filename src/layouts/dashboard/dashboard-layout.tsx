import { useCallback } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Tooltip from '@mui/material/Tooltip';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { useBoolean } from 'src/hooks/use-boolean';
import { useResponsive } from 'src/hooks/use-responsive';
import { useEventListener } from 'src/hooks/use-event-listener';

import { useAccounting } from 'src/store';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { SettingsButton } from 'src/components/settings';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { NavContent } from './nav-content';
import { CommandPalette } from './command-palette';

// ----------------------------------------------------------------------

const NAV_WIDTH = 264;

type Props = { children: React.ReactNode };

export function DashboardLayout({ children }: Props) {
  const lgUp = useResponsive('up', 'lg');
  const mobileNav = useBoolean();
  const search = useBoolean();
  const resetConfirm = useBoolean();
  const { resetDemo } = useAccounting();

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        search.onTrue();
      }
    },
    [search]
  );
  useEventListener('keydown', onKeyDown);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {lgUp ? (
        <Box
          component="aside"
          sx={{
            width: NAV_WIDTH,
            flexShrink: 0,
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflowY: 'auto',
            borderRight: (theme) => `dashed 1px ${theme.vars.palette.divider}`,
          }}
        >
          <NavContent />
        </Box>
      ) : (
        <Drawer open={mobileNav.value} onClose={mobileNav.onFalse} PaperProps={{ sx: { width: NAV_WIDTH } }}>
          <NavContent onNavigate={mobileNav.onFalse} />
        </Drawer>
      )}

      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Stack
          component="header"
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{
            px: { xs: 2, md: 4 },
            py: 1.5,
            position: 'sticky',
            top: 0,
            zIndex: (theme) => theme.zIndex.appBar,
            bgcolor: 'background.default',
            borderBottom: (theme) => `dashed 1px ${theme.vars.palette.divider}`,
          }}
        >
          {!lgUp && (
            <IconButton aria-label="เปิดเมนู" onClick={mobileNav.onTrue}>
              <Iconify icon="solar:hamburger-menu-line-duotone" />
            </IconButton>
          )}

          <ButtonBase
            onClick={search.onTrue}
            aria-label="ค้นหา (Ctrl+K)"
            sx={{
              flexGrow: 1,
              maxWidth: 480,
              height: 40,
              px: 1.5,
              gap: 1,
              borderRadius: 1,
              justifyContent: 'flex-start',
              color: 'text.disabled',
              bgcolor: 'background.neutral',
            }}
          >
            <Iconify icon="eva:search-fill" width={18} />
            <Typography variant="body2" sx={{ flexGrow: 1, textAlign: 'left' }} noWrap>
              ค้นหาเอกสาร ลูกค้า หรือเมนู
            </Typography>
            <Label sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>Ctrl K</Label>
          </ButtonBase>

          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title="ข้อมูลทั้งหมดเก็บในเบราว์เซอร์นี้ — กดเพื่อสร้างข้อมูลตัวอย่างใหม่">
            <ButtonBase onClick={resetConfirm.onTrue} sx={{ borderRadius: 0.75 }}>
              <Label variant="soft" color="warning" sx={{ cursor: 'pointer' }}>
                ข้อมูลตัวอย่าง
              </Label>
            </ButtonBase>
          </Tooltip>
          <SettingsButton />
        </Stack>

        <Box component="main" sx={{ flexGrow: 1, px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 } }}>
          <Box sx={{ maxWidth: 1360, mx: 'auto' }}>{children}</Box>
        </Box>
      </Box>

      <CommandPalette open={search.value} onClose={search.onFalse} />

      <ConfirmDialog
        open={resetConfirm.value}
        onClose={resetConfirm.onFalse}
        title="สร้างข้อมูลตัวอย่างใหม่"
        content="ข้อมูลทุกอย่างที่บันทึกในเบราว์เซอร์นี้จะถูกลบ แล้วแทนที่ด้วยข้อมูลตัวอย่างชุดใหม่ ย้อนกลับไม่ได้"
        action={
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              resetDemo();
              resetConfirm.onFalse();
            }}
          >
            ล้างและสร้างใหม่
          </Button>
        }
      />
    </Box>
  );
}
