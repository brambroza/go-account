import type { Contact, ContactKind } from 'src/domain';
import type { ContactSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useRef, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { cmd, useAccounting } from 'src/store';
import { ContactSchema } from 'src/schemas/accounting/doc-schemas';
import {
  normalizeTaxId,
  nextContactCode,
  normalizeBranch5,
  contactCodePrefix,
  contactDisplayName,
  defaultContactTitle,
  contactsWithSameTaxId,
} from 'src/domain';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';

import { RHFAmountField, preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  contact?: Contact | null;
  /** ผู้ติดต่อใหม่: ประเภทเริ่มต้น (จากฟอร์มขาย = ลูกค้า, ซื้อ = ผู้ขาย) */
  defaultKind?: ContactKind;
  /** ผู้ติดต่อใหม่: ชื่อที่พิมพ์ค้นไว้ในช่องค้นหา */
  defaultName?: string;
  /** เรียกหลังบันทึกสำเร็จ — ฟอร์มที่เปิด "+ เพิ่มใหม่" ใช้เลือกผู้ติดต่อนี้ทันที */
  onSaved?: (contact: Contact) => void;
};

function toForm(c: Contact | null | undefined, nextCode: string, defaults: { kind?: ContactKind; name?: string } = {}): ContactSchemaType {
  return {
    id: c?.id,
    code: c?.code ?? nextCode,
    kind: c?.kind ?? defaults.kind ?? 'customer',
    legalForm: c?.legalForm ?? 'juristic',
    title: c?.title ?? defaultContactTitle(defaults.name ?? '', 'juristic'),
    name: c?.name ?? defaults.name ?? '',
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

/** เพิ่ม/แก้ผู้ติดต่อ — รหัสใหม่ = ค่าสูงสุดของรหัสประเภทเดียวกัน + 1 (C = ลูกค้า, V = ผู้ขาย) */
export function ContactDialog({ open, onClose, contact, defaultKind, defaultName, onSaved }: Props) {
  const { data, run, busy } = useAccounting();
  const codeFor = (kind: ContactKind) => nextContactCode(data.contacts, contactCodePrefix(kind));
  const initial = () => toForm(contact, codeFor(defaultKind ?? 'customer'), { kind: defaultKind, name: defaultName });
  const methods = useForm<ContactSchemaType>({ resolver: zodResolver(ContactSchema), defaultValues: initial() });
  const [legalForm, taxId, branchNo, kind, name] = useWatch({
    control: methods.control,
    name: ['legalForm', 'taxId', 'branchNo', 'kind', 'name'],
  });
  // ผู้ติดต่อใหม่: เปลี่ยนประเภทแล้วรหัสอัตโนมัติเปลี่ยนตาม (ถ้ายังไม่ได้แก้รหัสเอง)
  const autoCode = useRef('');
  // เตือน (ไม่บล็อก) เมื่อมีผู้ติดต่ออื่นเลขผู้เสียภาษี + สาขาเดียวกัน — ผู้ขายซ้ำทำให้ตรวจใบกำกับซ้ำยาก
  const sameTaxId = contactsWithSameTaxId(data.contacts, {
    id: contact?.id,
    taxId: normalizeTaxId(taxId),
    branchNo: legalForm === 'juristic' ? branchNo : undefined,
  });

  useEffect(() => {
    if (!open) return;
    const values = initial();
    autoCode.current = contact ? '' : values.code;
    autoTitle.current = contact ? null : values.title;
    methods.reset(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact, defaultKind, defaultName]);

  // ผู้ติดต่อใหม่: คำนำหน้าตามชื่อ/สถานะ จนกว่าผู้ใช้จะแก้คำนำหน้าเอง (ไม่เติม "บริษัท" หน้า "ร้าน…" / บุคคลธรรมดา)
  const autoTitle = useRef<string | null>(null);
  useEffect(() => {
    if (contact) return;
    const current = methods.getValues('title') ?? '';
    if (autoTitle.current !== null && current !== autoTitle.current) return;
    const next = defaultContactTitle(name ?? '', legalForm ?? 'juristic');
    autoTitle.current = next;
    if (current !== next) methods.setValue('title', next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, legalForm, contact]);

  useEffect(() => {
    if (contact || !kind || !autoCode.current || methods.getValues('code') !== autoCode.current) return;
    const code = codeFor(kind);
    autoCode.current = code;
    methods.setValue('code', code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const onSubmit = methods.handleSubmit(async (v) => {
    const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    try {
      const saved = await run(
        cmd.saveContact({
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
        })
      );
      toast.success(contact ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มผู้ติดต่อ ${saved.contact.code} แล้ว`);
      onSaved?.(saved.contact);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  // dialog อยู่ใน portal แต่ event ของ React ยังส่งต่อไปฟอร์มแม่ (เช่นฟอร์มขายที่กด "+ เพิ่มใหม่") — หยุดไว้ที่นี่
  const submit = (event?: React.BaseSyntheticEvent) => {
    event?.stopPropagation();
    return onSubmit(event);
  };

  const grid = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <Form methods={methods} onSubmit={submit}>
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
            {sameTaxId.length > 0 && (
              <Alert severity="warning" variant="outlined" sx={{ gridColumn: '1 / -1' }}>
                เลขผู้เสียภาษีและสาขานี้มีอยู่แล้ว: {sameTaxId.map((c) => `${c.code} ${contactDisplayName(c)}`).join(', ')} — ถ้าเป็นรายเดียวกัน
                ให้ใช้ผู้ติดต่อเดิม (บันทึกได้ แต่ใบกำกับของผู้ขายรายเดียวกันจะถูกตรวจซ้ำรวมกัน)
              </Alert>
            )}
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
          <Button type="submit" variant="contained" disabled={busy}>
            บันทึก
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
