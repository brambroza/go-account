import type {
  AutocompleteProps,
  AutocompleteRenderInputParams,
  AutocompleteRenderGetTagProps,
} from '@mui/material/Autocomplete';

import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import InputAdornment from '@mui/material/InputAdornment';
import { filledInputClasses } from '@mui/material/FilledInput';

import { FlagIcon, iconifyClasses } from 'src/components/iconify';

// ----------------------------------------------------------------------

type Value = string;

export type AutocompleteBaseProps = Omit<
  AutocompleteProps<any, boolean, boolean, boolean>,
  'options' | 'renderOption' | 'renderInput' | 'renderTags' | 'getOptionLabel'
>;

export type IConSelectProps = AutocompleteBaseProps & {
  label?: string;
  error?: boolean;
  placeholder?: string;
  hiddenLabel?: boolean;
  getValue?: 'label' | 'value';
  helperText?: React.ReactNode;
  lists: { label: string; value: string; icon: JSX.Element }[];
  value: string;
};

export function RHFSelectIcon({
  id,
  label,
  error,
  multiple,
  helperText,
  hiddenLabel,
  placeholder,
  getValue = 'label',
  lists,
  value,
  ...other
}: IConSelectProps) {
   
    
  function displayValueByCountryCode(inputValue: string) {
    const option = lists.filter((country) => country.value === inputValue)[0];

    return option.label;
  }

  function getCountry(inputValue: string) {
    const option = lists.filter(
      (country) => country.label === inputValue || country.value === inputValue
    )[0];

    return { code: option?.value, label: option?.label , icon: option?.icon };
  }

  const renderOption = (props: React.HTMLAttributes<HTMLLIElement>, option: Value) => {
    const country = getCountry(option);

    if (!country.label) {
      return null;
    }

    return (
      <li {...props} key={country.label}   
       >
        {country.icon} 
        {country.label}
      </li>
    );
  };

  const renderInput = (params: AutocompleteRenderInputParams) => {
    const country = getCountry(params.inputProps.value as Value);

    const baseField = {
      ...params,
      label,
      placeholder,
      helperText,
      hiddenLabel,
      error: !!error,
      inputProps: {
        ...params.inputProps,
        autoComplete: 'new-password',
      },
    };

    if (multiple) {
      return <TextField {...baseField} />;
    }

    return (
      <TextField
        {...baseField}
        InputProps={{
          ...params.InputProps,
          startAdornment: (
            <InputAdornment position="start" sx={{ ...(!country.code && { display: 'none' }) }}>
               {country.icon} 
            </InputAdornment>
          ),
        }}
        sx={{
          ...(!hiddenLabel && {
            [`& .${filledInputClasses.root}`]: { [`& .${iconifyClasses.root}`]: { mt: -1 } },
          }),
        }}
      />
    );
  };

  const renderTags = (selected: Value[], getTagProps: AutocompleteRenderGetTagProps) =>
    selected.map((option, index) => {
      const country = getCountry(option);

      return (
        <Chip
          {...getTagProps({ index })}
          key={country.label}
          label={country.label}
          size="small"
          variant="soft"
          icon={
            <FlagIcon
              key={country.code}
              code={country.label}
              sx={{ width: 16, height: 16, borderRadius: '50%' }}
            />
          }
        />
      );
    });

  const getOptionLabel = (option: Value) =>
    getValue === 'label' ? option : displayValueByCountryCode(option);

  return (
    <Autocomplete
      id={`country-select-${id}`}
      multiple={multiple}
      options={lists.map((country) => country.label)}
      value={value}
      autoHighlight={!multiple}
      disableCloseOnSelect={multiple}
      renderOption={renderOption}
      renderInput={renderInput}
      renderTags={multiple ? renderTags : undefined}
      getOptionLabel={getOptionLabel}
      {...other}
    />
  );
}

// ----------------------------------------------------------------------
