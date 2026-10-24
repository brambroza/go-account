import path from 'path';
import checker from 'vite-plugin-checker';
import { loadEnv, defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// ----------------------------------------------------------------------

// 8081 เพื่อรันคู่กับ go-crm-24v4 (8080) ตอนเทียบ theme
const PORT = 8081;

const env = loadEnv('all', process.cwd());

/**
 * แยก vendor เป็นก้อนตามกลุ่ม (B12) — cache ได้นานเพราะเปลี่ยนน้อยกว่าโค้ดแอป และ bundle หลักเล็กลง
 * ลำดับมีผล: เช็ค path ที่เฉพาะกว่าก่อน (x-date-pickers ก่อน @mui)
 */
const VENDOR_CHUNKS: [string, RegExp][] = [
  ['vendor-pickers', /node_modules\/(@mui\/x-date-pickers|dayjs)\//],
  ['vendor-mui', /node_modules\/(@mui|@emotion|@popperjs|stylis|stylis-plugin-rtl|react-transition-group|clsx|mui-one-time-password-input)\//],
  ['vendor-forms', /node_modules\/(react-hook-form|@hookform|zod|react-number-format)\//],
  ['vendor-i18n', /node_modules\/(i18next|react-i18next|i18next-[^/]+)\//],
  ['vendor-motion', /node_modules\/framer-motion\//],
  ['vendor-icons', /node_modules\/@iconify\//],
  // พื้นฐานที่ทุกก้อนใช้ร่วม (react + helper) — รวมไว้ก้อนเดียวกันเพื่อไม่ให้เกิดการอ้างกันเป็นวงระหว่างก้อน
  [
    'vendor-react',
    /node_modules\/(react|react-dom|scheduler|react-is|prop-types|object-assign|@babel\/runtime|hoist-non-react-statics|use-sync-external-store|react-router|react-router-dom|@remix-run|react-helmet-async|react-fast-compare|invariant|shallowequal)\//,
  ],
];

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  const hit = VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id.replace(/\\/g, '/')));
  return hit ? hit[0] : 'vendor';
}

export default defineConfig(({ mode }) =>({
  // base: env.VITE_BASE_PATH,


  plugins: [
    react(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint "./src/**/*.{js,jsx,ts,tsx}"',
      },
      overlay: {
        position: 'tl',
        initialIsOpen: false,
      },
    }),
  ],
  esbuild: mode === 'production'
    ? { drop: ['console', 'debugger'] }
    : undefined,
  resolve: {
    alias: [
      {
        find: /^~(.+)/,
        replacement: path.join(process.cwd(), 'node_modules/$1'),
      },
      {
        find: /^src(.+)/,
        replacement: path.join(process.cwd(), 'src/$1'),
      },
    ],
  },
  // VITE_DATA_MODE=api: หน้าเว็บเรียก /api/v1 แบบ same-origin แล้ว proxy ส่งต่อไป go-account-api
  // cookie ของ API (`__Host-` / `__Secure-`, Secure, SameSite=Strict) จึงผูกกับ http://localhost:8081 — Chrome/Firefox ถือว่า localhost
  // เป็น secure context รับ Secure cookie ได้โดยไม่ต้องใช้ https (Safari ไม่รับ → ใช้ Chrome/Firefox ตอน dev) ดู README "โหมด API"
  // changeOrigin: false = ส่ง Origin/Host เดิม (http://localhost:8081) ซึ่งอยู่ใน allowlist ของ API (CORS + กัน CSRF)
  server: {
    port: PORT,
    host: true,
    proxy: { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:5070', changeOrigin: false } },
  },
  preview: { port: PORT, host: true },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        manualChunks,
      },
    },
  },

}));
