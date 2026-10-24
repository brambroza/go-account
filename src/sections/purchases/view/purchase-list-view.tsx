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

import { calcDocument, formatThaiDate } from 'src/domain';
import { useAccounting, useContactLookup } from 'src/store';

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

/** ทะเบียนเอกสารซื้อ — แสดงเลขใบสำคัญจ่าย (PV) และเลข 50 ทวิ ของรายการที่จ่ายแล้ว */
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
        const t = calcDocument(p);
        return { p, t, date: p.date, docNo: p.docNo, vendor: contacts.name(p.contactId) };
      })
      .filter(({ p }) => {
        if (filter === 'unpaid') return !p.paid;
        if (filter === 'paid') return p.paid;
        if (filter === 'wht') return p.whtRate > 0;
        return true;
      })
      .sort((a, b) => {
        const key = (table.orderBy === 'vendor' ? 'vendor' : table.orderBy === 'docNo' ? 'docNo' : 'date') as 'date';
        return a[key] === b[key] ? a.docNo.localeCompare(b.docNo) * dir : (a[key] > b[key] ? 1 : -1) * dir;
      });
  }, [data.purchases, contacts, filter, table.order, table.orderBy]);

  const unpaidCount = data.purchases.filter((p) => !p.paid).length;

  return (
    <>
      <CustomBreadcrumbs
        heading="ซื้อ / ค่าใช้จ่าย"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ซื้อ / ค่าใช้จ่าย' }]}
        action={
          <Button component={RouterLink} href={paths.purchases.new} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>
            บันทึกซื้อ / ค่าใช้จ่าย
          </Button>
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
              {rowInPage(rows, table.page, table.rowsPerPage).map(({ p, t, vendor }) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">{p.docNo}</Typography>
                  </TableCell>
                  <TableCell>{formatThaiDate(p.date)}</TableCell>
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
                    {p.claimVat ? <Money value={t.vat} hideZero /> : <Typography variant="caption" sx={{ color: 'text.disabled' }}>ไม่ขอคืน</Typography>}
                  </TableCell>
                  <TableCell align="right">
                    {p.whtRate > 0 ? (
                      <>
                        <Money value={t.wht} />
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                          {p.whtRate}% {p.whtIncomeType}
                        </Typography>
                      </>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <PaidLabel paid={p.paid} />
                    {p.paidDate && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {formatThaiDate(p.paidDate)}
                        {p.paymentDocNo ? ` · ${p.paymentDocNo}` : ''}
                      </Typography>
                    )}
                    {p.whtCertNo && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        50 ทวิ {p.whtCertNo}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {!p.paid && (
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
