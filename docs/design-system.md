# Design System — go-crm-24v4

> **หมายเหตุสำหรับ goalong-mui-starter:** เอกสารนี้ copy มาจาก repo `go-crm-24v4` ทั้งฉบับ
> หัวข้อ 1-3 และ 6 (token, กฎการใช้, component catalog, ภาคผนวก) ใช้กับ starter ได้ตรง ๆ
> หัวข้อ 4-5 (pattern หน้า list/detail, convention ของ ERP) อ้างถึง module ที่มีเฉพาะใน CRM
> (`sections/*`, `hooks/store/*`, `nav-section`, `DashboardLayout`) — ใช้เป็นแนวทางเท่านั้น
> component ที่ starter ไม่ได้นำมา: `upload`, `editor`, `chart`, `markdown`, `carousel`, `map`, `lightbox`, `nav-section`

เอกสารนี้อธิบาย **design system ที่มีอยู่จริงในโค้ดวันนี้** ไม่ใช่ข้อเสนอหรือแผนอนาคต
ทุกค่าที่เขียนไว้อ้างอิงจากไฟล์ต้นทางพร้อม path ตรวจย้อนได้

- Base: Minimal UI v6 (MUI v5) + โมดูล ERP ที่เขียนเพิ่มเอง
- Stack: React 18 + TypeScript + Vite 5 · MUI v5 / MUI X v7 · react-router v6 — **ไม่ใช่ Next.js**
- ผู้ใช้ระบบ: พนักงานออฟฟิศที่ทำงานซ้ำ ๆ วันละหลายสิบรายการ ไม่ใช่ผู้ใช้ทั่วไป
  ความเร็วและความหนาแน่นของข้อมูลสำคัญกว่าความสวย

**ขอบเขต:** เอกสารนี้คุมฝั่ง UI (token / component / โครงหน้า)
สำหรับ pattern ฝั่ง data, route, auth, business rule ให้ดู [`../CLAUDE.md`](../CLAUDE.md)

**วิธีใช้:** อ่านหัวข้อ 1-2 ก่อนเขียน UI ครั้งแรก จากนั้นใช้หัวข้อ 4 เป็น template
copy ไปแก้ชื่อได้ทันที และใช้หัวข้อ 3 เป็นรายการเช็คว่ามี component ให้ใช้ซ้ำหรือยังก่อนสร้างใหม่

---

## 1. Foundation — design token

### 1.1 Palette

ต้นทางสีทั้งหมดคือ `src/theme/core/colors.json` ทุกค่าจะถูกส่งผ่าน `createPaletteChannel()`
ซึ่งเติมคีย์ `<key>Channel` (RGB triplet) ให้อัตโนมัติ เช่น `mainChannel: "115 192 136"`

| กลุ่ม | lighter | light | main | dark | darker | contrastText |
|---|---|---|---|---|---|---|
| primary | `#C8FAD6` | `#5BE49B` | **`#73c088`** | `#007867` | `#004B50` | `#FFFFFF` |
| secondary | `#EFD6FF` | `#C684FF` | `#8E33FF` | `#5119B7` | `#27097A` | `#FFFFFF` |
| info | `#CAFDF5` | `#61F3F3` | `#00B8D9` | `#006C9C` | `#003768` | `#FFFFFF` |
| success | `#D3FCD2` | `#77ED8B` | `#22C55E` | `#118D57` | `#065E49` | `#ffffff` |
| warning | `#FFF5CC` | `#FFD666` | `#FFAB00` | `#B76E00` | `#7A4100` | `#1C252E` |
| error | `#FFE9D5` | `#FFAC82` | `#FF5630` | `#B71D18` | `#7A0916` | `#FFFFFF` |

> `primary.main` = `#73c088` เป็นสีที่ project แก้เอง (stock Minimal UI คือ `#00A76F`)
> ส่วน lighter/light/dark/darker ยังเป็นค่า stock — ถ้าต้องทำ shade ของ primary ใหม่ อย่าคำนวณจาก main เอง

**Grey** (`colors.json:50-61`) — `50` และ `900` ต่างจาก stock

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|
| `#FCFDFD` | `#F9FAFB` | `#F4F6F8` | `#DFE3E8` | `#C4CDD5` | `#919EAB` | `#637381` | `#454F5B` | `#1C252E` | `#141A21` |

**Common:** `black #000000` · `white #FFFFFF`

**Text / Background / Action** (`src/theme/core/palette.ts:88-127`) — ต่างกันระหว่างสองโหมด

| token | light | dark |
|---|---|---|
| `text.primary` | `grey[800]` `#1C252E` | `#FFFFFF` |
| `text.secondary` | `grey[600]` `#637381` | `grey[500]` `#919EAB` |
| `text.disabled` | `grey[500]` `#919EAB` | `grey[600]` `#637381` |
| `background.paper` | `#FFFFFF` | `grey[800]` `#1C252E` |
| `background.default` | `#FFFFFF` | `grey[900]` `#141A21` |
| `background.neutral` | `grey[200]` `#F4F6F8` | `#28323D` |
| `action.active` | `grey[600]` | `grey[500]` |

`action` ที่เหลือสร้างจาก `grey.500Channel` เหมือนกันทั้งสองโหมด:
`hover /0.08` · `selected /0.16` · `focus /0.24` · `disabled /0.8` · `disabledBackground /0.24`
· `hoverOpacity 0.08` · `disabledOpacity 0.48` · `divider = grey.500Channel /0.2`

### 1.2 Channel + `varAlpha` — กฎสำคัญ

