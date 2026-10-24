import { useMemo } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { useAccounting, useContactLookup } from 'src/store';
import {
  sumBaht,
  periodOf,
  todayISO,
  toSatang,
  formatBaht,
  periodLabel,
  shiftPeriod,
  dashboardStats,
  filingDueDates,
  formatThaiDateShort,
} from 'src/domain';

import { Iconify } from 'src/components/iconify';

import { Money } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Todo = { title: string; caption: string; href: string; cta: string; tone: 'error' | 'warning' | 'info' };

/** หน้าแรก: ตัวเลขสรุป (จาก `dashboardStats`) งานที่ต้องทำ และกำหนดยื่นภาษี */
export function DashboardView() {
  const { data } = useAccounting();
  const contacts = useContactLookup();
  const today = todayISO();
  const period = periodOf(today);

  const stats = useMemo(() => dashboardStats(data, today), [data, today]);

  const due = filingDueDates(period);
  const prevDue = filingDueDates(shiftPeriod(period, -1));

  const todos: Todo[] = [
    ...(stats.etaxWaiting.length
      ? [
          {
            title: `ใบกำกับ ${stats.etaxWaiting.length} ฉบับยังไม่ได้นำส่ง e-Tax`,
            caption: 'ลงนามแล้วรวมไฟล์อัปโหลดที่เว็บสรรพากร',
            href: paths.tax,
            cta: 'ไปศูนย์ภาษี',
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(stats.overdue.length
      ? [
          {
            title: `ลูกหนี้เกินกำหนด ${stats.overdue.length} ใบ`,
            caption: `รวม ${formatBaht(sumBaht(stats.overdue.map((o) => o.outstanding)))} บาท · เก่าสุดเกิน ${stats.overdue[0].daysOverdue} วัน`,
            href: paths.sales.root,
            cta: 'ดูรายการ',
            tone: 'error' as const,
          },
        ]
      : []),
    ...(stats.unpaidPurchases.length
      ? [
          {
            title: `เจ้าหนี้รอจ่าย ${stats.unpaidPurchases.length} ใบ`,
            caption: 'จ่ายแล้วระบบจะออกเลข 50 ทวิ และเข้า ภ.ง.ด. ให้อัตโนมัติ',
            href: paths.purchases.root,
            cta: 'จ่ายชำระ',
            tone: 'info' as const,
          },
        ]
      : []),
    ...(toSatang(stats.customerCredits) > 0
      ? [
          {
            title: `เงินรอคืนลูกค้า ${formatBaht(stats.customerCredits)} บาท`,
            caption: 'เกิดจากใบลดหนี้หลังลูกค้าชำระแล้ว — บันทึกคืนเงินที่หน้าเอกสารหรือหน้าผู้ติดต่อ',
            href: paths.contacts,
            cta: 'ดูรายการ',
            tone: 'info' as const,
          },
        ]
      : []),
    ...(stats.badContacts.length
      ? [
          {
            title: `ลูกค้า ${stats.badContacts.length} รายยังไม่มีเลขผู้เสียภาษี`,
            caption: 'ออกใบกำกับเต็มรูปและ e-Tax ไม่ได้จนกว่าจะเพิ่มข้อมูล',
            href: paths.contacts,
            cta: 'แก้ข้อมูล',
            tone: 'warning' as const,
          },
        ]
      : []),
  ];

  const kpis = [
    { label: 'เงินสดและเงินฝาก', value: stats.cash, icon: 'solar:wallet-bold-duotone', color: 'primary.main' },
    { label: 'ลูกหนี้ค้างรับ', value: stats.receivable, icon: 'solar:arrow-down-bold-duotone', color: 'info.main' },
    { label: 'เจ้าหนี้ค้างจ่าย', value: stats.payable, icon: 'solar:arrow-up-bold-duotone', color: 'warning.main' },
    { label: `ภาษีขายสุทธิ ${periodLabel(period)}`, value: stats.pp30.netVat, icon: 'solar:document-text-bold-duotone', color: 'secondary.main' },
  ];

  const deadlines = [
    { date: prevDue.wht, form: 'ภ.ง.ด.1, 3, 53', caption: `หัก ณ ที่จ่ายเดือน${periodLabel(shiftPeriod(period, -1))}` },
    { date: prevDue.vat, form: 'ภ.พ.30', caption: `VAT เดือน${periodLabel(shiftPeriod(period, -1))}` },
    { date: due.wht, form: 'ภ.ง.ด.1, 3, 53', caption: `หัก ณ ที่จ่ายเดือน${periodLabel(period)}` },
    { date: due.vat, form: 'ภ.พ.30', caption: `VAT เดือน${periodLabel(period)}` },
  ].filter((d) => d.date >= today);

  const toneColor = { error: 'error.main', warning: 'warning.main', info: 'info.main' };

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-end' }} spacing={2} sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h4">วันนี้มี {todos.length} เรื่องที่ควรทำ</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatThaiDateShort(today)} · {data.company.name}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} href={paths.sales.new} variant="contained" startIcon={<Iconify icon="mingcute:add-line" />}>
            {data.company.vatRegistered ? 'ออกใบกำกับภาษี' : 'ออกใบแจ้งหนี้'}
          </Button>
          <Button component={RouterLink} href={paths.purchases.new} variant="outlined" startIcon={<Iconify icon="mingcute:add-line" />}>
            บันทึกค่าใช้จ่าย
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
        {kpis.map((k) => (
          <Card key={k.label} sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Iconify icon={k.icon} width={28} sx={{ color: k.color }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {k.label}
              </Typography>
            </Stack>
            <Money value={k.value} variant="h4" signed sx={{ display: 'block', mt: 1 }} />
          </Card>
        ))}
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
          <Card>
            <CardHeader title="สิ่งที่ต้องทำ" />
            <Stack divider={<Divider sx={{ borderStyle: 'dashed' }} />} sx={{ px: 3, pb: 2 }}>
              {todos.map((t) => (
                <Stack key={t.title} direction="row" spacing={2} alignItems="center" sx={{ py: 2 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: toneColor[t.tone] }} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2">{t.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {t.caption}
                    </Typography>
                  </Box>
                  <Button component={RouterLink} href={t.href} variant="soft" color="primary" size="small">
                    {t.cta}
                  </Button>
                </Stack>
              ))}
              {!todos.length && (
                <Typography variant="body2" sx={{ py: 3, color: 'text.secondary' }}>
                  ไม่มีงานค้าง เยี่ยมมาก
                </Typography>
              )}
            </Stack>
          </Card>

          <Card sx={{ mt: 3 }}>
            <CardHeader title="ลูกหนี้ค้างชำระ" action={<Button component={RouterLink} href={paths.sales.root} size="small">ดูทั้งหมด</Button>} />
            <Stack divider={<Divider sx={{ borderStyle: 'dashed' }} />} sx={{ px: 3, pb: 2 }}>
              {stats.aging.slice(0, 5).map((a) => (
                <Stack
                  key={a.doc.id}
                  direction="row"
                  spacing={2}
                  alignItems="center"
                  component={RouterLink}
                  href={paths.sales.view(a.doc.id)}
                  sx={{ py: 1.5, color: 'inherit', textDecoration: 'none' }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap>
                      {contacts.name(a.doc.contactId)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: a.daysOverdue > 0 ? 'error.main' : 'text.secondary' }}>
                      {a.doc.docNo} · {a.daysOverdue > 0 ? `เกินกำหนด ${a.daysOverdue} วัน` : `ครบกำหนด ${formatThaiDateShort(a.doc.dueDate)}`}
                    </Typography>
                  </Box>
                  <Money value={a.outstanding} />
                </Stack>
              ))}
            </Stack>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card>
            <CardHeader title="กำหนดยื่นภาษี (e-Filing)" />
            <Stack spacing={2} sx={{ p: 3 }}>
              {deadlines.map((d) => (
                <Stack key={`${d.form}-${d.date}`} direction="row" spacing={2} alignItems="center">
                  <Box sx={{ width: 56, py: 0.75, borderRadius: 1.25, textAlign: 'center', bgcolor: 'background.neutral' }}>
                    <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                      {Number(d.date.slice(8, 10))}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {formatThaiDateShort(d.date).split(' ')[1]}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">{d.form}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {d.caption}
                    </Typography>
                  </Box>
                </Stack>
              ))}
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                วันที่ยื่นออนไลน์ใช้ตามประกาศขยายเวลาของกรมสรรพากรปี 2568 — ตรวจทุกปี
              </Typography>
            </Stack>
          </Card>

          <Card sx={{ mt: 3, p: 3 }}>
            <Typography variant="subtitle2">หัก ณ ที่จ่ายเดือนก่อนที่ต้องนำส่ง</Typography>
            <Money value={stats.whtPrev} variant="h4" sx={{ display: 'block', my: 1 }} />
            <Button component={RouterLink} href={paths.tax} size="small" endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}>
              สร้างไฟล์ ภ.ง.ด.
            </Button>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
