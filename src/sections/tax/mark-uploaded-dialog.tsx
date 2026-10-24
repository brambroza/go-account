import type { ETaxUploadSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LoadingButton from '@mui/lab/LoadingButton';

import { useAccounting, setETaxStatus } from 'src/store';
import { ETaxUploadSchema } from 'src/schemas/accounting/doc-schemas';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';
import { ConfirmDialog } from 'src/components/custom-dialog';

import { preventEnterSubmit } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  /** เอกสารที่ลงนามแล้ว (`etax === 'signed'`) ที่จะบันทึกว่านำส่งแล้ว — เอกสารขายหรือใบเสร็จรับเงิน/ใบกำกับภาษี */
  docs: { id: string; docNo: string }[];
};

/**
 * ยืนยันก่อนบันทึกว่านำส่ง e-Tax แล้ว (ย้อนกลับไม่ได้) — แสดงเลขที่เอกสารทุกใบ + เลขอ้างอิงการนำส่ง (ถ้ามี)
 * error จาก `setETaxStatus` (เช่น สถานะย้อนกลับ) แสดงเป็น toast
 */
export function MarkUploadedDialog({ open, onClose, docs }: Props) {
  const { run } = useAccounting();
  const methods = useForm<ETaxUploadSchemaType>({
    resolver: zodResolver(ETaxUploadSchema),
    defaultValues: { reference: '' },
  });
  const { reset, handleSubmit, formState } = methods;

  useEffect(() => {
    if (open) reset({ reference: '' });
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    try {
      run((s) => ({
        state: setETaxStatus(
          s,
          docs.map((d) => d.id),
          'uploaded',
          { reference: values.reference }
        ),
      }));
      toast.success(`บันทึกว่านำส่งสรรพากรแล้ว ${docs.length} ฉบับ`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      title={`ยืนยันว่านำส่ง e-Tax แล้ว ${docs.length} ฉบับ`}
      content={
        <Form methods={methods}>
          <Stack spacing={2} sx={{ pt: 0.5 }} onKeyDown={preventEnterSubmit}>
            <Typography variant="body2">
              {docs.map((d) => d.docNo).join(', ')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              ทำเครื่องหมายเฉพาะเมื่ออัปโหลดไฟล์ที่ลงนามแล้วสำเร็จที่ etax.rd.go.th — บันทึกแล้วเปลี่ยนสถานะกลับไม่ได้
            </Typography>
            <Field.Text name="reference" label="เลขอ้างอิงการนำส่ง (ถ้ามี)" size="small" />
          </Stack>
        </Form>
      }
      action={
        <LoadingButton variant="contained" onClick={submit} loading={formState.isSubmitting} disabled={!docs.length}>
          ยืนยันนำส่งแล้ว
        </LoadingButton>
      }
    />
  );
}
