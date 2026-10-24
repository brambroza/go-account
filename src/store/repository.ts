import type { AccountingData } from 'src/domain';
import type { ApiClient, HttpMethod } from 'src/utils/api-client';

import { ApiError } from 'src/utils/api-client';

import type { Command, RemoteContext } from './commands';
import type { AccountingStore, AccountingSnapshot } from './accounting-store';

// ----------------------------------------------------------------------
// AccountingRepository = ที่มาของข้อมูลของหน้าจอ — หน้าจอเห็นแค่ snapshot + `execute(command)` (async ทั้งสองโหมด)
//   local: ห่อ `AccountingStore` (localStorage) เดิม — รัน `command.local` แบบ synchronous แล้วคืน Promise
//   api:   สมุดมาจาก `GET /book` (cache ในหน่วยความจำ) — `execute` เรียก `command.remote` แล้วโหลดสมุดใหม่ (invalidate)
// ----------------------------------------------------------------------

export type RepositoryMode = 'local' | 'api';

export type RepositorySnapshot = {
  status: 'loading' | 'ready' | 'error';
  /** null จนกว่าจะโหลดครั้งแรกสำเร็จ (โหมด api) */
  data: AccountingData | null;
  /** โหลดไม่สำเร็จ (โหมด api) */
  error: string | null;
  /** เพิ่มทุกครั้งที่ข้อมูลเปลี่ยน — ใช้เป็น key ของ cache รายงานจากเซิร์ฟเวอร์ */
  revision: number;
  problems: string[];
  externalChangeAt: number | null;
  storageError: string | null;
  readOnly: boolean;
};

export type AccountingRepository = {
  mode: RepositoryMode;
  getSnapshot: () => RepositorySnapshot;
  subscribe: (listener: () => void) => () => void;
  /** รันคำสั่ง — throw ข้อความไทยถ้าผิดกฎ (local: BusinessRuleError, api: ApiError จาก ProblemDetails) */
  execute: <R extends object>(command: Command<R>) => Promise<R>;
  /** โหลดใหม่จากต้นทาง (api: GET /book; local: ไม่ทำอะไร) */
  reload: () => Promise<void>;
};

// ---------------- local ----------------

export type LocalRepository = AccountingRepository & { store: AccountingStore };

export function createLocalRepository(store: AccountingStore): LocalRepository {
  let lastStore: AccountingSnapshot | null = null;
  let snapshot: RepositorySnapshot;
  let revision = 0;

  const map = (s: AccountingSnapshot): RepositorySnapshot => {
    if (lastStore && s.data !== lastStore.data) revision += 1;
    lastStore = s;
    return {
      status: 'ready',
      data: s.data,
      error: null,
      revision,
      problems: s.problems,
      externalChangeAt: s.externalChangeAt,
      storageError: s.storageError,
      readOnly: s.readOnly,
    };
  };
  snapshot = map(store.getSnapshot());

  return {
    mode: 'local',
    store,
    getSnapshot: () => {
      const current = store.getSnapshot();
      if (current !== lastStore) snapshot = map(current);
      return snapshot;
    },
    subscribe: store.subscribe,
    execute: async (command) => store.run(command.local),
    reload: async () => undefined,
  };
}

// ---------------- api ----------------

export type ApiRepositoryOptions = {
  client: ApiClient;
  /** สร้าง Idempotency-Key ใหม่ (ค่าเริ่มต้น crypto.randomUUID) */
  newKey?: () => string;
};

const defaultKey = () => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** คำขอที่ไม่แน่ว่าเซิร์ฟเวอร์บันทึกหรือยัง (ไม่ได้ response / 5xx / 409 คำขอเดิมยังไม่จบ) — กดซ้ำต้องใช้ key เดิม */
export function isUncertainFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500 || error.status === 409;
}

export function createApiRepository({
  client,
  newKey = defaultKey,
}: ApiRepositoryOptions): AccountingRepository {
  const listeners = new Set<() => void>();
  let snapshot: RepositorySnapshot = {
    status: 'loading',
    data: null,
    error: null,
    revision: 0,
    problems: [],
    externalChangeAt: null,
    storageError: null,
    readOnly: false,
  };
  /** fingerprint ของคำสั่ง → key ที่ใช้ไปแล้วแต่ยังไม่รู้ผลแน่นอน (กดบันทึกซ้ำ = replay ไม่ออกเอกสารซ้ำ) */
  const pendingKeys = new Map<string, string>();
  let loading: Promise<AccountingData> | null = null;

  const set = (patch: Partial<RepositorySnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };

  const fetchBook = (): Promise<AccountingData> => {
    if (!loading) {
      loading = client
        .get<AccountingData>('/book')
        .then((data) => {
          set({ status: 'ready', data, error: null, revision: snapshot.revision + 1 });
          return data;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ';
          // มีข้อมูลเดิมแล้ว = ใช้ต่อ (แจ้งผ่าน error ของคำสั่ง) ; ยังไม่เคยโหลด = หน้าจอ error + ปุ่มลองใหม่
          if (!snapshot.data) set({ status: 'error', error: message });
          throw error;
        })
        .finally(() => {
          loading = null;
        });
    }
    return loading;
  };

  return {
    mode: 'api',
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload: async () => {
      await fetchBook();
    },
    execute: async (command) => {
      const before = snapshot.data;
      if (!before) throw new ApiError(0, 'ยังโหลดข้อมูลไม่เสร็จ — รอสักครู่แล้วลองใหม่');
      const key = pendingKeys.get(command.fingerprint) ?? newKey();
      pendingKeys.set(command.fingerprint, key);
      let committed = false;
      const ctx: RemoteContext = {
        before,
        client,
        send: async <T>(method: HttpMethod, path: string, body?: unknown, part?: string) => {
          const res = await client.request<T>(path, {
            method,
            body,
            idempotencyKey: part ? `${key}:${part}` : key,
          });
          committed = true;
          return res;
        },
        reload: fetchBook,
      };
      try {
        const result = await command.remote(ctx);
        pendingKeys.delete(command.fingerprint);
        return result;
      } catch (error) {
        // ผิดกติกา (4xx) = เซิร์ฟเวอร์ไม่เก็บ key → ทิ้งได้; ไม่แน่ใจผล หรือบันทึกแล้วแต่โหลดสมุดใหม่ไม่ได้ → เก็บ key ไว้ให้กดซ้ำ
        if (!committed && !isUncertainFailure(error)) pendingKeys.delete(command.fingerprint);
        throw error;
      }
    },
  };
}
