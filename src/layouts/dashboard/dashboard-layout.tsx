import { useRef, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Tooltip from '@mui/material/Tooltip';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { useBoolean } from 'src/hooks/use-boolean';
import { useResponsive } from 'src/hooks/use-responsive';
import { useEventListener } from 'src/hooks/use-event-listener';

import { useAccounting } from 'src/store';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { SettingsButton } from 'src/components/settings';

import { downloadBackup } from 'src/sections/settings/backup';
import { ResetDemoDialog } from 'src/sections/settings/reset-demo-dialog';

import { NavContent } from './nav-content';
import { CommandPalette } from './command-palette';

// ----------------------------------------------------------------------

const NAV_WIDTH = 264;

type Props = { children: React.ReactNode };

/** โครงหน้าหลัก: เมนู, header (ค้นหา Ctrl+K, ป้ายข้อมูลตัวอย่าง) และแถบแจ้งสถานะการบันทึกข้อมูล */
export function DashboardLayout({ children }: Props) {
  const lgUp = useResponsive('up', 'lg');
  const mobileNav = useBoolean();
  const search = useBoolean();
  const resetConfirm = useBoolean();
  const { data, problems, storageError, externalChangeAt, readOnly } = useAccounting();

  // แท็บอื่นแก้ข้อมูล → store โหลดล่าสุดให้แล้ว แจ้งผู้ใช้ครั้งเดียวต่อการเปลี่ยน
  const lastExternal = useRef(externalChangeAt);
  useEffect(() => {
    if (externalChangeAt && externalChangeAt !== lastExternal.current) {
      toast.info('ข้อมูลถูกแก้จากอีกแท็บ โหลดล่าสุดแล้ว');
    }
    lastExternal.current = externalChangeAt;
  }, [externalChangeAt]);

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
              // มือถือ 390px: ให้ช่องค้นหาหดได้ (ข้อความตัด …) ไม่ดันปุ่มด้านขวาล้นจอ (UAT U6)
              minWidth: 0,
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

          <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />

          <Tooltip title="ข้อมูลทั้งหมดเก็บในเบราว์เซอร์นี้ — กดเพื่อล้างและสร้างข้อมูลตัวอย่างใหม่ (ต้องยืนยัน)">
            <ButtonBase onClick={resetConfirm.onTrue} sx={{ borderRadius: 0.75, flexShrink: 0 }}>
              <Label variant="soft" color="warning" sx={{ cursor: 'pointer' }}>
                ข้อมูลตัวอย่าง
              </Label>
            </ButtonBase>
          </Tooltip>
          <SettingsButton />
        </Stack>

        <Box component="main" sx={{ flexGrow: 1, px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 } }}>
          <Box sx={{ maxWidth: 1360, mx: 'auto' }}>
            {storageError && (
              <Alert
                severity="error"
                sx={{ mb: 3 }}
                action={
                  <Button color="inherit" size="small" variant="outlined" onClick={() => downloadBackup(data, '-unsaved')}>
                    สำรองข้อมูลทันที
                  </Button>
                }
              >
                {storageError} — รายการที่บันทึกไม่สำเร็จจะไม่ถูกออกเลขที่และไม่ลงบัญชี ให้สำรองข้อมูลเป็นไฟล์แล้วแก้ที่เบราว์เซอร์
                (เปิดการเก็บข้อมูลของเว็บไซต์ / เพิ่มพื้นที่) ก่อนทำรายการต่อ
              </Alert>
            )}
            {problems.length > 0 && (
              <Alert
                severity={readOnly ? 'error' : 'warning'}
                variant="outlined"
                sx={{ mb: 3 }}
                action={
                  <Button component={RouterLink} href={paths.settings} color="inherit" size="small">
                    ไปหน้าตั้งค่า
                  </Button>
                }
              >
                {readOnly
                  ? `โหมดอ่านอย่างเดียว — ข้อมูลไม่ผ่านการตรวจ ${problems.length} ข้อ เช่น ${problems[0]} · ดูรายงานได้แต่บันทึกรายการไม่ได้ จนกว่าจะกู้คืนจากไฟล์สำรองที่ถูกต้องหรือล้างข้อมูลที่หน้าตั้งค่า`
                  : `พบปัญหาในข้อมูล ${problems.length} ข้อ เช่น ${problems[0]} — สำรองข้อมูลแล้วตรวจสอบที่หน้าตั้งค่า`}
              </Alert>
            )}
            {children}
          </Box>
        </Box>
      </Box>

      <CommandPalette open={search.value} onClose={search.onFalse} />

      <ResetDemoDialog open={resetConfirm.value} onClose={resetConfirm.onFalse} />
    </Box>
  );
}
