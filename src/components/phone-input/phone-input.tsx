import type { TextFieldProps } from '@mui/material/TextField';
import type { Country } from 'react-phone-number-input/input';

import { useState, forwardRef } from 'react';
import PhoneNumberInput from 'react-phone-number-input/input';

import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';

import { getCountryCode } from './utils';
import { CountryListPopover } from './list';

import type { PhoneInputProps, PhoneInputThaiProps } from './types';

// ----------------------------------------------------------------------

export const PhoneInput = forwardRef<HTMLDivElement, PhoneInputProps>(
  ({ value, onChange, placeholder, country: inputCountryCode, disableSelect, ...other }, ref) => {
    const defaultCountryCode = getCountryCode(value, inputCountryCode);

    const [selectedCountry, setSelectedCountry] = useState(defaultCountryCode);

    return (
      <PhoneNumberInput
        ref={ref}
        country={selectedCountry}
        inputComponent={CustomInput}
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Enter phone number'}
        InputProps={
          disableSelect
            ? undefined
            : {
              startAdornment: (
                <InputAdornment position="start" sx={{ ml: 1 }}>
                  <CountryListPopover
                    countryCode={selectedCountry}
                    onClickCountry={(inputValue: Country) => {
                     
                      setSelectedCountry(inputValue);
                    }}
                  />
                </InputAdornment>
              ),
            }
        }
        {...other}
      />
    );
  }
);

// ----------------------------------------------------------------------

const CustomInput = forwardRef<HTMLInputElement, TextFieldProps>(({ ...props }, ref) => (
  <TextField inputRef={ref} {...props} />
));
export const formatThaiPhoneNumber = (input: string | undefined): string => {
  if (!input) return "";

  // เอาเฉพาะตัวเลขก่อน
  const digitsOnly = input.replace(/\D/g, "");

  // normalize: 66xxxx -> 0xxxx (และกันเคส 660xxxxxxxxx -> 00... ให้เหลือ 0...)
  let normalized = digitsOnly;
  if (normalized.startsWith("66")) {
    normalized =    `0${normalized.slice(2)}`;
    normalized = normalized.replace(/^00/, "0");
  }

  // ✅ บล็อกไม่เกิน 10 หลัก (หลัง normalize)
  normalized = normalized.slice(0, 10);

  // --- format ---
  // 02xxxxxxx (รวม 9 หลัก) => 02 123 4567
  if (normalized.length === 9 && normalized.startsWith("02")) {
    return normalized.replace(/^(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3");
  }

  // 9 หลักอื่น ๆ => 000 000 000
  if (normalized.length === 9 && !normalized.startsWith("02")) {
    return normalized.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
  }

  // 10 หลัก => 000 000 0000
  if (normalized.length === 10) {
    return normalized.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
  }

  return normalized;
};

const CustomInputs = forwardRef<HTMLInputElement, TextFieldProps>(({ value, ...props }, ref) => {


  const formattedValue = value ? formatThaiPhoneNumber(value as string) : ''; // ฟอร์แมตค่า
  return <TextField inputRef={ref} {...props} value={formattedValue} />;
});

export const PhoneInputThai = forwardRef<HTMLDivElement, PhoneInputThaiProps>(
  ({ value, onChange, placeholder, country: inputCountryCode, disableSelect, ...other }, ref) => (
    <PhoneNumberInput
      ref={ref}
      country="TH"
      inputComponent={CustomInputs}
      value={value}
      onChange={(rawValue) => {
        onChange?.(rawValue || '');
      }}
      placeholder={placeholder ?? ''}
      {...other}
    />
  )
);
