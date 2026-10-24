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

import { downloadText } from 'src/utils/download';

import { useAccounting, setETaxStatus, useContactLookup } from 'src/store';
import { inPeriod, buildETaxXml, calcDocument, formatThaiDate } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';

import { Money, ETaxLabel } from 'src/sections/shared';

// ----------------------------------------------------------------------

export function ETaxTab({ period }: { period: Period }) {
  const { data, run } = useAccounting();
  const contacts = useContactLookup();

  const docs = useMemo(
    () => data.sales.filter((s) => s.etax !== 'not-required' && inPeriod(s.date, period)).sort((a, b) => a.docNo.localeCompare(b.docNo)),
    [data.sales, period]
  );
  const waiting = docs.filter((d) => d.etax === 'signed' || d.etax === 'pending-sign');

  const downloadAll = () => {
    waiting.forEach((doc, i) => {
      const buyer = contacts.get(doc.contactId);
      if (!buyer) return;
      const referenced = doc.refDocId ? data.sales.find((s) => s.id === doc.refDocId) : undefined;
      // เว้นจังหวะเล็กน้อยให้ browser ยอมดาวน์โหลดหลายไฟล์
      setTimeout(
        () => downloadText(`${doc.docNo}.xml`, buildETaxXml({ doc, company: data.company, buyer, referenced }), 'application/xml;charset=utf-8'),
        i * 300
      );
    });
  };

  const markUploaded = () => {
    run((s) => ({ state: setETaxStatus(s, waiting.filter((d) => d.etax === 'signed').map((d) => d.id), 'uploaded') }));
    toast.success('บันทึกว่านำส่งแล้ว');
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
          disabled={!waiting.some((d) => d.etax === 'signed')}
          onClick={markUploaded}
          startIcon={<Iconify icon="solar:check-circle-bold" />}
        >
          ทำเครื่องหมายว่านำส่งแล้ว
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
    </Stack>
  );
}
