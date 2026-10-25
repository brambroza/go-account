import { z as zod } from 'zod';

import { normalizeTaxId, isValidThaiTaxId } from 'src/domain';

// ----------------------------------------------------------------------
// ฟอร์ม login / สมัครบริษัท / เชิญสมาชิก (โหมด api) — กติการหัสผ่านจริงตรวจที่เซิร์ฟเวอร์ (ข้อความไทยกลับมาใน ProblemDetails)
// ----------------------------------------------------------------------

const email = zod
  .string()
  .trim()
  .min(1, { message: 'กรอกอีเมล' })
  .email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });

export const LoginSchema = zod.object({
  email,
  password: zod.string().min(1, { message: 'กรอกรหัสผ่าน' }),
});

export type LoginSchemaType = zod.input<typeof LoginSchema>;

/** รหัสผ่านใหม่ — กติกาเต็ม (คำที่เดาง่าย, ชื่ออีเมล) ตรวจที่เซิร์ฟเวอร์ */
const newPassword = zod
  .string()
  .min(10, { message: 'รหัสผ่านอย่างน้อย 10 ตัวอักษร' })
  .max(128, { message: 'รหัสผ่านไม่เกิน 128 ตัวอักษร' });

export const SignupSchema = zod.object({
  displayName: zod.string().trim().min(1, { message: 'กรอกชื่อผู้ใช้' }).max(100),
  email,
  password: newPassword,
  companyName: zod.string().trim().min(1, { message: 'กรอกชื่อบริษัท' }).max(200),
  taxId: zod
    .string()
    .trim()
    .refine((v) => !v || isValidThaiTaxId(normalizeTaxId(v)), {
      message: 'เลขผู้เสียภาษีไม่ถูกต้อง (13 หลัก ตรวจหลักสุดท้ายไม่ผ่าน)',
    }),
  branchNo: zod
    .string()
    .trim()
    .refine((v) => /^\d{0,5}$/.test(v), { message: 'สาขาเป็นตัวเลขไม่เกิน 5 หลัก' }),
  vatRegistered: zod.boolean(),
});

export type SignupSchemaType = zod.input<typeof SignupSchema>;

export const InviteSchema = zod.object({
  email,
  role: zod.enum(['owner', 'accountant', 'viewer']),
});

export type InviteSchemaType = zod.input<typeof InviteSchema>;

/** ลืมรหัสผ่าน / ส่งลิงก์ยืนยันอีเมลใหม่ (ยังไม่ login) */
export const EmailOnlySchema = zod.object({ email });

export type EmailOnlySchemaType = zod.input<typeof EmailOnlySchema>;

const MISMATCH = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';

/** ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล */
export const ResetPasswordSchema = zod
  .object({ password: newPassword, confirm: zod.string().min(1, { message: 'กรอกรหัสผ่านอีกครั้ง' }) })
  .refine((v) => v.password === v.confirm, { message: MISMATCH, path: ['confirm'] });

export type ResetPasswordSchemaType = zod.input<typeof ResetPasswordSchema>;

/** เปลี่ยนรหัสผ่าน (login อยู่) */
export const ChangePasswordSchema = zod
  .object({
    currentPassword: zod.string().min(1, { message: 'กรอกรหัสผ่านปัจจุบัน' }),
    newPassword,
    confirm: zod.string().min(1, { message: 'กรอกรหัสผ่านใหม่อีกครั้ง' }),
  })
  .refine((v) => v.newPassword === v.confirm, { message: MISMATCH, path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน',
    path: ['newPassword'],
  });

export type ChangePasswordSchemaType = zod.input<typeof ChangePasswordSchema>;
