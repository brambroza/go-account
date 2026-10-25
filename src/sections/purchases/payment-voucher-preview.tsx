import type { Payment, Company, PurchaseDoc } from 'src/domain';

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

import { subBaht, formatTaxId, branchLabel, calcDocument, formatThaiDate, companySnapshot, partyDisplayName } from 'src/domain';

import { Money, formatAddress, AmountInWords, SignatureBlock } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = {
  payment: Payment;
  purchase: PurchaseDoc;
  /** ใช้เมื่อใบสำคัญจ่ายไม่มี snapshot ผู้จ่าย (ข้อมูลเก่า) */
  company: Company;
  /** ยอดจ่ายรวมของเอกสารซื้อจนถึงใบนี้ (รวมใบนี้) — แสดงเมื่อแบ่งจ่าย */
  paidToDate: number;
  accountName: string;
};

/** ใบสำคัญจ่าย (PV) สำหรับดูและพิมพ์ — 1 ใบต่อการจ่าย 1 ครั้ง (แบ่งจ่ายแสดงยอดคงค้าง) */
export function PaymentVoucherPreview({ payment, purchase, company, paidToDate, accountName }: Props) {
  const payer = payment.payer ?? companySnapshot(company);
  const payee = payment.payee ?? purchase.supplier;
  const {total} = calcDocument(purchase);
  const partial = paidToDate < total || payment.amount < total;

  return (
    <Card sx={{ p: { xs: 3, md: 5 } }} className="print-area">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h6">{payer.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatAddress(payer.address)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            เลขประจำตัวผู้เสียภาษี {formatTaxId(payer.taxId)} · {branchLabel(payer.branchNo)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: { sm: 'right' } }}>
          <Typography variant="h5">ใบสำคัญจ่าย</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Payment Voucher
          </Typography>
          <Typography variant="subtitle1">{payment.docNo}</Typography>
          <Typography variant="body2">วันที่ {formatThaiDate(payment.date)}</Typography>
        </Box>
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="space-between">
        <Box>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            จ่ายให้
          </Typography>
          <Typography variant="subtitle2">{partyDisplayName(payee)}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatAddress(payee?.address)}
          </Typography>
          {payee?.taxId && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              เลขประจำตัวผู้เสียภาษี {formatTaxId(payee.taxId)}
            </Typography>
          )}
        </Box>
        <Box sx={{ maxWidth: 320 }}>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            อ้างถึง
          </Typography>
          <Typography variant="body2">เอกสารซื้อ {purchase.docNo}</Typography>
          {purchase.supplierInvoiceNo && (
            <Typography variant="body2">
              ใบกำกับ/ใบแจ้งหนี้ผู้ขาย {purchase.supplierInvoiceNo}
              {purchase.supplierInvoiceDate ? ` ลงวันที่ ${formatThaiDate(purchase.supplierInvoiceDate)}` : ''}
            </Typography>
          )}
          {payment.whtCertNo && <Typography variant="body2">หนังสือรับรอง 50 ทวิ เลขที่ {payment.whtCertNo}</Typography>}
        </Box>
      </Stack>

      <Table size="small" sx={{ mt: 3 }}>
        <TableHead>
          <TableRow>
            <TableCell>รายการ</TableCell>
            <TableCell align="right" sx={{ width: 180 }}>
              จำนวนเงิน
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>
              ชำระหนี้ตาม {purchase.docNo}
              {purchase.lines[0] ? ` — ${purchase.lines[0].description}${purchase.lines.length > 1 ? ' ฯลฯ' : ''}` : ''}
              {partial ? ' (แบ่งจ่าย)' : ''}
            </TableCell>
            <TableCell align="right">
              <Money value={payment.amount} />
            </TableCell>
          </TableRow>
          {payment.whtItems.map((i) => (
            <TableRow key={`${i.incomeType}-${i.rate}`}>
              <TableCell sx={{ color: 'text.secondary' }}>
                หัก ภาษี ณ ที่จ่าย {i.incomeType} {i.rate}% ของ <Money value={i.base} />
              </TableCell>
              <TableCell align="right">
                <Money value={-i.tax} />
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <Typography variant="subtitle2">จ่ายสุทธิ — จาก {accountName}</Typography>
            </TableCell>
            <TableCell align="right">
              <Money value={payment.netPaid} variant="subtitle2" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {partial && (
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            ยอดเอกสาร <Money value={total} />
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            จ่ายแล้วรวมใบนี้ <Money value={paidToDate} />
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            คงค้าง <Money value={subBaht(total, paidToDate)} />
          </Typography>
        </Stack>
      )}

      <Box sx={{ mt: 2 }}>
        <AmountInWords value={payment.netPaid} label="จ่ายสุทธิ (ตัวอักษร)" />
      </Box>

      <SignatureBlock roles={['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ', 'ผู้รับเงิน']} />
    </Card>
  );
}
