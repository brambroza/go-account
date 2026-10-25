# CLAUDE.md — GO Account

โปรแกรมบัญชี SaaS สำหรับ SME ไทย (ทดแทน Express) — ฝั่งหน้าเว็บ สร้างจาก goalong-mui-starter

## ก่อนแก้โค้ด

- UI: อ่าน `docs/design-system.md` หัวข้อ 1–2 (ห้าม hex, ใช้ `varAlpha`, `Label variant="soft"` สำหรับสถานะ, ฟอร์มใช้ RHF + zod + `Field.*`)
- ตรรกะบัญชี/ภาษี อยู่ที่ `src/domain` เท่านั้น — หน้าจอห้ามคำนวณภาษีเอง ให้เรียก `calcDocument`, `pp30Summary`, `buildRdWhtFile` ฯลฯ
- การเปลี่ยนข้อมูลทุกอย่างผ่านคำสั่ง `cmd.*` ใน `src/store/commands.ts` (local = pure action ใน `actions.ts`, remote = API) แล้ว `await useAccounting().run(cmd.x(input))` — ปุ่มบันทึกปิดด้วย `busy`, ปุ่มที่เปลี่ยนข้อมูลครอบ `CanWrite`/`OwnerOnly` (`src/auth`)
- โหมดข้อมูล `VITE_DATA_MODE=local|api` (ค่าเริ่มต้น local) — ดู README “โหมด API”
- เงิน: ใช้ฟังก์ชันใน `src/domain/money.ts` (สตางค์ integer, half-up) ห้ามบวกลบ float ตรง ๆ

## กติกาธุรกิจที่ห้ามทำลาย

1. เอกสารที่ออกแล้วแก้ไม่ได้ — ใบลดหนี้ / รายการปรับปรุงเท่านั้น
2. ทุกรายการบัญชีต้องสมดุล (`finalize` ใน posting.ts throw ถ้าไม่สมดุล)
3. เลขที่เอกสารเรียงต่อเนื่องต่อ prefix ต่อเดือน (`IV6910-0001`)
4. หัก ณ ที่จ่ายเข้างวดตามวันที่จ่าย, ภ.ง.ด.3 = บุคคลธรรมดา, ภ.ง.ด.53 = นิติบุคคล
5. ไฟล์ ภ.ง.ด. ต้องผ่าน test ใน `src/domain/__tests__/rd-files.test.ts` (จำนวนฟิลด์ 25/38, ตัวคั่น, CRLF)

## คำสั่ง

`yarn dev` · `yarn test` · `yarn lint` · `npx tsc --noEmit` · `yarn build` — ต้องผ่านทั้งหมดก่อน commit
