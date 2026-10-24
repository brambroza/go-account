// ----------------------------------------------------------------------

/**
 * path ทั้งหมดของแอป — เพิ่ม route ใหม่ต้องเพิ่มที่นี่ก่อน
 * แล้วไป lazy import หน้าใน `routes/sections/index.tsx`
 */
export const paths = {
  dashboard: '/',
  sales: {
    root: '/sales',
    new: '/sales/new',
    /** ออกเอกสารขายจากใบเสนอราคา (คัดลอกรายการ) */
    fromQuotation: (quotationId: string) => `/sales/new?quotation=${quotationId}`,
    view: (id: string) => `/sales/${id}`,
    creditNote: (invoiceId: string) => `/sales/${invoiceId}/credit-note`,
    debitNote: (invoiceId: string) => `/sales/${invoiceId}/debit-note`,
    /** ใบเสร็จรับเงิน / ใบเสร็จรับเงิน/ใบกำกับภาษี (งานบริการ) */
    receipt: (receiptId: string) => `/sales/receipts/${receiptId}`,
  },
  purchases: {
    root: '/purchases',
    new: '/purchases/new',
    /** ใบสำคัญจ่าย + 50 ทวิ ของการจ่าย 1 ครั้ง */
    payment: (paymentId: string) => `/purchases/payments/${paymentId}`,
    view: (id: string) => `/purchases/${id}`,
    /** ใบลดหนี้จากผู้ขาย อ้างเอกสารซื้อ */
    creditNote: (purchaseId: string) => `/purchases/${purchaseId}/credit-note`,
  },
  /** ใบเสนอราคา (ไม่ลงบัญชี) */
  quotations: {
    root: '/quotations',
    new: '/quotations/new',
    view: (id: string) => `/quotations/${id}`,
    edit: (id: string) => `/quotations/${id}/edit`,
  },
  /** ธนาคาร / เงินสดย่อย / กระทบยอด */
  bank: {
    root: '/bank',
    reconcile: (accountCode: string) => `/bank/reconcile/${accountCode}`,
  },
  contacts: '/contacts',
  tax: '/tax',
  ledger: '/ledger',
  settings: '/settings',
  /** ยอดยกมาจากระบบเดิม (Express) */
  opening: '/settings/opening',
  page404: '/404',
};
