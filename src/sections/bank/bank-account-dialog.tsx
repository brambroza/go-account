import type { BankAccount } from 'src/domain';
import type { BankAccountFormSchemaType } from 'src/schemas/accounting/doc-schemas';

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import LoadingButton from '@mui/lab/LoadingButton';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { cmd, useAccounting } from 'src/store';
import { nextBankAccountCode } from 'src/domain';
import { BankAccountFormSchema } from 'src/schemas/accounting/doc-schemas';

import { toast } from 'src/components/snackbar';
import { Form, Field } from 'src/components/hook-form';

import { formKeyHandler } from 'src/sections/shared';

// ----------------------------------------------------------------------

type Props = { open: boolean; onClose: () => void; editing?: BankAccount | null };

/** เพิ่มบัญชีธนาคาร (ผังบัญชี 1121–1129) / เงินสดย่อย (1112–1119) หรือแก้ชื่อธนาคาร เลขที่บัญชี สาขา */
export function BankAccountDialog({ open, onClose, editing }: Props) {
  const { data, run, busy } = useAccounting();
  const defaults = (): BankAccountFormSchemaType => ({
    kind: editing?.kind ?? 'bank',
    bankName: editing?.bankName ?? '',
    accountNo: editing?.accountNo ?? '',
    branch: editing?.branch ?? '',
  });
  const methods = useForm<BankAccountFormSchemaType>({ resolver: zodResolver(BankAccountFormSchema), defaultValues: defaults() });
  const kind = useWatch({ control: methods.control, name: 'kind' });
  const code = editing?.accountCode ?? nextBankAccountCode(data.accounts, kind ?? 'bank');

  useEffect(() => {
    if (open) methods.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const onSubmit = methods.handleSubmit(async (v) => {
    try {
      if (editing) {
        await run(
          cmd.updateBankAccount(editing.accountCode, {
            bankName: v.bankName,
            accountNo: v.accountNo,
            branch: v.branch ?? '',
          })
        );
        toast.success(`บันทึกบัญชี ${editing.accountCode} แล้ว`);
      } else {
        const r = await run(
          cmd.addBankAccount({
            kind: v.kind,
            bankName: v.bankName,
            accountNo: v.accountNo,
            branch: v.branch,
          })
        );
        toast.success(`เพิ่มบัญชี ${r.bank.accountCode} ในผังบัญชีแล้ว`);
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    }
  });

  const submit = (event?: React.BaseSyntheticEvent) => {
    event?.stopPropagation();
    return onSubmit(event);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Form methods={methods} onSubmit={submit}>
        <DialogTitle>{editing ? `แก้ไขบัญชี ${editing.accountCode}` : 'เพิ่มบัญชีธนาคาร / เงินสดย่อย'}</DialogTitle>
        <DialogContent onKeyDown={formKeyHandler(onSubmit)}>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {!editing && (
              <Field.RadioGroup
                row
                name="kind"
                options={[
                  { value: 'bank', label: 'บัญชีธนาคาร' },
                  { value: 'petty-cash', label: 'เงินสดย่อย' },
                ]}
              />
            )}
            <Field.Text name="bankName" label={kind === 'petty-cash' ? 'ผู้ถือเงิน / แผนก' : 'ชื่อธนาคาร'} size="small" />
            {kind === 'bank' && <Field.Text name="accountNo" label="เลขที่บัญชี" size="small" />}
            {kind === 'bank' && <Field.Text name="branch" label="สาขา (ไม่บังคับ)" size="small" />}
            {code ? (
              <Alert severity="info" variant="outlined">
                {editing ? `รหัสบัญชี ${code} (แก้ข้อมูลธนาคารไม่กระทบรายการบัญชี)` : `ระบบจะเพิ่มบัญชี ${code} ในผังบัญชีให้ — ใช้รับ/จ่าย/โอนเงินได้ทันที`}
              </Alert>
            ) : (
              <Alert severity="error" variant="outlined">
                เพิ่ม{kind === 'bank' ? 'บัญชีธนาคาร' : 'เงินสดย่อย'}ได้ไม่เกิน 9 บัญชี
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={onClose}>
            ยกเลิก
          </Button>
          <LoadingButton type="submit" variant="contained" loading={busy} disabled={!code}>
            บันทึก
          </LoadingButton>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
