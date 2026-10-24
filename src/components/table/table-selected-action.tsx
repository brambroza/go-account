import type { StackProps } from '@mui/material/Stack';
import type { Easing, RepeatType } from 'framer-motion';

import Stack from '@mui/material/Stack';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';

import { AnimateBorderCustom } from '../animate/animate-border-custom';
// ----------------------------------------------------------------------

export type TableSelectedActionProps = StackProps & {
  dense?: boolean;
  rowCount: number;
  numSelected: number;
  action?: React.ReactNode;
  onSelectAllRows: (checked: boolean) => void;
  animate?: {
    outline?: string;
    color?: string | string[];
    width?: string; // width `2px` | `2px 4px 0 0` (as padding)
    angle?: number; // angle: min: 0, max: 360, step: 1
    loop?: boolean;
    length?: number; // length: min: 1, max: 100, step: 1
    distance?: number; // distance: min: 1, max: 100, step: 1
    ease?: Easing;
    delay?: number;
    duration?: number; // duration: min: 1, max: 20, step: 1
    repeatType?: RepeatType; // repeatType: ["loop", "reverse", "mirror"
    disable?: boolean; // disable animate
    disableDoubleline?: boolean; // show 1 line
  };
};

export function TableSelectedAction({
  dense,
  action,
  rowCount,
  numSelected,
  onSelectAllRows,
  animate,
  sx,
  ...other
}: TableSelectedActionProps) {
  if (!numSelected) {
    return null;
  }

  return (
    <AnimateBorderCustom
      animate={animate}
      sx={{
        pl: 1,
        pr: 2,
        top: 2,
        left: 0,
        width: 1,
        zIndex: 9,
        height: 58,
        position: 'absolute',
        bgcolor: 'background.neutral',
        ...(dense && { height: 38 }),
        ...sx,
      }}
      action={
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            pl: 1,
            pr: 2,
            top: 2,
            left: 0,
            width: 1,
            zIndex: 9,
            height: 58,
            position: 'absolute',
            bgcolor: 'background.neutral',
            ...(dense && { height: 38 }),
            ...sx,
          }}
          {...other}
        >
          <Checkbox
            indeterminate={!!numSelected && numSelected < rowCount}
            checked={!!rowCount && numSelected === rowCount}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onSelectAllRows(event.target.checked)
            }
          />

          <Typography
            variant="subtitle2"
            sx={{
              ml: 2,
              flexGrow: 1,
              color: 'primary.main',
              ...(dense && { ml: 3 }),
            }}
          >
            {numSelected} selected
          </Typography>

          {action && action}
        </Stack>
      }
    />
  );
}
