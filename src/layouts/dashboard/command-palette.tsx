import { useMemo, useState } from 'react';

import List from '@mui/material/List';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemButton from '@mui/material/ListItemButton';
import InputAdornment from '@mui/material/InputAdornment';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { receiptTitle, salesDocTitle } from 'src/domain';
import { useAccounting, useContactLookup } from 'src/store';

import { Iconify } from 'src/components/iconify';

import { NAV, QUICK_ACTIONS } from './config-nav';

// ----------------------------------------------------------------------

type Result = { key: string; title: string; caption?: string; icon: string; path: string };

type Props = { open: boolean; onClose: () => void };

export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const menus = [...QUICK_ACTIONS, ...NAV.flatMap((s) => s.items)].map((m) => ({
      key: `m-${m.path}`,
      title: m.title,
      caption: 'เมนู',
      icon: m.icon,
      path: m.path,
      haystack: `${m.title} ${m.keywords ?? ''}`.toLowerCase(),
    }));
    if (!q) return menus;

    const docs = data.sales.map((s) => ({
      key: `s-${s.id}`,
      title: `${s.docNo} · ${contacts.name(s.contactId)}`,
      caption: salesDocTitle(s),
      icon: 'solar:bill-list-bold-duotone',
      path: paths.sales.view(s.id),
      haystack: `${s.docNo} ${contacts.name(s.contactId)}`.toLowerCase(),
    }));
    const receipts = data.receipts.map((r) => ({
      key: `r-${r.id}`,
      title: `${r.docNo} · ${contacts.name(r.contactId)}`,
      caption: receiptTitle(r),
      icon: 'solar:hand-money-bold',
      path: paths.sales.receipt(r.id),
      haystack: `${r.docNo} ${contacts.name(r.contactId)}`.toLowerCase(),
    }));
    // ฝั่งซื้อ: ค้นได้ทั้งเลขที่ภายใน (PI) และเลขที่ใบกำกับของผู้ขาย
    const purchases = data.purchases.map((p) => ({
      key: `p-${p.id}`,
      title: `${p.docNo} · ${contacts.name(p.contactId)}`,
      caption: `${p.opening ? 'ยอดยกมา (ซื้อ)' : 'เอกสารซื้อ'}${p.supplierInvoiceNo ? ` · ใบกำกับผู้ขาย ${p.supplierInvoiceNo}` : ''}`,
      icon: 'solar:cart-large-2-bold-duotone',
      path: paths.purchases.view(p.id),
      haystack: `${p.docNo} ${p.supplierInvoiceNo} ${contacts.name(p.contactId)}`.toLowerCase(),
    }));
    const payments = data.payments.map((pv) => ({
      key: `pv-${pv.id}`,
      title: `${pv.docNo} · ${contacts.name(pv.contactId)}`,
      caption: `ใบสำคัญจ่าย${pv.whtCertNo ? ` · 50 ทวิ ${pv.whtCertNo}` : ''}`,
      icon: 'solar:wallet-money-bold',
      path: paths.purchases.payment(pv.id),
      haystack: `${pv.docNo} ${pv.whtCertNo ?? ''} ${contacts.name(pv.contactId)}`.toLowerCase(),
    }));
    const supplierCredits = data.purchaseCredits.map((c) => ({
      key: `pc-${c.id}`,
      title: `${c.docNo} · ${contacts.name(c.contactId)}`,
      caption: `ใบลดหนี้จากผู้ขาย${c.supplierCreditNoteNo ? ` ${c.supplierCreditNoteNo}` : ''}`,
      icon: 'solar:undo-left-round-bold',
      path: paths.purchases.view(c.purchaseId),
      haystack: `${c.docNo} ${c.supplierCreditNoteNo} ${contacts.name(c.contactId)}`.toLowerCase(),
    }));
    const people = data.contacts.map((c) => ({
      key: `c-${c.id}`,
      title: contacts.name(c.id),
      caption: `${c.code}${c.taxId ? ` · ${c.taxId}` : ''}`,
      icon: 'solar:user-id-bold-duotone',
      path: `${paths.contacts}?q=${encodeURIComponent(c.code)}`,
      haystack: `${c.code} ${contacts.name(c.id)} ${c.taxId ?? ''}`.toLowerCase(),
    }));

    return [...menus, ...docs, ...receipts, ...purchases, ...payments, ...supplierCredits, ...people]
      .filter((r) => r.haystack.includes(q))
      .slice(0, 12);
  }, [query, data.sales, data.receipts, data.purchases, data.payments, data.purchaseCredits, data.contacts, contacts]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    router.push(r.path);
    setQuery('');
    setCursor(0);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-label="ค้นหา">
      <TextField
        autoFocus
        fullWidth
        value={query}
        placeholder="ค้นหาเมนู เลขที่เอกสารขาย/ซื้อ/ใบสำคัญจ่าย ผู้ติดต่อ หรือเลขผู้เสียภาษี"
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go(results[cursor]);
          }
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
            </InputAdornment>
          ),
        }}
        sx={{ p: 2, '& fieldset': { border: 'none' } }}
      />
      <List sx={{ px: 1, pb: 1, maxHeight: 420, overflowY: 'auto' }}>
        {results.map((r, i) => (
          <ListItemButton key={r.key} selected={i === cursor} onClick={() => go(r)} sx={{ borderRadius: 1 }}>
            <ListItemIcon>
              <Iconify icon={r.icon} />
            </ListItemIcon>
            <ListItemText primary={r.title} secondary={r.caption} primaryTypographyProps={{ typography: 'body2' }} />
          </ListItemButton>
        ))}
        {!results.length && (
          <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
            ไม่พบ “{query}” — ลองค้นด้วยเลขที่เอกสารหรือรหัสลูกค้า
          </Typography>
        )}
      </List>
    </Dialog>
  );
}
