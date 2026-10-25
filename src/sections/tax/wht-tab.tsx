import type { Period, WhtForm, RdWhtFileResult } from 'src/domain';
import type { WhtReportDto } from 'src/sections/shared/server-reports';

import { useMemo, useState } from 'react';

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

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { downloadText } from 'src/utils/download';

import { useAccounting, useContactLookup } from 'src/store';
import { periodKey, whtTotals, formatTaxId, buildRdWhtFile, formatThaiDate, whtPayeesForPeriod } from 'src/domain';

import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { Money } from 'src/sections/shared';
import { toWhtPayees, useServerDownload } from 'src/sections/shared/server-reports';

// ----------------------------------------------------------------------

/** `server` = รายงานจาก `/reports/wht/{month}/{form}` (โหมด api) — ไฟล์ดาวน์โหลดจาก `/files/wht/...` ของเซิร์ฟเวอร์ */
type Props = { form: WhtForm; period: Period; server?: WhtReportDto };

type FileResult = Pick<RdWhtFileResult, 'fileName' | 'errors' | 'warnings'>;

export function WhtTab({ form, period, server }: Props) {
  const { data, mode } = useAccounting();
  const contacts = useContactLookup();
  const download = useServerDownload();
  const [file, setFile] = useState<FileResult | null>(null);
  const [building, setBuilding] = useState(false);

  const payees = useMemo(
    () => (server ? toWhtPayees(server, data.contacts) : whtPayeesForPeriod(data, period, form)),
    [server, data, period, form]
  );
  const totals = whtTotals(payees);

  const build = async () => {
    if (mode === 'api') {
      if (!server) return;
      // ปัญหาที่ต้องแก้มากับรายงานแล้ว (ไฟล์ = 422 WHT_FILE_INVALID) — ไม่ต้องยิงดาวน์โหลด
      if (server.errors.length) {
        setFile({ fileName: server.fileName, errors: server.errors, warnings: server.warnings });
        return;
      }
      setBuilding(true);
      try {
        const r = await download(`/files/wht/${periodKey(period)}/${form === 'PND3' ? 'pnd3' : 'pnd53'}.txt`);
        setFile({ fileName: r.fileName, errors: [], warnings: r.warnings });
      } catch (e) {
        setFile({ fileName: server.fileName, errors: [e instanceof Error ? e.message : 'สร้างไฟล์ไม่สำเร็จ'], warnings: [] });
      } finally {
        setBuilding(false);
      }
      return;
    }
    const result = buildRdWhtFile({ form, company: data.company, period, payees });
    setFile(result);
    if (!result.errors.length) downloadText(result.fileName, result.content);
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {form === 'PND3' ? 'ผู้รับเงินที่เป็นบุคคลธรรมดา' : 'ผู้รับเงินที่เป็นนิติบุคคล'} · นับตามวันที่จ่ายเงินจริง (แบ่งจ่าย = แยกรายการต่อครั้ง) ·{' '}
          {totals.payees} ราย · เงินได้ <Money value={totals.amount} /> · ภาษี <Money value={totals.tax} sx={{ fontWeight: 600 }} />
        </Typography>
        <Button variant="contained" startIcon={<Iconify icon="solar:file-download-bold" />} onClick={build} disabled={!payees.length || building}>
          สร้างไฟล์ .txt สำหรับ RD Prep
        </Button>
      </Stack>

      {file && (
        <Stack spacing={1}>
          {file.errors.map((e) => (
            <Alert key={e} severity="error" variant="outlined">
              {e}
            </Alert>
          ))}
          {file.warnings.map((w) => (
            <Alert key={w} severity="warning" variant="outlined">
              {w}
            </Alert>
          ))}
          {!file.errors.length && (
            <Alert severity="success" variant="outlined">
              ดาวน์โหลด {file.fileName} แล้ว — นำเข้าโปรแกรม RD Prep / SWC แล้วยื่นที่ efiling.rd.go.th
            </Alert>
          )}
          {file.errors.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              แก้ข้อมูลตามรายการด้านบนในหน้า ลูกค้า / ผู้ขาย หรือ ตั้งค่าบริษัท แล้วกดสร้างไฟล์อีกครั้ง
            </Typography>
          )}
        </Stack>
      )}

      {payees.length ? (
        <Scrollbar>
          <Table size="small" sx={{ minWidth: 940 }}>
            <TableHead>
              <TableRow>
                <TableCell>ผู้รับเงิน</TableCell>
                <TableCell>เลขผู้เสียภาษี</TableCell>
                <TableCell>วันที่จ่าย</TableCell>
                <TableCell>ใบสำคัญจ่าย / 50 ทวิ</TableCell>
                <TableCell>ประเภทเงินได้</TableCell>
                <TableCell align="right">อัตรา</TableCell>
                <TableCell align="right">เงินได้</TableCell>
                <TableCell align="right">ภาษีที่หัก</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {payees.flatMap((p) =>
                p.items.map((item, i) => (
                  <TableRow key={`${item.paymentId}-${item.incomeType}-${item.rate}`}>
                    <TableCell>{i === 0 ? contacts.name(p.contact.id) : ''}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{i === 0 ? formatTaxId(p.contact.taxId) : ''}</TableCell>
                    <TableCell>{formatThaiDate(item.paidDate)}</TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        component={RouterLink}
                        href={paths.purchases.payment(item.paymentId)}
                        sx={{ color: 'inherit' }}
                      >
                        {item.docNo}
                      </Typography>
                      {item.certNo && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                          {item.certNo}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{item.incomeType}</TableCell>
                    <TableCell align="right">{item.rate}%</TableCell>
                    <TableCell align="right">
                      <Money value={item.amount} />
                    </TableCell>
                    <TableCell align="right">
                      <Money value={item.tax} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Scrollbar>
      ) : (
        <Box>
          <EmptyContent filled title="ไม่มีรายการหัก ณ ที่จ่ายในงวดนี้" description="ถ้าไม่มีรายการ ไม่ต้องยื่นแบบสำหรับเดือนนี้" sx={{ py: 6 }} />
        </Box>
      )}
    </Stack>
  );
}
