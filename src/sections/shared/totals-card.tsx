import type { DocTotals } from 'src/domain';

import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { Money } from './money';

// ----------------------------------------------------------------------

type Row = { label: string; value: number; strong?: boolean; negative?: boolean };

type Props = {
  totals: DocTotals;
  vatRate: number;
  showVat: boolean;
  whtRate?: number;
  whtLabel?: string;
  /** ข้อความแทน "{whtLabel} {whtRate}%" เมื่อหักหลายอัตรา (เอกสารซื้อระดับบรรทัด) */
  whtText?: string;
  payableLabel?: string;
};

export function TotalsSummary({ totals, vatRate, showVat, whtRate, whtLabel, whtText, payableLabel }: Props) {
  const rows: Row[] = [
    { label: 'มูลค่าสินค้า/บริการ (ก่อนภาษี)', value: totals.net },
    ...(showVat ? [{ label: `ภาษีมูลค่าเพิ่ม ${vatRate}%`, value: totals.vat }] : []),
  ];

  return (
    <Stack spacing={1.25}>
      {rows.map((r) => (
        <Stack key={r.label} direction="row" justifyContent="space-between">
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {r.label}
          </Typography>
          <Money value={r.value} />
        </Stack>
      ))}
      <Divider sx={{ borderStyle: 'dashed' }} />
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="subtitle1">รวมทั้งสิ้น</Typography>
        <Money value={totals.total} variant="subtitle1" />
      </Stack>
      {(!!whtRate || !!whtText) && (
        <>
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {whtText ?? `${whtLabel ?? 'หัก ณ ที่จ่าย'} ${whtRate}%`}
            </Typography>
            <Money value={-totals.wht} />
          </Stack>
          <Stack direction="row" justifyContent="space-between" sx={{ color: 'primary.dark' }}>
            <Typography variant="subtitle1">{payableLabel ?? 'ยอดชำระสุทธิ'}</Typography>
            <Money value={totals.payable} variant="subtitle1" />
          </Stack>
        </>
      )}
    </Stack>
  );
}
