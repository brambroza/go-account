import { RHFCode } from './rhf-code';
import { RHFRating } from './rhf-rating';
import { RHFSlider } from './rhf-slider';
import { RHFRadioGroup } from './rhf-radio-group';
import { RHFSelectIcon } from './rhf-select-icon';
import { RHFCountrySelect } from './rhf-country-select';
import { RHFSwitch, RHFMultiSwitch } from './rhf-switch';
import { RHFSelect, RHFMultiSelect } from './rhf-select';
import { RHFCheckbox, RHFMultiCheckbox } from './rhf-checkbox';
import { RHFPhoneInput, RHFPhoneInputThai } from './rhf-phone-input';
import { RHFDatePicker, RHFMobileDateTimePicker } from './rhf-date-picker';
import { RHFAutocomplete, RHFAutocompleteCustom } from './rhf-autocomplete';
import {
  RHFTextField,
  RHFTextFieldIcon,
  RHFTextNumberField,
  RHFTextFieldPrefixEnd,
  RHFTextFieldPrefixCustom,
} from './rhf-text-field';

// ----------------------------------------------------------------------

/**
 * `Field.*` = RHF wrapper ชุดเดียวกับ go-crm-24v4
 * ไม่มี Editor / Upload* / Anydesk — ถ้าต้องใช้ให้ย้าย `rhf-editor`, `rhf-upload` จาก CRM มาเพิ่ม (ดู README)
 */
export const Field = {
  Code: RHFCode,
  Select: RHFSelect,
  Switch: RHFSwitch,
  Slider: RHFSlider,
  Rating: RHFRating,
  Text: RHFTextField,
  TextIcon: RHFTextFieldIcon,
  TextNumber: RHFTextNumberField,
  TextPrefix: RHFTextFieldPrefixCustom,
  TextPrefixEnd: RHFTextFieldPrefixEnd,
  Phone: RHFPhoneInput,
  Checkbox: RHFCheckbox,
  RadioGroup: RHFRadioGroup,
  DatePicker: RHFDatePicker,
  MultiSelect: RHFMultiSelect,
  MultiSwitch: RHFMultiSwitch,
  Autocomplete: RHFAutocomplete,
  AutocompleteCustom: RHFAutocompleteCustom,
  MultiCheckbox: RHFMultiCheckbox,
  CountrySelect: RHFCountrySelect,
  MobileDateTimePicker: RHFMobileDateTimePicker,
  PhoneThai: RHFPhoneInputThai,
  SelectIcon: RHFSelectIcon,
};
