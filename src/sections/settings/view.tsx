import type { LoadResult } from 'src/store';
import type { CompanySchemaType } from 'src/schemas/accounting/doc-schemas';

import { useState } from 'react';
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
import { RouterLink } from 'src/routes/components';

import { useBoolean } from 'src/hooks/use-boolean';

import { cmd, useAccounting } from 'src/store';
import { CanWrite, usePermissions } from 'src/auth';
import { normalizeTaxId, normalizeBranch5 } from 'src/domain';
import { CompanySchema } from 'src/schemas/accounting/doc-schemas';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Form, Field } from 'src/components/hook-form';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { preventEnterSubmit } from 'src/sections/shared';

import { downloadBackup } from './backup';
import { RestoreDialog } from './restore-dialog';
import { ResetDemoDialog } from './reset-demo-dialog';

// ----------------------------------------------------------------------

/** ตั้งค่าบริษัท + สำรอง/กู้คืนข้อมูล (ตรวจไฟล์ก่อนเสมอ) + ล้างเป็นข้อมูลตัวอย่าง (ต้องยืนยัน + สำรองอัตโนมัติ) */
export function SettingsView() {
  const { data, run, busy, readBackup, canUseLocalTools } = useAccounting();
  const { isOwner } = usePermissions();
  const confirmReset = useBoolean();
  const confirmEmpty = useBoolean();
  const [restoreFile, setRestoreFile] = useState<{ name: string; result: LoadResult } | null>(null);
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

  const onSubmit = methods.handleSubmit(async (v) => {
    const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    try {
      await run(
        cmd.updateCompany({
          name: v.name.trim(),
          taxId: normalizeTaxId(v.taxId),
          branchNo: normalizeBranch5(v.branchNo),
          vatRegistered: v.vatRegistered,
          rdUserId: clean(v.rdUserId),
          email: clean(v.email),
          phone: clean(v.phone),
          address: Object.fromEntries(Object.entries(v.address).map(([k, val]) => [k, clean(val)])),
        })
      );
      toast.success('บันทึกข้อมูลบริษัทแล้ว');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  const importBackup = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // ล้างค่าเพื่อให้เลือกไฟล์เดิมซ้ำได้
    input.value = '';
    if (!file) return;
    try {
      setRestoreFile({ name: file.name, result: readBackup(await file.text()) });
    } catch (error) {
      toast.error(`อ่านไฟล์ไม่ได้: ${error instanceof Error ? error.message : ''}`);
    }
  };

  const grid = {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
  };

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
            <Card onKeyDown={preventEnterSubmit}>
              <CardHeader
                title="ข้อมูลบริษัท"
                subheader="พิมพ์บนใบกำกับภาษี และใช้ใน header ของไฟล์ ภ.ง.ด. / e-Tax"
              />
              <Box sx={{ p: 3 }}>
                <Box sx={grid}>
                  <Field.Text
                    name="name"
                    label="ชื่อบริษัท"
                    size="small"
                    sx={{ gridColumn: { sm: 'span 3' } }}
                  />
                  <Field.Text name="taxId" label="เลขประจำตัวผู้เสียภาษี 13 หลัก" size="small" />
                  <Field.Text name="branchNo" label="สาขา (00000 = สำนักงานใหญ่)" size="small" />
                  <Field.Switch name="vatRegistered" label="จดทะเบียนภาษีมูลค่าเพิ่ม" />
                  <Field.Text
                    name="rdUserId"
                    label="รหัสผู้ใช้ e-Filing"
                    size="small"
                    helperText="ใส่ในไฟล์ ภ.ง.ด. (USER_ID)"
                  />
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
                {isOwner ? (
                  <Stack alignItems="flex-end" sx={{ mt: 3 }}>
                    <LoadingButton type="submit" variant="contained" loading={busy}>
                      บันทึก
                    </LoadingButton>
                  </Stack>
                ) : (
                  <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
                    แก้ข้อมูลบริษัทได้เฉพาะเจ้าของบริษัท
                  </Typography>
                )}
              </Box>
            </Card>
          </Form>
        </Grid>

        <Grid item xs={12} lg={4}>
          {canUseLocalTools && (
            <Card>
              <CardHeader title="ข้อมูลในเครื่องนี้" subheader="ต้นแบบนี้เก็บข้อมูลในเบราว์เซอร์ ยังไม่มีเซิร์ฟเวอร์" />
              <Stack spacing={1.5} sx={{ p: 3 }}>
                <Button variant="outlined" startIcon={<Iconify icon="solar:download-bold" />} onClick={() => downloadBackup(data)}>
                  สำรองข้อมูล (.json)
                </Button>
                <Button variant="outlined" component="label" startIcon={<Iconify icon="solar:upload-bold" />}>
                  กู้คืนจากไฟล์สำรอง
                  <input hidden type="file" accept="application/json,.json" onChange={(e) => importBackup(e.currentTarget)} />
                </Button>
                <Button color="error" onClick={confirmReset.onTrue}>
                  ล้างข้อมูลและสร้างข้อมูลตัวอย่างใหม่
                </Button>
              </Stack>
            </Card>
          )}

          <CanWrite>
            <Card sx={{ mt: canUseLocalTools ? 3 : 0 }}>
              <CardHeader title="ย้ายจากระบบเดิม (Express)" subheader="ยอดยกมา: บัญชีแยกประเภท ลูกหนี้/เจ้าหนี้คงค้างรายใบ ภาษีชำระเกิน" />
              <Stack spacing={1.5} sx={{ p: 3 }}>
                <Button variant="outlined" component={RouterLink} href={paths.opening} startIcon={<Iconify icon="solar:import-bold" />}>
                  {data.openingBalance ? 'ดู / แก้ยอดยกมา' : 'บันทึกยอดยกมา'}
                </Button>
                {canUseLocalTools && (
                  <Button color="error" onClick={confirmEmpty.onTrue}>
                    ล้างเอกสารทั้งหมดเพื่อเริ่มยกยอด
                  </Button>
                )}
              </Stack>
            </Card>
          </CanWrite>
          {isOwner && !canUseLocalTools && (
            <Card sx={{ mt: 3 }}>
              <CardHeader title="ผู้ใช้งานของบริษัท" subheader="เชิญพนักงานบัญชี / ผู้ดูอย่างเดียว เปลี่ยนบทบาท หรือนำออก" />
              <Stack spacing={1.5} sx={{ p: 3 }}>
                <Button variant="outlined" component={RouterLink} href={paths.members} startIcon={<Iconify icon="solar:users-group-rounded-bold" />}>
                  จัดการผู้ใช้งาน
                </Button>
              </Stack>
            </Card>
          )}
        </Grid>
      </Grid>

      <RestoreDialog file={restoreFile} onClose={() => setRestoreFile(null)} />
      <ResetDemoDialog open={confirmReset.value} onClose={confirmReset.onFalse} />
      <ResetDemoDialog open={confirmEmpty.value} onClose={confirmEmpty.onFalse} mode="empty" />
    </>
  );
}
