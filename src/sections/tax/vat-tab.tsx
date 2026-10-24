import type { Period, VatReportRow } from 'src/domain';

import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';

import { downloadText } from 'src/utils/download';

import { sumBaht, formatTaxId, periodLabel, vatReportCsv, formatThaiDate } from 'src/domain';

import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { rows: VatReportRow[]; period: Period; kind: 'sales' | 'purchase' };

export function VatReportTab({ rows, period, kind }: Props) {
  const title = `${kind === 'sales' ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ'} เดือน${periodLabel(period)}`;
  const net = sumBaht(rows.map((r) => r.net));
  const vat = sumBaht(rows.map((r) => r.vat));

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {rows.length} รายการ · ตรวจแล้วทุกแถวมีเลขผู้เสียภาษีและสาขาตามที่ต้องพิมพ์ในรายงาน
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Iconify icon="solar:file-download-bold" />}
          disabled={!rows.length}
          onClick={() =>
            downloadText(
              `${kind === 'sales' ? 'sales' : 'purchase'}-vat-${period.year}-${String(period.month).padStart(2, '0')}.csv`,
              vatReportCsv(rows, title),
              'text/csv;charset=utf-8'
            )
          }
        >
          ส่งออก CSV
        </Button>
      </Stack>

      {rows.length ? (
        <Scrollbar>
          <Table size="small" sx={{ minWidth: 880 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 48 }}>ลำดับ</TableCell>
                <TableCell>วันที่</TableCell>
                <TableCell>เลขที่</TableCell>
                <TableCell>{kind === 'sales' ? 'ชื่อผู้ซื้อ' : 'ชื่อผู้ขาย'}</TableCell>
                <TableCell>เลขผู้เสียภาษี</TableCell>
                <TableCell>สาขา</TableCell>
                <TableCell align="right">มูลค่า</TableCell>
                <TableCell align="right">ภาษี</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{formatThaiDate(r.date)}</TableCell>
                  <TableCell>
                    {r.docNo}
                    {r.kind === 'credit-note' && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'error.main' }}>
                        ใบลดหนี้
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <Typography variant="body2" noWrap>
                      {r.contactName}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatTaxId(r.taxId) || '-'}</TableCell>
                  <TableCell>{r.branchNo}</TableCell>
                  <TableCell align="right">
                    <Money value={r.net} signed />
                  </TableCell>
                  <TableCell align="right">
                    <Money value={r.vat} signed />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="subtitle2">รวม</Typography>
                </TableCell>
                <TableCell align="right">
                  <Money value={net} sx={{ fontWeight: 600 }} />
                </TableCell>
                <TableCell align="right">
                  <Money value={vat} sx={{ fontWeight: 600 }} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Scrollbar>
      ) : (
        <Box>
          <EmptyContent filled title="ไม่มีรายการในงวดนี้" sx={{ py: 6 }} />
        </Box>
      )}
    </Stack>
  );
}