theme รันในโหมด CSS variables ค่าสีที่ออกมาจึงเป็น `var(--palette-primary-main)` ไม่ใช่ hex
ทำให้ `alpha()` ของ MUI ใช้ไม่ได้ ต้องใช้ `varAlpha` กับคีย์ `*Channel` แทน
(`src/theme/styles/utils.ts:79-101` — `varAlpha` จะ **throw** ถ้าได้รับ hex หรือ `rgb()`)

```tsx
import { varAlpha } from 'src/theme/styles';

// ถูก
sx={{ bgcolor: (theme) => varAlpha(theme.vars.palette.grey['500Channel'], 0.08) }}
sx={{ color: 'primary.main', bgcolor: 'background.neutral' }}

// ผิด
sx={{ bgcolor: alpha('#919EAB', 0.08) }}
sx={{ bgcolor: '#F4F6F8' }}
```

### 1.3 Typography

`src/theme/core/typography.ts` — ฟอนต์เป็น **Kanit** ทั้ง `primaryFont` และ `secondaryFont`
(โหลดใน `src/global.css` น้ำหนัก 400-800)

น้ำหนักที่ประกาศไว้ — สังเกตว่า `bold` ต่ำกว่ามาตรฐาน:
`light 300` · `regular 400` · `medium 500` · `semiBold 600` · **`bold 550`**

| variant | fontSize | lineHeight | weight | responsive sm / md / lg |
|---|---|---|---|---|
| h1 | 2.5rem (40) | 1.25 | 800 | 52 / 58 / 64 px |
| h2 | 2rem (32) | 1.333 | 800 | 40 / 44 / 48 px |
| h3 | 1.5rem (24) | 1.5 | 550 | 26 / 30 / 32 px |
| h4 | 1.25rem (20) | 1.5 | 550 | 20 / 24 / 24 px |
| h5 | 1.125rem (18) | 1.5 | 500 | 19 / 20 / 20 px |
| h6 | 1.0625rem (17) | 1.556 | 400 | 18 / 18 / 18 px |
| subtitle1 | 1rem (16) | 1.5 | 600 | — |
| subtitle2 | 0.875rem (14) | 1.571 | 500 | — |
| body1 | 1rem (16) | 1.5 | — | — |
| body2 | 0.875rem (14) | 1.571 | — | — |
| caption | 0.75rem (12) | 1.5 | — | — |
| overline | 0.75rem (12) | 1.5 | 500 | `uppercase` |
| button | 0.875rem (14) | 1.714 | 500 | `textTransform: unset` |

กฎภาษาไทย: ข้อความไทยต้องอ่านออกที่ **≥14px** → อย่างต่ำใช้ `body2` / `subtitle2`
`caption` (12px) ใช้ได้เฉพาะ metadata ที่ไม่ใช่เนื้อหาหลัก เช่น timestamp

helper: `pxToRem(px)`, `remToPx(rem)`, `responsiveFontSizes({ sm, md, lg })` — `src/theme/styles/utils.ts`

### 1.4 Spacing / shape / breakpoints

- **Spacing base = 8px** (MUI default ไม่ override) → `theme.spacing(3)` = 24px, `sx={{ p: 2.5 }}` = 20px
- **`borderRadius: 8`** (`src/theme/create-theme.ts:24`) ตัวคูณที่ใช้จริงใน override:

  | ตัวคูณ | ค่า | ใช้ที่ |
  |---|---|---|
  | ×2 | 16px | Card, Dialog, Skeleton rounded |
  | ×1.5 | 12px | Avatar rounded, Pickers popper |
  | ×1.25 | 10px | Chip medium, dropdown paper |
  | ×1 | 8px | ค่าเริ่มต้นทั่วไป |
  | ×0.75 | 6px | MenuItem |

- **Breakpoints** = MUI default (ไม่มีการ override ใน `src/theme`)
  `xs 0` · `sm 600` · `md 900` · `lg 1200` · `xl 1536`
  layout ของ dashboard ใช้ `layoutQuery = 'lg'` เป็นจุดสลับ desktop/mobile

### 1.5 Shadows

`theme.shadows` เป็น array 25 ระดับตามมาตรฐาน MUI แต่ที่ใช้จริงในโค้ดคือ `theme.customShadows`
(`src/theme/core/custom-shadows.ts:47-70`) — สร้างจาก `grey.500Channel` (light) / `common.blackChannel` (dark)

| key | ค่า |
|---|---|
| `z1` | `0 1px 2px 0 rgba(c / 0.16)` |
| `z4` | `0 4px 8px 0 rgba(c / 0.16)` |
| `z8` | `0 8px 16px 0 rgba(c / 0.16)` |
| `z12` | `0 12px 24px -4px rgba(c / 0.16)` |
| `z16` | `0 16px 32px -4px rgba(c / 0.16)` |
| `z20` | `0 20px 40px -4px rgba(c / 0.16)` |
| `z24` | `0 24px 48px 0 rgba(c / 0.16)` |
| `card` | `0 0 2px 0 rgba(c / 0.2), 0 12px 24px -4px rgba(c / 0.12)` |
| `dialog` | `-40px 40px 80px -8px rgba(black / 0.24)` |
| `dropdown` | `0 0 2px 0 rgba(c / 0.24), -20px 20px 40px -4px rgba(c / 0.24)` |
| `primary`…`error` | `0 8px 16px 0 rgba(<color>.mainChannel / 0.24)` |

```tsx
sx={{ boxShadow: (theme) => theme.customShadows.z8 }}
```

### 1.6 Mixins

