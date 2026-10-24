import { useMemo } from 'react';

import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { outstandingOf, useAccounting } from 'src/store';
import { sumBaht, inPeriod, periodOf, todayISO } from 'src/domain';

import { Iconify } from 'src/components/iconify';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

export function SalesSummaryCards() {
  const { data } = useAccounting();
  const today = todayISO();

  const stats = useMemo(() => {
    const open = data.sales.map((d) => ({ d, o: outstandingOf(data, d) })).filter((x) => x.o > 0);
    const overdue = open.filter((x) => x.d.dueDate < today);
    const period = periodOf(today);
    return {
      outstanding: sumBaht(open.map((x) => x.o)),
      openCount: open.length,
      overdue: sumBaht(overdue.map((x) => x.o)),
      overdueCount: overdue.length,
      received: sumBaht(data.receipts.filter((r) => inPeriod(r.date, period)).map((r) => r.amount)),
      receivedCount: data.receipts.filter((r) => inPeriod(r.date, period)).length,
    };
  }, [data, today]);

  const cards = [
    { title: 'ลูกหนี้ค้างรับ', value: stats.outstanding, caption: `${stats.openCount} ใบ`, icon: 'solar:wallet-money-bold-duotone', color: 'info.main' },
    { title: 'เกินกำหนดชำระ', value: stats.overdue, caption: `${stats.overdueCount} ใบ`, icon: 'solar:danger-triangle-bold-duotone', color: 'error.main' },
    { title: 'รับชำระเดือนนี้', value: stats.received, caption: `${stats.receivedCount} รายการ`, icon: 'solar:hand-money-bold-duotone', color: 'success.main' },
  ];

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
      {cards.map((c) => (
        <Card key={c.title} sx={{ p: 2.5, flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Iconify icon={c.icon} width={40} sx={{ color: c.color }} />
          <Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {c.title}
            </Typography>
            <Money value={c.value} variant="h5" />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {c.caption}
            </Typography>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
