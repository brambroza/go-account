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

export const SignupSchema = zod.object({
  displayName: zod.string().trim().min(1, { message: 'กรอกชื่อผู้ใช้' }).max(100),
  email,
  password: zod.string().min(10, { message: 'รหัสผ่านอย่างน้อย 10 ตัวอักษร' }).max(128),
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
