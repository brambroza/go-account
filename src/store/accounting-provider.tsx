import type { AccountingData } from 'src/domain';

import { useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { localStorageGetItem } from 'src/utils/storage-available';

import { buildDemoData } from './seed';

// ----------------------------------------------------------------------
// ที่เก็บข้อมูลชั่วคราวฝั่ง browser (localStorage) สำหรับต้นแบบ
// หน้าจอเรียกผ่าน `useAccounting()` เท่านั้น — ตอนต่อ backend ให้เปลี่ยน `run`
// เป็นการเรียก API แล้ว refetch โดยที่หน้าจอไม่ต้องแก้
// ----------------------------------------------------------------------

const STORAGE_KEY = 'go-account:data:v1';

type Mutation<R> = (state: AccountingData) => { state: AccountingData } & R;

export type AccountingContextValue = {
  data: AccountingData;
  /** รัน action แบบ pure แล้วบันทึกผล — throw ต่อถ้า action ผิดกฎธุรกิจ */
  run: <R extends object>(mutation: Mutation<R>) => R;
  /** แทนที่ทั้งก้อน (เช่น update company) */
  replace: (next: AccountingData) => void;
  resetDemo: () => void;
};

const AccountingContext = createContext<AccountingContextValue | undefined>(undefined);

function load(): AccountingData {
  try {
    const raw = localStorageGetItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AccountingData;
      if (parsed?.version === 1) return parsed;
    }
  } catch (error) {
    console.error('อ่านข้อมูลเดิมไม่สำเร็จ สร้างข้อมูลตัวอย่างใหม่', error);
  }
  return buildDemoData();
}

type Props = { children: React.ReactNode };

export function AccountingProvider({ children }: Props) {
  const [data, setData] = useState<AccountingData>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('บันทึกข้อมูลลงเครื่องไม่สำเร็จ', error);
    }
  }, [data]);

  const run = useCallback(
    <R extends object>(mutation: Mutation<R>): R => {
      // คำนวณจาก state ปัจจุบันแบบ synchronous เพื่อให้ error ส่งกลับไปที่ผู้เรียกได้ทันที
      const result = mutation(data);
      setData(result.state);
      return result;
    },
    [data]
  );

  const replace = useCallback((next: AccountingData) => setData(next), []);

  const resetDemo = useCallback(() => setData(buildDemoData()), []);

  const value = useMemo(() => ({ data, run, replace, resetDemo }), [data, run, replace, resetDemo]);

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>;
}

export function useAccounting(): AccountingContextValue {
  const ctx = useContext(AccountingContext);
  if (!ctx) throw new Error('useAccounting ต้องอยู่ใต้ <AccountingProvider>');
  return ctx;
}
