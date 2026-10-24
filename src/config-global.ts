import packageJson from '../package.json';

// ----------------------------------------------------------------------

/** local = ต้นแบบเก็บข้อมูลใน localStorage (demo), api = เซิร์ฟเวอร์ go-account-api เป็น source of truth */
export type DataMode = 'local' | 'api';

export type ConfigValue = {
  /** `VITE_DATA_MODE` — ไม่ตั้ง = `local` (dev/test/preview) */
  dataMode: DataMode;
  /** `VITE_API_BASE_URL` — ไม่ตั้ง = `/api/v1` (same-origin ผ่าน vite proxy ตอน dev / reverse proxy ตอน deploy) */
  apiBaseUrl: string;
  site: {
    name: string;
    basePath: string;
    serverUrl: string;
    version: string;
  };
};

// ----------------------------------------------------------------------

/**
 * จุดเดียวที่อ่าน `import.meta.env` — component อื่นให้อ่านผ่าน `CONFIG` เท่านั้น
 * `site.basePath` ถูกใช้โดย theme (mixins), settings drawer, logo, image, empty-content
 * สำหรับประกอบ URL ของไฟล์ใน `public/`
 */
export const CONFIG: ConfigValue = {
  dataMode: import.meta.env.VITE_DATA_MODE === 'api' ? 'api' : 'local',
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, ''),
  site: {
    name: 'GO Account',
    basePath: import.meta.env.VITE_BASE_PATH ?? '',
    serverUrl: import.meta.env.VITE_SERVER_URL ?? '',
    version: packageJson.version,
  },
};
