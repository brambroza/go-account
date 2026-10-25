import type { Contact, ContactKind } from 'src/domain';
import type { Theme, SxProps } from '@mui/material/styles';

import { useMemo, useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';

import { useBoolean } from 'src/hooks/use-boolean';

import { useAccounting } from 'src/store';
import { formatTaxId, filterContacts, contactDisplayName } from 'src/domain';

import { Iconify } from 'src/components/iconify';

import { ContactDialog } from 'src/sections/contacts/contact-dialog';

// ----------------------------------------------------------------------

const ADD_NEW = '__add_new__';

type Option = { id: string; contact?: Contact; label: string };

type Props = {
  name: string;
  label: string;
  /** customer = ลูกค้า + ทั้งสอง, vendor = ผู้ขาย + ทั้งสอง */
  side: 'customer' | 'vendor';
  sx?: SxProps<Theme>;
  disabled?: boolean;
  /** ฟอร์มใหม่: โฟกัสช่องนี้ทันทีเพื่อพิมพ์ค้นได้เลย (UAT U13) */
  autoFocus?: boolean;
};

/**
 * เลือกลูกค้า/ผู้ขายแบบพิมพ์ค้น (รหัส ชื่อ หรือเลขผู้เสียภาษี) — ตัวเลือกสุดท้าย "+ เพิ่มใหม่" เปิดฟอร์มผู้ติดต่อ
 * บันทึกแล้วเลือกให้ทันที (ค่าที่เก็บในฟอร์ม = contact id)
 */
export function ContactAutocomplete({ name, label, side, sx, disabled, autoFocus }: Props) {
  const { control, setValue } = useFormContext();
  const { data } = useAccounting();
  const dialog = useBoolean();
  const [input, setInput] = useState('');
  const [draftName, setDraftName] = useState('');
  // โฟกัสอัตโนมัติตอนเปิดฟอร์ม: ไม่เปิดรายการทับฟอร์มทันที — เปิดเมื่อพิมพ์/คลิก (โฟกัสครั้งถัดไปเปิดตามปกติ)
  const [quietFocus, setQuietFocus] = useState(!!autoFocus);

  const pool = useMemo(
    () => data.contacts.filter((c) => (side === 'customer' ? c.kind !== 'vendor' : c.kind !== 'customer')),
    [data.contacts, side]
  );
  // ตัวเลือกต้องเป็น object เดิมทุก render — Autocomplete รีเซ็ตข้อความค้นหาเมื่อ value เปลี่ยน reference
  const options = useMemo<Option[]>(
    () => pool.map((c) => ({ id: c.id, contact: c, label: `${c.code} · ${contactDisplayName(c)}` })),
    [pool]
  );
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const defaultKind: ContactKind = side === 'customer' ? 'customer' : 'vendor';

  return (
    <>
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState: { error } }) => (
            <Autocomplete<Option, false, false, false>
              value={byId.get(field.value) ?? null}
              inputValue={input}
              onInputChange={(_, v) => setInput(v)}
              options={options}
              disabled={disabled}
              autoHighlight
              openOnFocus={!quietFocus}
              size="small"
              sx={sx}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(o) => o.label}
              filterOptions={(_, state) => {
                // เรียงตามความตรง: รหัสตรงตัว/ขึ้นต้น ก่อนชื่อที่มีคำค้น (`filterContacts`)
                const list = filterContacts(pool, state.inputValue, 50).flatMap((c) => {
                  const option = byId.get(c.id);
                  return option ? [option] : [];
                });
                return [...list, { id: ADD_NEW, label: state.inputValue.trim() }];
              }}
              onChange={(_, option) => {
                if (option?.id === ADD_NEW) {
                  setDraftName(option.label);
                  dialog.onTrue();
                  return;
                }
                field.onChange(option?.id ?? '');
              }}
              onBlur={() => {
                setQuietFocus(false);
                field.onBlur();
              }}
              renderOption={(props, option) =>
                option.id === ADD_NEW ? (
                  <Box component="li" {...props} key={ADD_NEW} sx={{ color: 'primary.main', gap: 1 }}>
                    <Iconify icon="mingcute:add-line" width={18} />
                    เพิ่ม{side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย'}ใหม่{option.label ? ` “${option.label}”` : ''}
                  </Box>
                ) : (
                  <Box component="li" {...props} key={option.id} sx={{ display: 'block' }}>
                    <Typography variant="body2">{option.label}</Typography>
                    {option.contact?.taxId && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {formatTaxId(option.contact.taxId)}
                      </Typography>
                    )}
                  </Box>
                )
              }
              noOptionsText="ไม่พบ — เลือก “เพิ่มใหม่”"
              renderInput={(params) => (
                <TextField
                  {...params}
                  inputRef={field.ref}
                  label={label}
                  autoFocus={autoFocus && !disabled}
                  placeholder="พิมพ์รหัส ชื่อ หรือเลขผู้เสียภาษี"
                  error={!!error}
                  helperText={error?.message}
                  inputProps={{ ...params.inputProps, autoComplete: 'off' }}
                />
              )}
            />
          )}
      />
      <ContactDialog
        open={dialog.value}
        onClose={dialog.onFalse}
        defaultKind={defaultKind}
        defaultName={draftName}
        onSaved={(c) => {
          setValue(name, c.id, { shouldValidate: true, shouldDirty: true });
          setInput(`${c.code} · ${contactDisplayName(c)}`);
        }}
      />
    </>
  );
}
