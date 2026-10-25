import type { AccountingData } from 'src/domain';
import type { ApiClient } from 'src/utils/api-client';

import { useMemo, useState, useEffect, useContext, useCallback, createContext, useSyncExternalStore } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';

import { localStorageAvailable } from 'src/utils/storage-available';

import { CONFIG } from 'src/config-global';

import { EmptyContent } from 'src/components/empty-content';
import { LoadingScreen } from 'src/components/loading-screen';

import { useAuth } from 'src/auth/auth-provider';

import { buildDemoData } from './seed';
import { BusinessRuleError } from './actions';
import { readAccountingJson } from './migrations';
import { createAccountingStore } from './accounting-store';
import { createApiRepository, createLocalRepository } from './repository';

import type { Command } from './commands';
import type { LoadResult } from './migrations';
import type { RepositoryMode, LocalRepository, AccountingRepository } from './repository';

// ----------------------------------------------------------------------
// ข้อมูลของหน้าจอ — หน้าจอเรียกผ่าน `useAccounting()` เท่านั้น ไม่รู้ว่าข้อมูลมาจาก localStorage หรือเซิร์ฟเวอร์
//   VITE_DATA_MODE=local (ค่าเริ่มต้น): demo เก็บในเบราว์เซอร์ (`accounting-store.ts`)
//   VITE_DATA_MODE=api: go-account-api เป็น source of truth — สมุดมาจาก GET /book, คำสั่งผ่าน endpoint ของมัน
// `run(cmd.xxx(input))` เป็น async ทั้งสองโหมด: await แล้วค่อย toast/เปลี่ยนหน้า; `busy` = มีคำสั่งค้าง (ปิดปุ่มบันทึก)
// ----------------------------------------------------------------------

export type AccountingContextValue = {
  mode: RepositoryMode;
  data: AccountingData;
  /** รันคำสั่ง — throw ข้อความไทยถ้าผิดกฎธุรกิจ/สิทธิ์/เครือข่าย (ข้อมูลไม่เปลี่ยน) */
  run: <R extends object>(command: Command<R>) => Promise<R>;
  /** มีคำสั่งกำลังส่ง — ปุ่มบันทึกต้อง disabled */
  busy: boolean;
  /** เพิ่มทุกครั้งที่ข้อมูลเปลี่ยน (cache ของรายงานจากเซิร์ฟเวอร์) */
  revision: number;
  /** โหลดใหม่จากเซิร์ฟเวอร์ (โหมด api) */
  reload: () => Promise<void>;
  /** client ของ API (โหมด api) — หน้ารายงาน/ไฟล์ใช้เรียก /reports, /files */
  client: ApiClient | null;
  /** สำรอง/กู้คืน/ข้อมูลตัวอย่าง ใช้ได้เฉพาะโหมด local */
  canUseLocalTools: boolean;
  /** แทนที่ทั้งก้อน (กู้คืน backup) — throw ถ้าไม่ผ่าน `validateAccountingData` เว้นแต่ส่ง `force` */
  replace: (next: AccountingData, options?: { force?: boolean }) => void;
  resetDemo: () => void;
  /** ล้างเอกสารทั้งหมด คงข้อมูลบริษัท/ผังบัญชี/ผู้ติดต่อ เพื่อยกยอดจากระบบเดิม */
  resetEmpty: () => void;
  /** อ่าน + migrate + ตรวจไฟล์ backup ก่อนกู้คืน (ไม่เปลี่ยนข้อมูล) */
  readBackup: (text: string) => LoadResult;
  problems: string[];
  externalChangeAt: number | null;
  storageError: string | null;
  readOnly: boolean;
};

const AccountingContext = createContext<AccountingContextValue | undefined>(undefined);

type Props = { children: React.ReactNode };

const localOnly = () => {
  throw new BusinessRuleError('ใช้ได้เฉพาะโหมดข้อมูลในเครื่อง (demo) — ข้อมูลบนเซิร์ฟเวอร์แก้ได้ผ่านเอกสารเท่านั้น');
};

type Tools = Pick<AccountingContextValue, 'canUseLocalTools' | 'replace' | 'resetDemo' | 'resetEmpty'>;

