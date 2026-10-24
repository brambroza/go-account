import { Controller, useFormContext } from 'react-hook-form';

import { PhoneInput, PhoneInputThai } from '../phone-input';

import type { PhoneInputProps } from '../phone-input';

// ----------------------------------------------------------------------

type Props = Omit<PhoneInputProps, 'value' | 'onChange'> & {
  name: string;
};

export function RHFPhoneInput({ name, helperText, ...other }: Props) {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <PhoneInput
          {...field}
          fullWidth
          value={field.value}
          onChange={(newValue) => setValue(name, newValue, { shouldValidate: true })}
          error={!!error}
          helperText={error ? error?.message : helperText}
          {...other}
        />
      )}
    />
  );
}

export function RHFPhoneInputThai({ name, helperText, ...other }: Props) {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <PhoneInputThai
          {...field}
          fullWidth
          value={field.value}
          onChange={(newValue) => setValue(name, newValue, { shouldValidate: true })}
          error={!!error}
          helperText={error ? error?.message : helperText}
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
