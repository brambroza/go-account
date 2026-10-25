// ----------------------------------------------------------------------
// token ในลิงก์อีเมล (`/verify-email#token=…`, `/reset-password#token=…`, `/accept-invite#token=…`)
// อยู่หลัง # — ไม่ถูกส่งไปเซิร์ฟเวอร์ของหน้าเว็บ/Referer/log
// ----------------------------------------------------------------------

/** token 32 bytes แบบ base64url (43 ตัว) จาก fragment — รูปแบบไม่ถูกต้องคืน '' */
export function tokenFromHash(hash: string): string {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}

/** token จาก URL ปัจจุบัน (pure — ใช้ใน useState initializer ได้แม้ StrictMode เรียกซ้ำ) */
export function tokenFromLocation(): string {
  return tokenFromHash(window.location.hash);
}

/** ลบ fragment (token) ออกจาก URL/history — เรียกใน useEffect หลังอ่าน token แล้ว (token ไม่ค้างในประวัติ/การแชร์หน้าจอ) */
export function clearLocationHash(): void {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }
}
