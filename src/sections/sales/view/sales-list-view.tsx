import { useMemo, useState } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { CanWrite } from 'src/auth';
import { outstandingOf, useAccounting, useContactLookup } from 'src/store';
import { todayISO, salesSign, calcDocument, isTaxDocument, salesDocTitle, formatThaiDate } from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomTabs } from 'src/components/custom-tabs';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { useTable, rowInPage, TableHeadCustom, TablePaginationCustom } from 'src/components/table';

import { Money, ETaxLabel, SalesStatusLabel } from 'src/sections/shared';

import { SalesSummaryCards } from '../sales-summary-cards';

// ----------------------------------------------------------------------

type Filter = 'all' | 'open' | 'overdue' | 'paid' | 'credit';

const TABS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'open', label: 'รอรับชำระ' },
  { value: 'overdue', label: 'เกินกำหนด' },
  { value: 'paid', label: 'รับชำระแล้ว' },
  { value: 'credit', label: 'ใบลด/เพิ่มหนี้' },
];

const TABLE_HEAD = [
  { id: 'docNo', label: 'เลขที่' },
  { id: 'date', label: 'วันที่' },
  { id: 'contact', label: 'ลูกค้า' },
  { id: 'dueDate', label: 'ครบกำหนด' },
  { id: 'total', label: 'ยอดรวม', align: 'right' },
  { id: 'outstanding', label: 'ค้างชำระ', align: 'right' },
  { id: 'status', label: 'สถานะ' },
  { id: 'etax', label: 'e-Tax' },
];

/** ทะเบียนเอกสารขาย — ชื่อเอกสารตามสถานะ VAT ของเอกสาร (`salesDocTitle`) */
export function SalesListView() {
  const router = useRouter();
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const table = useTable({ defaultOrderBy: 'date', defaultOrder: 'desc', defaultDense: true, defaultRowsPerPage: 25 });
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const today = todayISO();
  const { vatRegistered } = data.company;

  const rows = useMemo(
    () =>
      data.sales.map((doc) => {
        const outstanding = outstandingOf(data, doc);
        return {
          doc,
          docNo: doc.docNo,
          date: doc.date,
          dueDate: doc.dueDate,
          contact: contacts.name(doc.contactId),
          total: calcDocument(doc).total * salesSign(doc),
          outstanding,
          overdue: doc.kind === 'tax-invoice' && outstanding > 0 && doc.dueDate < today,
        };
      }),
    [data, contacts, today]
  );

  const counts = useMemo(
    () => ({
      all: rows.length,
      open: rows.filter((r) => r.outstanding > 0).length,
      overdue: rows.filter((r) => r.overdue).length,
      paid: rows.filter((r) => r.doc.status === 'paid').length,
      credit: rows.filter((r) => r.doc.kind !== 'tax-invoice').length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = table.order === 'asc' ? 1 : -1;
    return rows
      .filter((r) => {
        if (filter === 'open') return r.outstanding > 0;
        if (filter === 'overdue') return r.overdue;
        if (filter === 'paid') return r.doc.status === 'paid';
        if (filter === 'credit') return r.doc.kind !== 'tax-invoice';
        return true;
      })
      .filter((r) => !q || `${r.docNo} ${r.contact}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const key = table.orderBy as keyof typeof a;
        const av = a[key] as string | number;
        const bv = b[key] as string | number;
        if (av === bv) return a.docNo.localeCompare(b.docNo) * dir;
        return (av > bv ? 1 : -1) * dir;
      });
  }, [rows, filter, query, table.order, table.orderBy]);

  return (
    <>
      <CustomBreadcrumbs
        heading={vatRegistered ? 'ขาย / ใบกำกับภาษี' : 'ขาย / ใบแจ้งหนี้'}
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ขาย' }]}
        action={
          <CanWrite>
            <Button component={RouterLink} href={paths.sales.new} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>
              {vatRegistered ? 'ออกใบกำกับภาษี' : 'ออกใบแจ้งหนี้'}
            </Button>
          </CanWrite>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <SalesSummaryCards />

      <Card>
        <CustomTabs
          value={filter}
          onChange={(_, v) => {
            setFilter(v);
            table.onResetPage();
          }}
          sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}
        >
          {TABS.map((t) => (
            <Tab
              key={t.value}
              value={t.value}
              label={t.label}
              iconPosition="end"
              icon={
                <Label variant={t.value === filter ? 'filled' : 'soft'} color={t.value === 'overdue' ? 'error' : 'default'}>
                  {counts[t.value]}
                </Label>
              }
            />
          ))}
        </CustomTabs>

        <Stack direction="row" sx={{ p: 2.5 }}>
          <TextField
            size="small"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              table.onResetPage();
            }}
            placeholder="ค้นหาเลขที่เอกสารหรือชื่อลูกค้า"
            sx={{ maxWidth: 400 }}
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
                </InputAdornment>
              ),
            }}
          />
        </Stack>

        <Scrollbar>
          <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 960 }}>
            <TableHeadCustom
              order={table.order}
              orderBy={table.orderBy}
              headLabel={TABLE_HEAD}
              onSort={table.onSort}
            />
            <TableBody>
              {rowInPage(filtered, table.page, table.rowsPerPage).map((r) => (
                <TableRow
                  key={r.doc.id}
                  hover
                  onClick={() => router.push(paths.sales.view(r.doc.id))}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="subtitle2" component={RouterLink} href={paths.sales.view(r.doc.id)} sx={{ color: 'inherit' }}>
                      {r.docNo}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                      {salesDocTitle(r.doc)}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatThaiDate(r.date)}</TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" noWrap>
                      {r.contact}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: r.overdue ? 'error.main' : undefined }}>
                    {r.doc.kind === 'tax-invoice' ? formatThaiDate(r.dueDate) : '-'}
                  </TableCell>
                  <TableCell align="right">
                    <Money value={r.total} signed />
                  </TableCell>
                  <TableCell align="right">
                    <Money value={r.outstanding} hideZero />
                  </TableCell>
                  <TableCell>
                    {r.doc.kind === 'tax-invoice' ? <SalesStatusLabel status={r.doc.status} overdue={r.overdue} /> : null}
                  </TableCell>
                  <TableCell>
                    {isTaxDocument(r.doc) ? <ETaxLabel status={r.doc.etax} /> : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyContent filled title="ไม่พบเอกสาร" description="ลองเปลี่ยนแท็บหรือคำค้นหา" sx={{ py: 8 }} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Scrollbar>

        <Box>
          <TablePaginationCustom
            page={table.page}
            dense={table.dense}
            count={filtered.length}
            rowsPerPage={table.rowsPerPage}
            onPageChange={table.onChangePage}
            onChangeDense={table.onChangeDense}
            onRowsPerPageChange={table.onChangeRowsPerPage}
          />
        </Box>
      </Card>
    </>
  );
}
