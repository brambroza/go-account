import type { ApiClient } from 'src/utils/api-client';

import { useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { createApiClient } from 'src/utils/api-client';

import { CONFIG } from 'src/config-global';

import type { Role, Membership, SessionUser, SignupInput, SessionResponse, AcceptedResponse } from './types';

// ----------------------------------------------------------------------
// session ของผู้ใช้ (โหมด api) — cookie httpOnly อยู่ที่เบราว์เซอร์ หน้าเว็บรู้สถานะจาก `GET /auth/me`
// โหมด local (demo) = ผู้ใช้สมมติบทบาท owner ไม่มีหน้า login
// ----------------------------------------------------------------------

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  mode: 'local' | 'api';
  status: AuthStatus;
  user: SessionUser | null;
  /** บริษัทที่ใช้งานอยู่ (+ บทบาท) */
  tenant: Membership | null;
  memberships: Membership[];
  role: Role | null;
  /** client เดียวของแอป (โหมด api) — null ในโหมด local */
  client: ApiClient | null;
  /** ยืนยันอีเมลแล้ว (โหมด local = true) — false = แสดงแถบให้ยืนยัน, คำขอบันทึกถูกปฏิเสธ */
  emailVerified: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** สมัคร — ไม่มี session (ต้องยืนยันอีเมลแล้วเข้าสู่ระบบ) คืนข้อความจากเซิร์ฟเวอร์ */
  signup: (input: SignupInput) => Promise<string>;
  /** ส่งลิงก์ยืนยันอีเมลใหม่ (login อยู่ = บัญชีนี้, ไม่ login = ตาม email) คืนข้อความจากเซิร์ฟเวอร์ */
  resendVerification: (email?: string) => Promise<string>;
  /** เปลี่ยนรหัสผ่าน (session อื่นถูกยกเลิก) คืนจำนวน session ที่ถูกยกเลิก */
  changePassword: (currentPassword: string, newPassword: string) => Promise<number>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  /** โหลดรายชื่อบริษัท/บทบาทใหม่ (หลังเปลี่ยนบทบาทสมาชิก) */
  refreshMe: () => Promise<void>;
};

type MeResponse = {
  user: SessionUser;
  tenant: { id: string; role: Role } | null;
  memberships: Membership[];
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const LOCAL_USER: SessionUser = {
  id: 'local',
  email: 'demo@localhost',
  displayName: 'ผู้ใช้ทดลอง (ข้อมูลในเครื่อง)',
  emailVerified: true,
};

type Props = { children: React.ReactNode };

export function AuthProvider({ children }: Props) {
  if (CONFIG.dataMode === 'local') return <LocalAuthProvider>{children}</LocalAuthProvider>;
  return <ApiAuthProvider>{children}</ApiAuthProvider>;
}

function LocalAuthProvider({ children }: Props) {
  const value = useMemo<AuthContextValue>(() => {
    const tenant: Membership = { id: 'local', name: 'ข้อมูลในเครื่อง', role: 'owner' };
    const noop = async () => undefined;
    return {
      mode: 'local',
      status: 'authenticated',
      user: LOCAL_USER,
      tenant,
      memberships: [tenant],
      role: 'owner',
      client: null,
      emailVerified: true,
      login: noop,
      signup: async () => '',
      resendVerification: async () => '',
      changePassword: async () => 0,
      logout: noop,
      switchTenant: noop,
      refreshMe: noop,
    };
  }, []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ApiAuthProvider({ children }: Props) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  // client เดียวตลอดอายุแอป — refresh ไม่ผ่าน = ออกจากระบบ (AuthGuard พาไปหน้า login พร้อม returnTo)
  const [client] = useState(() =>
    createApiClient({
      baseUrl: CONFIG.apiBaseUrl,
      onUnauthenticated: () => {
        setMe(null);
        setStatus('unauthenticated');
      },
    })
  );

  const loadMe = useCallback(async () => {
    try {
      const res = await client.request<MeResponse>('/auth/me');
      setMe(res);
      setStatus('authenticated');
    } catch {
      setMe(null);
      setStatus('unauthenticated');
    }
  }, [client]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const startSession = useCallback(
    async (session: SessionResponse) => {
      client.setSession(session);
      await loadMe();
    },
    [client, loadMe]
  );

  const value = useMemo<AuthContextValue>(() => {
    const memberships = me?.memberships ?? [];
    const active = me?.tenant ? memberships.find((m) => m.id === me.tenant?.id) : undefined;
    const tenant: Membership | null = me?.tenant
      ? { id: me.tenant.id, role: me.tenant.role, name: active?.name ?? '' }
      : null;
    return {
      mode: 'api',
      status,
      user: me?.user ?? null,
      tenant,
      memberships,
      role: tenant?.role ?? null,
      client,
      login: async (email, password) => {
        const s = await client.request<SessionResponse>('/auth/login', {
          method: 'POST',
          body: { email, password },
          noRefresh: true,
        });
        await startSession(s);
      },
      emailVerified: me?.user.emailVerified ?? false,
      signup: async (input) => {
        // D2: 202 เหมือนกันทุกกรณี ไม่มี cookie — ผู้ใช้ยืนยันอีเมลจากลิงก์แล้วเข้าสู่ระบบ
        const res = await client.request<AcceptedResponse>('/auth/signup', {
          method: 'POST',
          body: input,
          noRefresh: true,
        });
        return res.message;
      },
      resendVerification: async (email) => {
        const res = await client.request<AcceptedResponse>('/auth/resend-verification', {
          method: 'POST',
          body: email ? { email } : {},
          noRefresh: !me,
        });
        return res.message;
      },
      changePassword: async (currentPassword, newPassword) => {
        const res = await client.request<{ revokedSessions: number }>('/auth/password/change', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });
        return res.revokedSessions;
      },
      logout: async () => {
        try {
          await client.request('/auth/logout', { method: 'POST', noRefresh: true });
        } finally {
          client.setSession(null);
          setMe(null);
          setStatus('unauthenticated');
        }
      },
      switchTenant: async (tenantId) => {
        const s = await client.request<SessionResponse>('/auth/switch-tenant', {
          method: 'POST',
          body: { tenantId },
        });
        await startSession(s);
      },
      refreshMe: loadMe,
    };
  }, [client, loadMe, me, startSession, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ต้องอยู่ใต้ <AuthProvider>');
  return ctx;
}
