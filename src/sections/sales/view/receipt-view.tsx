import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { useBoolean } from 'src/hooks/use-boolean';

import { downloadText } from 'src/utils/download';

import { usePermissions } from 'src/auth';
import { useAccounting, useAccountLookup, useContactLookup } from 'src/store';
import { periodOf, periodLabel, receiptTitle, eTaxReadiness, formatThaiDate, buildReceiptETaxXml } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, ETaxLabel } from 'src/sections/shared';
import { useServerDownload } from 'src/sections/shared/server-reports';

import { ReceiptPreview } from '../receipt-preview';
import { MarkUploadedDialog } from '../../tax/mark-uploaded-dialog';

// ----------------------------------------------------------------------

/** ใบเสร็จรับเงิน (RE) / ใบเสร็จรับเงิน/ใบกำกับภาษีของงานบริการ (RT): ดู พิมพ์ ดาวน์โหลด XML และสถานะ e-Tax */
export function ReceiptView() {
  const { id = '' } = useParams();
  const { data, mode } = useAccounting();
  const serverDownload = useServerDownload();
  const { canWrite } = usePermissions();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const uploadDialog = useBoolean();

  const receipt = data.receipts.find((r) => r.id === id);
  const invoice = receipt ? data.sales.find((s) => s.id === receipt.invoiceId) : undefined;

  if (!receipt || !invoice) {
    return (
      <EmptyContent
        filled
        title="ไม่พบใบเสร็จ"
        action={
          <Button component={RouterLink} href={paths.sales.root} variant="contained" sx={{ mt: 3 }}>
            กลับไปหน้ารายการขาย
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const buyer = contacts.get(receipt.contactId);
  const title = receiptTitle(receipt);
  const isTax = !!receipt.isTaxInvoice;
  const etaxProblems = eTaxReadiness(data.company, buyer);
  const entry = data.journal.find((j) => j.id === receipt.journalId);

  const downloadXml = async () => {
    if (mode === 'api') {
      try {
        await serverDownload(`/files/etax/${encodeURIComponent(receipt.docNo)}.xml`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ดาวน์โหลด XML ไม่สำเร็จ');
      }
      return;
    }
    try {
      const xml = buildReceiptETaxXml({ receipt, invoice, company: data.company, buyer });
      downloadText(`${receipt.docNo}.xml`, xml, 'application/xml;charset=utf-8');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'สร้าง XML ไม่สำเร็จ');
    }
  };

  return (
    <>
      <CustomBreadcrumbs
        heading={`${title} ${receipt.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ขาย', href: paths.sales.root },
          { name: invoice.docNo, href: paths.sales.view(invoice.id) },
          { name: receipt.docNo },
        ]}
        action={
          <Button variant="outlined" startIcon={<Iconify icon="solar:printer-minimalistic-bold" />} onClick={() => window.print()}>
            พิมพ์
          </Button>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <ReceiptPreview receipt={receipt} invoice={invoice} company={data.company} contact={buyer} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Stack spacing={3}>
            <Card sx={{ p: 3 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ตัดลูกหนี้
                  </Typography>
                  <Money value={receipt.amount} variant="subtitle1" />
                </Stack>
                {isTax && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      ภาษีขาย (เดือน{periodLabel(periodOf(receipt.date))})
                    </Typography>
                    <Money value={receipt.vat ?? 0} />
                  </Stack>
                )}
                {isTax && receipt.etax && (
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      e-Tax Invoice
                    </Typography>
                    <ETaxLabel status={receipt.etax} />
                  </Stack>
                )}
                {receipt.etax === 'uploaded' && receipt.etaxUploadedAt && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
                    นำส่งเมื่อ {formatThaiDate(receipt.etaxUploadedAt.slice(0, 10))}
                    {receipt.etaxReference ? ` · อ้างอิง ${receipt.etaxReference}` : ''}
                  </Typography>
                )}
              </Stack>
            </Card>

            {isTax && (
              <Card>
                <CardHeader title="e-Tax Invoice" subheader="ใบเสร็จรับเงิน/ใบกำกับภาษี (T03)" />
                <Stack spacing={2} sx={{ p: 3 }}>
                  {etaxProblems.length > 0 && (
                    <Alert severity="warning" variant="outlined">
                      ยังส่ง e-Tax ไม่ได้: {etaxProblems.join(' · ')}
                    </Alert>
                  )}
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ไฟล์ยังไม่ลงลายมือชื่อดิจิทัล และรหัสประเภทเอกสาร T03 ต้องตรวจกับ ขมธอ.3-2560 ฉบับล่าสุดก่อนใช้งานจริง
                  </Typography>
                  <Button variant="outlined" startIcon={<Iconify icon="solar:file-download-bold" />} onClick={downloadXml}>
                    ดาวน์โหลด XML
                  </Button>
                  {canWrite && receipt.etax === 'signed' && (
                    <Button color="inherit" onClick={uploadDialog.onTrue}>
                      ทำเครื่องหมายว่านำส่งแล้ว
                    </Button>
                  )}
                </Stack>
              </Card>
            )}

            {entry && (
              <Card>
                <CardHeader title="รายการบัญชีที่ลงให้อัตโนมัติ" />
                <Stack spacing={0.5} sx={{ p: 3 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {entry.docNo} · {formatThaiDate(entry.date)}
                  </Typography>
                  {entry.lines.map((l, i) => (
                    <Stack key={i} direction="row" justifyContent="space-between" sx={{ pl: l.credit ? 2 : 0 }}>
                      <Typography variant="body2">
                        {l.debit ? 'Dr' : 'Cr'} {accounts.name(l.accountCode)}
                      </Typography>
                      <Money value={l.debit || l.credit} />
                    </Stack>
                  ))}
                </Stack>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>

      {isTax && <MarkUploadedDialog open={uploadDialog.value} onClose={uploadDialog.onFalse} docs={[receipt]} />}
    </>
  );
}
