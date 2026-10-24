import type { TextFieldProps } from '@mui/material/TextField';

import { NumericFormat } from 'react-number-format';
import { Controller, useFormContext } from 'react-hook-form';

import TextField from '@mui/material/TextField';

// ----------------------------------------------------------------------

type Props = Omit<TextFieldProps, 'name' | 'value' | 'onChange' | 'defaultValue' | 'type'> & {
  name: string;
  decimals?: number;
};

/**
 * ช่องตัวเลขแบบ controlled สำหรับ RHF (ใช้ใน useFieldArray ได้)
 * เก็บค่าเป็น number เสมอ ช่องว่าง = 0
 */
export function RHFAmountField({ name, decimals = 2, inputProps, ...other }: Props) {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <NumericFormat
          customInput={TextField}
          getInputRef={field.ref}
          value={field.value ?? ''}
          onBlur={field.onBlur}
          onValueChange={(v) => field.onChange(v.floatValue ?? 0)}
          thousandSeparator
          decimalScale={decimals}
          allowNegative={false}
          fullWidth
          size="small"
          error={!!error}
          helperText={error?.message}
          inputProps={{ inputMode: 'decimal', style: { textAlign: 'right' }, ...inputProps }}
          {...(other as Record<string, unknown>)}
        />
      )}
    />
  );
}
