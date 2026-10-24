import type { AccountingData } from 'src/domain';

import { validateAccountingData } from 'src/domain';

import { BusinessRuleError } from './actions';
import { readAccountingJson } from './migrations';

// ----------------------------------------------------------------------
// ที่เก็บข้อมูลฝั่ง browser แบบ external store (ไม่ผูก React) — ทดสอบได้ด้วย storage ปลอม
//
// - `run` คำนวณจาก state ล่าสุดเสมอ (ไม่ใช่ค่าใน closure ของ render) เรียกซ้อนใน tick เดียวก็ได้เลขต่อกัน
// - บันทึกลง storage ทันทีแบบ synchronous ใน `run`
// - กันหลายแท็บเขียนทับกัน: ก่อน `run` ทุกครั้งเทียบค่าใน storage กับค่าที่เราเขียน/อ่านล่าสุด
//   ถ้าแท็บอื่นเปลี่ยน ให้โหลดของใหม่ก่อนแล้วค่อยรัน action บนข้อมูลนั้น (action ตรวจกติกาซ้ำบนข้อมูลใหม่)
//   และรับ event `storage` เพื่ออัปเดตหน้าจอทันทีที่แท็บอื่นบันทึก
// - TODO(Phase C): `run` ยังเป็น synchronous — ตอนต่อ backend เปลี่ยนเป็น `Promise<R>` แล้วออกเลขที่ใน transaction ฝั่งเซิร์ฟเวอร์
// ----------------------------------------------------------------------

export const STORAGE_KEY = 'go-account:data:v1';

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type Mutation<R> = (state: AccountingData) => { state: AccountingData } & R;

export type AccountingSnapshot = {
  data: AccountingData;
  /** ปัญหาที่พบตอนโหลด/รับข้อมูลจากแท็บอื่น — ข้อมูลยังใช้ได้ แต่หน้าจอควรแจ้งผู้ใช้ */
  problems: string[];
  /** เวลา (ms) ที่โหลดข้อมูลใหม่เพราะแท็บอื่นแก้ไข — หน้าจอใช้แจ้งเตือน */
  externalChangeAt: number | null;
  /** บันทึกลงเครื่องไม่สำเร็จ (เช่น พื้นที่เต็ม) — ข้อมูลยังอยู่ในหน่วยความจำ */
  storageError: string | null;
};

export type AccountingStore = {
  getSnapshot: () => AccountingSnapshot;
  subscribe: (listener: () => void) => () => void;
  run: <R extends object>(mutation: Mutation<R>) => R;
  /** แทนที่ทั้งก้อน — ตรวจ invariant ก่อน ถ้าไม่ผ่าน throw (ส่ง `force` เมื่อผู้ใช้ยืนยันแล้วเท่านั้น) */
  replace: (next: AccountingData, options?: { force?: boolean }) => void;
  resetDemo: () => void;
  /** เรียกจาก event `storage` ของ window */
  handleStorageEvent: (key: string | null, newValue: string | null) => void;
};

type Options = {
  storage: StorageLike | null;
  fallback: () => AccountingData;
  key?: string;
  now?: () => number;
};

/** สร้าง store — โหลดข้อมูลเดิม (migrate + ตรวจ) ถ้าอ่านไม่ได้เก็บสำเนาไว้ก่อนแล้วใช้ข้อมูลตัวอย่าง */
export function createAccountingStore({ storage, fallback, key = STORAGE_KEY, now = Date.now }: Options): AccountingStore {
  const listeners = new Set<() => void>();
  let lastRaw: string | null = null;
  let snapshot: AccountingSnapshot;

  const safeGet = (): string | null => {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  };

  const safeSet = (k: string, value: string): string | null => {
    try {
      storage?.setItem(k, value);
      return null;
    } catch (error) {
      return `บันทึกข้อมูลลงเครื่องไม่สำเร็จ: ${error instanceof Error ? error.message : ''}`;
    }
  };

  const notify = () => listeners.forEach((l) => l());

  const persist = (data: AccountingData): string | null => {
    const raw = JSON.stringify(data);
    const error = safeSet(key, raw);
    if (!error) lastRaw = raw;
    return error;
  };

  const commit = (data: AccountingData, extra: Partial<AccountingSnapshot> = {}) => {
    const storageError = persist(data);
    snapshot = { ...snapshot, ...extra, data, storageError };
    notify();
  };

  // ---------------- โหลดครั้งแรก ----------------
  const initialRaw = safeGet();
  if (initialRaw === null) {
    snapshot = { data: fallback(), problems: [], externalChangeAt: null, storageError: null };
    snapshot = { ...snapshot, storageError: persist(snapshot.data) };
  } else {
    const loaded = readAccountingJson(initialRaw);
    if (loaded.data) {
      snapshot = { data: loaded.data, problems: loaded.problems, externalChangeAt: null, storageError: null };
      lastRaw = initialRaw;
      if (loaded.migratedFrom !== undefined) {
        // เก็บต้นฉบับเวอร์ชันเก่าไว้ก่อนเขียนทับด้วยเวอร์ชันใหม่
        safeSet(`${key}:backup-v${loaded.migratedFrom}`, initialRaw);
        snapshot = { ...snapshot, storageError: persist(loaded.data) };
      }
    } else {
      const backupKey = `${key}:unreadable-${now()}`;
      safeSet(backupKey, initialRaw);
      snapshot = {
        data: fallback(),
        problems: [`อ่านข้อมูลเดิมไม่ได้ — เก็บสำเนาไว้ที่ ${backupKey} แล้วเปิดด้วยข้อมูลตัวอย่าง`, ...loaded.problems],
        externalChangeAt: null,
        storageError: null,
      };
      // ไม่เขียนทับจนกว่าผู้ใช้จะทำรายการแรก
      lastRaw = initialRaw;
    }
  }

  /** โหลดข้อมูลที่แท็บอื่นเขียน — อ่านไม่ได้ให้คงข้อมูลเดิมแล้วแจ้งปัญหา */
  const adoptExternal = (raw: string) => {
    lastRaw = raw;
    const loaded = readAccountingJson(raw);
    if (loaded.data) {
      snapshot = { ...snapshot, data: loaded.data, problems: loaded.problems, externalChangeAt: now() };
    } else {
      snapshot = {
        ...snapshot,
        problems: ['ข้อมูลที่แท็บอื่นบันทึกอ่านไม่ได้ — ใช้ข้อมูลเดิมในแท็บนี้ต่อ', ...loaded.problems],
        externalChangeAt: now(),
      };
    }
    notify();
  };

  const syncIfChanged = () => {
    const raw = safeGet();
    if (raw !== null && raw !== lastRaw) adoptExternal(raw);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run: <R extends object>(mutation: Mutation<R>): R => {
      syncIfChanged();
      // คำนวณแบบ synchronous จาก state ล่าสุด เพื่อให้ error ส่งกลับไปที่ผู้เรียกได้ทันที
      const result = mutation(snapshot.data);
      commit(result.state);
      return result;
    },
    replace: (next, options = {}) => {
      const problems = validateAccountingData(next);
      if (problems.length && !options.force) {
        throw new BusinessRuleError(`ข้อมูลไม่ผ่านการตรวจ ${problems.length} ข้อ เช่น ${problems[0]}`);
      }
      commit(next, { problems, externalChangeAt: null });
    },
    resetDemo: () => commit(fallback(), { problems: [], externalChangeAt: null }),
    handleStorageEvent: (eventKey, newValue) => {
      if (eventKey !== key || newValue === null || newValue === lastRaw) return;
      adoptExternal(newValue);
    },
  };
}