`src/theme/styles/mixins.ts` — ใช้แทนการเขียน CSS ซ้ำ

| mixin | ทำอะไร |
|---|---|
| `bgGradient({ color, imgUrl })` | พื้นหลัง gradient (+ รูปทับได้) |
| `bgBlur({ color, blur = 6, imgUrl })` | พื้นหลังโปร่ง + backdrop blur |
| `paper({ theme, color, dropdown })` | พื้นผิว popover/dropdown ตามมาตรฐาน (blur 20 + shadow + radius) |
| `menuItem(theme)` | สไตล์ MenuItem มาตรฐาน (body2, padding 6/8, radius 6) |
| `maxLine({ line, persistent })` | ตัดข้อความหลายบรรทัดพร้อมคำนวณความสูง |
| `hideScrollX` / `hideScrollY` | ซ่อน scrollbar แต่ยัง scroll ได้ |
| `textGradient` / `borderGradient` | ตัวอักษร / ขอบแบบ gradient |

### 1.7 Dark mode

theme ใช้ `Experimental_CssVarsProvider` (`src/theme/theme-provider.tsx:24-41`)
โหมดถูกเก็บใน localStorage key `theme-mode` แยกจาก settings ตัวอื่น

การเขียนสไตล์เฉพาะโหมดมืดต้องใช้ selector helper ไม่ใช่การเช็ค `palette.mode`:

```tsx
import { stylesMode } from 'src/theme/styles';

sx={{
  color: 'grey.800',
  [stylesMode.dark]: { color: 'common.white' },   // → [data-mui-color-scheme="dark"] &
}}
```

### 1.8 Settings ที่ผู้ใช้ปรับได้ตอน runtime

`src/components/settings/config-settings.ts:9-18` — เก็บใน localStorage key `app-settings`

| setting | default | ค่าที่เป็นไปได้ |
|---|---|---|
| `colorScheme` | `light` | `light` / `dark` |
| `primaryColor` | `default` | `default` / `cyan` / `purple` / `blue` / `orange` / `red` |
| `contrast` | `default` | `default` / `hight` (สะกดแบบนี้ในโค้ด) |
| `navLayout` | `vertical` | `vertical` / `horizontal` / `mini` |
| `navColor` | `integrate` | `integrate` / `apparent` |
| `compactLayout` | `true` | boolean |
| `direction` | `ltr` | `ltr` / `rtl` |
| `fontFamily` | `Kanit` | Kanit / Public Sans / DM Sans / Nunito Sans / Sarabun / Tahoma Sans |

> **ห้าม assume ว่า primary คือสีเขียว** — ผู้ใช้เปลี่ยน preset ได้ตอน runtime
> (cyan `#078DEE`, purple `#7635dc`, blue `#0C68E9`, orange `#fda92d`, red `#FF3030`)
> ทุกที่ที่ต้องใช้สีหลักให้อ้าง `primary.main` เสมอ ห้ามใส่ hex

---

## 2. กฎการใช้ token (Do / Don't)

| ห้าม | ให้ใช้แทน |
|---|---|
| `color: '#73c088'` | `color: 'primary.main'` |
| `alpha('#919EAB', 0.08)` | `varAlpha(theme.vars.palette.grey['500Channel'], 0.08)` |
| `padding: '20px'` | `sx={{ p: 2.5 }}` หรือ `theme.spacing(2.5)` |
| `borderRadius: '16px'` | `borderRadius: 2` (ตัวคูณของ `shape.borderRadius`) |
| `theme.palette.mode === 'dark' ? … : …` | `[stylesMode.dark]: { … }` |
| import icon set อื่นเข้ามาปน | `<Iconify icon="solar:pen-bold" />` |
| `<TextField>` เปล่าในฟอร์ม | `<Field.Text name="…" />` ใต้ `<Form>` |
| ข้อความ hardcode ในหน้าจอ | `tt('key')` + เพิ่ม key ใน `locales/langs/th` และ `en` |
| สร้าง component ใหม่ก่อนเช็คของเดิม | ดูหัวข้อ 3 ก่อนเสมอ |

---

## 3. Component catalog — `src/components/`

ทุกโฟลเดอร์มี `index.ts` เป็น barrel → `import { X } from 'src/components/<folder>'`

### 3.1 ใช้บ่อยในหน้า ERP

