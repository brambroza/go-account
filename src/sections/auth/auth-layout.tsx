import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { Logo } from 'src/components/logo';

// ----------------------------------------------------------------------

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
};

/** โครงหน้า login / สมัคร — การ์ดกลางจอ ไม่มีเมนู (ยังไม่ login) */
export function AuthLayout({ title, subtitle, children, maxWidth = 440 }: Props) {
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 6,
        bgcolor: 'background.neutral',
      }}
    >
      <Card sx={{ width: 1, maxWidth, p: { xs: 3, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Logo sx={{ mb: 1 }} />
          <Typography variant="h4" component="h1">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          )}
        </Stack>
        {children}
      </Card>
    </Box>
  );
}
