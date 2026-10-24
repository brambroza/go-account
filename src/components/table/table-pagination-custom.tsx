import type { Theme, SxProps } from '@mui/material/styles';
import type { TablePaginationProps } from '@mui/material/TablePagination';

import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import TablePagination from '@mui/material/TablePagination';
import FormControlLabel from '@mui/material/FormControlLabel';

import { useTranslate } from 'src/locales';
// ----------------------------------------------------------------------

export type TablePaginationCustomProps = TablePaginationProps & {
  dense?: boolean;
  sx?: SxProps<Theme>;
  onChangeDense?: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export function TablePaginationCustom({
  sx,
  dense,
  onChangeDense,
  rowsPerPageOptions = [5, 10, 25, 50, { label: 'All', value: -1 }],
  ...other
}: TablePaginationCustomProps) {
 const { t: tt } = useTranslate('translation');

  return (
    <Box sx={{ position: 'relative', ...sx }}>
      <TablePagination
        rowsPerPageOptions={rowsPerPageOptions}
        component="div"
        {...other}
        sx={{ borderTopColor: 'transparent' }}
        labelRowsPerPage={tt('txtrowperpage')}
      />

      {onChangeDense && (
        <FormControlLabel
          label="Dense"
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
