import type { TypographyProps } from '@mui/material/Typography';

import Typography from '@mui/material/Typography';

import { toSatang, formatBaht } from 'src/domain';

// ----------------------------------------------------------------------

type Props = TypographyProps & {
  value: number;
  /** ซ่อนศูนย์ (แสดงช่องว่าง) — ใช้ในตารางเดบิต/เครดิต */
  hideZero?: boolean;
  /** ติดลบเป็นสีแดง */
  signed?: boolean;
};

/** ตัวเลขเงิน ชิดขวา ใช้ตัวเลขความกว้างเท่ากันเพื่อให้หลักตรงกันในตาราง */
export function Money({ value, hideZero, signed, sx, ...other }: Props) {
  const zero = toSatang(value) === 0;
  return (
    <Typography
      component="span"
      variant="body2"
      sx={{
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...(signed && value < 0 && { color: 'error.main' }),
        ...sx,
      }}
      {...other}
    >
      {hideZero && zero ? '' : formatBaht(value)}
    </Typography>
  );
}
