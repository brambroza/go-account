import Box from '@mui/material/Box';
import List from '@mui/material/List';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ListSubheader from '@mui/material/ListSubheader';
import ListItemButton from '@mui/material/ListItemButton';

import { useActiveLink } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { branchLabel } from 'src/domain';
import { useAccounting } from 'src/store';
import { varAlpha } from 'src/theme/styles';

import { Iconify } from 'src/components/iconify';

import { NAV } from './config-nav';

import type { NavItem } from './config-nav';

// ----------------------------------------------------------------------

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const active = useActiveLink(item.path, !item.exact);

  return (
    <ListItemButton
      component={RouterLink}
      href={item.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      sx={{
        gap: 1.5,
        minHeight: 44,
        px: 1.5,
        borderRadius: 1,
        typography: 'body2',
        color: 'text.secondary',
        ...(active && {
          color: 'primary.dark',
          fontWeight: 'fontWeightSemiBold',
          bgcolor: (theme) => varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
          '&:hover': {
            bgcolor: (theme) => varAlpha(theme.vars.palette.primary.mainChannel, 0.2),
          },
          '[data-mui-color-scheme="dark"] &': { color: 'primary.light' },
        }),
      }}
    >
      <Iconify icon={item.icon} width={22} />
      {item.title}
    </ListItemButton>
  );
}

type Props = { onNavigate?: () => void };

export function NavContent({ onNavigate }: Props) {
  const { data } = useAccounting();

  return (
    <Stack sx={{ height: 1, px: 2, py: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1, pb: 2.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            typography: 'subtitle1',
          }}
        >
          GA
        </Box>
        <Box>
          <Typography variant="subtitle1">GO Account</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            โปรแกรมบัญชีบนคลาวด์
          </Typography>
        </Box>
      </Stack>

      <Box component="nav" aria-label="เมนูหลัก" sx={{ flexGrow: 1 }}>
        {NAV.map((section) => (
          <List
            key={section.subheader}
            disablePadding
            sx={{ mb: 2 }}
            subheader={
              <ListSubheader
                disableSticky
                sx={{ px: 1.5, typography: 'overline', color: 'text.disabled', bgcolor: 'transparent', lineHeight: 2.5 }}
              >
                {section.subheader}
              </ListSubheader>
            }
          >
            <Stack spacing={0.5}>
              {section.items.map((item) => (
                <NavLink key={item.path} item={item} onNavigate={onNavigate} />
              ))}
            </Stack>
          </List>
        ))}
      </Box>

      <Box sx={{ px: 1.5, pt: 2, borderTop: (theme) => `dashed 1px ${theme.vars.palette.divider}` }}>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          บริษัทที่กำลังใช้งาน
        </Typography>
        <Typography variant="subtitle2" noWrap>
          {data.company.name}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {branchLabel(data.company.branchNo)}
        </Typography>
      </Box>
    </Stack>
  );
}
