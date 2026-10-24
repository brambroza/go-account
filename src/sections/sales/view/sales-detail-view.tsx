import { useMemo } from 'react';

import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { useBoolean } from 'src/hooks/use-boolean';

import { downloadText } from 'src/utils/download';

import { outstandingOf, useAccounting, useAccountLookup, useContactLookup } from 'src/store';
import {
  todayISO,
  toSatang,
  salesSign,
  calcDocument,
  buildETaxXml,
  creditableOf,
  receiptTitle,
  deferredVatOf,
  eTaxReadiness,
  isTaxDocument,
  salesDocTitle,
  formatThaiDate,
  customerCreditOf,
  isServiceInvoice,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, ETaxLabel, SalesStatusLabel } from 'src/sections/shared';

import { RefundDialog } from '../refund-dialog';
import { DocumentPreview } from '../document-preview';
import { ReceivePaymentDialog } from '../receive-payment-dialog';
import { MarkUploadedDialog } from '../../tax/mark-uploaded-dialog';

// ----------------------------------------------------------------------

/** รายละเอียดเอกสารขาย: ตัวอย่างพิมพ์ (จาก snapshot), รับชำระ, ลดหนี้, คืนเงินลูกค้า, e-Tax */
export function SalesDetailView() {
  const { id = '' } = useParams();
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const payDialog = useBoolean();
  const refundDialog = useBoolean();
  const uploadDialog = useBoolean();

  const doc = data.sales.find((s) => s.id === id);
  const buyer = doc ? contacts.get(doc.contactId) : undefined;
  const referenced = doc?.refDocId ? data.sales.find((s) => s.id === doc.refDocId) : undefined;
  const referencedReceipt = doc?.refReceiptId ? data.receipts.find((r) => r.id === doc.refReceiptId) : undefined;

  const related = useMemo(() => {
    if (!doc) return { receipts: [], credits: [], journal: [] };
    const receipts = data.receipts.filter((r) => r.invoiceId === doc.id);
    const credits = data.sales.filter((s) => s.refDocId === doc.id);
    const journalIds = new Set([doc.journalId, ...receipts.map((r) => r.journalId)]);
    return { receipts, credits, journal: data.journal.filter((j) => journalIds.has(j.id)) };
  }, [data, doc]);

  if (!doc) {
    return (
      <EmptyContent
        filled
        title="ไม่พบเอกสาร"
        description="เอกสารอาจถูกล้างไปพร้อมข้อมูลตัวอย่าง"
        action={
          <Button component={RouterLink} href={paths.sales.root} variant="contained" sx={{ mt: 3 }}>
            กลับไปหน้ารายการขาย
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const outstanding = outstandingOf(data, doc);
  const creditable = creditableOf(data, doc);
  const customerCredit = customerCreditOf(data, doc.contactId);
  const isInvoice = doc.kind === 'tax-invoice';
  const isTax = isTaxDocument(doc);
  const title = salesDocTitle(doc);
  const overdue = isInvoice && outstanding > 0 && doc.dueDate < todayISO();
  const etaxProblems = eTaxReadiness(data.company, buyer);
  const showETax = isTax && doc.etax !== 'not-required';
  const service = isServiceInvoice(doc);
  const deferredVat = service ? deferredVatOf(data, doc) : 0;
  // ใบเพิ่มหนี้ไม่รองรับงานบริการ (ออกใบแจ้งหนี้ใหม่) และยอดยกมา (ปรับในระบบเดิม)
  const canDebit = isInvoice && doc.status !== 'cancelled' && !doc.opening && !(doc.saleType === 'service' && !isTax);
  const canCredit = isInvoice && toSatang(creditable) > 0 && !doc.opening;

  const downloadXml = () => {
    try {
      const xml = buildETaxXml({ doc, company: data.company, buyer, referenced, referencedReceipt });
      downloadText(`${doc.docNo}.xml`, xml, 'application/xml;charset=utf-8');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'สร้าง XML ไม่สำเร็จ');
    }
  };

  return (
    <>
      <CustomBreadcrumbs
        heading={`${title} ${doc.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ขาย', href: paths.sales.root },
          { name: doc.docNo },
        ]}
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<Iconify icon="solar:printer-minimalistic-bold" />} onClick={() => window.print()}>
              พิมพ์
            </Button>
            {canCredit && (
              <Button
                component={RouterLink}
                href={paths.sales.creditNote(doc.id)}
                variant="outlined"
                color="error"
                startIcon={<Iconify icon="solar:undo-left-round-bold" />}
              >
                ออกใบลดหนี้
              </Button>
            )}
            {canDebit && (
              <Button
                component={RouterLink}
                href={paths.sales.debitNote(doc.id)}
                variant="outlined"
                startIcon={<Iconify icon="mingcute:add-line" />}
              >
                ออกใบเพิ่มหนี้
              </Button>
            )}
            {toSatang(customerCredit) > 0 && (
              <Button variant="outlined" startIcon={<Iconify icon="solar:wallet-money-bold" />} onClick={refundDialog.onTrue}>
                คืนเงินลูกค้า
              </Button>
            )}
            {isInvoice && toSatang(outstanding) > 0 && (
              <Button variant="contained" startIcon={<Iconify icon="solar:hand-money-bold" />} onClick={payDialog.onTrue}>
                รับชำระ
              </Button>
            )}
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <DocumentPreview
            doc={doc}
            company={data.company}
            contact={buyer}
            referenced={referenced}
            referencedReceipt={referencedReceipt}
          />
        </Grid>

        <Grid item xs={12} lg={4}>
          <Stack spacing={3}>
            <Card sx={{ p: 3 }}>
              <Stack spacing={1.5}>
                {doc.kind === 'tax-invoice' && (
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      สถานะ
                    </Typography>
                    <SalesStatusLabel status={doc.status} overdue={overdue} />
                  </Stack>
                )}
                {doc.kind === 'tax-invoice' && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ค้างชำระ
                    </Typography>
                    <Money value={outstanding} variant="subtitle1" />
                  </Stack>
                )}
                {isInvoice && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ลดหนี้ได้อีก
                    </Typography>
                    <Money value={creditable} />
                  </Stack>
                )}
                {service && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ภาษีขายยังไม่ถึงกำหนด (ออกใบกำกับตอนรับเงิน)
                    </Typography>
                    <Money value={deferredVat} />
                  </Stack>
                )}
                {doc.opening && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    ยอดยกมาจากระบบเดิม — ภาษีขายยื่นในระบบเดิมแล้ว รับชำระได้ตามปกติ ลดหนี้/เพิ่มหนี้ให้ทำในระบบเดิม
                  </Typography>
                )}
                {toSatang(customerCredit) > 0 && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      เงินรอคืนลูกค้า (ทุกเอกสาร)
                    </Typography>
                    <Money value={customerCredit} sx={{ color: 'warning.main' }} />
                  </Stack>
                )}
                {isTax && (
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      e-Tax Invoice
                    </Typography>
                    <ETaxLabel status={doc.etax} />
                  </Stack>
                )}
                {doc.etax === 'uploaded' && doc.etaxUploadedAt && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
                    นำส่งเมื่อ {formatThaiDate(doc.etaxUploadedAt.slice(0, 10))}
                    {doc.etaxReference ? ` · อ้างอิง ${doc.etaxReference}` : ''}
                  </Typography>
                )}
              </Stack>
            </Card>

            {showETax && (
              <Card>
                <CardHeader title="e-Tax Invoice" subheader="XML ตามโครงสร้าง ETDA ขมธอ.3-2560" />
                <Stack spacing={2} sx={{ p: 3 }}>
                  {etaxProblems.length > 0 && (
                    <Alert severity="warning" variant="outlined">
                      ยังส่ง e-Tax ไม่ได้: {etaxProblems.join(' · ')}
                    </Alert>
                  )}
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ไฟล์ที่ดาวน์โหลดได้ยังไม่ลงลายมือชื่อดิจิทัล — การลงนามด้วยใบรับรอง CA ของบริษัทจะทำที่ระบบหลังบ้าน
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<Iconify icon="solar:file-download-bold" />}
                    onClick={downloadXml}
                  >
                    ดาวน์โหลด XML
                  </Button>
                  {doc.etax === 'signed' && (
                    <Button color="inherit" onClick={uploadDialog.onTrue}>
                      ทำเครื่องหมายว่านำส่งแล้ว
                    </Button>
                  )}
                </Stack>
              </Card>
            )}

            {(related.receipts.length > 0 || related.credits.length > 0) && (
              <Card>
                <CardHeader title="รับชำระ / ลดหนี้ / เพิ่มหนี้" />
                <Stack spacing={1.5} sx={{ p: 3 }} divider={<Divider sx={{ borderStyle: 'dashed' }} />}>
                  {related.receipts.map((r) => (
                    <Stack key={r.id} direction="row" justifyContent="space-between">
                      <div>
                        <Typography variant="subtitle2" component={RouterLink} href={paths.sales.receipt(r.id)} sx={{ color: 'inherit' }}>
                          {r.docNo}
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                          {receiptTitle(r)} · {formatThaiDate(r.date)}
                          {r.isTaxInvoice ? ` · VAT ${(r.vat ?? 0).toFixed(2)}` : ''}
                          {r.whtAmount ? ` · ถูกหัก ณ ที่จ่าย ${r.whtAmount.toFixed(2)}` : ''}
                        </Typography>
                      </div>
                      <Money value={r.amount} />
                    </Stack>
                  ))}
                  {related.credits.map((c) => (
                    <Stack key={c.id} direction="row" justifyContent="space-between">
                      <div>
                        <Typography variant="subtitle2" component={RouterLink} href={paths.sales.view(c.id)} sx={{ color: 'inherit' }}>
                          {c.docNo}
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                          {formatThaiDate(c.date)} · {c.reason}
                        </Typography>
                      </div>
                      <Money value={calcDocument(c).total * salesSign(c)} signed />
                    </Stack>
                  ))}
                </Stack>
              </Card>
            )}

            <Card>
              <CardHeader title="รายการบัญชีที่ลงให้อัตโนมัติ" />
              <Stack spacing={2} sx={{ p: 3 }}>
                {related.journal.map((j) => (
                  <Stack key={j.id} spacing={0.5}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {j.docNo} · {formatThaiDate(j.date)}
                    </Typography>
                    {j.lines.map((l, i) => (
                      <Stack key={i} direction="row" justifyContent="space-between" sx={{ pl: l.credit ? 2 : 0 }}>
                        <Typography variant="body2">
                          {l.debit ? 'Dr' : 'Cr'} {accounts.name(l.accountCode)}
                        </Typography>
                        <Money value={l.debit || l.credit} />
                      </Stack>
                    ))}
                  </Stack>
                ))}
              </Stack>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      {isInvoice && <ReceivePaymentDialog open={payDialog.value} onClose={payDialog.onFalse} invoice={doc} />}
      <RefundDialog open={refundDialog.value} onClose={refundDialog.onFalse} contactId={doc.contactId} />
      {showETax && <MarkUploadedDialog open={uploadDialog.value} onClose={uploadDialog.onFalse} docs={[doc]} />}
    </>
  );
}