const API_TOOLS: Tools = {
  canUseLocalTools: false,
  replace: localOnly,
  resetDemo: localOnly,
  resetEmpty: localOnly,
};

/** เลือก repository ตาม `CONFIG.dataMode` — โหมด api ต้องอยู่ใต้ AuthGuard (ใช้ client + บริษัทที่ login) */
export function AccountingProvider({ children }: Props) {
  const { client, tenant } = useAuth();
  if (CONFIG.dataMode === 'api' && client) {
    // เปลี่ยนบริษัท = สมุดใหม่ทั้งก้อน (key ทำให้ repository ถูกสร้างใหม่)
    return (
      <ApiAccountingProvider key={tenant?.id ?? 'none'} client={client}>
        {children}
      </ApiAccountingProvider>
    );
  }
  return <LocalAccountingProvider>{children}</LocalAccountingProvider>;
}

function LocalAccountingProvider({ children }: Props) {
  const [repo] = useState<LocalRepository>(() =>
    createLocalRepository(
      createAccountingStore({
        storage: localStorageAvailable() ? window.localStorage : null,
        fallback: () => buildDemoData(),
      })
    )
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => repo.store.handleStorageEvent(event.key, event.newValue);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [repo]);

  const tools = useMemo<Tools>(
    () => ({
      canUseLocalTools: true,
      replace: repo.store.replace,
      resetDemo: repo.store.resetDemo,
      resetEmpty: repo.store.resetEmpty,
    }),
    [repo]
  );

  return (
    <RepositoryContext repo={repo} client={null} tools={tools}>
      {children}
    </RepositoryContext>
  );
}

function ApiAccountingProvider({ children, client }: Props & { client: ApiClient }) {
  const [repo] = useState<AccountingRepository>(() => createApiRepository({ client }));

  useEffect(() => {
    repo.reload().catch(() => undefined);
    // กลับมาที่แท็บ = โหลดสมุดใหม่ (ผู้ใช้คนอื่นอาจบันทึกระหว่างนั้น)
    const onVisible = () => {
      if (document.visibilityState === 'visible') repo.reload().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [repo]);

  return (
    <RepositoryContext repo={repo} client={client} tools={API_TOOLS}>
      {children}
    </RepositoryContext>
  );
}

function RepositoryContext({ repo, client, tools, children }: Props & { repo: AccountingRepository; client: ApiClient | null; tools: Tools }) {
  const snap = useSyncExternalStore(repo.subscribe, repo.getSnapshot);
  const [pending, setPending] = useState(0);

  const run = useCallback(
    async <R extends object>(command: Command<R>): Promise<R> => {
      setPending((n) => n + 1);
      try {
        return await repo.execute(command);
      } finally {
        setPending((n) => n - 1);
      }
    },
    [repo]
  );

  const value = useMemo<AccountingContextValue | null>(
    () =>
      snap.data
        ? {
            mode: repo.mode,
            data: snap.data,
            run,
            busy: pending > 0,
            revision: snap.revision,
            reload: repo.reload,
            client,
            ...tools,
            readBackup: readAccountingJson,
            problems: snap.problems,
            externalChangeAt: snap.externalChangeAt,
            storageError: snap.storageError,
            readOnly: snap.readOnly,
          }
        : null,
    [snap, repo, run, pending, client, tools]
  );

  if (!value) {
    if (snap.status === 'error') {
      return (
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
          }}
        >
          <EmptyContent
            filled
            title="โหลดข้อมูลบัญชีไม่สำเร็จ"
            description={snap.error ?? undefined}
            action={
              <Button variant="contained" sx={{ mt: 2 }} onClick={() => repo.reload().catch(() => undefined)}>
                ลองใหม่
              </Button>
            }
            sx={{ maxWidth: 480, py: 6 }}
          />
        </Box>
      );
    }
    return <LoadingScreen sx={{ minHeight: '100vh' }} />;
  }

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>;
}

export function useAccounting(): AccountingContextValue {
  const ctx = useContext(AccountingContext);
  if (!ctx) throw new Error('useAccounting ต้องอยู่ใต้ <AccountingProvider>');
  return ctx;
}
