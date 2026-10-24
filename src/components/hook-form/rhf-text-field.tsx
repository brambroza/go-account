import type { Theme, SxProps } from '@mui/material/styles';
import type { TextFieldProps } from '@mui/material/TextField';
import type { NumericFormatProps } from 'react-number-format';

import { NumericFormat } from 'react-number-format';
import { Controller, useFormContext } from 'react-hook-form';

import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';

import { Iconify } from 'src/components/iconify';

// ----------------------------------------------------------------------

type Props = TextFieldProps & {
  name: string;
  prefix?: string;
  icon?: string;
};

export function RHFTextField({ name, helperText, type, ...other }: Props) {
  const { control } = useFormContext();
  const isNumericText = type === 'number-string';
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          fullWidth
          type={type}


          value={type === 'number' && field.value === 0 ? '0' : field.value}
          /*  onChange={(event) => {
             if (type === 'number') {
               field.onChange(Number(event.target.value));
             } else {
               field.onChange(event.target.value);
             }
           }} */
          onChange={(event) => {
            const newValue = event.target.value;

            if (isNumericText) {
              if (/^\d*$/.test(newValue)) {
                field.onChange(newValue); // ✅ รับเป็น string
              }
            } else {
              field.onChange(type === 'number' ? Number(newValue) : newValue);
            }
          }}
          error={!!error}
          helperText={error?.message ?? helperText}
          inputProps={{
            autoComplete: 'off',
            ...(isNumericText && {
              inputMode: 'numeric',
              pattern: '[0-9]*',
            }),

          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderStyle: 'dotted',
              },
              '&:hover fieldset': {
                borderStyle: 'dotted',
              },
              '&.Mui-focused fieldset': {
                borderStyle: 'dotted',
              },
            },
          }}
          {...other}
        />
      )}
    />
  );
}



export function RHFTextFieldIcon({ name, icon, helperText, type, ...other }: Props) {
  const { control } = useFormContext();
  const isNumericText = type === 'number-string';
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          fullWidth
          type={type}
          value={type === 'number' && field.value === 0 ? '' : field.value}
          /*  onChange={(event) => {
             if (type === 'number') {
               field.onChange(Number(event.target.value));
             } else {
               field.onChange(event.target.value);
             }
           }} */
          onChange={(event) => {
            const newValue = event.target.value;

            if (isNumericText) {
              if (/^\d*$/.test(newValue)) {
                field.onChange(newValue); // ✅ รับเป็น string
              }
            } else {
              field.onChange(type === 'number' ? Number(newValue) : newValue);
            }
          }}
          error={!!error}
          helperText={error?.message ?? helperText}

          InputProps={{
            autoComplete: 'off',
            ...(isNumericText && {
              inputMode: 'numeric',
              pattern: '[0-9]*',
            }),

            endAdornment: (
              <InputAdornment position="end">
                <IconButton edge="end" onClick={() => console.log('Clicked!')}>
                  <Iconify icon={icon ?? "solar:pen-bold"} width={15} />

                </IconButton>
              </InputAdornment>
            ),
          }}

          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderStyle: 'dotted',
              },
              '&:hover fieldset': {
                borderStyle: 'dotted',
              },
              '&.Mui-focused fieldset': {
                borderStyle: 'dotted',
              },
            },
          }}
          {...other}
        />
      )}
    />
  );
}



type NumbersProps = NumericFormatProps & {
  name: string;
  helperText?: string;
  type?: string;
  values?: number;
  label?: string;
  defaultValue?: number;
  sx?: SxProps<Theme> | undefined;
};

export function RHFTextNumberField({
  name,
  helperText,
  type = 'text',
  values,
  defaultValue,

  onChange: externalOnChange,
  label,
  sx,
  ...other
}: NumbersProps) {
  const { control } = useFormContext();



  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <NumericFormat
          {...field}
          size="small"
          placeholder="0"

          fullWidth
          disabled={other.disabled}
          customInput={TextField}
          thousandSeparator
          valueIsNumericString
          value={values}
          defaultValue={defaultValue}

          onChange={(event) => {

            // field.onChange(Number(event.target.value.replaceAll(',', '')));

            if (externalOnChange) {
              externalOnChange(event);
            }
          }}
          onValueChange={(event) => {
            const newValue = event.floatValue;
            field.onChange(newValue);
          }}
          error={!!error}
          helperText={error?.message ?? helperText}
          label={label}
          inputProps={{
            autoComplete: 'off',
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderStyle: 'dotted',
              },
              '&:hover fieldset': {
                borderStyle: 'dotted',
              },
              '&.Mui-focused fieldset': {
                borderStyle: 'dotted',
              },
            },
            [`& .MuiInputBase-input`]: { textAlign: { md: 'right' } },
            width: '100%',
            ...sx,
          }}
        />
      )}
    />
  );
}

export function RHFTextFieldPrefixCustom({ name, prefix, helperText, type, ...other }: Props) {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start" sx={{ ml: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
                  {prefix}-
                </Typography>
              </InputAdornment>
            ),
          }}
          fullWidth
          type={type}
          value={type === 'number' && field.value === 0 ? '' : field.value}
          onChange={(event) => {
            if (type === 'number') {
              field.onChange(Number(event.target.value));
            } else {
              field.onChange(event.target.value);
            }
          }}
          error={!!error}
          helperText={error?.message ?? helperText}
          inputProps={{
            autoComplete: 'off',
          }}
          {...other}
        />
      )}
    />
  );
}

export function RHFTextFieldPrefixEnd({ name, prefix, helperText, type, ...other }: Props) {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          InputProps={{
            endAdornment: (
              <InputAdornment position="start" sx={{ ml: 1 }}>
                <Typography variant="caption" sx={{ textAlign: 'end' }}>
                  {prefix}
                </Typography>
              </InputAdornment>
            ),
          }}
          fullWidth
          type={type}
          value={type === 'number' && field.value === 0 ? '' : field.value}
          onChange={(event) => {
            if (type === 'number') {
              field.onChange(Number(event.target.value));
            } else {
              field.onChange(event.target.value);
            }
          }}
          error={!!error}
          helperText={error?.message ?? helperText}
          inputProps={{
            autoComplete: 'off',
          }}
          {...other}
        />
      )}
    />
  );
}
