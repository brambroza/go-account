// ----------------------------------------------------------------------

export type LanguageValue = 'en' | 'th';

export const fallbackLng = 'th';
export const languages = ['th', 'en'];
export const defaultNS = 'common';
export const cookieName = 'i18next';

// ----------------------------------------------------------------------

export function i18nOptions(lng = fallbackLng, ns = defaultNS) {
  return {
    // debug: true,
    lng,
    fallbackLng,
    ns,
    defaultNS,
    fallbackNS: defaultNS,
    supportedLngs: languages,
  };
}

// ----------------------------------------------------------------------

export const changeLangMessages: Record<
  LanguageValue,
  { success: string; error: string; loading: string }
> = {
  en: {
    success: 'Language has been changed!',
    error: 'Error changing language!',
    loading: 'Loading...',
  },
  th: {
    success: 'เปลี่ยนเป็นภาษาไทยแล้ว!',
    error: 'Error changing language!',
    loading: 'กำลังโหลด...',
  },
};
