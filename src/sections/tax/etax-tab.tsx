import type { Period } from 'src/domain';

import { useMemo } from 'react';

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

import { useBoolean } from 'src/hooks/use-boolean';

import { downloadText } from 'src/utils/download';

import { useAccounting, useContactLookup } from 'src/store';
import { inPeriod, buildETaxXml, calcDocument, isTaxDocument, formatThaiDate } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { Money, ETaxLabel } from 'src/sections/shared';

import { MarkUploadedDialog } from './mark-uploaded-dialog';

// ----------------------------------------------------------------------

/** e-Tax ของงวด: ดาวน์โหลด XML ที่รอนำส่ง และบันทึกว่านำส่งแล้ว (ยืนยันก่อน) — เฉพาะเอกสารภาษี */
export function ETaxTab({ period }: { period: Period }) {
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const markDialog = useBoolean();

  const docs = useMemo(
    () => data.sales.filter((s) => s.etax !== 'not-required' && isTaxDocument(s) && inPeriod(s.date, period)).sort((a, b) => a.docNo.localeCompare(b.docNo)),
    [data.sales, period]
  );
  const waiting = docs.filter((d) => d.etax === 'signed' || d.etax === 'pending-sign');
  const signed = waiting.filter((d) => d.etax === 'signed');

  const downloadAll = () => {
    const files: { name: string; xml: string }[] = [];
    const failed: string[] = [];
    waiting.forEach((doc) => {
      const referenced = doc.refDocId ? data.sales.find((s) => s.id === doc.refDocId) : undefined;
      try {
        const xml = buildETaxXml({ doc, company: data.company, buyer: contacts.get(doc.contactId), referenced });
        files.push({ name: `${doc.docNo}.xml`, xml });
      } catch (error) {
        failed.push(error instanceof Error ? error.message : doc.docNo);
      }
    });
    // เว้นจังหวะเล็กน้อยให้ browser ยอมดาวน์โหลดหลายไฟล์
    files.forEach((f, i) => setTimeout(() => downloadText(f.name, f.xml, 'application/xml;charset=utf-8'), i * 300));
    if (failed.length) toast.error(`สร้าง XML ไม่ได้ ${failed.length} ฉบับ: ${failed.slice(0, 3).join(' · ')}`);
  };

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" variant="outlined">
        ช่องทางนำส่งเฟสแรก: อัปโหลดไฟล์ XML ที่ลงลายมือชื่อแล้วผ่านเว็บไซต์กรมสรรพากร (etax.rd.go.th) · การลงนามด้วยใบรับรอง CA
        ของบริษัทจะทำที่ระบบหลังบ้าน ไฟล์ที่ดาวน์โหลดจากต้นแบบนี้ยังไม่ลงนาม
      </Alert>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
        <Button variant="outlined" startIcon={<Iconify icon="solar:file-download-bold" />} disabled={!waiting.length} onClick={downloadAll}>
          ดาวน์โหลด XML ที่รอนำส่ง ({waiting.length})
        </Button>
        <Button
          variant="contained"
          disabled={!signed.length}
          onClick={markDialog.onTrue}
          startIcon={<Iconify icon="solar:check-circle-bold" />}
        >
          ทำเครื่องหมายว่านำส่งแล้ว ({signed.length})
        </Button>
      </Stack>

      {docs.length ? (
        <Scrollbar>
          <Table size="small" sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell>เลขที่</TableCell>
                <TableCell>วันที่</TableCell>
                <TableCell>ลูกค้า</TableCell>
                <TableCell align="right">ยอดรวม</TableCell>
                <TableCell>สถานะ e-Tax</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2" component={RouterLink} href={paths.sales.view(d.id)} sx={{ color: 'inherit' }}>
                      {d.docNo}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatThaiDate(d.date)}</TableCell>
                  <TableCell>{contacts.name(d.contactId)}</TableCell>
                  <TableCell align="right">
                    <Money value={calcDocument(d).total} />
                  </TableCell>
                  <TableCell>
                    <ETaxLabel status={d.etax} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scrollbar>
      ) : (
        <Box>
          <EmptyContent filled title="ไม่มีเอกสาร e-Tax ในงวดนี้" sx={{ py: 6 }} />
        </Box>
      )}

      <MarkUploadedDialog open={markDialog.value} onClose={markDialog.onFalse} docs={signed} />
    </Stack>
  );
}
