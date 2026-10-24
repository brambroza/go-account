import type { Address } from 'src/domain';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { bahtText } from 'src/domain';

// ----------------------------------------------------------------------
// ชิ้นส่วนร่วมของเอกสารพิมพ์ (ใบกำกับ ใบลด/เพิ่มหนี้ ใบสำคัญจ่าย 50 ทวิ)
// ----------------------------------------------------------------------

/** ที่อยู่บรรทัดเดียวตามลำดับที่พิมพ์บนเอกสาร */
export function formatAddress(a: Address | undefined): string {
  if (!a) return '';
  return [
    a.addressNo,
    a.moo && `หมู่ ${a.moo}`,
    a.village,
    a.soi && `ซ.${a.soi}`,
    a.street && `ถ.${a.street}`,
    a.subDistrict,
    a.district,
    a.province,
    a.postalCode,
  ]
    .filter(Boolean)
    .join(' ');
}

/** จำนวนเงินเป็นตัวอักษร (บาทถ้วน/สตางค์) ในกรอบ — คำนวณจาก `bahtText` ของ domain */
export function AmountInWords({ value, label = 'จำนวนเงิน (ตัวอักษร)' }: { value: number; label?: string }) {
  return (
    <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'background.neutral', breakInside: 'avoid' }}>
      <Typography variant="body2">
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {label}:
        </Box>{' '}
        <strong>({bahtText(value)})</strong>
      </Typography>
    </Box>
  );
}

/** ช่องลงชื่อ — เส้นลงชื่อ, (ชื่อตัวบรรจง), ตำแหน่ง, วันที่ — ไม่ตัดข้ามหน้า */
export function SignatureBlock({ roles, date }: { roles: string[]; date?: string }) {
  return (
    <Box
      sx={{
        mt: 5,
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.min(roles.length, 4)}, 1fr)` },
        breakInside: 'avoid',
        '@media print': { gridTemplateColumns: `repeat(${Math.min(roles.length, 4)}, 1fr)` },
      }}
    >
      {roles.map((role) => (
        <Stack key={role} alignItems="center" spacing={0.5}>
          <Box sx={{ width: 1, maxWidth: 200, height: 40, borderBottom: (theme) => `dotted 1px ${theme.vars.palette.text.primary}` }} />
          <Typography variant="body2">(..............................................)</Typography>
          <Typography variant="subtitle2">{role}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            วันที่ {date ?? '......../......../........'}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/** ช่องทำเครื่องหมาย ☑ / ☐ สำหรับแบบฟอร์ม */
export function CheckMark({ checked, label }: { checked: boolean; label: string }) {
  return (
    <Typography variant="body2" component="span" sx={{ whiteSpace: 'nowrap', fontWeight: checked ? 600 : 400 }}>
      {checked ? '☑' : '☐'} {label}
    </Typography>
  );
}
