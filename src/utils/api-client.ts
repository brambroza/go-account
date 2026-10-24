// ----------------------------------------------------------------------
// HTTP client ของ go-account-api (โหมด `VITE_DATA_MODE=api`) — fetch ล้วน ไม่ผูก React ทดสอบได้ด้วย fetch ปลอม
//
// - cookie httpOnly (`__Host-ga_at`, `__Secure-ga_rt`, `__Host-ga_csrf`) → `credentials: 'include'`; หน้าเว็บอ่าน cookie ไม่ได้
// - CSRF double-submit: ค่า token มาจาก response ของ login/signup/refresh (`csrfToken`) หรือ `GET /auth/csrf` เมื่อยังไม่มี (รีเฟรชหน้า)
//   ส่งเป็น header `X-CSRF-Token` ทุกคำขอที่เปลี่ยนข้อมูล; 403 ประเภท csrf = token เก่า → ขอใหม่แล้วลองอีกครั้ง
// - 401 → refresh แบบ single-flight (หลายคำขอพร้อมกันใช้ refresh ครั้งเดียว) แล้วส่งซ้ำ 1 ครั้ง; refresh ไม่ผ่าน = `onUnauthenticated`
// - `Idempotency-Key` ผู้เรียกส่งมาเอง (คงที่ทุกครั้งที่ส่งซ้ำของการกดบันทึกครั้งเดียวกัน) — client ไม่สร้างใหม่ตอน retry
// - error → `ApiError` ที่ `message` = `detail` ภาษาไทยของ ProblemDetails (หน้าจอแสดงได้ทันที) + `code` สำหรับแยกกรณี
// ----------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** ข้อผิดพลาดจาก API — `message` แสดงผู้ใช้ได้, `code` เทียบ `ERROR_CODES` ของ golden / C# */
export class ApiError extends Error {
  readonly status: number;

  readonly code?: string;

  /** validation รูปแบบ (400) แยกตาม field */
  readonly fieldErrors?: Record<string, string[]>;

  readonly traceId?: string;

  constructor(
    status: number,
    message: string,
    extra: { code?: string; fieldErrors?: Record<string, string[]>; traceId?: string } = {}
  ) {
    super(message);
    // target ES5 (jest/ts-jest) ไม่ต่อ prototype ของ subclass ของ Error ให้ — ไม่ตั้งเอง instanceof ApiError จะเป็น false
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ApiError';
    this.status = status;
    this.code = extra.code;
    this.fieldErrors = extra.fieldErrors;
    this.traceId = extra.traceId;
  }
}

/** ข้อความเมื่อไม่ได้รับ response (เครือข่าย/เซิร์ฟเวอร์ล่ม) — คำสั่งยังไม่แน่ว่าบันทึกหรือไม่ จึงต้องส่งซ้ำด้วย key เดิม */
export const NETWORK_ERROR_MESSAGE =
  'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วกดบันทึกอีกครั้ง (ระบบกันบันทึกซ้ำให้)';

export type SessionPayload = { csrfToken?: string };

export type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** คงที่ต่อการกดบันทึกหนึ่งครั้ง — ส่งซ้ำ (refresh / เครือข่ายหลุด) ใช้ key เดิม */
  idempotencyKey?: string;
  /** คำขอ auth เอง (login/refresh) — 401 ไม่ต้อง refresh */
  noRefresh?: boolean;
};

export type DownloadedFile = { blob: Blob; fileName: string; warnings: string[] };

export type ApiClient = {
  readonly baseUrl: string;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  get: <T>(path: string, query?: RequestOptions['query']) => Promise<T>;
  /** ดาวน์โหลดไฟล์ (CSV / .txt / XML) — ชื่อไฟล์จาก Content-Disposition, คำเตือนจาก `X-Warnings` */
  download: (path: string) => Promise<DownloadedFile>;
  /** เก็บ csrfToken จาก response ของ login/signup/switch-tenant */
  setSession: (session: SessionPayload | null) => void;
  /** refresh access token (single-flight) — คืน true ถ้าสำเร็จ */
  refresh: () => Promise<boolean>;
};

export type ApiClientOptions = {
  /** เช่น `/api/v1` หรือ `https://api.example.com/api/v1` (ไม่มี / ท้าย) */
  baseUrl: string;
  fetch?: typeof fetch;
  /** refresh ไม่ผ่าน / ไม่มี session — ให้แอปพาไปหน้า login */
  onUnauthenticated?: () => void;
};

