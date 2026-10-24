import type { LoadResult } from 'src/store';

import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import Typography from '@mui/material/Typography';

import { useAccounting } from 'src/store';
import { formatThaiDate } from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { backupCounts, downloadBackup } from './backup';

// ----------------------------------------------------------------------

type Props = {
  onClose: () => void;
  /** ผลการอ่านไฟล์ (`readBackup`) — null = ปิด dialog */
  file: { name: string; result: LoadResult } | null;
};

/**
 * ตรวจไฟล์สำรองก่อนกู้คืน: เทียบจำนวนรายการไฟล์กับข้อมูลปัจจุบัน, แจ้งการย้ายเวอร์ชัน, แสดงปัญหา
 * มีปัญหาข้อใดข้อหนึ่ง = กู้คืนไม่ได้ (ไม่มีทางข้ามใน UI)
 */
export function RestoreDialog({ file, onClose }: Props) {
  const { data, replace } = useAccounting();
  const result = file?.result;
  const blocked = !result?.data || result.problems.length > 0;
  const current = backupCounts(data);
  const incoming = result?.data ? backupCounts(result.data) : [];

  const restore = () => {
    if (!result?.data || blocked) return;
    try {
      replace(result.data);
      toast.success('กู้คืนข้อมูลแล้ว');
      onClose();
    } catch (error) {
      toast.error(`กู้คืนไม่สำเร็จ: ${error instanceof Error ? error.message : ''}`);
    }
  };

  return (
    <ConfirmDialog
      open={!!file}
      onClose={onClose}
      maxWidth="sm"
      title="กู้คืนจากไฟล์สำรอง"
      content={
        result && (
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              ไฟล์ {file?.name}
              {result.data ? ` · ${result.data.company.name}` : ''}
              {result.data?.company.lockedThrough ? ` · ปิดงวดถึง ${formatThaiDate(result.data.company.lockedThrough)}` : ''}
            </Typography>

            {result.migratedFrom !== undefined && (
              <Alert severity="info" variant="outlined">
                ไฟล์เป็นข้อมูลเวอร์ชัน {result.migratedFrom} — ระบบจะย้ายขึ้นเวอร์ชันปัจจุบันให้ตอนกู้คืน
              </Alert>
            )}

            {blocked ? (
              <Alert severity="error">
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  กู้คืนไม่ได้ — ไฟล์ไม่ผ่านการตรวจ {result.problems.length} ข้อ
                </Typography>
                <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {result.problems.slice(0, 20).map((p) => (
                    <li key={p}>
                      <Typography variant="body2">{p}</Typography>
                    </li>
                  ))}
                  {result.problems.length > 20 && (
                    <li>
                      <Typography variant="body2">และอีก {result.problems.length - 20} ข้อ</Typography>
                    </li>
                  )}
                </Stack>
              </Alert>
            ) : (
              <Alert severity="warning" variant="outlined">
                ข้อมูลปัจจุบันในเบราว์เซอร์นี้ทั้งหมดจะถูกแทนที่ด้วยข้อมูลในไฟล์ ย้อนกลับไม่ได้ — สำรองข้อมูลปัจจุบันไว้ก่อน
              </Alert>
            )}

            {incoming.length > 0 && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>รายการ</TableCell>
                    <TableCell align="right">ในไฟล์</TableCell>
                    <TableCell align="right">ปัจจุบัน</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {incoming.map((row, i) => (
                    <TableRow key={row.key}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell align="right">{row.count.toLocaleString('th-TH')}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: current[i].count > row.count ? 'warning.main' : 'text.secondary' }}
                      >
                        {current[i].count.toLocaleString('th-TH')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Button
              variant="outlined"
              color="inherit"
              startIcon={<Iconify icon="solar:download-bold" />}
              onClick={() => downloadBackup(data, '-before-restore')}
              sx={{ alignSelf: 'flex-start' }}
            >
              สำรองข้อมูลปัจจุบันก่อน
            </Button>
          </Stack>
        )
      }
      action={
        <Button variant="contained" color="error" onClick={restore} disabled={blocked}>
          แทนที่ด้วยข้อมูลในไฟล์
        </Button>
      }
    />
  );
}
