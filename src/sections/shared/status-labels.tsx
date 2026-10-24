import type { LabelColor } from 'src/components/label';
import type { ETaxStatus, SalesDocStatus } from 'src/domain';

import { Label } from 'src/components/label';

// ----------------------------------------------------------------------
// สีสถานะตาม convention ของ design system: ร่าง=default, รอ=warning, ระหว่างทาง=info,
// เสร็จ=success, ยกเลิก=error

const SALES_STATUS: Record<SalesDocStatus, { label: string; color: LabelColor }> = {
  issued: { label: 'รอรับชำระ', color: 'warning' },
  partial: { label: 'รับชำระบางส่วน', color: 'info' },
  paid: { label: 'รับชำระแล้ว', color: 'success' },
  cancelled: { label: 'ยกเลิก (ลดหนี้แล้ว)', color: 'error' },
};

export function SalesStatusLabel({ status, overdue }: { status: SalesDocStatus; overdue?: boolean }) {
  if (overdue && (status === 'issued' || status === 'partial')) {
    return (
      <Label variant="soft" color="error">
        เกินกำหนด
      </Label>
    );
  }
  const s = SALES_STATUS[status];
  return (
    <Label variant="soft" color={s.color}>
      {s.label}
    </Label>
  );
}

const ETAX_STATUS: Record<ETaxStatus, { label: string; color: LabelColor }> = {
  'not-required': { label: 'ไม่ต้องออก', color: 'default' },
  'pending-sign': { label: 'รอลงลายมือชื่อ', color: 'warning' },
  signed: { label: 'ลงนามแล้ว รอนำส่ง', color: 'info' },
  uploaded: { label: 'นำส่งแล้ว', color: 'success' },
};

export function ETaxLabel({ status }: { status: ETaxStatus }) {
  const s = ETAX_STATUS[status];
  return (
    <Label variant="soft" color={s.color}>
      {s.label}
    </Label>
  );
}

export function PaidLabel({ paid }: { paid: boolean }) {
  return (
    <Label variant="soft" color={paid ? 'success' : 'warning'}>
      {paid ? 'จ่ายแล้ว' : 'รอจ่าย'}
    </Label>
  );
}
