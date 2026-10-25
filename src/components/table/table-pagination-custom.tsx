import type { Theme, SxProps } from '@mui/material/styles';
import type { TablePaginationProps } from '@mui/material/TablePagination';

import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import TablePagination from '@mui/material/TablePagination';
import FormControlLabel from '@mui/material/FormControlLabel';

// ----------------------------------------------------------------------
// GO Account ใช้ภาษาไทยทั้งระบบ — ป้ายของ pagination ไม่พึ่งภาษาของ i18n (เดิมขึ้นภาษาอังกฤษ, UAT U13)

const ITEM_ARIA_LABEL = { first: 'หน้าแรก', last: 'หน้าสุดท้าย', next: 'หน้าถัดไป', previous: 'หน้าก่อนหน้า' } as const;

export type TablePaginationCustomProps = TablePaginationProps & {
  dense?: boolean;
  sx?: SxProps<Theme>;
  onChangeDense?: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export function TablePaginationCustom({
  sx,
  dense,
  onChangeDense,
  rowsPerPageOptions = [5, 10, 25, 50, { label: 'ทั้งหมด', value: -1 }],
  ...other
}: TablePaginationCustomProps) {
  return (
    <Box sx={{ position: 'relative', ...sx }}>
      <TablePagination
        rowsPerPageOptions={rowsPerPageOptions}
        component="div"
        {...other}
        sx={{ borderTopColor: 'transparent' }}
        labelRowsPerPage="แถวต่อหน้า:"
        labelDisplayedRows={({ from, to, count }) =>
          `${from.toLocaleString('th-TH')}–${to.toLocaleString('th-TH')} จาก ${count !== -1 ? count.toLocaleString('th-TH') : `มากกว่า ${to.toLocaleString('th-TH')}`}`
        }
        getItemAriaLabel={(type) => ITEM_ARIA_LABEL[type]}
      />

      {onChangeDense && (
        <FormControlLabel
          label="แสดงแบบกระชับ"
          control={<Switch name="dense" checked={dense} onChange={onChangeDense} />}
          sx={{
            pl: 2,
            py: 1.5,
            top: 0,
            position: { sm: 'absolute' },
          }}
        />
      )}
    </Box>
  );
}
