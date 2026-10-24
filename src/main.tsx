import ReactDOM from 'react-dom/client';
import { Suspense, StrictMode } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, BrowserRouter } from 'react-router-dom';

import App from './app';
import { CONFIG } from './config-global';

// ----------------------------------------------------------------------

/**
 * VITE_ROUTER=memory ใช้ตอน build เป็นหน้า preview แบบไฟล์เดียว (URL ภายนอกเปลี่ยนไม่ได้)
 * ปกติใช้ BrowserRouter
 */
const Router = import.meta.env.VITE_ROUTER === 'memory' ? MemoryRouter : BrowserRouter;

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <StrictMode>
    <HelmetProvider>
      <Router basename={CONFIG.site.basePath}>
        <Suspense>
          <App />
        </Suspense>
      </Router>
    </HelmetProvider>
  </StrictMode>
);