| Component | Import จาก | Props สำคัญ | ใช้เมื่อ |
|---|---|---|---|
| `Label` | `label` | `color` (default/primary/secondary/info/success/warning/error), `variant` (filled/outlined/soft/inverted), `startIcon`, `endIcon` | แสดงสถานะเอกสาร — ดูหัวข้อ 5.1 |
| `Iconify` | `iconify` | `icon` (iconify string), `width` (default 20), `sx` | ไอคอนทุกจุดในระบบ |
| `Scrollbar` | `scrollbar` | `fillContent`, `naturalScroll`, `slotProps` | ห่อตารางและ area ที่ scroll แนวนอน |
| `EmptyContent` | `empty-content` | `title` (default `'No data'`), `description`, `imgUrl`, `filled`, `action` | สถานะไม่มีข้อมูล |
| `CustomBreadcrumbs` | `custom-breadcrumbs` | `heading`, `links[]`, `action`, `actionStart`, `moreLink`, `slotProps` | หัวหน้าจอทุกหน้าใน dashboard |
| `ConfirmDialog` / `ConfirmDialogXS` | `custom-dialog` | `open`, `onClose`, `title`, `content`, `action` | ยืนยันก่อน action ที่มีผลจริง |
| `CustomPopover` + `usePopover` | `custom-popover` | `open` (anchorEl), `onClose`, `slotProps.arrow` | เมนู 3 จุดท้ายแถวตาราง |
| `CustomTabs` | `custom-tabs` | `value`, `onChange`, `slotProps` | tab ในหน้า detail |
| `FiltersResult` | `filters-result` | `totalResults`, `onReset`, `children` | แถบ chip สรุป filter ที่เลือก |
| `toast` | `snackbar` | ทุก API ของ sonner (`toast.success/error/promise`) | แจ้งผลทุกกรณี — ไม่ใช้ Snackbar ของ MUI ตรง ๆ |
| `Upload` และพวก | `upload` | `value`, `multiple`, `thumbnail`, `onDelete/onRemove/onUpload`, + `DropzoneOptions` | แนบไฟล์ (จำกัด 22 MB, jpg/png/pdf/xls(x)/doc(x)) |
| `UserName` | `user-name` | `username` (login email), `fallback` (default `'-'`) | แปลง login เป็นชื่อจริง |
| `SignaturePad` | `signature-pad` | `onSign(dataUrl)`, `onCancel`, `width` 440, `height` 130 | เซ็นรับงาน |
| `LoadingScreen` / `SplashScreen` | `loading-screen` | — | fallback ของ `Suspense` ในทุก route |
| `SvgColor` | `svg-color` | `src` | ไอคอนเมนู (mask-image) |
| `SearchNotFound` | `search-not-found` | `query` | ผลค้นหาว่าง |

### 3.2 ใช้เฉพาะงาน

| Component | Import จาก | หมายเหตุ |
|---|---|---|
| `Chart` + `useChart` | `chart` | ApexCharts wrapper |
| `Editor` | `editor` | TipTap rich text |
| `Image` | `image` | lazy-load + `ratio` + `overlay` |
| `FileThumbnail` | `file-thumbnail` | ไอคอน/preview ตามนามสกุลไฟล์ |
| `Lightbox` + `useLightBox` | `lightbox` | ดูรูปเต็มจอ |
| `Map`, `MapMarker` | `map` | mapbox-gl |
| `CustomDateRangePicker` | `custom-date-range-picker` | `variant='calendar' \| 'input'` |
| `PhoneInput` / `AnydeskInput` | `phone-input` | — |
| `CountrySelect` | `country-select` | — |
| `ColorPicker` / `ColorPreview` | `color-utils` | — |
| `Carousel` + `useCarousel` | `carousel` | embla |
| `OrganizationalChart` | `organizational-chart` | ผังองค์กร |
| `Markdown` | `markdown` | + `htmlToMarkdown`, `isMarkdownContent` |
| `Walktour` + `useWalktour` | `walktour` | tour แนะนำการใช้งาน |
| `MotionContainer`, `varFade`, … | `animate` | framer-motion variants |
| `NavSectionVertical/Mini/Horizontal` | `nav-section` | ใช้ผ่าน layout ไม่เรียกตรง |
| `SettingsProvider`, `useSettingsContext` | `settings` | — |
| `ProgressBar` | `progress-bar` | mount ที่ `app.tsx` แล้ว |

### 3.3 ของ template ที่ไม่ได้ใช้ในระบบจริง

`mega-menu/` · `nav-basic/` · `card/component-box/` (ใช้ใน `sections/_examples` เท่านั้น)
— อย่าเผลอแก้ไฟล์กลุ่มนี้แทนไฟล์จริง

### 3.4 hook ประกอบที่ใช้คู่กันเสมอ

| Hook | คืนอะไร | ใช้เมื่อ |
|---|---|---|
| `useBoolean()` | `{ value, onTrue, onFalse, onToggle, setValue }` | คุม dialog / drawer / confirm |
| `useSetState<T>(initial)` | `{ state, setState, setField, onResetState, canReset }` | container ของ filter ในหน้า list |
| `useTable(options)` | ดูหัวข้อ 4.1 | ทุกตาราง |
| `usePopover()` | `{ open, onOpen, onClose }` | เมนูท้ายแถว |
| `useTabs(default)` | `{ value, setValue, onChange }` | tab |
| `useResponsive(query, start, end)` | boolean | เช็คขนาดจอ |
| `useTranslate(ns?)` | `{ t, currentLang, onChangeLang }` | i18n — นิยมตั้งชื่อเป็น `tt` |

---

## 4. Pattern มาตรฐาน + code template

### 4.1 หน้า list (ใช้อยู่ ~25 หน้า)

ไฟล์อ้างอิงจริง: `src/sections/wms/receive/view/receive-list.tsx`,
`src/sections/organization/view/organization-list.tsx`

**ส่วน state / derived data**

```tsx
export function XxxListView() {
  const { t: tt } = useTranslate();
  const table = useTable({ defaultOrderBy: 'createDate', defaultDense: true, defaultRowsPerPage: 25 });
  const confirm = useBoolean();

  const { xxxs, xxxsLoading } = useXxxGets();               // SWR action
  const [tableData, setTableData] = useState<IXxx[]>([]);
  useEffect(() => { setTableData(xxxs); }, [xxxs]);

  const filters = useSetState<IXxxFilter>({ name: '', status: 'all', startDate: null, endDate: null });

  const dataFiltered = applyFilter({
    inputData: tableData,
    comparator: getComparator(table.order, table.orderBy),
    filters: filters.state,
    dateError,
  });

  const canReset = !!filters.state.name || filters.state.status !== 'all';
  const notFound = !dataFiltered.length;

  const TABLE_HEAD = [
    { id: 'docno', label: tt('txtdocno') },
    { id: 'createDate', label: tt('txtcreatedate'), align: 'center' },
    { id: 'status', label: tt('txtstatus') },
    { id: '' },                                              // ช่องปุ่ม action
  ];
```

