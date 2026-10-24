import { useMemo, useState } from 'react';

import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { sumBaht, whtCertificateOf } from 'src/domain';
import { useAccounting, useAccountLookup } from 'src/store';

import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { PaymentVoucherPreview } from '../payment-voucher-preview';
import { WhtCertificatePreview } from '../wht-certificate-preview';

// ----------------------------------------------------------------------

type DocView = 'pv' | 'wht1' | 'wht2';

/** ใบสำคัญจ่าย (PV) และหนังสือรับรอง 50 ทวิ ของการจ่าย 1 ครั้ง — ดูและพิมพ์ทีละฉบับ */
export function PaymentView() {
  const { id = '' } = useParams();
  const { data } = useAccounting();
  const accounts = useAccountLookup();
  const [view, setView] = useState<DocView>('pv');

  const payment = data.payments.find((p) => p.id === id);
  const purchase = payment ? data.purchases.find((p) => p.id === payment.purchaseId) : undefined;
  const cert = useMemo(() => (payment ? whtCertificateOf(data, payment.id) : null), [data, payment]);

  if (!payment || !purchase) {
    return (
      <EmptyContent
        filled
        title="ไม่พบใบสำคัญจ่าย"
        action={
          <Button component={RouterLink} href={paths.purchases.root} variant="contained" sx={{ mt: 3 }}>
            กลับไปหน้าซื้อ / ค่าใช้จ่าย
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  // ยอดจ่ายรวมของเอกสารซื้อจนถึงใบนี้ (เรียงตามเลขที่ PV = ตามวันที่)
  const paidToDate = sumBaht(
    data.payments
      .filter((p) => p.purchaseId === purchase.id && (p.date + p.docNo).localeCompare(payment.date + payment.docNo) <= 0)
      .map((p) => p.amount)
  );
  const current = view !== 'pv' && !cert ? 'pv' : view;

  return (
    <>
      <CustomBreadcrumbs
        heading={`ใบสำคัญจ่าย ${payment.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ซื้อ / ค่าใช้จ่าย', href: paths.purchases.root },
          { name: payment.docNo },
        ]}
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <ToggleButtonGroup size="small" exclusive value={current} onChange={(_, v: DocView | null) => v && setView(v)}>
              <ToggleButton value="pv">ใบสำคัญจ่าย</ToggleButton>
              <ToggleButton value="wht1" disabled={!cert}>
                50 ทวิ ฉบับที่ 1
              </ToggleButton>
              <ToggleButton value="wht2" disabled={!cert}>
                ฉบับที่ 2
              </ToggleButton>
            </ToggleButtonGroup>
            <Button variant="outlined" startIcon={<Iconify icon="solar:printer-minimalistic-bold" />} onClick={() => window.print()}>
              พิมพ์
            </Button>
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      {current === 'pv' && (
        <PaymentVoucherPreview
          payment={payment}
          purchase={purchase}
          company={data.company}
          paidToDate={paidToDate}
          accountName={`${payment.accountCode} ${accounts.name(payment.accountCode)}`}
        />
      )}
      {current !== 'pv' && cert && <WhtCertificatePreview cert={cert} copy={current === 'wht1' ? 1 : 2} />}
    </>
  );
}
