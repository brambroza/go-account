import {
  LoginSchema,
  SignupSchema,
  EmailOnlySchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
} from 'src/schemas/auth/auth-schemas';

// ----------------------------------------------------------------------
// ฟอร์ม auth (D2): ลืมรหัสผ่าน, ตั้งรหัสผ่านใหม่, เปลี่ยนรหัสผ่าน — ข้อความไทยต่อช่อง (กติกาเต็มอยู่ที่เซิร์ฟเวอร์)
// ----------------------------------------------------------------------

/** ข้อความแรกของแต่ละช่อง (แบบที่ zodResolver ส่งให้ฟอร์มแสดง) */
const messages = (r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) => {
  const out: Record<string, string> = {};
  (r.error?.issues ?? []).forEach((i) => {
    const key = i.path.join('.');
    if (!(key in out)) out[key] = i.message;
  });
  return out;
};

describe('auth schemas (D2)', () => {
  it('email-only form trims and validates the address', () => {
    expect(EmailOnlySchema.safeParse({ email: '  a@example.com ' }).success).toBe(true);
    expect(messages(EmailOnlySchema.safeParse({ email: '' }))).toEqual({ email: 'กรอกอีเมล' });
    expect(messages(EmailOnlySchema.safeParse({ email: 'nope' }))).toEqual({ email: 'รูปแบบอีเมลไม่ถูกต้อง' });
  });

  it('reset password requires 10–128 chars and a matching confirmation', () => {
    expect(ResetPasswordSchema.safeParse({ password: 'กาแฟเย็นหวานน้อย', confirm: 'กาแฟเย็นหวานน้อย' }).success).toBe(true);
    expect(messages(ResetPasswordSchema.safeParse({ password: 'short', confirm: 'short' }))).toEqual({
      password: 'รหัสผ่านอย่างน้อย 10 ตัวอักษร',
    });
    expect(messages(ResetPasswordSchema.safeParse({ password: 'x'.repeat(129), confirm: 'x'.repeat(129) }))).toEqual({
      password: 'รหัสผ่านไม่เกิน 128 ตัวอักษร',
    });
    expect(messages(ResetPasswordSchema.safeParse({ password: 'กาแฟเย็นหวานน้อย', confirm: 'กาแฟเย็นหวานมาก' }))).toEqual({
      confirm: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
    });
    expect(messages(ResetPasswordSchema.safeParse({ password: 'กาแฟเย็นหวานน้อย', confirm: '' }))).toMatchObject({
      confirm: 'กรอกรหัสผ่านอีกครั้ง',
    });
  });

  it('change password needs the current password, a new different one and confirmation', () => {
    const ok = { currentPassword: 'old-password-1', newPassword: 'new-password-2', confirm: 'new-password-2' };
    expect(ChangePasswordSchema.safeParse(ok).success).toBe(true);
    expect(messages(ChangePasswordSchema.safeParse({ ...ok, currentPassword: '' }))).toEqual({
      currentPassword: 'กรอกรหัสผ่านปัจจุบัน',
    });
    expect(messages(ChangePasswordSchema.safeParse({ ...ok, confirm: 'new-password-3' }))).toEqual({
      confirm: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
    });
    expect(
      messages(ChangePasswordSchema.safeParse({ currentPassword: 'same-password', newPassword: 'same-password', confirm: 'same-password' }))
    ).toEqual({ newPassword: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน' });
  });

  it('signup and login keep their rules', () => {
    expect(LoginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
    const signup = {
      displayName: 'สมชาย',
      email: 'a@example.com',
      password: 'กาแฟเย็นหวานน้อย',
      companyName: 'บริษัท ทดสอบ จำกัด',
      taxId: '',
      branchNo: '00000',
      vatRegistered: true,
    };
    expect(SignupSchema.safeParse(signup).success).toBe(true);
    expect(messages(SignupSchema.safeParse({ ...signup, password: 'short' }))).toEqual({
      password: 'รหัสผ่านอย่างน้อย 10 ตัวอักษร',
    });
  });
});
