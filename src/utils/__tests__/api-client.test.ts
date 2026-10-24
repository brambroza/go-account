import { ApiError, toApiError, createApiClient, NETWORK_ERROR_MESSAGE, fileNameFromDisposition } from '../api-client';

// ----------------------------------------------------------------------
// C6: HTTP client — cookie (credentials), CSRF double-submit, single-flight refresh, Idempotency-Key คงที่ตอนส่งซ้ำ, ProblemDetails → ApiError
// ----------------------------------------------------------------------

type Recorded = { url: string; init: RequestInit };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function fakeFetch(handler: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

const header = (r: Recorded, name: string) => (r.init.headers as Record<string, string> | undefined)?.[name];

describe('api client', () => {
  it('sends cookies, fetches the CSRF token once for writes and sends the Idempotency-Key', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: 'tok' });
      return json(201, { id: 'x' });
    });
    const client = createApiClient({ baseUrl: '/api/v1', fetch: fn });
    await client.request('/sales/invoices', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k1' });
    await client.request('/sales/invoices', { method: 'POST', body: { a: 2 }, idempotencyKey: 'k2' });
    const posts = calls.filter((c) => c.url.endsWith('/sales/invoices'));
    expect(calls.filter((c) => c.url.endsWith('/auth/csrf'))).toHaveLength(1);
    expect(posts.map((p) => header(p, 'X-CSRF-Token'))).toEqual(['tok', 'tok']);
    expect(posts.map((p) => header(p, 'Idempotency-Key'))).toEqual(['k1', 'k2']);
    expect(posts.every((p) => p.init.credentials === 'include')).toBe(true);
    expect(posts[0].init.body).toBe('{"a":1}');
  });

  it('uses the csrfToken from the session (login) without calling /auth/csrf, and GET carries no CSRF header', async () => {
    const { fn, calls } = fakeFetch(() => json(200, { ok: true }));
    const client = createApiClient({ baseUrl: '/api/v1', fetch: fn });
    client.setSession({ csrfToken: 'from-login' });
    await client.get('/book', { q: 'ก ข', empty: '', none: undefined });
    await client.request('/company', { method: 'PUT', body: {} });
    expect(calls[0].url).toBe('/api/v1/book?q=%E0%B8%81%20%E0%B8%82');
    expect(header(calls[0], 'X-CSRF-Token')).toBeUndefined();
    expect(header(calls[1], 'X-CSRF-Token')).toBe('from-login');
    expect(calls.some((c) => c.url.endsWith('/auth/csrf'))).toBe(false);
  });

  it('refreshes once for concurrent 401s (single-flight) then retries each request with the same key', async () => {
    let refreshed = false;
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: 'c0' });
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return json(200, { csrfToken: 'c1' });
      }
      return refreshed ? json(200, { ok: url }) : json(401, { title: 'ไม่ได้เข้าสู่ระบบ' });
    });
    const client = createApiClient({ baseUrl: '', fetch: fn });
    const [a, b] = await Promise.all([
      client.request<{ ok: string }>('/a', { method: 'POST', body: {}, idempotencyKey: 'ka' }),
      client.request<{ ok: string }>('/b'),
    ]);
    expect(a.ok).toBe('/a');
    expect(b.ok).toBe('/b');
    expect(calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
    const aCalls = calls.filter((c) => c.url === '/a');
    expect(aCalls.map((c) => header(c, 'Idempotency-Key'))).toEqual(['ka', 'ka']);
    expect(header(aCalls[1], 'X-CSRF-Token')).toBe('c1');
  });

  it('calls onUnauthenticated when refresh fails', async () => {
    const onUnauthenticated = jest.fn();
    const { fn } = fakeFetch((url) => (url.endsWith('/auth/csrf') ? json(401, {}) : json(401, { detail: 'หมดเวลา' })));
    const client = createApiClient({ baseUrl: '', fetch: fn, onUnauthenticated });
    await expect(client.get('/book')).rejects.toMatchObject({ status: 401, message: 'หมดเวลา' });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(await client.refresh()).toBe(false);
  });

  it('noRefresh (login) does not refresh on 401', async () => {
    const onUnauthenticated = jest.fn();
    const { fn, calls } = fakeFetch(() => json(401, { detail: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }));
    const client = createApiClient({ baseUrl: '', fetch: fn, onUnauthenticated });
    await expect(client.request('/auth/login', { method: 'POST', body: {}, noRefresh: true })).rejects.toThrow('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(calls.some((c) => c.url === '/auth/refresh')).toBe(false);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('retries a command once after a network failure with the same key; GET retries too', async () => {
    const { fn, calls } = fakeFetch((url, _init, n) => {
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: 't' });
      if (n <= 2) throw new TypeError('Failed to fetch');
      return json(200, { ok: true });
    });
    const client = createApiClient({ baseUrl: '', fetch: fn });
    await client.request('/payments', { method: 'POST', body: {}, idempotencyKey: 'same' });
    expect(calls.filter((c) => c.url === '/payments').map((c) => header(c, 'Idempotency-Key'))).toEqual(['same', 'same']);
  });

  it('does not blindly resend a write without a key, and reports a Thai network error', async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: 't' });
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient({ baseUrl: '', fetch: fn });
    await expect(client.request('/x', { method: 'DELETE' })).rejects.toMatchObject({ status: 0, code: 'NETWORK', message: NETWORK_ERROR_MESSAGE });
    expect(calls.filter((c) => c.url === '/x')).toHaveLength(1);
  });

  it('a stale CSRF token (403 csrf) is re-fetched and the request retried once', async () => {
    let csrfCalls = 0;
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/auth/csrf')) {
        csrfCalls += 1;
        return json(200, { csrfToken: `t${csrfCalls}` });
      }
      const sent = calls[calls.length - 1];
      return header(sent, 'X-CSRF-Token') === 't2'
        ? json(204, undefined)
        : json(403, { detail: 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย (CSRF) กรุณารีเฟรชหน้าแล้วลองใหม่' });
    });
    const client = createApiClient({ baseUrl: '', fetch: fn });
    await expect(client.request('/bank-matches/1', { method: 'DELETE' })).resolves.toBeUndefined();
    expect(csrfCalls).toBe(2);
  });

  it('403 for role is not retried', async () => {
    const { fn, calls } = fakeFetch((url) => (url.endsWith('/auth/csrf') ? json(200, { csrfToken: 't' }) : json(403, { title: 'ไม่มีสิทธิ์' })));
    const client = createApiClient({ baseUrl: '', fetch: fn });
    await expect(client.request('/sales/invoices', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403, message: 'ไม่มีสิทธิ์' });
    expect(calls.filter((c) => c.url === '/sales/invoices')).toHaveLength(1);
  });

  it('downloads a file with the server file name and X-Warnings', async () => {
    const { fn } = fakeFetch(
      () =>
        new Response('H|1\r\n', {
          status: 200,
          headers: {
            'Content-Disposition': "attachment; filename=PND53_x.txt; filename*=UTF-8''PND53_%E0%B8%81.txt",
            'X-Warnings': encodeURIComponent('ก · ข'),
          },
        })
    );
    const client = createApiClient({ baseUrl: '', fetch: fn });
    const file = await client.download('/files/wht/2026-09/pnd53.txt');
    expect(file.fileName).toBe('PND53_ก.txt');
    expect(file.warnings).toEqual(['ก', 'ข']);
    expect(await file.blob.text()).toBe('H|1\r\n');
  });
});

