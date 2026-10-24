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
  },
  purchases: {
    root: '/purchases',
    new: '/purchases/new',
  },
  contacts: '/contacts',
  tax: '/tax',
  ledger: '/ledger',
  settings: '/settings',
  page404: '/404',
};
