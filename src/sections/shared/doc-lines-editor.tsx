import type { Account, DocLine } from 'src/domain';

import { useWatch, useFieldArray, useFormContext } from 'react-hook-form';

import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import Button from '@mui/material/Button';
import TableRow from '@mui/material/TableRow';
import MenuItem from '@mui/material/MenuItem';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import IconButton from '@mui/material/IconButton';

import { uid } from 'src/store';
import { lineAmount } from 'src/domain';

import { Iconify } from 'src/components/iconify';
import { Field } from 'src/components/hook-form';
import { Scrollbar } from 'src/components/scrollbar';

import { Money } from './money';
import { RHFAmountField } from './rhf-amount-field';

// ----------------------------------------------------------------------

export function newLine(accountCode: string): DocLine {
  return { id: uid(), description: '', qty: 1, unitPrice: 0, discount: 0, accountCode };
}

type Props = {
  accounts: Account[];
  defaultAccountCode: string;
  accountLabel: string;
  /** ซ่อนคอลัมน์บัญชี (เช่นใบลดหนี้ที่ใช้บัญชีตามใบเดิม) */
  hideAccount?: boolean;
};

function LineAmount({ index }: { index: number }) {
  const line = useWatch({ name: `lines.${index}` }) as DocLine | undefined;
  return <Money value={line ? lineAmount(line) : 0} sx={{ fontWeight: 'fontWeightMedium' }} />;
}

/** ตารางกรอกรายการสินค้า/บริการ ใช้ร่วมกันทั้งขาย ซื้อ และใบลดหนี้ (ไล่ด้วยปุ่ม Tab ได้ทั้งแถว) */
export function DocLinesEditor({ accounts, defaultAccountCode, accountLabel, hideAccount }: Props) {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: 'key' });

  return (
    <Box>
      <Scrollbar>
        <Table size="small" sx={{ minWidth: hideAccount ? 640 : 860 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}>#</TableCell>
              <TableCell>รายการ</TableCell>
              {!hideAccount && <TableCell sx={{ width: 200 }}>{accountLabel}</TableCell>}
              <TableCell align="right" sx={{ width: 100 }}>
                จำนวน
              </TableCell>
              <TableCell align="right" sx={{ width: 130 }}>
                ราคา/หน่วย
              </TableCell>
              <TableCell align="right" sx={{ width: 110 }}>
                ส่วนลด
              </TableCell>
              <TableCell align="right" sx={{ width: 130 }}>
                จำนวนเงิน
              </TableCell>
              <TableCell sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.map((field, index) => (
              <TableRow key={field.key}>
                <TableCell sx={{ color: 'text.secondary' }}>{index + 1}</TableCell>
                <TableCell>
                  <Field.Text
                    name={`lines.${index}.description`}
                    size="small"
                    placeholder="คำอธิบายสินค้า/บริการ"
                    inputProps={{ 'aria-label': `รายการที่ ${index + 1}` }}
                  />
                </TableCell>
                {!hideAccount && (
                  <TableCell>
                    <Field.Select name={`lines.${index}.accountCode`} size="small" inputProps={{ 'aria-label': accountLabel }}>
                      {accounts.map((a) => (
                        <MenuItem key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </MenuItem>
                      ))}
                    </Field.Select>
                  </TableCell>
                )}
                <TableCell>
                  <RHFAmountField name={`lines.${index}.qty`} decimals={3} inputProps={{ 'aria-label': 'จำนวน' }} />
                </TableCell>
                <TableCell>
                  <RHFAmountField name={`lines.${index}.unitPrice`} inputProps={{ 'aria-label': 'ราคาต่อหน่วย' }} />
                </TableCell>
                <TableCell>
                  <RHFAmountField name={`lines.${index}.discount`} inputProps={{ 'aria-label': 'ส่วนลด' }} />
                </TableCell>
                <TableCell align="right">
                  <LineAmount index={index} />
                </TableCell>
                <TableCell>
                  <IconButton
                    aria-label={`ลบรายการที่ ${index + 1}`}
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    size="small"
                  >
                    <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Scrollbar>
      <Button
        size="small"
        color="primary"
        startIcon={<Iconify icon="mingcute:add-line" />}
        onClick={() => append(newLine(defaultAccountCode))}
        sx={{ mt: 1.5 }}
      >
        เพิ่มรายการ
      </Button>
    </Box>
  );
}