**ส่วน render**

```tsx
  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading={tt('txtxxxtitle')}
        links={[{ name: 'Dashboard', href: paths.dashboard.root }, { name: tt('txtxxxtitle') }]}
        action={
          <Button variant="contained" startIcon={<Iconify icon="mingcute:add-line" />} onClick={…}>
            {tt('btnadd')}
          </Button>
        }
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      <Card>
        <XxxTableToolbar filters={filters} onResetPage={table.onResetPage} />

        {canReset && (
          <XxxTableFiltersResult
            filters={filters}
            totalResults={dataFiltered.length}
            onResetPage={table.onResetPage}
            sx={{ p: 2.5, pt: 0 }}
          />
        )}

        <Box sx={{ position: 'relative' }}>
          <TableSelectedAction
            dense={table.dense}
            numSelected={table.selected.length}
            rowCount={dataFiltered.length}
            onSelectAllRows={(checked) =>
              table.onSelectAllRows(checked, dataFiltered.map((row) => row.docNo))
            }
            action={<Stack direction="row">{/* ปุ่มลบ/ส่งออก */}</Stack>}
          />

          <Scrollbar sx={{ minHeight: 444 }}>
            <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 800 }}>
              <TableHeadCustom
                order={table.order}
                orderBy={table.orderBy}
                headLabel={TABLE_HEAD}
                rowCount={dataFiltered.length}
                numSelected={table.selected.length}
                onSort={table.onSort}
                onSelectAllRows={(checked) =>
                  table.onSelectAllRows(checked, dataFiltered.map((row) => row.docNo))
                }
              />

              <TableBody>
                {dataFiltered
                  .slice(
                    table.page * table.rowsPerPage,
                    table.page * table.rowsPerPage + table.rowsPerPage
                  )
                  .map((row) => (
                    <XxxTableRow
                      key={row.docNo}
                      row={row}
                      selected={table.selected.includes(row.docNo)}
                      onSelectRow={() => table.onSelectRow(row.docNo)}
                      onViewRow={() => router.push(paths.gocrm.xxx.view(row.docNo))}
                      onDeleteRow={() => handleDeleteRow(row.docNo)}
                    />
                  ))}

                <TableEmptyRows
                  height={table.dense ? 56 : 76}
                  emptyRows={emptyRows(table.page, table.rowsPerPage, dataFiltered.length)}
                />
                <TableNoData notFound={notFound} />
              </TableBody>
            </Table>
          </Scrollbar>
        </Box>

        <TablePaginationCustom
          page={table.page}
          dense={table.dense}
          count={dataFiltered.length}
          rowsPerPage={table.rowsPerPage}
          onPageChange={table.onChangePage}
          onChangeDense={table.onChangeDense}
          onRowsPerPageChange={table.onChangeRowsPerPage}
        />
      </Card>
    </DashboardContent>
  );
}
```

**`applyFilter` วางท้ายไฟล์เดียวกันเสมอ**

```tsx
function applyFilter({ inputData, comparator, filters, dateError }: ApplyFilterProps) {
  const { name, status, startDate, endDate } = filters;

  const stabilized = inputData.map((el, index) => [el, index] as const);
  stabilized.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    return order !== 0 ? order : a[1] - b[1];
  });
  let data = stabilized.map((el) => el[0]);

  if (name) {
    data = data.filter((row) => row.docNo.toLowerCase().includes(name.toLowerCase()));
  }
  if (status !== 'all') {
    data = data.filter((row) => row.status === status);
  }
  if (!dateError && startDate && endDate) {
    data = data.filter((row) => fIsBetween(row.createDate, startDate, endDate));
  }
  return data;
}
```

**API ของ `useTable`** (`src/components/table/use-table.ts:19`)

- options: `defaultDense`, `defaultOrder`, `defaultOrderBy` (default `'name'`), `defaultSelected`,
  `defaultRowsPerPage` (default 25), `defaultCurrentPage`
- คืน: `dense, page, rowsPerPage, order, orderBy, selected, onSort, onSelectRow, onSelectAllRows,
  onChangePage, onChangeRowsPerPage, onChangeDense, onResetPage, onUpdatePageDeleteRow,
  onUpdatePageDeleteRows` + setter ทุกตัว

**component ตารางที่มีให้** — `TableHeadCustom`, `TableNoData`, `TableEmptyRows`,
`TableSelectedAction`, `TablePaginationCustom` (ตัวเลือกแถว `[5,10,25,50,All]`), `TableSkeleton`
และ util `rowInPage`, `emptyRows`, `getComparator`

> ตาราง data-heavy ที่ต้องการ filter/sort/export ในตัว ใช้ `@mui/x-data-grid` แทนได้
> theme override สไตล์ DataGrid ไว้ครบแล้ว (`src/theme/core/components/mui-x-data-grid.tsx`)

### 4.2 ไฟล์ประกอบต่อ feature

```
src/sections/<feature>/
  view/<name>-list.tsx            หน้ารายการ (ตาม 4.1)
  <name>-rows.tsx                 1 แถวของตาราง + เมนู action
  <name>-table-toolbar.tsx        ช่องค้นหา + filter
  <name>-table-filter-result.tsx  chip สรุป filter
  <name>-new-edit-form.tsx        ฟอร์มเพิ่ม/แก้ไข (ตาม 4.3)
  <name>-analytic.tsx             การ์ดสรุปตัวเลขด้านบน (ถ้ามี)
```

