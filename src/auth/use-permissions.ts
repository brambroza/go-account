import { permissionsOf } from './types';
import { useAuth } from './auth-provider';

/** สิทธิ์ของผู้ใช้ในบริษัทที่เลือก — โหมด local = owner */
export function usePermissions() {
  const { role } = useAuth();
  return permissionsOf(role);
}
