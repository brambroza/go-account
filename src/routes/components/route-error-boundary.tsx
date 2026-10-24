import { Component } from 'react';

import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useRouter, usePathname } from 'src/routes/hooks';

import { useAccounting } from 'src/store';

import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';

import { downloadBackup } from 'src/sections/settings/backup';

import { RouterLink } from './router-link';

// ----------------------------------------------------------------------

type FallbackProps = { error: Error; onReset: () => void };

/** หน้าข้อความเมื่อหน้าจอพัง — ให้กลับหน้าแรก, ไปหน้าตั้งค่า หรือสำรองข้อมูลได้ทันที */
export function RouteErrorFallback({ error, onReset }: FallbackProps) {
  const router = useRouter();
  const { data } = useAccounting();

  return (
    <EmptyContent
      filled
      title="หน้านี้แสดงผลไม่ได้"
      description="ข้อมูลที่บันทึกไว้ยังอยู่ — ลองกลับหน้าแรก ถ้ายังเป็นอีกให้สำรองข้อมูลเป็นไฟล์แล้วแจ้งทีมงาน"
      action={
        <Stack spacing={2} alignItems="center" sx={{ mt: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:home-2-bold" />}
              onClick={() => {
                onReset();
                router.push(paths.dashboard);
              }}
            >
              กลับหน้าแรก
            </Button>
            <Button variant="outlined" startIcon={<Iconify icon="solar:download-bold" />} onClick={() => downloadBackup(data, '-error')}>
              สำรองข้อมูล (.json)
            </Button>
            <Button component={RouterLink} href={paths.settings} color="inherit" onClick={onReset}>
              ไปหน้าตั้งค่า
            </Button>
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.disabled', maxWidth: 480, textAlign: 'center' }}>
            รายละเอียด: {error.message || error.name}
          </Typography>
        </Stack>
      }
      sx={{ py: 10 }}
    />
  );
}

type BoundaryProps = { children: React.ReactNode; resetKey: string };
type BoundaryState = { error: Error | null };

class ErrorBoundaryInner extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: BoundaryProps) {
    // เปลี่ยนหน้าแล้วลองแสดงใหม่
    const { resetKey } = this.props;
    const { error } = this.state;
    if (prev.resetKey !== resetKey && error) this.reset();
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Route error', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { children } = this.props;
    if (error) return <RouteErrorFallback error={error} onReset={this.reset} />;
    return children;
  }
}

/**
 * ErrorBoundary ระดับ route — หน้าใดพังจะแสดงข้อความภาษาไทยแทนจอขาว และเมนูยังใช้ได้
 * (แอปใช้ `<BrowserRouter>` + `useRoutes` ซึ่งไม่รองรับ `errorElement` ของ data router จึงใช้ boundary แทน)
 */
export function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <ErrorBoundaryInner resetKey={pathname}>{children}</ErrorBoundaryInner>;
}
