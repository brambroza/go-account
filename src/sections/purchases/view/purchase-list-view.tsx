import type { PurchaseDoc } from 'src/domain';

import { useMemo, useState } from 'react';

import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { CanWrite } from 'src/auth';
import { useAccounting, useContactLookup } from 'src/store';
import {
  hasWht,
  toSatang,
  paymentsOf,
  periodLabel,
  periodFromKey,
  formatThaiDate,
  purchaseTotals,
  whtSummaryLabel,
  purchaseWhtGroups,
  purchaseOutstanding,
} from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomTabs } from 'src/components/custom-tabs';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { useTable, rowInPage, TableHeadCustom, TablePaginationCustom } from 'src/components/table';

import { Money, PaidLabel } from 'src/sections/shared';

import { PayPurchaseDialog } from '../pay-purchase-dialog';

// ----------------------------------------------------------------------

type Filter = 'all' | 'unpaid' | 'paid' | 'wht';

const TABLE_HEAD = [
  { id: 'docNo', label: 'เลขที่' },
  { id: 'date', label: 'วันที่' },
  { id: 'vendor', label: 'ผู้ขาย' },
  { id: 'supplierInvoiceNo', label: 'ใบกำกับผู้ขาย' },
  { id: 'total', label: 'ยอดรวม', align: 'right' },
  { id: 'vat', label: 'ภาษีซื้อ', align: 'right' },
  { id: 'wht', label: 'หัก ณ ที่จ่าย', align: 'right' },
  { id: 'status', label: 'สถานะ' },
  { id: '' },
];

/** ทะเบียนเอกสารซื้อ — แสดงใบสำคัญจ่าย (PV) / 50 ทวิ ทุกครั้งที่จ่าย (กดเพื่อดู/พิมพ์), ยอดค้างเมื่อแบ่งจ่าย */
export function PurchaseListView() {
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const table = useTable({ defaultOrderBy: 'date', defaultOrder: 'desc', defaultDense: true });
  const [filter, setFilter] = useState<Filter>('all');
  const [paying, setPaying] = useState<PurchaseDoc | null>(null);

  const rows = useMemo(() => {
    const dir = table.order === 'asc' ? 1 : -1;
    return data.purchases
      .map((p) => {
        const t = purchaseTotals(p);
        return {
          p,
          t,
          date: p.date,
          docNo: p.docNo,
          vendor: contacts.name(p.contactId),
          outstanding: purchaseOutstanding(data, p),
          pvs: paymentsOf(data, p.id),
          wht: purchaseWhtGroups(p),
        };
      })
      .filter(({ p }) => {
        if (filter === 'unpaid') return !p.paid;
        if (filter === 'paid') return p.paid;
        if (filter === 'wht') return hasWht(p);
        return true;
      })
      .sort((a, b) => {
        const key = (table.orderBy === 'vendor' ? 'vendor' : table.orderBy === 'docNo' ? 'docNo' : 'date') as 'date';
        return a[key] === b[key] ? a.docNo.localeCompare(b.docNo) * dir : (a[key] > b[key] ? 1 : -1) * dir;
      });
  }, [data, contacts, filter, table.order, table.orderBy]);

  const unpaidCount = data.purchases.filter((p) => !p.paid).length;

  return (
    <>
      <CustomBreadcrumbs
        heading="ซื้อ / ค่าใช้จ่าย"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ซื้อ / ค่าใช้จ่าย' }]}
        action={
          <CanWrite>
            <Button component={RouterLink} href={paths.purchases.new} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>
              บันทึกซื้อ / ค่าใช้จ่าย
            </Button>
          </CanWrite>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Card>
        <CustomTabs
          value={filter}
          onChange={(_, v) => {
            setFilter(v);
            table.onResetPage();
          }}
          sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}
        >
          <Tab value="all" label="ทั้งหมด" />
          <Tab
            value="unpaid"
            label="รอจ่าย"
            iconPosition="end"
            icon={<Label color="warning" variant={filter === 'unpaid' ? 'filled' : 'soft'}>{unpaidCount}</Label>}
          />
          <Tab value="paid" label="จ่ายแล้ว" />
          <Tab value="wht" label="มีหัก ณ ที่จ่าย" />
        </CustomTabs>

        <Scrollbar>
          <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 1000 }}>
            <TableHeadCustom order={table.order} orderBy={table.orderBy} headLabel={TABLE_HEAD} onSort={table.onSort} />
            <TableBody>
              {rowInPage(rows, table.page, table.rowsPerPage).map(({ p, t, vendor, outstanding, pvs, wht }) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2" component={RouterLink} href={paths.purchases.view(p.id)} sx={{ color: 'inherit' }}>
                      {p.docNo}
                    </Typography>
                    {p.opening && (
                      <Label variant="soft" sx={{ display: 'flex', width: 'fit-content', mt: 0.5 }}>
                        ยอดยกมา
                      </Label>
                    )}
                  </TableCell>
                  <TableCell>
                    {formatThaiDate(p.date)}
                    {p.supplierInvoiceDate && p.supplierInvoiceDate !== p.date && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        ใบกำกับ {formatThaiDate(p.supplierInvoiceDate)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <Typography variant="body2" noWrap>
                      {vendor}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap component="div">
                      {p.lines[0]?.description}
                    </Typography>
                  </TableCell>
                  <TableCell>{p.supplierInvoiceNo || '-'}</TableCell>
                  <TableCell align="right">
                    <Money value={t.total} />
                  </TableCell>
                  <TableCell align="right">
                    {p.claimVat ? (
                      <>
                        <Money value={t.vat} hideZero />
                        {p.vatClaimPeriod && (
                          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                            ใช้สิทธิ {periodLabel(periodFromKey(p.vatClaimPeriod))}
                          </Typography>
                        )}
                      </>
                    ) : (
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                        ไม่ขอคืน
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {wht.length ? (
                      <>
                        <Money value={t.wht} />
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                          {whtSummaryLabel(wht)}
                        </Typography>
                      </>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {p.paid || !pvs.length ? (
                      <PaidLabel paid={p.paid} />
                    ) : (
                      <Label variant="soft" color="info">
                        จ่ายบางส่วน
                      </Label>
                    )}
                    {!p.paid && pvs.length > 0 && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        ค้าง <Money value={outstanding} sx={{ typography: 'caption' }} />
                      </Typography>
                    )}
                    {pvs.map((pv) => (
                      <Typography
                        key={pv.id}
                        variant="caption"
                        component={RouterLink}
                        href={paths.purchases.payment(pv.id)}
                        sx={{ display: 'block', color: 'text.secondary' }}
                      >
                        {formatThaiDate(pv.date)} · {pv.docNo}
                        {pv.whtCertNo ? ` · 50 ทวิ ${pv.whtCertNo}` : ''}
                      </Typography>
                    ))}
                  </TableCell>
                  <TableCell align="right">
                    {!p.paid && toSatang(outstanding) > 0 && (
                      <Button size="small" variant="soft" color="primary" onClick={() => setPaying(p)}>
                        จ่ายชำระ
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyContent filled title="ไม่พบเอกสาร" sx={{ py: 8 }} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Scrollbar>

        <TablePaginationCustom
          page={table.page}
          dense={table.dense}
          count={rows.length}
          rowsPerPage={table.rowsPerPage}
          onPageChange={table.onChangePage}
          onChangeDense={table.onChangeDense}
          onRowsPerPageChange={table.onChangeRowsPerPage}
        />
      </Card>

      <PayPurchaseDialog open={!!paying} doc={paying} onClose={() => setPaying(null)} />
    </>
  );
}