### 4.3 ฟอร์ม — RHF + zod + `Field.*`

ไฟล์อ้างอิงจริง: `src/sections/organization/organization-form.tsx:66-165`

```tsx
import { z as zod } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, Field, schemaHelper } from 'src/components/hook-form';

export function XxxNewEditForm({ currentData }: Props) {
  const { t: tt } = useTranslate();

  const XxxSchema = zod.object({
    docNo: zod.string().min(1, { message: tt('txtvalidatedatacheckemtrydata') }),
    qty: zod.number().min(1, { message: tt('txtvalidateqty') }),
    dueDate: schemaHelper.date({ message: { required_error: tt('txtvalidatedate') } }),
    remark: zod.string().optional(),
  });
  type XxxSchemaType = zod.infer<typeof XxxSchema>;

  const defaultValues = useMemo(
    () => ({
      docNo: currentData?.docNo || '',
      qty: currentData?.qty ?? 0,
      dueDate: currentData?.dueDate || null,
      remark: currentData?.remark || '',
    }),
    [currentData]
  );

  const methods = useForm<XxxSchemaType>({
    mode: 'onSubmit',
    resolver: zodResolver(XxxSchema),
    defaultValues,
  });

  const { reset, handleSubmit, formState: { isSubmitting } } = methods;

  const onSubmit = handleSubmit(async (data) => {
    try {
      await api.current.setXxx({ ...data, cmpid, userlogin });
      toast.success(tt('msgsavesuccess'));
      reset();
    } catch (error) {
      toast.error(tt('msgsavefail'));
    }
  });

  return (
    <Form methods={methods} onSubmit={onSubmit}>
      <Card sx={{ p: 3 }}>
        <Box
          rowGap={3}
          columnGap={2}
          display="grid"
          gridTemplateColumns={{ xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)' }}
        >
          <Field.Text size="small" name="docNo" label={tt('txtdocno')} />
          <Field.TextNumber size="small" name="qty" label={tt('txtqty')} />
          <Field.DatePicker name="dueDate" label={tt('txtduedate')} />
          <Field.Text size="small" name="remark" label={tt('txtremark')} multiline rows={3} />
        </Box>

        <Stack alignItems="flex-end" sx={{ mt: 3 }}>
          <LoadingButton type="submit" variant="contained" loading={isSubmitting}>
            {tt('btnsave')}
          </LoadingButton>
        </Stack>
      </Card>
    </Form>
  );
}
```

**⚠️ กับดักที่เคยพลาดจริง:** field ใดไม่ประกาศใน zod schema จะโดน resolver **strip ทิ้งตอน submit**
(เคยเกิดกับ `serials` / `selected` ในโมดูล WMS) — เพิ่ม field ใหม่ต้องเพิ่มใน schema ด้วยเสมอ

**`Field.*` ที่มีให้** (map เต็มที่ `src/components/hook-form/fields.tsx:31-66`)
`Text` · `TextNumber` · `Select` · `MultiSelect` · `SelectIcon` · `Autocomplete` · `Checkbox` ·
`MultiCheckbox` · `Switch` · `MultiSwitch` · `RadioGroup` · `Slider` · `Rating` · `Code` · `Editor` ·
`DatePicker` · `MobileDateTimePicker` · `Phone` · `PhoneThai` · `CountrySelect` ·
`Upload` · `UploadBox` · `UploadAvatar` · `UploadSignature`

**`schemaHelper`** (`src/components/hook-form/schema-helper.ts:15`) — zod builder ที่เตรียมไว้:
`phoneNumber`, `date`, `editor`, `objectOrNull`, `boolean`, `nullableInput`, `file`, `files`

**ที่วาง schema:** โค้ดเก่านิยมประกาศ schema ในไฟล์ component (เพื่อให้ message ใช้ `tt()` ได้)
ของใหม่ให้แยกไว้ที่ `src/schemas/<domain>/` แล้ว export type ด้วย `zod.infer`
(ดู `src/schemas/nis/new-project-schema.ts`) — ถ้าต้อง i18n ให้ส่ง `tt` เข้าเป็น factory function

### 4.4 หน้า detail ที่มี tab

```tsx
const tabs = useTabs('info');

<CustomTabs value={tabs.value} onChange={tabs.onChange} sx={{ mb: 3 }}>
  <Tab value="info" label={tt('txtinfo')} />
  <Tab value="items" label={tt('txtitems')} />
  <Tab value="log" label={tt('txtlog')} />
</CustomTabs>

{tabs.value === 'info' && <XxxInfoTab data={data} />}
```

ถ้า tab ต้องผูกกับ URL ให้ประกาศ path เป็น function ที่รับ `tab` ใน `routes/paths.ts`
เช่น `reqcustview: (id, tab?) => ...`

### 4.5 Page file — บางที่สุด

```tsx
import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';
import { XxxListView } from 'src/sections/xxx/view';

const metadata = { title: `Xxx list | Dashboard - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <XxxListView />
    </>
  );
}
```

### 4.6 Route ใหม่ — 4 ขั้น

1. เพิ่ม path ใน `src/routes/paths.ts` (path แบบมี id เขียนเป็น function)
2. `lazy(() => import('src/pages/...'))` ในไฟล์ section ที่เกี่ยว (`routes/sections/gocrm.tsx` สำหรับโมดูล ERP)
3. สร้างไฟล์ใน `src/pages/` ตาม 4.5
4. เพิ่ม i18n key ใน `locales/langs/th` และ `en`

```tsx
const XxxListPage = lazy(() => import('src/pages/erpapp/xxx/list'));

