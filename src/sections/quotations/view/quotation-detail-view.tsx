import type { QuotationStatus } from 'src/domain';

import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { usePermissions } from 'src/auth';
import { cmd, useAccounting, useContactLookup } from 'src/store';
import {
  todayISO,
  salesDocTitle,
  formatThaiDate,
  quotationTotals,
  quotationStatusOf,
  quotationValidUntil,
  QUOTATION_STATUS_LABEL,
  quotationConvertProblem,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { usePopover, CustomPopover } from 'src/components/custom-popover';

import { Money, QuotationStatusLabel } from 'src/sections/shared';

import { QuotationPreview } from '../quotation-preview';

// ----------------------------------------------------------------------

const STATUS_ACTIONS: QuotationStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

/** รายละเอียดใบเสนอราคา: ตัวอย่างพิมพ์, เปลี่ยนสถานะ, แก้ไข, ออกเอกสารขาย (คัดลอกรายการ) */
export function QuotationDetailView() {
  const { id = '' } = useParams();
  const { data, run, busy } = useAccounting();
  const { canWrite } = usePermissions();
  const contacts = useContactLookup();
  const statusMenu = usePopover();
  const q = data.quotations.find((x) => x.id === id);
  const today = todayISO();

  if (!q) {
    return (
      <EmptyContent
        filled
        title="ไม่พบใบเสนอราคา"
        action={
          <Button component={RouterLink} href={paths.quotations.root} sx={{ mt: 2 }}>
            กลับไปทะเบียนใบเสนอราคา
          </Button>
        }
        sx={{ py: 10 }}
      />
    );
  }

  const status = quotationStatusOf(q, today);
  const converted = q.convertedSalesId ? data.sales.find((s) => s.id === q.convertedSalesId) : undefined;
  const convertProblem = quotationConvertProblem(q, today);
  const totals = quotationTotals(q);

  const changeStatus = async (next: QuotationStatus) => {
    statusMenu.onClose();
    try {
      await run(cmd.setQuotationStatus(q.id, next));
      toast.success(`${q.docNo}: ${QUOTATION_STATUS_LABEL[next]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <>
      <CustomBreadcrumbs
        heading={`ใบเสนอราคา ${q.docNo}`}
        links={[
          { name: 'หน้าแรก', href: paths.dashboard },
          { name: 'ใบเสนอราคา', href: paths.quotations.root },
          { name: q.docNo },
        ]}
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" startIcon={<Iconify icon="solar:printer-minimalistic-bold" />} onClick={() => window.print()}>
              พิมพ์
            </Button>
            {canWrite && !converted && (
              <Button component={RouterLink} href={paths.quotations.edit(q.id)} variant="outlined" startIcon={<Iconify icon="solar:pen-bold" />}>
                แก้ไข
              </Button>
            )}
            {canWrite && !converted && (
              <Tooltip title={convertProblem ?? ''}>
                <span>
                  <Button
                    component={RouterLink}
                    href={paths.sales.fromQuotation(q.id)}
                    variant="contained"
                    disabled={!!convertProblem}
                    startIcon={<Iconify icon="solar:bill-list-bold-duotone" />}
                  >
                    ออก{q.saleType === 'service' || !data.company.vatRegistered ? 'ใบแจ้งหนี้' : 'ใบกำกับภาษี'}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Stack>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <QuotationPreview quotation={q} company={data.company} contact={contacts.get(q.contactId)} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card>
            <CardHeader title="สถานะ" action={<QuotationStatusLabel status={status} />} />
            <Stack spacing={1.5} sx={{ p: 3 }}>
              <Row label="ลูกค้า" value={contacts.name(q.contactId)} />
              <Row label="วันที่" value={formatThaiDate(q.date)} />
              <Row label="ยืนราคาถึง" value={formatThaiDate(quotationValidUntil(q))} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  ยอดรวม
                </Typography>
                <Money value={totals.total} sx={{ fontWeight: 600 }} />
              </Stack>
              <Divider sx={{ borderStyle: 'dashed' }} />
              {converted ? (
                <Alert severity="success" variant="outlined">
                  ออก{salesDocTitle(converted)}{' '}
                  <Typography component={RouterLink} href={paths.sales.view(converted.id)} variant="subtitle2" sx={{ color: 'inherit' }}>
                    {converted.docNo}
                  </Typography>{' '}
                  แล้ว — ใบเสนอราคาถูกล็อก
                </Alert>
              ) : (
                <>
                  {status === 'expired' && (
                    <Alert severity="warning" variant="outlined">
                      พ้นกำหนดยืนราคาแล้ว — แก้จำนวนวันยืนราคาเพื่อต่ออายุ หรือทำใบเสนอราคาใหม่
                    </Alert>
                  )}
                  <Button
                    variant="outlined"
                    color="inherit"
                    endIcon={<Iconify icon="eva:arrow-ios-downward-fill" />}
                    onClick={statusMenu.onOpen}
                  >
                    เปลี่ยนสถานะ
                  </Button>
                </>
              )}
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <CustomPopover open={statusMenu.open} anchorEl={statusMenu.anchorEl} onClose={statusMenu.onClose}>
        <MenuList>
          {STATUS_ACTIONS.map((s) => (
            <MenuItem key={s} selected={q.status === s} disabled={busy} onClick={() => changeStatus(s)}>
              {QUOTATION_STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </MenuList>
      </CustomPopover>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  );
}
