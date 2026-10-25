import { useRef } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';

import { useTranslate } from 'src/locales';

import type { ConfirmDialogProps } from './types';
// ----------------------------------------------------------------------

/**
 * Enter ในหน้ายืนยัน = กดปุ่มหลัก (ปุ่มแรกที่ใช้ได้ใน `action`) แบบเดียวกับ Express (UAT U13)
 * ไม่ทำงานเมื่อโฟกัสอยู่ที่ปุ่ม/ลิงก์ (Enter กดปุ่มนั้นเอง), textarea, เมนูตัวเลือก หรือกดค้าง (repeat)
 */
function useEnterToConfirm() {
  const actionsRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' || event.repeat || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, textarea, [role="listbox"], [role="option"], [role="combobox"], [aria-expanded="true"]')) return;
    const primary = actionsRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    if (!primary || primary.dataset.dialogCancel !== undefined) return;
    event.preventDefault();
    primary.click();
  };
  return { actionsRef, onKeyDown };
}

export function ConfirmDialog({
  title,
  content,
  action,
  open,
  onClose,
  ...other
}: ConfirmDialogProps) {
  const { t: tt } = useTranslate('translation');
  const { actionsRef, onKeyDown } = useEnterToConfirm();
  return (
    <Dialog fullWidth maxWidth="md" open={open} onClose={onClose} onKeyDown={onKeyDown} {...other}>
      <DialogTitle sx={{ pb: 2 }}>{title}</DialogTitle>

      {content && <DialogContent sx={{ typography: 'body2' }}> {content} </DialogContent>}

      <DialogActions ref={actionsRef}>
        {action}

        <Button variant="outlined" color="inherit" onClick={onClose} data-dialog-cancel="">
         
          {tt('btncancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ConfirmDialogXS({
  title,
  content,
  action,
  open,
  onClose,
  ...other
}: ConfirmDialogProps) {
  const { t: tt } = useTranslate('translation');
  const { actionsRef, onKeyDown } = useEnterToConfirm();
  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose} onKeyDown={onKeyDown} {...other}>
      <DialogTitle sx={{ pb: 2 }}>{title}</DialogTitle>

      {content && <DialogContent sx={{ typography: 'body2' }}> {content} </DialogContent>}

      <DialogActions ref={actionsRef}>
        {action}

        <Button variant="outlined" color="inherit" onClick={onClose} data-dialog-cancel="">
         
          {tt('btncancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}




export function ConfirmDialogRepeats({
  title,
  content,
  action,
  open,
  onClose,
  ...other
}: ConfirmDialogProps) {
  const { t: tt } = useTranslate('translation');
  const { actionsRef, onKeyDown } = useEnterToConfirm();
  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose} onKeyDown={onKeyDown} {...other}>
      <DialogTitle sx={{ pb: 2 }}>{title}</DialogTitle>

      {content && <DialogContent sx={{ typography: 'body2' }}> {content} </DialogContent>}

      <DialogActions ref={actionsRef}>
        {action}

        <Button variant="outlined" color="inherit" onClick={onClose} data-dialog-cancel="">
         
          {tt('btncancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}


