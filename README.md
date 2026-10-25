# GO Account

โปรแกรมบัญชีบนคลาวด์สำหรับ SME ไทย ใช้งานครบแบบโปรแกรมบัญชี desktop เดิม (เช่น Express) แต่ใช้ง่ายกว่า
และออกไฟล์ให้ตรงรูปแบบที่กรมสรรพากรรับตั้งแต่วันแรก — โดย GO Along Co., Ltd

> **สถานะ: v0.2** ทำงานได้สองโหมด (`VITE_DATA_MODE`): `local` = demo เก็บข้อมูลใน localStorage (ค่าเริ่มต้น) ·
> `api` = ใช้ [go-account-api](../go-account-api) (.NET + PostgreSQL) เป็น source of truth พร้อม login / หลายบริษัท / บทบาท —
> ตรรกะบัญชีใน `src/domain` ใช้แสดงผลและ preview ก่อนบันทึก ตัวเลขฝั่งเซิร์ฟเวอร์ตรงกันด้วย golden vectors

- Stack: React 18 + TypeScript + Vite 5 + MUI v5 / MUI X v7 + react-router v6 (จาก `goalong-mui-starter`)
- Design system: [docs/design-system.md](docs/design-system.md)

## เริ่มใช้งาน

```bash
yarn install
yarn dev        # http://localhost:8081
yarn test       # unit test ของ domain + store
yarn build
```

ครั้งแรกระบบสร้างข้อมูลตัวอย่างให้ (บริษัทสาธิต ลูกค้า ผู้ขาย เอกสาร 3 เดือน) — กดป้าย “ข้อมูลตัวอย่าง” ที่แถบบนเพื่อสร้างใหม่

## โหมด API (`VITE_DATA_MODE=api`)

```bash
# 1) go-account-api: dev DB + API ที่ http://localhost:5070 (ดู README ของ go-account-api)
# 2) หน้าเว็บ
VITE_DATA_MODE=api yarn dev     # http://localhost:8081 → /login, /signup
```

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `VITE_DATA_MODE` | `local` | `local` = demo ในเบราว์เซอร์ (test/preview ใช้โหมดนี้), `api` = เซิร์ฟเวอร์ |
| `VITE_API_BASE_URL` | `/api/v1` | base URL ของ API — ค่าเริ่มต้นเป็น same-origin (dev ผ่าน vite proxy, production ผ่าน reverse proxy) |
| `VITE_API_PROXY_TARGET` | `http://localhost:5070` | ปลายทางของ vite proxy (`/api` → API) เฉพาะ `yarn dev` |

- **Cookie / https ตอน dev**: API ใช้ cookie `__Host-ga_at`, `__Secure-ga_rt`, `__Host-ga_csrf` (Secure + SameSite=Strict + httpOnly)
  หน้าเว็บเรียก `/api/v1` แบบ same-origin ผ่าน vite proxy (`changeOrigin: false` → Origin `http://localhost:8081` อยู่ใน allowlist ของ API)
  Chrome / Firefox ถือว่า `http://localhost` เป็น secure context จึงรับ Secure cookie ได้โดยไม่ต้อง https — **Safari ไม่รับ** ให้ใช้ Chrome/Firefox ตอน dev
  (ไม่แก้ชื่อ cookie ของ API และไม่ต้องตั้ง https/basic-ssl)
- **ข้อมูล**: หลัง login หน้าเว็บโหลดสมุดทั้งก้อนจาก `GET /book` (รูปเดียวกับ `AccountingData`) แล้วหน้าจอใช้ตัวเลือก/selector เดิม
  คำสั่งทุกตัว (`cmd.*` ใน `src/store/commands.ts`) เรียก endpoint ของมันแล้วโหลดสมุดใหม่ — ไม่มีการคำนวณยอด/ออกเลขที่ฝั่งหน้าเว็บ
- รายงานภาษี/งบ (ศูนย์ภาษี, สมุดบัญชี) อ่านจาก `/reports/*`; ไฟล์ CSV / .txt ภ.ง.ด. / XML e-Tax ดาวน์โหลดจาก `/files/*`
- บริษัทใหม่เริ่มจาก **สมัคร** (ได้ผังบัญชีตั้งต้น) → **ตั้งค่า → ยอดยกมา** — ไม่มีการอัปโหลดข้อมูล localStorage ขึ้นเซิร์ฟเวอร์;
  สำรอง/กู้คืน/ข้อมูลตัวอย่างใช้ได้เฉพาะโหมด local