describe('ProblemDetails mapping', () => {
  it('uses detail + code, then validation errors, then title, then a status message', async () => {
    const a = await toApiError(json(422, { title: 'ทำรายการไม่ได้', code: 'AMOUNT_EXCEEDS_OUTSTANDING', detail: 'ยอดรับชำระเกินยอดค้าง', traceId: 't' }));
    expect(a).toBeInstanceOf(ApiError);
    expect(a).toMatchObject({ status: 422, code: 'AMOUNT_EXCEEDS_OUTSTANDING', message: 'ยอดรับชำระเกินยอดค้าง', traceId: 't' });
    const b = await toApiError(json(400, { title: 'One or more validation errors occurred.', errors: { amount: ['ทศนิยมไม่เกิน 2 ตำแหน่ง'] } }));
    expect(b.message).toBe('ทศนิยมไม่เกิน 2 ตำแหน่ง');
    expect(b.fieldErrors).toEqual({ amount: ['ทศนิยมไม่เกิน 2 ตำแหน่ง'] });
    expect((await toApiError(new Response('oops', { status: 429 }))).message).toContain('ถี่เกินไป');
    expect((await toApiError(new Response('', { status: 500 }))).message).toContain('500');
  });

  it('parses Content-Disposition', () => {
    expect(fileNameFromDisposition(null, 'f')).toBe('f');
    expect(fileNameFromDisposition('attachment; filename="IV6910-0001.xml"', 'f')).toBe('IV6910-0001.xml');
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E0%B8", 'f')).toBe('f');
  });
});
