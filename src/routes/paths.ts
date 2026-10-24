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
    view: (id: string) => `/sales/${id}`,
    creditNote: (invoiceId: string) => `/sales/${invoiceId}/credit-note`,
    debitNote: (invoiceId: string) => `/sales/${invoiceId}/debit-note`,
  },
  purchases: {
    root: '/purchases',
    new: '/purchases/new',
    /** ใบสำคัญจ่าย + 50 ทวิ ของการจ่าย 1 ครั้ง */
    payment: (paymentId: string) => `/purchases/payments/${paymentId}`,
  },
  contacts: '/contacts',
  tax: '/tax',
  ledger: '/ledger',
  settings: '/settings',
  page404: '/404',
};
