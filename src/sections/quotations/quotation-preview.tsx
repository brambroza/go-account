import type { Company, Contact, Quotation } from 'src/domain';

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

import {
  lineAmount,
  formatTaxId,
  branchLabel,
  resolveParty,
  formatThaiDate,
  quotationTotals,
  companySnapshot,
  partyDisplayName,
  quotationValidUntil,
} from 'src/domain';

import { Scrollbar } from 'src/components/scrollbar';

import { Money, formatAddress, AmountInWords, SignatureBlock } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { quotation: Quotation; company: Company; contact: Contact | undefined };

/** ใบเสนอราคาสำหรับดู/พิมพ์ — ไม่ใช่เอกสารภาษี ผู้ซื้อแสดงจาก snapshot ล่าสุดที่บันทึก */
export function QuotationPreview({ quotation: q, company, contact }: Props) {
  const t = quotationTotals(q);
  const seller = companySnapshot(company);
  const buyer = resolveParty(q.buyer, contact);
  const showVat = q.vatMode !== 'none' && q.vatRate > 0;

  return (
    <Card sx={{ p: { xs: 3, md: 5 } }} className="print-area">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h6">{seller.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatAddress(seller.address)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            เลขประจำตัวผู้เสียภาษี {formatTaxId(seller.taxId)} · {branchLabel(seller.branchNo)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: { sm: 'right' } }}>
          <Typography variant="h5">ใบเสนอราคา</Typography>
          <Typography variant="subtitle1">{q.docNo}</Typography>
          <Typography variant="body2">วันที่ {formatThaiDate(q.date)}</Typography>
          <Typography variant="body2">
            ยืนราคา {q.validDays} วัน (ถึง {formatThaiDate(quotationValidUntil(q))})
          </Typography>
        </Box>
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Box>
        <Typography variant="overline" sx={{ color: 'text.disabled' }}>
          เสนอราคาแก่
        </Typography>
        <Typography variant="subtitle2">{partyDisplayName(buyer)}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {formatAddress(buyer?.address)}
        </Typography>
        {buyer?.taxId && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            เลขประจำตัวผู้เสียภาษี {formatTaxId(buyer.taxId)} · {branchLabel(buyer.branchNo)}
          </Typography>
        )}
      </Box>

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
            {q.lines.map((l, i) => (
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
              มูลค่าก่อนภาษี
            </Typography>
            <Money value={t.net} />
          </Stack>
          {showVat && (
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                ภาษีมูลค่าเพิ่ม {q.vatRate}%
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

      <Box sx={{ mt: 2 }}>
        <AmountInWords value={t.total} />
      </Box>

      <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
        เอกสารนี้ไม่ใช่ใบกำกับภาษี — ราคาอาจเปลี่ยนแปลงหลังพ้นกำหนดยืนราคา
        {q.saleType === 'service' ? ' · งานบริการ: ใบกำกับภาษีออกเมื่อได้รับชำระ' : ''}
      </Typography>
      {q.note && (
        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
          หมายเหตุ: {q.note}
        </Typography>
      )}

      <SignatureBlock roles={['ผู้เสนอราคา', 'ผู้อนุมัติสั่งซื้อ (ลูกค้า)']} />
    </Card>
  );
}