const layoutContent = (
  <DashboardLayout>
    <Suspense fallback={<LoadingScreen />}>
      <Outlet />
    </Suspense>
  </DashboardLayout>
);

export const gocrmRoutes = [
  {
    path: 'marketing',
    element: CONFIG.auth.skip ? <>{layoutContent}</> : <AuthGuard>{layoutContent}</AuthGuard>,
    children: [
      { element: <XxxListPage />, index: true },
      { path: 'xxxlist', element: <XxxListPage /> },
      { path: 'xxxlist/:id', element: <XxxDetailPage /> },
    ],
  },
];
```

หน้า business ทุกหน้าอยู่ใต้ `AuthGuard` + `DashboardLayout` เสมอ
เมนูฝั่ง nav มาจาก DB (`useFetchMenuNavDashboard()` + `findMenuById`) ไม่ใช่ hardcode ใน
`config-nav-dashboard.tsx` — ถ้าหน้าใหม่ต้องขึ้นเมนู ต้องเพิ่มข้อมูลฝั่ง backend ด้วย

---

## 5. UI convention เฉพาะ ERP ตัวนี้

### 5.1 สถานะเอกสาร

ใช้ `<Label variant="soft">` เสมอ ห้ามใช้ Chip หรือข้อความสีเปล่า

```tsx
<Label
  variant="soft"
  color={
    (row.stateApp === '1' && 'success') ||
    (row.stateApp === '9' && 'error') ||
    'default'
  }
>
  {statusdoc.find((e) => e.value === row.stateApp)?.label}
</Label>
```

ตัวอย่างจริง: `src/sections/wms/receive/receive-rows.tsx:131-139`

**สีที่ควรใช้ให้ตรงกันทุกโมดูล** — เป็น convention ที่ตกลงกัน ไม่ใช่ค่าที่โค้ดบังคับวันนี้
จึงต้องตรวจตอน review ว่าโมดูลใหม่ใช้ตรงกัน:

| สถานะ | color |
|---|---|
| draft / ร่าง | `default` |
| รอดำเนินการ / รออนุมัติ | `warning` |
| กำลังดำเนินการ / ระหว่างทาง | `info` |
| approve / เสร็จสิ้น | `success` |
| cancel / ปฏิเสธ | `error` |

### 5.2 สามสถานะครบทุกหน้า

| สถานะ | ใช้อะไร |
|---|---|
| loading | `TableSkeleton` (ตาราง) หรือ `<Skeleton />` ของ MUI (การ์ด/ฟอร์ม) |
| empty | `<TableNoData notFound />` ในตาราง, `<EmptyContent />` นอกตาราง |
| error | `toast.error(...)` + ข้อความไทยที่ผู้ใช้แก้ต่อได้ |

ข้อความ error ต้องบอกว่าจะแก้ยังไง เช่น
`"จำนวนจ่ายออกเกินยอดคงเหลือ (คงเหลือ 12 ชิ้น)"` ไม่ใช่ `"Validation failed"`

### 5.3 Action ที่ตัดสต็อกหรือกระทบเงิน

ต้องมี `ConfirmDialog` ที่ **บอกผลลัพธ์เป็นข้อความ** ไม่ใช่แค่ "ยืนยัน?"

```tsx
<ConfirmDialog
  open={confirm.value}
  onClose={confirm.onFalse}
  title={tt('txtconfirmapprove')}
  content={`อนุมัติใบส่งของ ${docNo} จะตัดสต็อกทันที ${itemCount} รายการ และย้อนกลับไม่ได้`}
  action={
    <LoadingButton variant="contained" color="error" loading={loading} onClick={handleApprove}>
      {tt('btnconfirm')}
    </LoadingButton>
  }
