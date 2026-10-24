import type { Contact } from 'src/domain';
import type { ContactSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useAccounting, upsertContact } from 'src/store';
import { normalizeTaxId, normalizeBranch5 } from 'src/domain';
import { ContactSchema } from 'src/schemas/accounting/doc-schemas';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';

import { RHFAmountField, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; contact?: Contact | null; nextCode: string };

function toForm(c: Contact | null | undefined, nextCode: string): ContactSchemaType {
  return {
    id: c?.id,
    code: c?.code ?? nextCode,
    kind: c?.kind ?? 'customer',
    legalForm: c?.legalForm ?? 'juristic',
    title: c?.title ?? 'บริษัท',
    name: c?.name ?? '',
    lastName: c?.lastName ?? '',
    taxId: c?.taxId ?? '',
    branchNo: c?.branchNo ?? '00000',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    creditDays: c?.creditDays ?? 30,
    address: {
      addressNo: c?.address.addressNo ?? '',
      moo: c?.address.moo ?? '',
      village: c?.address.village ?? '',
      soi: c?.address.soi ?? '',
      street: c?.address.street ?? '',
      subDistrict: c?.address.subDistrict ?? '',
      district: c?.address.district ?? '',
      province: c?.address.province ?? '',
      postalCode: c?.address.postalCode ?? '',
    },
  };
}

export function ContactDialog({ open, onClose, contact, nextCode }: Props) {
  const { run } = useAccounting();
  const methods = useForm<ContactSchemaType>({ resolver: zodResolver(ContactSchema), defaultValues: toForm(contact, nextCode) });
  const legalForm = useWatch({ control: methods.control, name: 'legalForm' });

  useEffect(() => {
    if (open) methods.reset(toForm(contact, nextCode));
  }, [open, contact, nextCode, methods]);

  const onSubmit = methods.handleSubmit((v) => {
    const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    try {
      run((s) => ({
        state: upsertContact(s, {
          id: v.id,
          code: v.code.trim(),
          kind: v.kind,
          legalForm: v.legalForm,
          title: v.title.trim(),
          name: v.name.trim(),
          lastName: v.legalForm === 'individual' ? clean(v.lastName) : undefined,
          taxId: clean(normalizeTaxId(v.taxId)),
          branchNo: v.legalForm === 'juristic' ? normalizeBranch5(v.branchNo) : undefined,
          email: clean(v.email),
          phone: clean(v.phone),
          creditDays: v.creditDays,
          address: Object.fromEntries(Object.entries(v.address).map(([k, val]) => [k, clean(val)])),
        }),
      }));
      toast.success(contact ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มผู้ติดต่อแล้ว');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  const grid = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <Form methods={methods} onSubmit={onSubmit}>
        <DialogTitle>{contact ? `แก้ไข ${contact.code}` : 'เพิ่มลูกค้า / ผู้ขาย'}</DialogTitle>
        <DialogContent onKeyDown={preventEnterSubmit}>
          <Box sx={{ ...grid, pt: 1 }}>
            <Field.Text name="code" label="รหัส" size="small" />
            <Field.Select name="kind" label="ประเภท" size="small">
              <MenuItem value="customer">ลูกค้า</MenuItem>
              <MenuItem value="vendor">ผู้ขาย</MenuItem>
              <MenuItem value="both">ทั้งสองแบบ</MenuItem>
            </Field.Select>
            <Field.Select name="legalForm" label="สถานะ" size="small" helperText="ใช้แยก ภ.ง.ด.3 / ภ.ง.ด.53">
              <MenuItem value="juristic">นิติบุคคล</MenuItem>
              <MenuItem value="individual">บุคคลธรรมดา</MenuItem>
            </Field.Select>

            <Field.Text name="title" label="คำนำหน้า" size="small" placeholder={legalForm === 'juristic' ? 'บริษัท' : 'นาย'} />
            <Field.Text name="name" label={legalForm === 'juristic' ? 'ชื่อนิติบุคคล' : 'ชื่อ'} size="small" />
            {legalForm === 'individual' ? (
              <Field.Text name="lastName" label="นามสกุล" size="small" />
            ) : (
              <Field.Text name="branchNo" label="สาขา (00000 = สำนักงานใหญ่)" size="small" />
            )}

            <Field.Text
              name="taxId"
              label={legalForm === 'juristic' ? 'เลขประจำตัวผู้เสียภาษี' : 'เลขบัตรประชาชน / ผู้เสียภาษี'}
              size="small"
              inputProps={{ inputMode: 'numeric', maxLength: 17 }}
            />
            <Field.Text name="phone" label="โทรศัพท์" size="small" />
            <Field.Text name="email" label="อีเมล (ส่ง e-Tax)" size="small" />
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1.5 }}>
            ที่อยู่ (ใช้พิมพ์บนใบกำกับและไฟล์ ภ.ง.ด.)
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
            <Field.Text name="address.postalCode" label="รหัสไปรษณีย์" size="small" inputProps={{ inputMode: 'numeric', maxLength: 5 }} />
            <RHFAmountField name="creditDays" label="เครดิต (วัน)" decimals={0} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" variant="contained">
            บันทึก
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
