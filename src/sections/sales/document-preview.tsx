import type { Address, Company, Contact, SalesDoc } from 'src/domain';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';

import { lineAmount, formatTaxId, branchLabel, calcDocument, formatThaiDate, contactDisplayName } from 'src/domain';

import { Scrollbar } from 'src/components/scrollbar';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

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

type Props = {
  doc: SalesDoc;
  company: Company;
  buyer: Contact | undefined;
  referenced?: SalesDoc;
};

/** หน้าตาเอกสารสำหรับดูและพิมพ์ — มีองค์ประกอบใบกำกับภาษีเต็มรูปตาม ม.86/4 */
export function DocumentPreview({ doc, company, buyer, referenced }: Props) {
  const t = calcDocument(doc);
  const isCredit = doc.kind === 'credit-note';
  const title = isCredit ? 'ใบลดหนี้ / ใบกำกับภาษี' : 'ใบกำกับภาษี / ใบแจ้งหนี้';

  return (
    <Card sx={{ p: { xs: 3, md: 5 } }} className="print-area">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h6">{company.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatAddress(company.address)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            เลขประจำตัวผู้เสียภาษี {formatTaxId(company.taxId)} · {branchLabel(company.branchNo)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: { sm: 'right' } }}>
          <Typography variant="h5">{title}</Typography>
          <Typography variant="subtitle1">{doc.docNo}</Typography>
          <Typography variant="body2">วันที่ {formatThaiDate(doc.date)}</Typography>
          {!isCredit && <Typography variant="body2">ครบกำหนด {formatThaiDate(doc.dueDate)}</Typography>}
        </Box>
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="space-between">
        <Box>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            ลูกค้า
          </Typography>
          <Typography variant="subtitle2">{contactDisplayName(buyer)}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatAddress(buyer?.address)}
          </Typography>
          {buyer?.taxId && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              เลขประจำตัวผู้เสียภาษี {formatTaxId(buyer.taxId)} · {branchLabel(buyer.branchNo)}
            </Typography>
          )}
        </Box>
        {isCredit && referenced && (
          <Box sx={{ maxWidth: 320 }}>
            <Typography variant="overline" sx={{ color: 'text.disabled' }}>
              อ้างถึง
            </Typography>
            <Typography variant="body2">
              ใบกำกับภาษีเลขที่ {referenced.docNo} ลงวันที่ {formatThaiDate(referenced.date)}
            </Typography>
            <Typography variant="body2">มูลค่าเดิม <Money value={calcDocument(referenced).net} /> บาท</Typography>
            <Typography variant="body2">เหตุผล: {doc.reason}</Typography>
          </Box>
        )}
      </Stack>

      <Scrollbar sx={{ mt: 3 }}>
        <Table size="small" sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}>#</TableCell>
              <TableCell>รายการ</TableCell>
              <TableCell align="right">จำนวน</TableCell>
              <TableCell align="right">ราคา/หน่วย</TableCell>
              <TableCell align="right">ส่วนลด</TableCell>
              <TableCell align="right">จำนวนเงิน</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {doc.lines.map((l, i) => (
              <TableRow key={l.id}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{l.description}</TableCell>
                <TableCell align="right">{l.qty.toLocaleString('th-TH')}</TableCell>
                <TableCell align="right">
                  <Money value={l.unitPrice} />
                </TableCell>
                <TableCell align="right">
                  <Money value={l.discount} hideZero />
                </TableCell>
                <TableCell align="right">
                  <Money value={lineAmount(l)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Scrollbar>

      <Stack alignItems="flex-end" sx={{ mt: 3 }}>
        <Stack spacing={1} sx={{ width: { xs: 1, sm: 320 } }}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {isCredit ? 'มูลค่าที่ลดลง' : 'มูลค่าก่อนภาษี'}
            </Typography>
            <Money value={t.net} />
          </Stack>
          {doc.vatMode !== 'none' && (
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                ภาษีมูลค่าเพิ่ม {doc.vatRate}%
              </Typography>
              <Money value={t.vat} />
            </Stack>
          )}
          <Divider sx={{ borderStyle: 'dashed' }} />
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="subtitle1">รวมทั้งสิ้น</Typography>
            <Money value={t.total} variant="subtitle1" />
          </Stack>
        </Stack>
      </Stack>

      {doc.note && (
        <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
          หมายเหตุ: {doc.note}
        </Typography>
      )}
    </Card>
  );
}
