import type { Address } from 'src/domain';

// ----------------------------------------------------------------------
// สัญญา auth ของ go-account-api (C3) — ดู go-account-api/README.md "Auth (C3)"
// ----------------------------------------------------------------------

/** viewer อ่านอย่างเดียว ⊂ accountant ลงเอกสาร/บัญชี ⊂ owner จัดการสมาชิก/บริษัท/ปิดงวด */
export type Role = 'owner' | 'accountant' | 'viewer';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'เจ้าของ',
  accountant: 'พนักงานบัญชี',
  viewer: 'ดูอย่างเดียว',
};

/** `emailVerified: false` = ยังไม่ยืนยันอีเมล — อ่านได้ แต่บันทึก/แก้ข้อมูลไม่ได้ (เซิร์ฟเวอร์ตอบ 403 `EMAIL_NOT_VERIFIED`) */
export type SessionUser = { id: string; email: string; displayName: string; emailVerified: boolean };

/** code ของ ProblemDetails ฝั่ง auth (D2) */
export const AUTH_CODES = {
  emailNotVerified: 'EMAIL_NOT_VERIFIED',
  tokenInvalid: 'TOKEN_INVALID',
  wrongPassword: 'WRONG_PASSWORD',
} as const;

/** คำตอบของคำขอที่ตอบเหมือนกันทุกกรณี (สมัคร / ลืมรหัสผ่าน / ส่งลิงก์ยืนยันใหม่) — ไม่บอกว่าอีเมลมีบัญชีหรือไม่ */
export type AcceptedResponse = { message: string };

/** บริษัทที่ผู้ใช้เป็นสมาชิก (`tenant.id` เป็น uuid) */
export type Membership = { id: string; name: string; role: Role };

export type SessionResponse = {
  user: SessionUser;
  tenant: { id: string; role: Role } | null;
  csrfToken: string;
  accessTokenExpiresAt: string;
};

export type SignupInput = {
  email: string;
  password: string;
  displayName: string;
  company: {
    name: string;
    taxId?: string;
    branchNo?: string;
    vatRegistered: boolean;
    address?: Address;
    phone?: string;
  };
};

export type Member = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  joinedAt: string;
};

export type Invitation = { id: string; email: string; role: Role; expiresAt: string };

/** คำเชิญที่รอตอบรับ (`GET /tenant/members/invitations`) — `expired` = หมดอายุแล้ว ส่งใหม่ได้ */
export type PendingInvitation = Invitation & { createdAt: string; invitedBy: string; expired: boolean };

/** สิทธิ์ของบทบาท — หน้าจอซ่อนปุ่มตามนี้ (เซิร์ฟเวอร์บังคับซ้ำทุกคำขอ) */
export function permissionsOf(role: Role | null) {
  return {
    role,
    /** บันทึกเอกสาร/รายการบัญชี */
    canWrite: role === 'owner' || role === 'accountant',
    /** จัดการสมาชิก แก้ข้อมูลบริษัท ปิดงวด/ปิดปี */
    isOwner: role === 'owner',
  };
}

export type Permissions = ReturnType<typeof permissionsOf>;
