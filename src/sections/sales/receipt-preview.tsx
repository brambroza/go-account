import type { Company, Contact, Receipt, SalesDoc } from 'src/domain';

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
  subBaht,
  formatTaxId,
  branchLabel,
  resolveParty,
  receiptTitle,
  salesDocTitle,
  formatThaiDate,
  companySnapshot,
  partyDisplayName,
} from 'src/domain';

import { Scrollbar } from 'src/components/scrollbar';

import { Money, formatAddress, AmountInWords, SignatureBlock } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = {
  receipt: Receipt;
  invoice: SalesDoc;
  /** ใช้เฉพาะเมื่อใบเสร็จไม่มี snapshot ผู้ขาย (ข้อมูลเก่า) */
  company: Company;
  /** ใช้เฉพาะเมื่อใบเสร็จไม่มี snapshot ผู้ซื้อ (ข้อมูลเก่า) */
  contact: Contact | undefined;
};

/**
 * ใบเสร็จรับเงิน / ใบเสร็จรับเงิน/ใบกำกับภาษี (งานบริการ ม.78/1) ของการรับเงิน 1 ครั้ง — ดูและพิมพ์
 * ใบกำกับภาษีพิมพ์มูลค่าก่อนภาษีและ VAT ของส่วนที่รับครั้งนี้ (ตัวเลขจาก domain ที่บันทึกในใบเสร็จ) อ้างใบแจ้งหนี้เดิม
 */
export function ReceiptPreview({ receipt, invoice, company, contact }: Props) {
  const seller = receipt.seller ?? companySnapshot(company);
  const buyer = resolveParty(receipt.buyer, contact);
  const isTax = !!receipt.isTaxInvoice;
  const vat = receipt.vat ?? 0;
  const net = subBaht(receipt.amount, vat);
  const received = subBaht(receipt.amount, receipt.whtAmount);

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
          <Typography variant="h5">{receiptTitle(receipt)}</Typography>
          <Typography variant="subtitle1">{receipt.docNo}</Typography>
          <Typography variant="body2">วันที่ {formatThaiDate(receipt.date)}</Typography>
        </Box>
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="space-between">
        <Box>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            ได้รับเงินจาก
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
        <Box sx={{ maxWidth: 360 }}>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            อ้างถึง
          </Typography>
          <Typography variant="body2">
            {invoice.opening ? 'ยอดยกมา' : salesDocTitle(invoice)}เลขที่ {invoice.docNo} ลงวันที่ {formatThaiDate(invoice.date)}
          </Typography>
        </Box>
      </Stack>

      <Scrollbar sx={{ mt: 3 }}>
        <Table size="small" sx={{ minWidth: 480 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}>#</TableCell>
              <TableCell>รายการ</TableCell>
              <TableCell align="right">จำนวนเงิน</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>1</TableCell>
              <TableCell>
                รับชำระ{isTax ? 'ค่าบริการ' : ''}ตามเลขที่ {invoice.docNo}
                {invoice.lines[0] && !invoice.opening && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    {invoice.lines.map((l) => l.description).join(', ')}
                  </Typography>
                )}
              </TableCell>
              <TableCell align="right">
                <Money value={isTax ? net : receipt.amount} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Scrollbar>

      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
        <Stack spacing={1} sx={{ width: { xs: 1, sm: 340 } }}>
          {isTax && (
            <>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  มูลค่าก่อนภาษี
                </Typography>
                <Money value={net} />
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  ภาษีมูลค่าเพิ่ม {invoice.vatRate}%
                </Typography>
                <Money value={vat} />
              </Stack>
            </>
          )}
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="subtitle2">รวมเงินที่รับชำระ</Typography>
            <Money value={receipt.amount} variant="subtitle2" />
          </Stack>
          {receipt.whtAmount > 0 && (
            <>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  หัก ภาษีถูกหัก ณ ที่จ่าย
                </Typography>
                <Money value={receipt.whtAmount} />
              </Stack>
              <Divider sx={{ borderStyle: 'dashed' }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="subtitle1">รับเงินสุทธิ</Typography>
                <Money value={received} variant="subtitle1" />
              </Stack>
            </>
          )}
        </Stack>
      </Stack>

      <Box sx={{ mt: 2 }}>
        <AmountInWords value={receipt.amount} />
      </Box>

      <SignatureBlock roles={['ผู้จ่ายเงิน', 'ผู้รับเงิน']} />
    </Card>
  );
}
