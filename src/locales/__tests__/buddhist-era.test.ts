import dayjs from 'dayjs';

import { AdapterDayjsBuddhist } from '../adapter-buddhist-dayjs';
import { PICKER_DATE_FORMAT, buddhistToGregorianInput } from '../buddhist-era';

// ----------------------------------------------------------------------

describe('Buddhist-era date picker (B10)', () => {
  it('converts typed BE text to CE before parsing', () => {
    expect(buddhistToGregorianInput('24/10/2569', 'DD/MM/BBBB')).toEqual({ value: '24/10/2026', format: 'DD/MM/YYYY' });
    expect(buddhistToGregorianInput('24 10 2569', 'DD MM BBBB')).toEqual({ value: '24 10 2026', format: 'DD MM YYYY' });
    expect(buddhistToGregorianInput('1/9/2569', 'D/M/BBBB')).toEqual({ value: '1/9/2026', format: 'D/M/YYYY' });
    expect(buddhistToGregorianInput('24/10/2026', 'DD/MM/YYYY')).toBeNull();
    expect(buddhistToGregorianInput('24/10/25', 'DD/MM/BBBB')).toEqual({ value: '24/10/25', format: 'DD/MM/YYYY' });
    expect(buddhistToGregorianInput('24/10/0002', 'DD/MM/BBBB')?.value).toBe('24/10/xxxx');
    expect(buddhistToGregorianInput('24/10/ab', 'DD/MM/BBBB')?.value).toBe('24/10/ab');
  });

  it('adapter shows BE and parses BE input into CE dates (leap years included)', () => {
    const adapter = new AdapterDayjsBuddhist({ locale: 'th' });
    const date = dayjs('2026-10-24');
    expect(adapter.formatByString(date, PICKER_DATE_FORMAT)).toBe('24/10/2569');
    expect(adapter.parse('24/10/2569', PICKER_DATE_FORMAT)?.format('YYYY-MM-DD')).toBe('2026-10-24');
    // 29 ก.พ. 2567 = 2024 (ปีอธิกสุรทิน) — ถ้า parse ปี 2567 เป็น ค.ศ. ตรง ๆ จะไม่มีวันที่ 29
    expect(adapter.parse('29/02/2567', PICKER_DATE_FORMAT)?.format('YYYY-MM-DD')).toBe('2024-02-29');
    expect(adapter.parse('29/02/2568', PICKER_DATE_FORMAT)?.isValid()).toBe(false);
    expect(adapter.parse('', PICKER_DATE_FORMAT)).toBeNull();
    expect(adapter.parse('24/10/2026', 'DD/MM/YYYY')?.format('YYYY-MM-DD')).toBe('2026-10-24');
    expect(adapter.formatTokenMap.BBBB).toEqual({ sectionType: 'year', contentType: 'digit', maxLength: 4 });
  });
});
