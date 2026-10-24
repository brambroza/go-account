import type { Account, DocLine, PurchaseLine } from 'src/domain';

import { useRef, useEffect } from 'react';
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
import { lineAmount, WHT_INCOME_TYPES, shouldAppendLineOnEnter } from 'src/domain';

import { Iconify } from 'src/components/iconify';
import { Field } from 'src/components/hook-form';
import { Scrollbar } from 'src/components/scrollbar';

import { Money } from './money';
import { RHFAmountField } from './rhf-amount-field';

// ----------------------------------------------------------------------

export function newLine(accountCode: string): DocLine {
  return { id: uid(), description: '', qty: 1, unitPrice: 0, discount: 0, accountCode };
}

/** บรรทัดเอกสารซื้อใหม่ — ไม่หัก ณ ที่จ่าย (สินค้า) จนกว่าจะเลือกประเภทเงินได้ */
export function newPurchaseLine(accountCode: string): PurchaseLine {
  return { ...newLine(accountCode), whtIncomeType: '', whtRate: 0 };
}

/** อัตราหัก ณ ที่จ่ายที่เลือกได้ในบรรทัด */
export const WHT_RATE_OPTIONS = [0, 1, 2, 3, 5, 10, 15];

type Props = {
  accounts: Account[];
  defaultAccountCode: string;
  accountLabel: string;
  /** ซ่อนคอลัมน์บัญชี (เช่นใบลดหนี้ที่ใช้บัญชีตามใบเดิม) */
  hideAccount?: boolean;
  /** เอกสารซื้อ: แสดงคอลัมน์หัก ณ ที่จ่ายต่อบรรทัด (ประเภทเงินได้ + อัตรา) */
  withWht?: boolean;
};

/** เลือกประเภทเงินได้แล้วเติมอัตราตามปกติให้ (แก้อัตราเองได้) */
function LineWhtFields({ index }: { index: number }) {
  const { setValue } = useFormContext();
  const incomeType = useWatch({ name: `lines.${index}.whtIncomeType` }) as string | undefined;
  useEffect(() => {
    const preset = WHT_INCOME_TYPES.find((w) => w.label === incomeType);
    if (preset) setValue(`lines.${index}.whtRate`, preset.rate, { shouldValidate: true });
    if (incomeType === '') setValue(`lines.${index}.whtRate`, 0, { shouldValidate: true });
  }, [incomeType, index, setValue]);
  return (
    <>
      <TableCell>
        <Field.Select name={`lines.${index}.whtIncomeType`} size="small" inputProps={{ 'aria-label': 'ประเภทเงินได้' }}>
          <MenuItem value="">ไม่หัก (สินค้า)</MenuItem>
          {WHT_INCOME_TYPES.map((w) => (
            <MenuItem key={w.label} value={w.label}>
              {w.label}
            </MenuItem>
          ))}
          {incomeType && !WHT_INCOME_TYPES.some((w) => w.label === incomeType) && (
            <MenuItem value={incomeType}>{incomeType}</MenuItem>
          )}
        </Field.Select>
      </TableCell>
      <TableCell>
        <Field.Select name={`lines.${index}.whtRate`} size="small" inputProps={{ 'aria-label': 'อัตราหัก ณ ที่จ่าย' }}>
          {WHT_RATE_OPTIONS.map((r) => (
            <MenuItem key={r} value={r}>
              {r}%
            </MenuItem>
          ))}
        </Field.Select>
      </TableCell>
    </>
  );
}

function LineAmount({ index }: { index: number }) {
  const line = useWatch({ name: `lines.${index}` }) as DocLine | undefined;
  return <Money value={line ? lineAmount(line) : 0} sx={{ fontWeight: 'fontWeightMedium' }} />;
}

/**
 * ตารางกรอกรายการสินค้า/บริการ ใช้ร่วมกันทั้งขาย ซื้อ ใบเสนอราคา และใบลดหนี้ (ไล่ด้วยปุ่ม Tab ได้ทั้งแถว)
 * Enter ในช่องกรอกของบรรทัดสุดท้าย = เพิ่มบรรทัดใหม่แล้วไปที่ช่องคำอธิบาย (แบบ Express)
 */
export function DocLinesEditor({ accounts, defaultAccountCode, accountLabel, hideAccount, withWht }: Props) {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: 'key' });
  const container = useRef<HTMLDivElement>(null);
  const focusRow = useRef<number | null>(null);

  const addLine = () => append(withWht ? newPurchaseLine(defaultAccountCode) : newLine(defaultAccountCode));

  // หลังเพิ่มบรรทัดด้วย Enter: โฟกัสช่องคำอธิบายของบรรทัดใหม่
  useEffect(() => {
    if (focusRow.current === null) return;
    const input = container.current?.querySelector<HTMLInputElement>(`input[aria-label="รายการที่ ${focusRow.current + 1}"]`);
    if (input) {
      input.focus();
      focusRow.current = null;
    }
  }, [fields.length]);

  const onRowKeyDown = (index: number) => (event: React.KeyboardEvent) => {
    const isTextInput = event.target instanceof HTMLInputElement && event.target.type !== 'checkbox';
    if (!shouldAppendLineOnEnter(event, index, fields.length, isTextInput)) return;
    event.preventDefault();
    focusRow.current = fields.length;
    addLine();
  };

  return (
    <Box ref={container}>
      <Scrollbar>
        <Table size="small" sx={{ minWidth: (hideAccount ? 640 : 860) + (withWht ? 300 : 0) }}>
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
              {withWht && <TableCell sx={{ width: 190 }}>หัก ณ ที่จ่าย</TableCell>}
              {withWht && <TableCell sx={{ width: 96 }}>อัตรา</TableCell>}
              <TableCell sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.map((field, index) => (
              <TableRow key={field.key} onKeyDown={onRowKeyDown(index)}>
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
                {withWht && <LineWhtFields index={index} />}
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
        onClick={addLine}
        sx={{ mt: 1.5 }}
      >
        เพิ่มรายการ
      </Button>
      <Box component="span" sx={{ ml: 1.5, typography: 'caption', color: 'text.secondary' }}>
        Enter ที่บรรทัดสุดท้าย = เพิ่มบรรทัด · Ctrl+Enter = บันทึก
      </Box>
    </Box>
  );
}