const UNSAFE: HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** แปลง ProblemDetails เป็น `ApiError` — ไม่มี detail ใช้ title / ข้อความตาม status */
export async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const p = isRecord(body) ? body : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  let fieldErrors: Record<string, string[]> | undefined;
  if (isRecord(p.errors)) {
    fieldErrors = Object.fromEntries(
      Object.entries(p.errors).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
      ])
    );
  }
  const firstField = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
  const fallback: Record<number, string> = {
    401: 'ยังไม่ได้เข้าสู่ระบบหรือหมดเวลาใช้งาน — เข้าสู่ระบบอีกครั้ง',
    403: 'ไม่มีสิทธิ์ทำรายการนี้',
    404: 'ไม่พบข้อมูล',
    409: 'ข้อมูลถูกเปลี่ยนพร้อมกัน — รีเฟรชแล้วลองอีกครั้ง',
    429: 'ทำรายการถี่เกินไป — รอสักครู่แล้วลองใหม่',
  };
  const message =
    str(p.detail) ??
    firstField ??
    str(p.title) ??
    fallback[res.status] ??
    `เซิร์ฟเวอร์ขัดข้อง (${res.status}) — ลองใหม่อีกครั้ง`;
  return new ApiError(res.status, message, {
    code: str(p.code),
    fieldErrors,
    traceId: str(p.traceId),
  });
}

/** ชื่อไฟล์จาก Content-Disposition (`filename*=UTF-8''…` ก่อน `filename=`) */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* ใช้ filename= แทน */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

export function createApiClient({
  baseUrl,
  fetch: fetchImpl,
  onUnauthenticated,
}: ApiClientOptions): ApiClient {
  const doFetch: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  let csrf: string | null = null;
  let csrfLoading: Promise<string | null> | null = null;
  let refreshing: Promise<boolean> | null = null;

  const url = (path: string, query?: RequestOptions['query']) => {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
  };

  /** CSRF token ปัจจุบัน — ไม่มีให้ขอจาก `/auth/csrf` (ยังไม่ login = null ไม่ต้องส่ง header) */
  const ensureCsrf = async (): Promise<string | null> => {
    if (csrf) return csrf;
    if (!csrfLoading) {
      csrfLoading = (async () => {
        try {
          const res = await doFetch(url('/auth/csrf'), {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) return null;
          const body: unknown = await res.json();
          csrf = isRecord(body) && typeof body.csrfToken === 'string' ? body.csrfToken : null;
          return csrf;
        } catch {
          return null;
        } finally {
          csrfLoading = null;
        }
      })();
    }
    return csrfLoading;
  };

  const refresh = (): Promise<boolean> => {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const token = await ensureCsrf();
          const res = await doFetch(url('/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
          });
          if (!res.ok) {
            csrf = null;
            return false;
          }
          const body: unknown = await res.json();
          if (isRecord(body) && typeof body.csrfToken === 'string') csrf = body.csrfToken;
          return true;
        } catch {
          return false;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  };

  type Retried = { network?: boolean; auth?: boolean; csrf?: boolean };

  /**
   * ส่งคำขอ แล้วส่งซ้ำได้ไม่เกินอย่างละครั้ง: เครือข่ายหลุด (GET หรือคำสั่งที่มี key เท่านั้น), 401 → refresh, 403 csrf → ขอ token ใหม่
   * ทุกครั้งที่ส่งซ้ำใช้ Idempotency-Key เดิม — เซิร์ฟเวอร์ตอบผลเดิมโดยไม่บันทึกซ้ำ
   */
  const send = async (
    path: string,
    options: RequestOptions,
    retried: Retried = {}
  ): Promise<Response> => {
    const method = options.method ?? 'GET';
    const unsafe = UNSAFE.includes(method);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (unsafe) {
      const token = await ensureCsrf();
      if (token) headers['X-CSRF-Token'] = token;
    }
    let res: Response;
    try {
      res = await doFetch(url(path, options.query), {
        method,
        credentials: 'include',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      if (!retried.network && (!unsafe || options.idempotencyKey))
        return send(path, options, { ...retried, network: true });
      throw new ApiError(0, NETWORK_ERROR_MESSAGE, { code: 'NETWORK' });
    }
    if (res.status === 401 && !options.noRefresh && !retried.auth) {
      if (await refresh()) return send(path, options, { ...retried, auth: true });
      onUnauthenticated?.();
      throw await toApiError(res);
    }
    if (res.status === 403 && unsafe && !retried.csrf) {
      const err = await toApiError(res);
      if (!/CSRF/i.test(err.message)) throw err;
      csrf = null;
      return send(path, options, { ...retried, csrf: true });
    }
    if (!res.ok) {
      if (res.status === 401 && !options.noRefresh) onUnauthenticated?.();
      throw await toApiError(res);
    }
    return res;
  };

  const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const res = await send(path, options);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };

  return {
    baseUrl,
    request,
    get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
    download: async (path) => {
      const res = await send(path, {});
      const blob = await res.blob();
      const fallback = path.split('/').pop() ?? 'download';
      const rawWarnings = res.headers.get('X-Warnings');
      let warnings: string[] = [];
      if (rawWarnings) {
        try {
          warnings = decodeURIComponent(rawWarnings).split(' · ').filter(Boolean);
        } catch {
          warnings = [rawWarnings];
        }
      }
      return {
        blob,
        fileName: fileNameFromDisposition(res.headers.get('Content-Disposition'), fallback),
        warnings,
      };
    },
    setSession: (session) => {
      csrf = session?.csrfToken ?? null;
    },
    refresh,
  };
}