/>
```

### 5.4 ความหนาแน่นของข้อมูล

- หน้ารายการตั้ง `defaultDense: true` (แถวสูง 56px แทน 76px)
- ฟอร์มใช้ `size="small"` กับทุก input
- อย่าใส่ white space แบบ landing page — หน้ารายการควรเห็นข้อมูลได้มากที่สุดโดยยังอ่านออก
- ลดจำนวนคลิกต่อรายการ ฟอร์มที่คีย์ซ้ำ ๆ ต้องไล่ด้วยคีย์บอร์ดได้

### 5.5 Responsive

Desktop-first — จอหลักคือ ≥1440 layout สลับที่ `lg` (1200)
mobile ทำเท่าที่ flow นั้นต้องใช้จริง ไม่ต้องทำครบทุกหน้า
`DashboardContent` จัดการ container/padding ให้แล้ว หน้าไม่ต้องอ่าน settings เอง

### 5.6 สิทธิ์ระดับปุ่ม

ปุ่มที่ผูกกับสิทธิ์ใช้ `PermissionLoadingButton`
(`src/sections/auth/permission/permission-loading-button`) พร้อม prop `objectname` + `mnuname`
ส่วน guard ระดับหน้าใช้ `AuthGuard` / `RoleBasedGuard`

> สิทธิ์จริงบังคับที่ backend เสมอ — UI แค่ซ่อน/ปิดปุ่ม ห้ามถือว่าเป็นการป้องกัน

### 5.7 i18n

```tsx
const { t: tt } = useTranslate();
```

key ใหม่ต้องเพิ่มทั้ง `src/locales/langs/th` และ `en` (ภาษาอื่นมี ar, cn, fr, jr, vi — เติมได้ตามสะดวก)
ข้อความบางส่วนมาจาก DB ผ่าน `locales/langsfomdb.ts`

---

## 6. ภาคผนวก

### 6.1 แผนผัง `src/theme/`

| ไฟล์ | หน้าที่ | แก้เมื่อ |
|---|---|---|
| `core/colors.json` | **ต้นทางสีทั้งหมด** | ต้องการเปลี่ยนสีระดับ brand |
| `core/palette.ts` | ประกอบ channel + text/background/action ของสองโหมด | เพิ่มกลุ่มสีใหม่ |
| `core/typography.ts` | ฟอนต์ + ทุก variant | ปรับขนาด/น้ำหนักตัวอักษร |
| `core/shadows.ts` · `core/custom-shadows.ts` | เงา | — |
| `core/components/*` | override 46 component | ปรับ default ของ component MUI |
| `create-theme.ts` | โรงงานสร้าง theme, `shape.borderRadius`, `cssVarPrefix` | ปรับ radius ฐาน / spacing |
| `styles/utils.ts` | `varAlpha`, `stylesMode`, `pxToRem`, `mediaQueries` | — |
| `styles/mixins.ts` | mixin ทั้งหมด | เพิ่ม pattern CSS ที่ใช้ซ้ำ |
| `overrides-theme.ts` | **hook ว่างสำหรับ override ระดับ project** (ปัจจุบันเป็น `{}`) | override เฉพาะ project โดยไม่แตะ core |
| `with-settings/update-theme.ts` | ยัด primaryColor preset + contrast เข้า theme | — |
| `theme-provider.tsx` | `CssVarsProvider` + `CssBaseline` + RTL | — |

การแก้ token ระดับ project ควรทำที่ `overrides-theme.ts` ก่อน เพื่อให้ merge จาก template รอบหน้าง่าย

### 6.2 Default ของ component ที่ถูก override — ต้องรู้ก่อนใช้

| Component | ต่างจาก MUI มาตรฐานยังไง |
|---|---|
| `Button` | default `color="inherit"`, `disableElevation`, มี **variant `soft`** เพิ่ม, small สูง 30px / large 48px |
| `Paper` | `elevation: 0` เป็น default และปิด backgroundImage overlay |
| `Card` | radius 16px + `customShadows.card`; `CardHeader` title = `h6`, padding 24 |
| `Stack` | `useFlexGap: true` → `spacing` กลายเป็น CSS gap |
| `Table` | cell ใช้ border แบบ **dashed**, head cell 14px semiBold บน `background.neutral` |
| `Tabs` | default `scrollable` + `textColor="inherit"`, gap 24px (40px ≥sm) |
| `TextField` | input 15px (16px ต่ำกว่า `sm` กัน iOS zoom), filled ไม่มี underline |
| `Chip` | มี variant `soft`, radius 10px (small 8px) |
| `Fab` | มี variant `outlined`, `outlinedExtended`, `soft`, `softExtended` |
| `Pagination` | มี variant `soft` และรองรับ color info/success/warning/error |
| `Avatar` | มี `colorByName()` เลือกสีจากตัวอักษรแรกของ `alt`, rounded radius 12px |
| `Badge` | มี variant `online`, `alway`, `busy`, `offline`, `invisible` |
| `Checkbox` / `Radio` | icon SVG custom, default `size="small"` |
| `Skeleton` | default `variant="rounded"` + `animation="wave"` |
| `Popover` / `Autocomplete` dropdown | ใช้ mixin `paper({ dropdown: true })` (blur + shadow) |
| `Link` | `underline="none"` + เส้นใต้แบบ animate ตอน hover |
| `AppBar` | `color="transparent"`, ไม่มีเงา (layout วาดพื้นหลังเอง) |

### 6.3 หมายเหตุที่พบระหว่างทำเอกสาร (ยังไม่ได้แก้)

- `palette.salmon` (`main #fa7f30`, `dark #ec6c19`) ประกาศไว้ใน `colors.json` และ export ที่
  `palette.ts:84` แต่ **ไม่ได้ merge เข้า `basePalette`** — ใช้อยู่ที่เดียวคือ `src/_mock/_calendar.ts:14`
  เรียกผ่าน `theme.palette.salmon` ไม่ได้
- ตัวเลือกฟอนต์ใน settings drawer มี `Sarabun` (ติดตั้ง package แล้วแต่ยังไม่ `@import` ใน `global.css`)
  และ `Tahoma Sans` ที่ไม่มีแหล่งฟอนต์ — เลือกแล้วจะตกไปที่ system font
- `src/sections/nis-onsite-form/` ใช้ `useState` ล้วน ไม่ตาม pattern RHF + zod ของ repo
  (มี spec ค้างอยู่ที่ `docs/handoff/onsite-form-redesign-design.md`)
- `src/actions/` กับ `src/hooks/store/` ทำหน้าที่ทับซ้อนกันในบางโดเมน — ของใหม่ให้ไปทาง `hooks/store/`

### 6.4 เอกสารอื่นใน repo

| ไฟล์ | เนื้อหา |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | pattern ฝั่ง data / route / auth, business rule WMS, env, deploy |
| [`nis-onsite-progress-api-contract.md`](nis-onsite-progress-api-contract.md) | API contract ของ NIS onsite progress (รอ backend) |
| [`handoff/onsite-form-redesign-design.md`](handoff/onsite-form-redesign-design.md) | spec ปรับหน้า onsite form ให้เทียบเท่าแอป React Native |
| `../.claude/agents/` · `../.claude/skills/` | agent และ skill ประจำ repo (`crm-ux-ui`, `crm-dev`, `/crm-ui-spec`, …) |
