import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { useAccounting, useAccountLookup, useContactLookup } from 'src/store';
import {
  sumBaht,
  toSatang,
  paymentsOf,
  lineAmount,
  formatTaxId,
  branchLabel,
  periodLabel,
  resolveParty,
  calcDocument,
  periodFromKey,
  formatThaiDate,
  purchaseTotals,
  whtSummaryLabel,
  partyDisplayName,
  purchaseCreditsOf,
  purchaseOutstanding,
  purchaseCreditedTotal,
  purchaseAdjustedWhtGroups,
} from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { Money, PaidLabel, formatAddress } from 'src/sections/shared';

import { PayPurchaseDialog } from '../pay-purchase-dialog';

// ----------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right' }}>{children}</Box>
    </Stack>
  );
}

/**
 * รายละเอียดเอกสารซื้อ: บรรทัดรายการ + หัก ณ ที่จ่ายต่อบรรทัด, สิทธิภาษีซื้อ (เดือนใช้สิทธิ),
 * ใบสำคัญจ่าย/50 ทวิ ทุกครั้งที่จ่าย, ใบลดหนี้จากผู้ขาย, สถานะ/ยอดค้าง และรายการบัญชี
 */
export function PurchaseDetailView() {
  const { id = '' } = useParams();
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const accounts = useAccountLookup();
  const [paying, setPaying] = useState(false);

  const doc = data.purchases.find((p) => p.id === id);
  const related = useMemo(() => {
    if (!doc) return { payments: [], credits: [], journal: [] };
    const payments = paymentsOf(data, doc.id);
    const credits = purchaseCreditsOf(data, doc.id);
    const ids = new Set([doc.journalId, ...payments.map((p) => p.journalId), ...credits.map((c) => c.journalId)]);
    return { payments, credits, journal: data.journal.filter((j) => ids.has(j.id) && j.source !== 'opening') };
  }, [data, doc]);

  if (!doc) {
    return (
      <EmptyContent
        filled
        title="ไม่พบเอกสารซื้อ"
        action={
          <Button component={RouterLink} href={paths.purchases.root} variant="contained" sx={{ mt: 3 }}>
            กลับไปหน้าซื้อ / ค่าใช้จ่าย
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const supplier = resolveParty(doc.supplier, contacts.get(doc.contactId));
  const t = purchaseTotals(doc);
  const outstanding = purchaseOutstanding(data, doc);
  const credited = purchaseCreditedTotal(data, doc);
  const wht = purchaseAdjustedWhtGroups(data, doc);
  const canCredit = !doc.opening && toSatang(outstanding) > 0;

  return (
    <>
      <CustomBreadcrumbs
        heading={`${doc.opening ? 'ยอดยกมา' : 'เอกสารซื้อ'} ${doc.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ซื้อ / ค่าใช้จ่าย', href: paths.purchases.root },
          { name: doc.docNo },
        ]}
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {canCredit && (
              <Button
                component={RouterLink}
                href={paths.purchases.creditNote(doc.id)}
                variant="outlined"
                color="error"
                startIcon={<Iconify icon="solar:undo-left-round-bold" />}
              >
                บันทึกใบลดหนี้จากผู้ขาย
              </Button>
            )}
            {toSatang(outstanding) > 0 && (
              <Button variant="contained" startIcon={<Iconify icon="solar:hand-money-bold" />} onClick={() => setPaying(true)}>
                จ่ายชำระ
              </Button>
            )}
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Card sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="overline" sx={{ color: 'text.disabled' }}>
                  ผู้ขาย
                </Typography>
                <Typography variant="subtitle1">{partyDisplayName(supplier)}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {formatAddress(supplier?.address)}
                </Typography>
                {supplier?.taxId && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    เลขประจำตัวผู้เสียภาษี {formatTaxId(supplier.taxId)} · {branchLabel(supplier.branchNo)}
                  </Typography>
                )}
              </Box>
              <Stack spacing={0.5} sx={{ minWidth: 240 }}>
                <Row label="เลขที่ภายใน">{doc.docNo}</Row>
                <Row label="วันที่บันทึก">{formatThaiDate(doc.date)}</Row>
                <Row label="ใบกำกับผู้ขาย">{doc.supplierInvoiceNo || '-'}</Row>
                {doc.supplierInvoiceDate && <Row label="วันที่ใบกำกับ">{formatThaiDate(doc.supplierInvoiceDate)}</Row>}
              </Stack>
            </Stack>

            <Scrollbar sx={{ mt: 3 }}>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 40 }}>#</TableCell>
                    <TableCell>รายการ</TableCell>
                    <TableCell>บัญชี</TableCell>
                    <TableCell align="right">จำนวน</TableCell>
                    <TableCell align="right">ราคา/หน่วย</TableCell>
                    <TableCell>หัก ณ ที่จ่าย</TableCell>
                    <TableCell align="right">จำนวนเงิน</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {doc.lines.map((l, i) => (
                    <TableRow key={l.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell>
                        {l.accountCode} {accounts.name(l.accountCode)}
                      </TableCell>
                      <TableCell align="right">{l.qty.toLocaleString('th-TH')}</TableCell>
                      <TableCell align="right">
                        <Money value={l.unitPrice} />
                      </TableCell>
                      <TableCell>{l.whtRate > 0 ? `${l.whtIncomeType} ${l.whtRate}%` : '-'}</TableCell>
                      <TableCell align="right">
                        <Money value={lineAmount(l)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scrollbar>

            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
              <Stack spacing={1} sx={{ width: { xs: 1, sm: 340 } }}>
                <Row label="มูลค่าก่อนภาษี">
                  <Money value={t.net} />
                </Row>
                <Row label={doc.claimVat ? `ภาษีซื้อ ${doc.vatRate}%` : `ภาษี ${doc.vatRate}% (ขอคืนไม่ได้ — เป็นค่าใช้จ่าย)`}>
                  <Money value={t.vat} />
                </Row>
                <Divider sx={{ borderStyle: 'dashed' }} />
                <Row label="รวมทั้งสิ้น">
                  <Money value={t.total} variant="subtitle1" />
                </Row>
                {wht.length > 0 && (
                  <Row label={`หัก ณ ที่จ่าย (${whtSummaryLabel(wht)})`}>
                    <Money value={sumBaht(wht.map((g) => g.tax))} />
                  </Row>
                )}
              </Stack>
            </Stack>
            {doc.note && (
              <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
                หมายเหตุ: {doc.note}
              </Typography>
            )}
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Stack spacing={3}>
            <Card sx={{ p: 3 }}>
              <Stack spacing={1.5}>
                <Row label="สถานะ">
                  {doc.paid || !related.payments.length ? (
                    <PaidLabel paid={doc.paid} />
                  ) : (
                    <Label variant="soft" color="info">
                      จ่ายบางส่วน
                    </Label>
                  )}
                </Row>
                <Row label="ค้างจ่าย">
                  <Money value={outstanding} variant="subtitle1" />
                </Row>
                {toSatang(credited) > 0 && (
                  <Row label="ลดหนี้จากผู้ขายแล้ว">
                    <Money value={credited} />
                  </Row>
                )}
                <Row label="ภาษีซื้อ">
                  {doc.opening ? (
                    'ใช้สิทธิในระบบเดิมแล้ว'
                  ) : doc.claimVat && doc.vatClaimPeriod ? (
                    `ใช้สิทธิเดือน${periodLabel(periodFromKey(doc.vatClaimPeriod))}`
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                      ไม่ขอคืน
                    </Typography>
                  )}
                </Row>
              </Stack>
            </Card>

            <Card>
              <CardHeader title="การจ่ายชำระ / ใบลดหนี้" />
              <Stack spacing={1.5} sx={{ p: 3 }} divider={<Divider sx={{ borderStyle: 'dashed' }} />}>
                {related.payments.map((pv) => (
                  <Stack key={pv.id} direction="row" justifyContent="space-between">
                    <div>
                      <Typography variant="subtitle2" component={RouterLink} href={paths.purchases.payment(pv.id)} sx={{ color: 'inherit' }}>
                        {pv.docNo}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {formatThaiDate(pv.date)}
                        {pv.whtCertNo ? ` · 50 ทวิ ${pv.whtCertNo} หัก ${pv.whtAmount.toFixed(2)}` : ''}
                      </Typography>
                    </div>
                    <Money value={pv.amount} />
                  </Stack>
                ))}
                {related.credits.map((c) => (
                  <Stack key={c.id} direction="row" justifyContent="space-between">
                    <div>
                      <Typography variant="subtitle2">{c.docNo}</Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        ใบลดหนี้ผู้ขาย {c.supplierCreditNoteNo || '-'} · {formatThaiDate(c.date)} · {c.reason}
                        {c.claimVat && c.vatClaimPeriod ? ` · ลดภาษีซื้อเดือน${periodLabel(periodFromKey(c.vatClaimPeriod))}` : ''}
                      </Typography>
                    </div>
                    <Money value={-calcDocument(c).total} signed />
                  </Stack>
                ))}
                {!related.payments.length && !related.credits.length && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ยังไม่มีการจ่ายชำระ
                  </Typography>
                )}
              </Stack>
            </Card>

            <Card>
              <CardHeader title="รายการบัญชีที่ลงให้อัตโนมัติ" />
              <Stack spacing={2} sx={{ p: 3 }}>
                {doc.opening && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    ยอดยกมา — รวมอยู่ในรายการยอดยกมา (เจ้าหนี้การค้า)
                  </Typography>
                )}
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

      <PayPurchaseDialog open={paying} doc={paying ? doc : null} onClose={() => setPaying(false)} />
    </>
  );
}
