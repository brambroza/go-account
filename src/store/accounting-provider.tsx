import type { AccountingData } from 'src/domain';

import { useMemo, useState, useEffect, useContext, createContext, useSyncExternalStore } from 'react';

import { localStorageAvailable } from 'src/utils/storage-available';

import { buildDemoData } from './seed';
import { readAccountingJson } from './migrations';
import { createAccountingStore } from './accounting-store';

import type { LoadResult } from './migrations';
import type { Mutation } from './accounting-store';

// ----------------------------------------------------------------------
// ที่เก็บข้อมูลชั่วคราวฝั่ง browser (localStorage) สำหรับต้นแบบ — ตรรกะอยู่ใน `accounting-store.ts`
// หน้าจอเรียกผ่าน `useAccounting()` เท่านั้น — ตอนต่อ backend ให้เปลี่ยน `run`
// เป็นการเรียก API แล้ว refetch โดยที่หน้าจอไม่ต้องแก้
// ----------------------------------------------------------------------

export type AccountingContextValue = {
  data: AccountingData;
  /** รัน action แบบ pure บนข้อมูลล่าสุดแล้วบันทึกผล — throw ต่อถ้า action ผิดกฎธุรกิจ */
  run: <R extends object>(mutation: Mutation<R>) => R;
  /** แทนที่ทั้งก้อน (กู้คืน backup) — throw ถ้าไม่ผ่าน `validateAccountingData` เว้นแต่ส่ง `force` */
  replace: (next: AccountingData, options?: { force?: boolean }) => void;
  resetDemo: () => void;
  /** อ่าน + migrate + ตรวจไฟล์ backup ก่อนกู้คืน (ไม่เปลี่ยนข้อมูล) */
  readBackup: (text: string) => LoadResult;
  /** ปัญหาที่พบตอนโหลดข้อมูล */
  problems: string[];
  /** เวลา (ms) ที่ข้อมูลถูกโหลดใหม่เพราะแท็บอื่นแก้ไข */
  externalChangeAt: number | null;
  storageError: string | null;
};

const AccountingContext = createContext<AccountingContextValue | undefined>(undefined);

type Props = { children: React.ReactNode };

export function AccountingProvider({ children }: Props) {
  const [store] = useState(() =>
    createAccountingStore({
      storage: localStorageAvailable() ? window.localStorage : null,
      fallback: () => buildDemoData(),
    })
  );
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => store.handleStorageEvent(event.key, event.newValue);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);

  const value = useMemo<AccountingContextValue>(
    () => ({
      data: snap.data,
      run: store.run,
      replace: store.replace,
      resetDemo: store.resetDemo,
      readBackup: readAccountingJson,
      problems: snap.problems,
      externalChangeAt: snap.externalChangeAt,
      storageError: snap.storageError,
    }),
    [snap, store]
  );

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>;
}

export function useAccounting(): AccountingContextValue {
  const ctx = useContext(AccountingContext);
  if (!ctx) throw new Error('useAccounting ต้องอยู่ใต้ <AccountingProvider>');
  return ctx;
}
