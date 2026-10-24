// ----------------------------------------------------------------------

/** ดาวน์โหลดข้อความเป็นไฟล์จาก browser (ใช้กับ .txt ภ.ง.ด., .xml e-Tax, .csv รายงาน) */
export function downloadText(fileName: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** บันทึก Blob เป็นไฟล์ (ไฟล์จากเซิร์ฟเวอร์ — CSV / .txt / XML ตามที่ API สร้าง ทุก byte) */
export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
