// ----------------------------------------------------------------------

/**
 * กัน Enter ในช่องกรอกส่งฟอร์มเอง (implicit submit) — ผู้ใช้ต้องกดปุ่มบันทึกแล้วยืนยันเท่านั้น
 * ใส่ที่ element ที่ครอบช่องกรอก: `<Grid container onKeyDown={preventEnterSubmit}>`
 * textarea / ปุ่ม ยังใช้ Enter ได้ตามปกติ
 */
export function preventEnterSubmit(event: React.KeyboardEvent) {
  if (event.key !== 'Enter') return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') {
    event.preventDefault();
  }
}
