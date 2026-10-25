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
  chargesVat,
  lineAmount,
  formatTaxId,
  branchLabel,
  resolveParty,
  calcDocument,
  isTaxDocument,
  salesDocTitle,
  formatThaiDate,
  companySnapshot,
  partyDisplayName,
  adjustmentReasonDisplay,
} from 'src/domain';

import { Scrollbar } from 'src/components/scrollbar';

import { Money, formatAddress, AmountInWords, SignatureBlock } from 'src/sections/shared';

// ----------------------------------------------------------------------

/** ที่อยู่บรรทัดเดียว — ย้ายไปอยู่ที่ `src/sections/shared/print-parts.tsx` คง export ไว้ให้ที่เดิม */
export { formatAddress };

type Props = {
  doc: SalesDoc;
  /** ใช้เฉพาะเมื่อเอกสารไม่มี snapshot ผู้ขาย (ข้อมูลเก่า) */
  company: Company;
  /** ใช้เฉพาะเมื่อเอกสารไม่มี snapshot ผู้ซื้อ (ข้อมูลเก่า) */
  contact: Contact | undefined;
  /** ใบลดหนี้/ใบเพิ่มหนี้: ใบกำกับเดิม */
  referenced?: SalesDoc;
  /** ใบลดหนี้ของงานบริการหลังรับเงินครบ: ใบเสร็จรับเงิน/ใบกำกับภาษีที่อ้างถึง */
  referencedReceipt?: Receipt;
};

/**
 * หน้าตาเอกสารสำหรับดูและพิมพ์ — มีองค์ประกอบใบกำกับภาษีเต็มรูปตาม ม.86/4
 * ใบลดหนี้/ใบเพิ่มหนี้พิมพ์มูลค่าตามใบกำกับเดิม มูลค่าที่ถูกต้อง ผลต่าง ภาษีของผลต่าง และเหตุผล (ม.86/9, 86/10)
 * ท้ายเอกสาร: จำนวนเงินเป็นตัวอักษร + ช่องลงชื่อ
 * ผู้ขาย/ผู้ซื้ออ่านจาก snapshot ณ วันออกเอกสาร (แก้ข้อมูลบริษัท/ลูกค้าภายหลังแล้วเอกสารเดิมไม่เปลี่ยน)
 * บริษัทไม่จด VAT พิมพ์เป็น "ใบแจ้งหนี้/ใบเสร็จรับเงิน" ไม่มีบรรทัด VAT
 */
export function DocumentPreview({ doc, company, contact, referenced, referencedReceipt }: Props) {
  const t = calcDocument(doc);
  const isCredit = doc.kind === 'credit-note';
  const isAdjustment = doc.kind !== 'tax-invoice';
  const title = salesDocTitle(doc);
  // ใบแจ้งหนี้งานบริการแสดง VAT ด้วย (ยังไม่ใช่ใบกำกับภาษี — ใบกำกับออกตอนรับเงิน)
  const showVat = chargesVat(doc) && (isTaxDocument(doc) || doc.saleType === 'service');
  const serviceInvoice = doc.kind === 'tax-invoice' && doc.saleType === 'service' && !isTaxDocument(doc) && chargesVat(doc);
  const seller = doc.seller ?? companySnapshot(company);
  const buyer = resolveParty(doc.buyer, contact);

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
          <Typography variant="h5">{title}</Typography>
          <Typography variant="subtitle1">{doc.docNo}</Typography>
          <Typography variant="body2">วันที่ {formatThaiDate(doc.date)}</Typography>
          {!isAdjustment && <Typography variant="body2">ครบกำหนด {formatThaiDate(doc.dueDate)}</Typography>}
        </Box>
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="space-between">
        <Box>
          <Typography variant="overline" sx={{ color: 'text.disabled' }}>
            ลูกค้า
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
        {isAdjustment && referenced && (
          <Box sx={{ maxWidth: 360 }}>
            <Typography variant="overline" sx={{ color: 'text.disabled' }}>
              อ้างถึง
            </Typography>
            {referencedReceipt ? (
              <Typography variant="body2">
                ใบเสร็จรับเงิน/ใบกำกับภาษีเลขที่ {referencedReceipt.docNo} ลงวันที่ {formatThaiDate(referencedReceipt.date)} (ตาม
                ใบแจ้งหนี้ {referenced.docNo})
              </Typography>
            ) : (
              <Typography variant="body2">
                {isTaxDocument(referenced) ? salesDocTitle(referenced) : 'ใบแจ้งหนี้'}เลขที่ {referenced.docNo} ลงวันที่{' '}
                {formatThaiDate(referenced.date)}
              </Typography>
            )}
            <Typography variant="body2">
              เหตุผล: {adjustmentReasonDisplay({ kind: doc.kind === 'debit-note' ? 'debit-note' : 'credit-note', reasonCode: doc.reasonCode, reason: doc.reason })}
            </Typography>
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

      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={3} sx={{ mt: 3 }}>
        {isAdjustment ? (
          <Stack spacing={1} sx={{ width: { xs: 1, sm: 360 } }}>
            {[
              { label: 'มูลค่าสินค้า/บริการตามใบกำกับเดิม', value: doc.originalNet ?? 0 },
              { label: 'มูลค่าที่ถูกต้องตามจริง', value: doc.correctNet ?? 0 },
              { label: `ผลต่าง (${isCredit ? 'ลดลง' : 'เพิ่มขึ้น'})`, value: t.net },
            ].map((r) => (
              <Stack key={r.label} direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {r.label}
                </Typography>
                <Money value={r.value} />
              </Stack>
            ))}
          </Stack>
        ) : (
          <Box />
        )}
        <Stack spacing={1} sx={{ width: { xs: 1, sm: 320 } }}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {isAdjustment ? `มูลค่าผลต่าง${isCredit ? 'ที่ลดลง' : 'ที่เพิ่มขึ้น'}` : 'มูลค่าก่อนภาษี'}
            </Typography>
            <Money value={t.net} />
          </Stack>
          {showVat && (
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {isAdjustment ? `ภาษีมูลค่าเพิ่มของผลต่าง ${doc.vatRate}%` : `ภาษีมูลค่าเพิ่ม ${doc.vatRate}%`}
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

      {serviceInvoice && (
        <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
          เอกสารนี้ไม่ใช่ใบกำกับภาษี — ใบเสร็จรับเงิน/ใบกำกับภาษีจะออกให้เมื่อได้รับชำระ (ภาษีมูลค่าเพิ่มถึงกำหนดเมื่อรับชำระค่าบริการ)
        </Typography>
      )}

      {doc.note && (
        <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
          หมายเหตุ: {doc.note}
        </Typography>
      )}

      <SignatureBlock
        roles={
          isAdjustment || serviceInvoice
            ? ['ผู้รับเอกสาร', 'ผู้มีอำนาจลงนาม']
            : ['ผู้รับสินค้า/บริการ', 'ผู้ส่งสินค้า', 'ผู้มีอำนาจลงนาม']
        }
      />
    </Card>
  );
}
