import type { WhtCertificate } from 'src/domain';
import type { Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';

import { formatTaxId, formatThaiDate, partyDisplayName } from 'src/domain';

import { Money, CheckMark, formatAddress } from 'src/sections/shared';

// ----------------------------------------------------------------------

/** ช่องแบบที่ยื่นตามหนังสือรับรองของกรมสรรพากร — ระบบออกได้เฉพาะ ภ.ง.ด.3 และ ภ.ง.ด.53 */
const FORMS: { label: string; form?: WhtCertificate['form'] }[] = [
  { label: '(1) ภ.ง.ด.1ก' },
  { label: '(2) ภ.ง.ด.1ก พิเศษ' },
  { label: '(3) ภ.ง.ด.2' },
  { label: '(4) ภ.ง.ด.3', form: 'PND3' },
  { label: '(5) ภ.ง.ด.2ก' },
  { label: '(6) ภ.ง.ด.3ก' },
  { label: '(7) ภ.ง.ด.53', form: 'PND53' },
];

/** หัวข้อประเภทเงินได้ตามแบบ — รายการของระบบเป็นการจ่ายตามคำสั่งที่ออกตาม ม.3 เตรส (ข้อ 5) */
const INCOME_ROWS = [
  '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)',
  '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)',
  '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)',
  '4. ดอกเบี้ย เงินปันผล ฯลฯ ตามมาตรา 40 (4)',
  '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น ค่าเช่า ค่าบริการ ค่าจ้างทำของ ค่าขนส่ง ค่าโฆษณา',
  '6. อื่น ๆ (ระบุ)',
];

const CONDITIONS: { value: WhtCertificate['condition'] | '4'; label: string }[] = [
  { value: '1', label: '(1) หัก ณ ที่จ่าย' },
  { value: '2', label: '(2) ออกให้ตลอดไป' },
  { value: '3', label: '(3) ออกให้ครั้งเดียว' },
  { value: '4', label: '(4) อื่น ๆ (ระบุ)' },
];

/**
 * พิมพ์ให้จบใน A4 หน้าเดียวรวมช่องลงชื่อ (UAT U5) — ย่อระยะห่าง/ตัวอักษรเฉพาะตอนพิมพ์
 * หน้าจอยังใช้ขนาดปกติ (≥14px)
 */
const PRINT_COMPACT_SX = {
  '& .MuiTableCell-root': { py: 0.5, px: 1 },
  '& .MuiTypography-body2, & .MuiTableCell-root': { fontSize: 12.5, lineHeight: 1.45 },
  '& .MuiTypography-subtitle2': { fontSize: 13 },
  '& .MuiTypography-caption': { fontSize: 11 },
  '& .MuiTypography-h6': { fontSize: 16 },
} as const;

type Props = {
  cert: WhtCertificate;
  /** ฉบับที่ 1 (แนบแบบแสดงรายการ) หรือ 2 (เก็บเป็นหลักฐาน) */
  copy: 1 | 2;
};

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ — จัดหน้าตามแบบของกรมสรรพากร
 * (ผู้จ่าย/ผู้ถูกหัก + เลขผู้เสียภาษี, ลำดับที่ในแบบ, ช่องแบบ ภ.ง.ด., ตารางประเภทเงินได้, ตัวอักษร, เงื่อนไข, ลงชื่อ)
 */
export function WhtCertificatePreview({ cert, copy }: Props) {
  const cellSx = { border: (theme: Theme) => `1px solid ${theme.vars.palette.divider}` };
  const party = (role: string, name: string, taxId: string, address: string) => (
    <Box sx={{ p: 1.5, border: (theme) => `1px solid ${theme.vars.palette.divider}`, borderRadius: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
        <Typography variant="subtitle2">{role}</Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) <strong>{formatTaxId(taxId) || '-'}</strong>
        </Typography>
      </Stack>
      <Typography variant="body2">ชื่อ {name}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        ที่อยู่ {address || '-'}
      </Typography>
    </Box>
  );

  return (
    <Card sx={{ p: { xs: 2.5, md: 4 }, '@media print': PRINT_COMPACT_SX }} className="print-area">
      <Typography variant="caption" component="div" sx={{ textAlign: 'right', color: 'text.secondary' }}>
        {copy === 1
          ? 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)'
          : 'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)'}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-end' }} sx={{ mt: 1 }}>
        <Box>
          <Typography variant="h6">หนังสือรับรองการหักภาษี ณ ที่จ่าย</Typography>
          <Typography variant="body2">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</Typography>
        </Box>
        <Typography variant="body2">
          เล่มที่ <strong>{cert.bookNo}</strong> · เลขที่ <strong>{cert.seqInBook}</strong>
        </Typography>
      </Stack>

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {party('ผู้มีหน้าที่หักภาษี ณ ที่จ่าย', cert.payer.name, cert.payer.taxId, formatAddress(cert.payer.address))}
        {party('ผู้ถูกหักภาษี ณ ที่จ่าย', partyDisplayName(cert.payee), cert.payee.taxId, formatAddress(cert.payee.address))}
      </Stack>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1.5 }}>
        <Typography variant="body2">
          ลำดับที่ <strong>{cert.sequence ?? '-'}</strong> ในแบบ
        </Typography>
        {FORMS.map((f) => (
          <CheckMark key={f.label} checked={!!f.form && f.form === cert.form} label={f.label} />
        ))}
      </Stack>

      <Table size="small" sx={{ mt: 2, '& td, & th': cellSx }}>
        <TableHead>
          <TableRow>
            <TableCell>ประเภทเงินได้พึงประเมินที่จ่าย</TableCell>
            <TableCell align="center" sx={{ width: 120 }}>
              วัน เดือน หรือปีภาษี ที่จ่าย
            </TableCell>
            <TableCell align="right" sx={{ width: 140 }}>
              จำนวนเงินที่จ่าย
            </TableCell>
            <TableCell align="right" sx={{ width: 140 }}>
              ภาษีที่หักและนำส่งไว้
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {INCOME_ROWS.map((row, index) => (
            <TableRow key={row}>
              <TableCell>
                <Typography variant="body2">{row}</Typography>
                {index === 4 &&
                  cert.items.map((i) => (
                    <Typography key={`${i.incomeType}-${i.rate}`} variant="body2" sx={{ pl: 2 }}>
                      — {i.incomeType} ({i.rate}%)
                    </Typography>
                  ))}
              </TableCell>
              <TableCell align="center">
                {index === 4 &&
                  cert.items.map((i) => (
                    <Typography key={`${i.incomeType}-${i.rate}`} variant="body2">
                      {formatThaiDate(i.paidDate)}
                    </Typography>
                  ))}
              </TableCell>
              <TableCell align="right">
                {index === 4 && cert.items.map((i) => <Money key={`${i.incomeType}-${i.rate}`} value={i.base} sx={{ display: 'block' }} />)}
              </TableCell>
              <TableCell align="right">
                {index === 4 && cert.items.map((i) => <Money key={`${i.incomeType}-${i.rate}`} value={i.tax} sx={{ display: 'block' }} />)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={2}>
              <Typography variant="subtitle2">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</Typography>
            </TableCell>
            <TableCell align="right">
              <Money value={cert.totalBase} sx={{ fontWeight: 600 }} />
            </TableCell>
            <TableCell align="right">
              <Money value={cert.totalTax} sx={{ fontWeight: 600 }} />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={4}>
              <Typography variant="body2">
                รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) <strong>({cert.totalTaxText})</strong>
              </Typography>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
        เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ........ บาท · กองทุนประกันสังคม ........ บาท ·
        กองทุนสำรองเลี้ยงชีพ ........ บาท
      </Typography>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <Typography variant="subtitle2">ผู้จ่ายเงิน</Typography>
        {CONDITIONS.map((c) => (
          <CheckMark key={c.value} checked={c.value === cert.condition} label={c.label} />
        ))}
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 3, breakInside: 'avoid' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            คำเตือน: ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร
            ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร
          </Typography>
          <Typography variant="caption" component="div" sx={{ mt: 1, color: 'text.secondary' }}>
            อ้างอิง: ใบสำคัญจ่าย {cert.paymentDocNo} · เอกสารซื้อ {cert.purchaseDocNo}
          </Typography>
        </Box>
        <Stack alignItems="center" spacing={0.5} sx={{ flex: 1 }}>
          <Typography variant="body2">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</Typography>
          <Box sx={{ width: 220, height: 40, borderBottom: (theme) => `dotted 1px ${theme.vars.palette.text.primary}` }} />
          <Typography variant="body2">ลงชื่อ ผู้จ่ายเงิน</Typography>
          <Typography variant="body2">{formatThaiDate(cert.date)} (วัน เดือน ปี ที่ออกหนังสือรับรอง)</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            ประทับตรานิติบุคคล (ถ้ามี)
          </Typography>
        </Stack>
      </Stack>
    </Card>
  );
}
