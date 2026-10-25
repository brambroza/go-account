import type { QuotationStatus } from 'src/domain';

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
import { useAccounting, useContactLookup } from 'src/store';
import { todayISO, formatThaiDate, quotationTotals, quotationStatusOf, quotationValidUntil } from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomTabs } from 'src/components/custom-tabs';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { useTable, rowInPage, TableHeadCustom, TablePaginationCustom } from 'src/components/table';

import { Money, QuotationStatusLabel } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Filter = 'all' | 'open' | 'accepted' | 'converted' | 'closed';

const TABS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'open', label: 'รอลูกค้าตอบ' },
  { value: 'accepted', label: 'ตอบรับ (รอออกเอกสาร)' },
  { value: 'converted', label: 'ออกเอกสารขายแล้ว' },
  { value: 'closed', label: 'ไม่อนุมัติ / หมดอายุ' },
];

const TABLE_HEAD = [
  { id: 'docNo', label: 'เลขที่' },
  { id: 'date', label: 'วันที่' },
  { id: 'contact', label: 'ลูกค้า' },
  { id: 'validUntil', label: 'ยืนราคาถึง' },
  { id: 'total', label: 'ยอดรวม', align: 'right' },
  { id: 'status', label: 'สถานะ' },
];

function inTab(status: QuotationStatus | 'converted', tab: Filter): boolean {
  if (tab === 'open') return status === 'draft' || status === 'sent';
  if (tab === 'accepted') return status === 'accepted';
  if (tab === 'converted') return status === 'converted';
  if (tab === 'closed') return status === 'rejected' || status === 'expired';
  return true;
}

/** ทะเบียนใบเสนอราคา — ไม่ใช่เอกสารภาษี ไม่ลงบัญชี */
export function QuotationListView() {
  const router = useRouter();
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const table = useTable({ defaultOrderBy: 'date', defaultOrder: 'desc', defaultDense: true, defaultRowsPerPage: 25 });
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const today = todayISO();

  const rows = useMemo(
    () =>
      data.quotations.map((q) => ({
        q,
        docNo: q.docNo,
        date: q.date,
        contact: contacts.name(q.contactId),
        validUntil: quotationValidUntil(q),
        total: quotationTotals(q).total,
        status: quotationStatusOf(q, today),
      })),
    [data.quotations, contacts, today]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = table.order === 'asc' ? 1 : -1;
    return rows
      .filter((r) => inTab(r.status, filter))
      .filter((r) => !q || `${r.docNo} ${r.contact}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const key = table.orderBy as 'docNo' | 'date' | 'contact' | 'validUntil' | 'total' | 'status';
        const av = a[key];
        const bv = b[key];
        if (av === bv) return a.docNo.localeCompare(b.docNo) * dir;
        return (av > bv ? 1 : -1) * dir;
      });
  }, [rows, filter, query, table.order, table.orderBy]);

  return (
    <>
      <CustomBreadcrumbs
        heading="ใบเสนอราคา"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ใบเสนอราคา' }]}
        action={
          <CanWrite>
            <Button component={RouterLink} href={paths.quotations.new} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>
              สร้างใบเสนอราคา
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
          {TABS.map((t) => (
            <Tab
              key={t.value}
              value={t.value}
              label={t.label}
              iconPosition="end"
              icon={<Label variant={t.value === filter ? 'filled' : 'soft'}>{rows.filter((r) => inTab(r.status, t.value)).length}</Label>}
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
            placeholder="ค้นหาเลขที่หรือชื่อลูกค้า"
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
          <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 800 }}>
            <TableHeadCustom order={table.order} orderBy={table.orderBy} headLabel={TABLE_HEAD} onSort={table.onSort} />
            <TableBody>
              {rowInPage(filtered, table.page, table.rowsPerPage).map((r) => (
                <TableRow key={r.q.id} hover onClick={() => router.push(paths.quotations.view(r.q.id))} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="subtitle2" component={RouterLink} href={paths.quotations.view(r.q.id)} sx={{ color: 'inherit' }}>
                      {r.docNo}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatThaiDate(r.date)}</TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" noWrap>
                      {r.contact}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: r.status === 'expired' ? 'warning.dark' : undefined }}>{formatThaiDate(r.validUntil)}</TableCell>
                  <TableCell align="right">
                    <Money value={r.total} />
                  </TableCell>
                  <TableCell>
                    <QuotationStatusLabel status={r.status} />
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyContent
                      filled
                      title={rows.length ? 'ไม่พบใบเสนอราคา' : 'ยังไม่มีใบเสนอราคา'}
                      description={rows.length ? 'ลองเปลี่ยนแท็บหรือคำค้นหา' : 'สร้างใบเสนอราคาแล้วแปลงเป็นใบกำกับภาษีได้ในคลิกเดียว'}
                      sx={{ py: 8 }}
                    />
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
