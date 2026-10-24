import 'src/global.css';

// ----------------------------------------------------------------------

import { lazy, useState, Suspense, useEffect } from 'react';

import { Router } from 'src/routes/sections';

import { useScrollToTop } from 'src/hooks/use-scroll-to-top';

import { AuthProvider } from 'src/auth';
import { AccountingProvider } from 'src/store';
import { LocalizationProvider } from 'src/locales';
import { I18nProvider } from 'src/locales/i18n-provider';
import { ThemeProvider } from 'src/theme/theme-provider';

import { Snackbar } from 'src/components/snackbar';
import { ProgressBar } from 'src/components/progress-bar';
import { MotionLazy } from 'src/components/animate/motion-lazy';
import { defaultSettings, SettingsProvider, useSettingsContext } from 'src/components/settings';

// แผงตั้งค่าหน้าตา (สี/ฟอนต์) โหลดเมื่อเปิดครั้งแรกเท่านั้น — ไม่อยู่ใน bundle หลัก
const SettingsDrawer = lazy(() =>
  import('src/components/settings/drawer/settings-drawer').then((m) => ({ default: m.SettingsDrawer }))
);

function LazySettingsDrawer() {
  const { openDrawer } = useSettingsContext();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (openDrawer) setMounted(true);
  }, [openDrawer]);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <SettingsDrawer hideNavLayout hideNavColor hideCompact />
    </Suspense>
  );
}

// ----------------------------------------------------------------------

/**
 * ลำดับ provider ต้องคงไว้แบบนี้:
 * I18nProvider อยู่นอกสุดเพราะ ThemeProvider เรียก useTranslate (MUI locale)
 * SettingsProvider อยู่นอก ThemeProvider เพราะ theme อ่านค่า settings
 */
export default function App() {
  useScrollToTop();

  return (
    <I18nProvider>
      <LocalizationProvider>
        <SettingsProvider settings={defaultSettings}>
          <ThemeProvider>
            <MotionLazy>
              <Snackbar />
              <ProgressBar />
              <LazySettingsDrawer />
              <AuthProvider>
                <AccountingProvider>
                  <Router />
                </AccountingProvider>
              </AuthProvider>
            </MotionLazy>
          </ThemeProvider>
        </SettingsProvider>
      </LocalizationProvider>
    </I18nProvider>
  );
}
