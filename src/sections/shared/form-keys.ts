import { isSubmitShortcut } from 'src/domain';

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

/**
 * ตัวจัดการคีย์บอร์ดของฟอร์ม: Ctrl+Enter (⌘+Enter) = ส่งฟอร์ม → เปิดหน้ายืนยัน, Enter ในช่องกรอกไม่ส่งฟอร์มเอง
 * ไม่รับ event ที่มาจาก dialog ลูก (portal) ซึ่ง React ส่งต่อขึ้นมาถึงฟอร์มแม่
 */
export function formKeyHandler(onSubmit: () => void) {
  return (event: React.KeyboardEvent) => {
    if (!(event.currentTarget as Node).contains(event.target as Node)) return;
    if (isSubmitShortcut(event)) {
      event.preventDefault();
      onSubmit();
      return;
    }
    preventEnterSubmit(event);
  };
}
