import { Navigate, useLocation } from 'react-router-dom';

import { paths } from 'src/routes/paths';

import { LoadingScreen } from 'src/components/loading-screen';

import { useAuth } from './auth-provider';
import { usePermissions } from './use-permissions';

// ----------------------------------------------------------------------

type Props = { children: React.ReactNode };

/** หน้าที่ต้อง login (โหมด local ผ่านเสมอ) — ยังไม่ login พาไปหน้าเข้าสู่ระบบพร้อม returnTo */
export function AuthGuard({ children }: Props) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingScreen sx={{ minHeight: '100vh' }} />;
  if (status === 'unauthenticated') {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`${paths.auth.login}?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}

/** หน้า login/signup — login แล้ว (หรือโหมด local) กลับหน้าที่ขอไว้ */
export function GuestGuard({ children }: Props) {
  const { status, mode } = useAuth();
  const location = useLocation();
  if (mode === 'local') return <Navigate to={paths.dashboard} replace />;
  if (status === 'loading') return <LoadingScreen sx={{ minHeight: '100vh' }} />;
  if (status === 'authenticated') {
    const returnTo = new URLSearchParams(location.search).get('returnTo');
    // รับเฉพาะ path ภายใน (กัน open redirect)
    const safe =
      returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : paths.dashboard;
    return <Navigate to={safe} replace />;
  }
  return <>{children}</>;
}

/** หน้าบันทึกเอกสาร (ออกใบกำกับ/บันทึกซื้อ ฯลฯ) — viewer กลับหน้าแรก */
export function RequireWrite({ children }: Props) {
  const { canWrite } = usePermissions();
  if (!canWrite) return <Navigate to={paths.dashboard} replace />;
  return <>{children}</>;
}

/** หน้าของเจ้าของ (สมาชิก) */
export function RequireOwner({ children }: Props) {
  const { isOwner } = usePermissions();
  if (!isOwner) return <Navigate to={paths.dashboard} replace />;
  return <>{children}</>;
}

/** แสดงเฉพาะผู้ที่บันทึกได้ (owner/accountant) — ใช้ครอบปุ่มที่เปลี่ยนข้อมูล */
export function CanWrite({ children }: Props) {
  const { canWrite } = usePermissions();
  return canWrite ? <>{children}</> : null;
}

/** แสดงเฉพาะเจ้าของ */
export function OwnerOnly({ children }: Props) {
  const { isOwner } = usePermissions();
  return isOwner ? <>{children}</> : null;
}
