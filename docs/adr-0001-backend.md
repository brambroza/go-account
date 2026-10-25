# ADR-0001 — Backend สำหรับ GO Account (Phase C)

- วันที่: 2026-10-24
- สถานะ: Accepted (ตัดสินโดยเจ้าของโปรเจกต์)

## การตัดสินใจ

| เรื่อง | เลือก | ทางที่ไม่เลือก |
|---|---|---|
| Stack | .NET 9 (ASP.NET Core) + PostgreSQL 16 + EF Core (Npgsql) | Node/Fastify + shared TS core (senior-architect แนะนำ) |
| Repo | แยก repo `go-account-api` (โฟลเดอร์ข้าง `go-account`) | monorepo |
| Auth | ทำเอง: email + password (Argon2id), JWT access + refresh token ใน httpOnly cookie, role ต่อ tenant (owner / accountant / viewer) | Keycloak, Auth0/Clerk |
| Data model | ตาราง relational เต็มรูป (เอกสาร, บรรทัด, รายการบัญชี เป็นแถว) | event log + snapshot |

Convention ตาม `coreapi-26v1`: net9.0, EF Core, Controllers, JwtBearer, Swashbuckle — เปลี่ยน provider เป็น Npgsql

## ผลที่ตามมา และวิธีคุมความเสี่ยง

1. **ตรรกะบัญชีมีสองชุด (TS หน้าเว็บ, C# เซิร์ฟเวอร์)** — ความเสี่ยงหลักคือตัวเลขสองฝั่งไม่ตรงกัน
   - เซิร์ฟเวอร์เป็น source of truth; หน้าเว็บใช้ TS แค่ preview ก่อนบันทึก
   - **Golden vectors**: `go-account/scripts/export-golden.ts` รันตรรกะ TS แล้วเขียน JSON (input → output) ลง `go-account/golden/`
     test ฝั่ง C# อ่านไฟล์เดียวกันและต้องได้ผลตรงทุกตัว — CI ทั้งสอง repo รันชุดนี้
   - เงินเป็นสตางค์ `long` ทั้งระบบ ปัด half-up (ห้าม `decimal` banker's rounding / `Math.Round` ค่า default)
2. **Relational เต็มรูป** — `actions.ts` port เป็น command handler ทีละตัว ใน transaction เดียวกับการออกเลขเอกสาร
   (`doc_sequences ... FOR UPDATE`), idempotency key ต่อคำสั่ง
3. **Multi-tenant** — ทุกตารางมี `tenant_id` + PostgreSQL RLS (`SET LOCAL app.tenant_id` ทุก transaction) และ test ว่าข้าม tenant ไม่ได้
4. **Audit** — `audit_log` append-only + hash chain ต่อ tenant; ห้าม UPDATE/DELETE เอกสารที่ออกแล้วด้วยสิทธิ์ DB
5. **ปิดงวด / ปิดภาษี / integrity** — บังคับที่เซิร์ฟเวอร์ (ปิดช่องที่ localStorage ปิดไม่ได้: R2b, R6a, R10, B3, B4)

## แผนงาน

| ขั้น | ขอบเขต |
|---|---|
| C1 | scaffold repo, docker-compose PG (dev), CI, golden exporter, port ตรรกะ pure (money, tax id, document calc, WHT, bahtText, numbering) + golden tests |
| C2 | schema relational + EF migrations, RLS, doc_sequences, audit_log hash chain |
| C3 | auth + tenant/role, signup บริษัท |
| C4 | port posting + command (ขาย, รับเงิน, ซื้อ, จ่าย, ลด/เพิ่มหนี้, ปิดงวด ...) + golden scenario tests |
| C5 | รายงาน + ไฟล์ ภ.ง.ด. + e-Tax XML + integrity endpoint |
| C6 | หน้าเว็บเปลี่ยน `useAccounting().run` เป็นเรียก API (async), migration ข้อมูลจาก localStorage/backup |
