import type { Contact } from 'src/domain';

import { useMemo, useState } from 'react';

import Tab from '@mui/material/Tab';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';

import { paths } from 'src/routes/paths';
import { useSearchParams } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { CanWrite } from 'src/auth';
import { useAccounting, useContactLookup } from 'src/store';
import { toSatang, formatTaxId, branchLabel, isValidThaiTaxId, customerCreditOf, supplierRefundDueOf } from 'src/domain';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { CustomTabs } from 'src/components/custom-tabs';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { useTable, rowInPage, TableHeadCustom, TablePaginationCustom } from 'src/components/table';

import { Money } from 'src/sections/shared';
import { RefundDialog } from 'src/sections/sales/refund-dialog';
import { SupplierRefundDialog } from 'src/sections/purchases/supplier-refund-dialog';

import { ContactDialog } from './contact-dialog';
import { ImportContactsDialog } from './import-dialog';

// ----------------------------------------------------------------------

const TABLE_HEAD = [
  { id: 'code', label: 'รหัส' },
  { id: 'name', label: 'ชื่อ' },
  { id: 'taxId', label: 'เลขผู้เสียภาษี' },
  { id: 'kind', label: 'ประเภท' },
  { id: 'province', label: 'จังหวัด' },
  { id: 'credit', label: 'เงินรอคืน / เงินคืนค้างรับ', align: 'right' },
  { id: '' },
];

const KIND_LABEL = { customer: 'ลูกค้า', vendor: 'ผู้ขาย', both: 'ลูกค้า + ผู้ขาย' } as const;

/** ทะเบียนลูกค้า/ผู้ขาย — แสดงเงินรอคืนลูกค้า (จากใบลดหนี้หลังรับเงิน) และบันทึกคืนเงินได้ */
export function ContactsView() {
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const params = useSearchParams();
  const table = useTable({ defaultOrderBy: 'code', defaultDense: true });
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState<'all' | 'customer' | 'vendor'>('all');
  const [editing, setEditing] = useState<Contact | null>(null);
  const dialog = useBoolean();
  const importDialog = useBoolean();
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [supplierRefundFor, setSupplierRefundFor] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.contacts
      .filter((c) => kind === 'all' || c.kind === kind || c.kind === 'both')
      .filter((c) => !q || `${c.code} ${contacts.name(c.id)} ${c.taxId ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code) * (table.order === 'asc' ? 1 : -1));
  }, [data.contacts, contacts, query, kind, table.order]);

  const openNew = () => {
    setEditing(null);
    dialog.onTrue();
  };

  return (
    <>
      <CustomBreadcrumbs
        heading="ลูกค้า / ผู้ขาย"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ลูกค้า / ผู้ขาย' }]}
        action={
          <CanWrite>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<Iconify icon="solar:import-bold" />} onClick={importDialog.onTrue}>
                นำเข้า CSV
              </Button>
              <Button variant="contained" startIcon={<Iconify icon="mingcute:add-line" />} onClick={openNew}>
                เพิ่ม
              </Button>
            </Stack>
          </CanWrite>
        }
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Card>
        <CustomTabs
          value={kind}
          onChange={(_, v) => setKind(v)}
          sx={{ px: 2.5, boxShadow: (theme) => `inset 0 -2px 0 0 ${theme.vars.palette.divider}` }}
        >
          <Tab value="all" label="ทั้งหมด" />
          <Tab value="customer" label="ลูกค้า" />
          <Tab value="vendor" label="ผู้ขาย" />
        </CustomTabs>

        <Stack sx={{ p: 2.5 }}>
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหารหัส ชื่อ หรือเลขผู้เสียภาษี"
            sx={{ maxWidth: 400 }}
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
              {rowInPage(rows, table.page, table.rowsPerPage).map((c) => {
                const badTaxId = !!c.taxId && !isValidThaiTaxId(c.taxId);
                const credit = customerCreditOf(data, c.id);
                const supplierDue = supplierRefundDueOf(data, c.id);
                return (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.code}</TableCell>
                    <TableCell>
                      <Typography variant="subtitle2">{contacts.name(c.id)}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {c.legalForm === 'juristic' ? `นิติบุคคล · ${branchLabel(c.branchNo)}` : 'บุคคลธรรมดา'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c.taxId ? formatTaxId(c.taxId) : <Label variant="soft" color="warning">ยังไม่มี</Label>}
                      {badTaxId && (
                        <Label variant="soft" color="error" sx={{ ml: 1 }}>
                          เลขไม่ถูกต้อง
                        </Label>
                      )}
                    </TableCell>
                    <TableCell>{KIND_LABEL[c.kind]}</TableCell>
                    <TableCell>{c.address.province ?? '-'}</TableCell>
                    <TableCell align="right">
                      {toSatang(credit) > 0 && (
                        <Stack alignItems="flex-end" spacing={0.5}>
                          <Money value={credit} sx={{ color: 'warning.main' }} />
                          <CanWrite>
                            <Button size="small" variant="soft" color="warning" onClick={() => setRefundFor(c.id)}>
                              คืนเงินลูกค้า
                            </Button>
                          </CanWrite>
                        </Stack>
                      )}
                      {toSatang(supplierDue) > 0 && (
                        <Stack alignItems="flex-end" spacing={0.5} sx={{ mt: toSatang(credit) > 0 ? 1 : 0 }}>
                          <Money value={supplierDue} sx={{ color: 'info.main' }} />
                          <CanWrite>
                            <Button size="small" variant="soft" color="info" onClick={() => setSupplierRefundFor(c.id)}>
                              รับเงินคืนจากผู้ขาย
                            </Button>
                          </CanWrite>
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <CanWrite>
                        <IconButton
                          aria-label={`แก้ไข ${c.code}`}
                          onClick={() => {
                            setEditing(c);
                            dialog.onTrue();
                          }}
                        >
                          <Iconify icon="solar:pen-bold" />
                        </IconButton>
                      </CanWrite>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyContent filled title="ไม่พบผู้ติดต่อ" sx={{ py: 8 }} />
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

      <ContactDialog open={dialog.value} onClose={dialog.onFalse} contact={editing} defaultKind={kind === 'vendor' ? 'vendor' : 'customer'} />
      <ImportContactsDialog open={importDialog.value} onClose={importDialog.onFalse} />
      {refundFor && <RefundDialog open={!!refundFor} onClose={() => setRefundFor(null)} contactId={refundFor} />}
      {supplierRefundFor && (
        <SupplierRefundDialog open={!!supplierRefundFor} onClose={() => setSupplierRefundFor(null)} contactId={supplierRefundFor} />
      )}
    </>
  );
}
