/* eslint-disable perfectionist/sort-imports */

import 'dayjs/locale/th';
import 'dayjs/locale/en';

import dayjs from 'dayjs';

import { LocalizationProvider as Provider } from '@mui/x-date-pickers/LocalizationProvider';

import { useTranslate } from './use-locales';
import { BUDDHIST_DATE_FORMATS } from './buddhist-era';
import { AdapterDayjsBuddhist } from './adapter-buddhist-dayjs';

// ----------------------------------------------------------------------

type Props = {
  children: React.ReactNode;
};

/** date picker ทั้งระบบแสดงปี พ.ศ. (ค่าที่เก็บยังเป็น ISO ค.ศ.) — ดู `buddhist-era.ts` */
export function LocalizationProvider({ children }: Props) {
  const { currentLang } = useTranslate();

  dayjs.locale(currentLang.adapterLocale);

  return (
    <Provider dateAdapter={AdapterDayjsBuddhist} adapterLocale={currentLang.adapterLocale} dateFormats={BUDDHIST_DATE_FORMATS}>
      {children}
    </Provider>
  );
}
