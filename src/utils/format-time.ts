import type { Dayjs, OpUnitType } from 'dayjs';

import 'dayjs/locale/th';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
// ----------------------------------------------------------------------

dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.locale('th');

// ----------------------------------------------------------------------

export type DatePickerFormat = Dayjs | Date | string | number | null | undefined;

/**
 * Docs: https://day.js.org/docs/en/display/format
 */
export const formatStr = {
  dateTime: 'DD MMM YYYY HH:mm', // 17 Apr 2022 12:00 am
  date: 'DD/MM/YYYY', // 17 Apr 2022
  datesystem: 'YYYY-MM-DD',
  time: 'HH:mm', // 12:00 am
  timesec: 'HH:mm:ss',
  split: {
    dateTime: 'DD/MM/YYYY HH:mm', // 17/04/2022 12:00 am
    date: 'DD/MM/YYYY', // 17/04/2022
  },
  paramCase: {
    dateTime: 'DD-MM-YYYY HH:mm', // 17-04-2022 12:00 am
    date: 'DD-MM-YYYY', // 17-04-2022
  },
  period: "YY:MM:DD",
};

export function today(format?: string) {
  return dayjs(new Date()).format(format ?? 'YYYY-MM-DDTHH:mm:ss.SSS');
  // return now(format); // dayjs(new Date()).startOf('day').format(format);
}

// ----------------------------------------------------------------------

/** output: 17 Apr 2022 12:00 am
 */
export function fDateTime(date: DatePickerFormat, format?: string) {
  if (!date) {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).format(format ?? formatStr.dateTime) : 'Invalid time value';
}

// ----------------------------------------------------------------------

export function dateDiffInDays(
  startDate: DatePickerFormat,
  endDate: DatePickerFormat
): number | null {
  if (!startDate || !endDate) {
    return null;
  }

  const start = dayjs(startDate).toDate().getTime();
  const end = dayjs(endDate).toDate().getTime();



  const diffInMs = end - start;
  return diffInMs / (1000 * 60 * 60 * 24); // Convert milliseconds to days
}

/** output: 17 Apr 2022
 */
export function fDate(date: DatePickerFormat, format?: string) {
  if (!date) {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).format(format ?? formatStr.date) : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: 12:00 am
 */
export function fTime(date: DatePickerFormat, format?: string) {
  if (!date) {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).format(format ?? formatStr.time) : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: 1713250100
 */
export function fTimestamp(date: DatePickerFormat) {
  if (!date) {
    return null;
  }

  const isValid = dayjs(date).isValid();

  return isValid ? dayjs(date).valueOf() : 'Invalid time value';
}

// ----------------------------------------------------------------------

/** output: a few seconds, 2 years
 */
export function fToNow(date: DatePickerFormat) {
  /*   if (!date) {
      return null;
    }
  
    const isValid = dayjs(date).isValid();
  
  
    return isValid ? dayjs(date.toString().replace("Z", "")).toNow(true) : 'Invalid time value'; */

  if (!date) return null;

  const isValid = dayjs(date).isValid();
  if (!isValid) return 'เวลาผิดพลาด';


  const formattedDate = dayjs(date.toString().replace('Z', ''));
  return formattedDate.toNow(true);
}

// ----------------------------------------------------------------------

/** output: boolean
 */
export function fIsBetween(
  inputDate: DatePickerFormat,
  startDate: DatePickerFormat,
  endDate: DatePickerFormat
) {
  if (!inputDate || !startDate || !endDate) {
    return false;
  }

  const formattedInputDate = fTimestamp(inputDate);
  const formattedStartDate = fTimestamp(startDate);
  const formattedEndDate = fTimestamp(endDate);

  if (formattedInputDate && formattedStartDate && formattedEndDate) {
    return formattedInputDate >= formattedStartDate && formattedInputDate <= formattedEndDate;
  }

  return false;
}

// ----------------------------------------------------------------------

/** output: boolean
 */
export function fIsAfter(startDate: DatePickerFormat, endDate: DatePickerFormat) {
  return dayjs(startDate).isAfter(endDate);
}

// ----------------------------------------------------------------------

/** output: boolean
 */
export function fIsSame(
  startDate: DatePickerFormat,
  endDate: DatePickerFormat,
  units?: OpUnitType
) {
  if (!startDate || !endDate) {
    return false;
  }

  const isValid = dayjs(startDate).isValid() && dayjs(endDate).isValid();

  if (!isValid) {
    return 'Invalid time value';
  }

  return dayjs(startDate).isSame(endDate, units ?? 'year');
}

// ----------------------------------------------------------------------

/** output:
 * Same day: 26 Apr 2024
 * Same month: 25 - 26 Apr 2024
 * Same month: 25 - 26 Apr 2024
 * Same year: 25 Apr - 26 May 2024
 */
export function fDateRangeShortLabel(
  startDate: DatePickerFormat,
  endDate: DatePickerFormat,
  initial?: boolean
) {
  const isValid = dayjs(startDate).isValid() && dayjs(endDate).isValid();

  const isAfter = fIsAfter(startDate, endDate);

  if (!isValid || isAfter) {
    return 'Invalid time value';
  }

  let label = `${fDate(startDate)} - ${fDate(endDate)}`;

  if (initial) {
    return label;
  }

  const isSameYear = fIsSame(startDate, endDate, 'year');
  const isSameMonth = fIsSame(startDate, endDate, 'month');
  const isSameDay = fIsSame(startDate, endDate, 'day');

  if (isSameYear && !isSameMonth) {
    label = `${fDate(startDate, 'DD MMM')} - ${fDate(endDate)}`;
  } else if (isSameYear && isSameMonth && !isSameDay) {
    label = `${fDate(startDate, 'DD')} - ${fDate(endDate)}`;
  } else if (isSameYear && isSameMonth && isSameDay) {
    label = `${fDate(endDate)}`;
  }

  return label;
}

// ----------------------------------------------------------------------

export type DurationProps = {
  years?: number;
  months?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
};

/** output: '2024-05-28T05:55:31+00:00'
 */
export function fAdd({
  years = 0,
  months = 0,
  days = 0,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
}: DurationProps) {
  const result = dayjs()
    .add(
      dayjs.duration({
        years,
        months,
        days,
        hours,
        minutes,
        seconds,
        milliseconds,
      })
    )
    .format('YYYY-MM-DDTHH:mm:ss.SSS');

  return result;
}

/** output: '2024-05-28T05:55:31+00:00'
 */
export function fSub({
  years = 0,
  months = 0,
  days = 0,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
}: DurationProps) {
  const result = dayjs()
    .subtract(
      dayjs.duration({
        years,
        months,
        days,
        hours,
        minutes,
        seconds,
        milliseconds,
      })
    )
    .format('YYYY-MM-DDTHH:mm:ss.SSS');

  return result;
}


export function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isDateTime(value: unknown): boolean {
  const invalidBaseDate = "1900-01-01T00:00:00";

  if (value instanceof Date) {
    return !Number.isNaN(value.getTime()) && value.toISOString() !== `${invalidBaseDate}.000Z`;
  }

  if (typeof value === "string") {
    if (!value || value.startsWith(invalidBaseDate)) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  }

  return false;
}

export function toThaiMonthYear(raw?: string) {
  if (!raw) return "";

  // รองรับทั้ง \n และช่องว่าง
  const normalized = raw.trim().replace(/\s+/g, " ");

  const d = dayjs(normalized, "DD/MM/YYYY HH:mm:ss", true);
  if (!d.isValid()) return "";

  return d.locale("th").format("MMMM YYYY"); // => "มกราคม 2026"
}