- บทบาท: `viewer` ไม่เห็นปุ่มบันทึกและเข้าหน้าบันทึกเอกสารไม่ได้, `owner` จัดการผู้ใช้ (`/settings/members`), แก้ข้อมูลบริษัท, ปิดงวด/ปิดปี —
  เซิร์ฟเวอร์ตรวจสิทธิ์ซ้ำทุกคำขอ; คำเชิญเปิดที่ `/accept-invite#token=…` (owner ดู/ส่งใหม่/ยกเลิกคำเชิญที่รอตอบรับได้ที่หน้าผู้ใช้งาน)
- **อีเมล (D2)**: สมัครแล้วยังไม่ได้ session — ยืนยันจากลิงก์ `/verify-email#token=…` แล้วเข้าสู่ระบบ (ยังไม่ยืนยันก็เข้าได้ อ่านได้ แต่บันทึกไม่ได้ —
  แสดงแถบเตือน + ส่งลิงก์ใหม่); ลืมรหัสผ่าน `/forgot-password` → `/reset-password#token=…` (ทุกอุปกรณ์ออกจากระบบ); เปลี่ยนรหัสผ่านที่เมนูผู้ใช้;
  token ในลิงก์ถูกลบออกจาก URL ทันทีที่เปิดหน้า. dev: อีเมลไปที่ Mailpit ของ go-account-api (http://127.0.0.1:8025)

### สถาปัตยกรรมการสลับโหมด

```
หน้าจอ ── useAccounting() ── { data, run(cmd.x(input)): Promise, busy, client }
                │
      AccountingRepository (src/store/repository.ts)
        ├─ local: AccountingStore (localStorage) — run = pure action ใน actions.ts
        └─ api:   GET /book (cache) — run = command.remote → POST/PUT/PATCH/DELETE แล้ว reload
                       │
                  api-client (src/utils/api-client.ts): credentials include, X-CSRF-Token (จาก session / GET /auth/csrf),
                  Idempotency-Key ต่อการกดบันทึก (กดซ้ำหลังเครือข่ายหลุด/5xx = key เดิม), 401 → refresh ครั้งเดียว (single-flight) แล้วส่งซ้ำ,
                  refresh ไม่ผ่าน → หน้า login, ProblemDetails → ApiError (message = detail ภาษาไทย, code)
```

## Docker / deploy (D3)

- `Dockerfile`: `yarn build` (โหมด `api`) → **nginx unprivileged** (uid 101, port 8080) — SPA fallback, security headers + CSP (`deploy/nginx/security-headers.conf`),
  assets ที่มี hash cache 1 ปี, `index.html` no-cache, `/api/*` และ `/health`, `/health/live` reverse proxy ไป go-account-api ⇒ หน้าเว็บกับ API **origin เดียวกัน**
  (cookie `__Host-`/Secure + SameSite=Strict ใช้ได้โดยไม่ต้องตั้ง domain)
- ค่าตอนรัน (env ของ container, แทนใน `deploy/nginx/default.conf.template`): `GA_API_UPSTREAM` (`http://api:8080`), `GA_PUBLIC_SCHEME` (`https` = ส่ง HSTS + `X-Forwarded-Proto: https`),
  `GA_TRUSTED_PROXY_CIDR` / `GA_REAL_IP_HEADER` (IP จริงจาก edge), `GA_MAX_BODY`
- staging ในเครื่อง + deploy DigitalOcean + runbook อยู่ใน go-account-api: `docker-compose.staging.yml`, `.github/workflows/deploy-staging.yml`, `docs/ops/`
- CI: `.github/workflows/ci.yml` — test, lint, tsc, build (โหมด api) แล้ว build image + ตรวจ non-root/SPA/CSP/HSTS (ไม่ push)

## ทำอะไรได้แล้ว

| หน้า | ความสามารถ |
|---|---|
| หน้าแรก | งานที่ต้องทำวันนี้, เงินสด/ลูกหนี้/เจ้าหนี้, กำหนดยื่นภาษี, ลูกหนี้ค้างชำระ |
| ขาย | ออกใบกำกับภาษี (เลขที่ต่อเนื่องต่อเดือน), รับชำระ (รวมกรณีลูกค้าหัก ณ ที่จ่าย), ใบลดหนี้อ้างใบเดิม, พิมพ์, ดาวน์โหลด XML e-Tax |
| ซื้อ / ค่าใช้จ่าย | บันทึกซื้อพร้อมภาษีซื้อ, หัก ณ ที่จ่าย (แยก ภ.ง.ด.3 / 53 อัตโนมัติ), จ่ายชำระ |
| ศูนย์ภาษี | ภ.พ.30 สรุปยอด, รายงานภาษีขาย/ซื้อ (CSV), ไฟล์ .txt ภ.ง.ด.3/53 ตาม Format กลาง v2.0, คิว e-Tax |
| สมุดบัญชี | สมุดรายวัน (ลงอัตโนมัติจากเอกสาร), รายการปรับปรุง, งบทดลอง, กำไรขาดทุน, ผังบัญชี |
| ลูกค้า / ผู้ขาย | เพิ่ม/แก้, ตรวจเลขผู้เสียภาษี 13 หลัก (check digit), นำเข้า CSV จากโปรแกรมเดิม |
| ตั้งค่า | ข้อมูลบริษัท, สำรอง/กู้คืนข้อมูล |
| ทั่วระบบ | Ctrl+K ค้นหาเมนู/เอกสาร/ลูกค้า, ธีมสว่าง/มืด และ settings drawer ของ starter |

## กติกาทางบัญชีที่ระบบบังคับ

- เอกสารที่ออกแล้ว **แก้ไม่ได้** — แก้ด้วยใบลดหนี้ หรือรายการปรับปรุงเท่านั้น
- ทุกเอกสารลงบัญชีอัตโนมัติผ่าน posting engine (`src/domain/posting.ts`) และต้องสมดุลก่อนบันทึก
- เงินคำนวณเป็นสตางค์ (integer) ปัดเศษ half-up — ไม่มี floating point error
- หัก ณ ที่จ่ายคิดจากมูลค่าก่อน VAT และเข้างวดตาม **วันที่จ่ายจริง**
- รับชำระ/ลดหนี้เกินยอดค้างไม่ได้ ข้อความ error บอกยอดที่ทำได้

## ไฟล์ที่ส่งสรรพากร

| ไฟล์ | สถานะ | อ้างอิง |
|---|---|---|
| ภ.ง.ด.3 / ภ.ง.ด.53 `.txt` | ตาม Format กลาง v2.0 (ปรับปรุง 16/06/2568): header 25 ฟิลด์, detail 38 ฟิลด์, คั่นด้วย `\|`, UTF-8, CRLF, 3 ประเภทเงินได้ต่อลำดับ, ตัดอักขระต้องห้าม, ชื่อไฟล์ตามข้อกำหนด | [PND3](https://rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND3V2_0.pdf) · [PND53](https://rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND53V2_0.pdf) |
| e-Tax Invoice XML | โครงสร้าง ETDA ขมธอ.3-2560 (ใบกำกับ 388, ใบลดหนี้ 81, TXID = เลข 13 หลัก + สาขา 5 หลัก) **ยังไม่ลงลายมือชื่อ** | ETDA |
| ภ.พ.30 | สรุปตัวเลขสำหรับกรอกที่ e-Filing | — |

### ต้องทำก่อนใช้งานจริง

1. **ลงลายมือชื่อดิจิทัล (XAdES)** ฝั่ง backend ด้วยใบรับรอง CA ของลูกค้า เก็บกุญแจใน KMS/HSM
2. ตรวจ XML กับ XML Schema และตัวตรวจของ ETDA / กรมสรรพากร — รหัสเหตุผลใบลดหนี้ (`CDNG99`) ต้องเทียบตารางรหัสจริง
3. นำไฟล์ ภ.ง.ด. ตัวอย่างเข้า RD Prep / SWC เพื่อยืนยันว่าผ่าน validation
4. กำหนดยื่นออนไลน์ (15 / 23 ของเดือนถัดไป) เป็นค่าตามประกาศขยายเวลา ต้องทบทวนทุกปี (`filingDueDates`)
5. ~~ย้ายตรรกะไป backend แล้วให้ `useAccounting().run` เรียก API~~ — ทำแล้ว (C6, โหมด `api`) ดูหัวข้อ “โหมด API”
6. ข้อความบนหน้าจอยังเป็นภาษาไทยในโค้ด (ยังไม่ผ่าน i18n) — ถ้าจะทำหลายภาษาให้ย้ายเข้า `src/locales`

## โครงสร้างโค้ด

```
src/
  domain/        ตรรกะบัญชี/ภาษีล้วน ไม่มี React — เงิน, เลขผู้เสียภาษี, คำนวณเอกสาร,
                 posting, รายงาน VAT, ภ.ง.ด. Format กลาง, e-Tax XML, งบทดลอง, นำเข้า CSV
  store/         actions (pure: state → state ใหม่), commands (local/remote ของแต่ละคำสั่ง), repository (local/api),
                 seed ข้อมูลตัวอย่าง, provider
  auth/          session (โหมด api), AuthGuard / RequireWrite / CanWrite, บทบาท
  schemas/       zod schema ของทุกฟอร์ม
  layouts/       DashboardLayout + เมนู + Ctrl+K
  sections/      หน้าจอแต่ละโมดูล (view อยู่ใน sections/<x>/view)
  pages/         ไฟล์บาง ๆ: Helmet + view
```

การเพิ่มหน้าใหม่ทำตาม pattern ของ starter: `routes/paths.ts` → `routes/sections/index.tsx` → `pages/` → `sections/`
