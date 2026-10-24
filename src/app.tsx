import 'src/global.css';

// ----------------------------------------------------------------------

import { Router } from 'src/routes/sections';

import { useScrollToTop } from 'src/hooks/use-scroll-to-top';

import { AccountingProvider } from 'src/store';
import { LocalizationProvider } from 'src/locales';
import { I18nProvider } from 'src/locales/i18n-provider';
import { ThemeProvider } from 'src/theme/theme-provider';

import { Snackbar } from 'src/components/snackbar';
import { ProgressBar } from 'src/components/progress-bar';
import { MotionLazy } from 'src/components/animate/motion-lazy';
import { SettingsDrawer, defaultSettings, SettingsProvider } from 'src/components/settings';

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
              <SettingsDrawer hideNavLayout hideNavColor hideCompact />
              <AccountingProvider>
                <Router />
              </AccountingProvider>
            </MotionLazy>
          </ThemeProvider>
        </SettingsProvider>
      </LocalizationProvider>
    </I18nProvider>
  );
}
