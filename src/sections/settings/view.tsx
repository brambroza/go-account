import type { AccountingData } from 'src/domain';
import type { CompanySchemaType } from 'src/schemas/accounting/doc-schemas';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';

import { useBoolean } from 'src/hooks/use-boolean';

import { downloadText } from 'src/utils/download';

import { useAccounting, updateCompany } from 'src/store';
import { normalizeTaxId, normalizeBranch5 } from 'src/domain';
import { CompanySchema } from 'src/schemas/accounting/doc-schemas';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// ----------------------------------------------------------------------

export function SettingsView() {
  const { data, run, replace, resetDemo } = useAccounting();
  const confirmReset = useBoolean();
  const c = data.company;

  const methods = useForm<CompanySchemaType>({
    resolver: zodResolver(CompanySchema),
    defaultValues: {
      name: c.name,
      taxId: c.taxId,
      branchNo: c.branchNo,
      vatRegistered: c.vatRegistered,
      rdUserId: c.rdUserId ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      address: {
        addressNo: c.address.addressNo ?? '',
        moo: c.address.moo ?? '',
        village: c.address.village ?? '',
        soi: c.address.soi ?? '',
        street: c.address.street ?? '',
        subDistrict: c.address.subDistrict ?? '',
        district: c.address.district ?? '',
        province: c.address.province ?? '',
        postalCode: c.address.postalCode ?? '',
      },
    },
  });

  const onSubmit = methods.handleSubmit((v) => {
    const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    run((s) => ({
      state: updateCompany(s, {
        name: v.name.trim(),
        taxId: normalizeTaxId(v.taxId),
        branchNo: normalizeBranch5(v.branchNo),
        vatRegistered: v.vatRegistered,
        rdUserId: clean(v.rdUserId),
        email: clean(v.email),
        phone: clean(v.phone),
        address: Object.fromEntries(Object.entries(v.address).map(([k, val]) => [k, clean(val)])),
      }),
    }));
    toast.success('บันทึกข้อมูลบริษัทแล้ว');
  });

  const exportBackup = () => {
    downloadText(`go-account-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as AccountingData;
      if (parsed?.version !== 1 || !Array.isArray(parsed.journal)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
      replace(parsed);
      toast.success('กู้คืนข้อมูลแล้ว');
    } catch (error) {
      toast.error(`กู้คืนไม่สำเร็จ: ${error instanceof Error ? error.message : ''} — ใช้ไฟล์ .json ที่ส่งออกจากหน้านี้เท่านั้น`);
    }
  };

  const grid = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } };

  return (
    <>
      <CustomBreadcrumbs
        heading="ตั้งค่าบริษัท"
        links={[{ name: 'หน้าแรก', href: paths.dashboard }, { name: 'ตั้งค่าบริษัท' }]}
        sx={{ mb: { xs: 3, md: 4 } }}
      />

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Form methods={methods} onSubmit={onSubmit}>
            <Card>
              <CardHeader title="ข้อมูลบริษัท" subheader="พิมพ์บนใบกำกับภาษี และใช้ใน header ของไฟล์ ภ.ง.ด. / e-Tax" />
              <Box sx={{ p: 3 }}>
                <Box sx={grid}>
                  <Field.Text name="name" label="ชื่อบริษัท" size="small" sx={{ gridColumn: { sm: 'span 3' } }} />
                  <Field.Text name="taxId" label="เลขประจำตัวผู้เสียภาษี 13 หลัก" size="small" />
                  <Field.Text name="branchNo" label="สาขา (00000 = สำนักงานใหญ่)" size="small" />
                  <Field.Switch name="vatRegistered" label="จดทะเบียนภาษีมูลค่าเพิ่ม" />
                  <Field.Text name="rdUserId" label="รหัสผู้ใช้ e-Filing" size="small" helperText="ใส่ในไฟล์ ภ.ง.ด. (USER_ID)" />
                  <Field.Text name="email" label="อีเมลฝ่ายบัญชี" size="small" />
                  <Field.Text name="phone" label="โทรศัพท์" size="small" />
                </Box>
                <Typography variant="subtitle2" sx={{ mt: 3, mb: 1.5 }}>
                  ที่อยู่ตามทะเบียน
                </Typography>
                <Box sx={grid}>
                  <Field.Text name="address.addressNo" label="เลขที่" size="small" />
                  <Field.Text name="address.moo" label="หมู่" size="small" />
                  <Field.Text name="address.village" label="อาคาร / หมู่บ้าน" size="small" />
                  <Field.Text name="address.soi" label="ซอย" size="small" />
                  <Field.Text name="address.street" label="ถนน" size="small" />
                  <Field.Text name="address.subDistrict" label="ตำบล / แขวง" size="small" />
                  <Field.Text name="address.district" label="อำเภอ / เขต" size="small" />
                  <Field.Text name="address.province" label="จังหวัด" size="small" />
                  <Field.Text name="address.postalCode" label="รหัสไปรษณีย์" size="small" />
                </Box>
                <Stack alignItems="flex-end" sx={{ mt: 3 }}>
                  <LoadingButton type="submit" variant="contained">
                    บันทึก
                  </LoadingButton>
                </Stack>
              </Box>
            </Card>
          </Form>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Card>
            <CardHeader title="ข้อมูลในเครื่องนี้" subheader="ต้นแบบนี้เก็บข้อมูลในเบราว์เซอร์ ยังไม่มีเซิร์ฟเวอร์" />
            <Stack spacing={1.5} sx={{ p: 3 }}>
              <Button variant="outlined" startIcon={<Iconify icon="solar:download-bold" />} onClick={exportBackup}>
                สำรองข้อมูล (.json)
              </Button>
              <Button variant="outlined" component="label" startIcon={<Iconify icon="solar:upload-bold" />}>
                กู้คืนจากไฟล์สำรอง
                <input hidden type="file" accept="application/json,.json" onChange={(e) => importBackup(e.target.files?.[0])} />
              </Button>
              <Button color="error" onClick={confirmReset.onTrue}>
                ล้างข้อมูลและสร้างข้อมูลตัวอย่างใหม่
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={confirmReset.value}
        onClose={confirmReset.onFalse}
        title="ล้างข้อมูลทั้งหมด"
        content="เอกสาร รายการบัญชี และผู้ติดต่อทั้งหมดในเบราว์เซอร์นี้จะถูกลบแล้วแทนด้วยข้อมูลตัวอย่าง ย้อนกลับไม่ได้ — สำรองข้อมูลก่อนถ้ายังต้องใช้"
        action={
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              resetDemo();
              confirmReset.onFalse();
              toast.success('สร้างข้อมูลตัวอย่างใหม่แล้ว');
            }}
          >
            ล้างข้อมูล
          </Button>
        }
      />
    </>
  );
}
