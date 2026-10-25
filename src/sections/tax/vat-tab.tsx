import type { Period, VatReportRow } from 'src/domain';

import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';

import { downloadText } from 'src/utils/download';

import { useAccounting } from 'src/store';
import { sumBaht, formatTaxId, periodLabel, vatReportCsv, formatThaiDate, isValidThaiTaxId } from 'src/domain';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { Money } from 'src/sections/shared';
import { useServerDownload } from 'src/sections/shared/server-reports';

// ----------------------------------------------------------------------

type Props = { rows: VatReportRow[]; period: Period; kind: 'sales' | 'purchase' };

/** ปัญหาของแถวที่ต้องแก้ก่อนยื่น: ไม่มี/ผิดเลขผู้เสียภาษี 13 หลัก หรือสาขาไม่ใช่ 5 หลัก */
export function vatRowProblem(row: Pick<VatReportRow, 'taxId' | 'branchNo'>): string | null {
  if (!row.taxId) return 'ไม่มีเลขผู้เสียภาษี';
  if (!isValidThaiTaxId(row.taxId)) return 'เลขผู้เสียภาษีไม่ถูกต้อง';
  if (!/^\d{5}$/.test(row.branchNo)) return 'ไม่มีเลขสาขา';
  return null;
}

/** รายงานภาษีขาย/ซื้อของงวด — ตรวจทุกแถวว่ามีเลขผู้เสียภาษีและสาขาครบก่อนส่งออก */
export function VatReportTab({ rows, period, kind }: Props) {
  const title = `${kind === 'sales' ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ'} เดือน${periodLabel(period)}`;
  const net = sumBaht(rows.map((r) => r.net));
  const vat = sumBaht(rows.map((r) => r.vat));
  const problems = rows.map((r) => vatRowProblem(r));
  const badCount = problems.filter(Boolean).length;
  const { mode } = useAccounting();
  const download = useServerDownload();
  const fileName = `${kind === 'sales' ? 'sales' : 'purchase'}-vat-${period.year}-${String(period.month).padStart(2, '0')}.csv`;

  /** โหมด api: CSV จากเซิร์ฟเวอร์ (`/files/vat/...`) ทุก byte ตรงกับ golden; โหมด local สร้างในเบราว์เซอร์ */
  const exportCsv = async () => {
    if (mode !== 'api') {
      downloadText(fileName, vatReportCsv(rows, title), 'text/csv;charset=utf-8');
      return;
    }
    try {
      await download(`/files/vat/${period.year}-${String(period.month).padStart(2, '0')}/${kind}.csv`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ดาวน์โหลดไม่สำเร็จ');
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {rows.length} รายการ
          {rows.length > 0 && badCount === 0 && ' · ตรวจแล้วทุกแถวมีเลขผู้เสียภาษีและสาขาตามที่ต้องพิมพ์ในรายงาน'}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Iconify icon="solar:file-download-bold" />}
          disabled={!rows.length}
          onClick={exportCsv}
        >
          ส่งออก CSV
        </Button>
      </Stack>

      {badCount > 0 && (
        <Alert severity="warning" variant="outlined">
          {badCount} แถวไม่มีเลขผู้เสียภาษีหรือสาขาที่ถูกต้อง — รายงานที่ยื่นต้องมีข้อมูลนี้ ตรวจกับเอกสารต้นฉบับ
          และแก้ข้อมูลลูกค้า/ผู้ขายก่อนออกเอกสารใบถัดไป (เอกสารที่ออกแล้วใช้ข้อมูล ณ วันที่ออก)
        </Alert>
      )}

      {rows.length ? (
        <Scrollbar>
          <Table size="small" sx={{ minWidth: 880 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 48 }}>ลำดับ</TableCell>
                <TableCell>{kind === 'sales' ? 'วันที่' : 'วันที่ใบกำกับ'}</TableCell>
                <TableCell>{kind === 'sales' ? 'เลขที่' : 'เลขที่ใบกำกับผู้ขาย'}</TableCell>
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
                    {r.kind === 'debit-note' && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'info.main' }}>
                        ใบเพิ่มหนี้
                      </Typography>
                    )}
                    {r.kind === 'receipt' && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        ใบเสร็จรับเงิน/ใบกำกับภาษี (งานบริการ)
                      </Typography>
                    )}
                    {r.kind === 'purchase-credit-note' && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'error.main' }}>
                        ใบลดหนี้จากผู้ขาย
                      </Typography>
                    )}
                    {r.refDocNo && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {r.refDocNo} · บันทึก {formatThaiDate(r.recordedDate)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <Typography variant="body2" noWrap>
                      {r.contactName}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatTaxId(r.taxId) || '-'}
                    {problems[i] && (
                      <Label variant="soft" color="error" sx={{ ml: 1 }}>
                        {problems[i]}
                      </Label>
                    )}
                  </TableCell>
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
