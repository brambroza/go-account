import type { StackProps } from '@mui/material/Stack';
import type { ContainerProps } from '@mui/material/Container';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { varAlpha, stylesMode } from 'src/theme/styles';

// ----------------------------------------------------------------------

type ComponentBoxProps = StackProps & {
  title?: string;
};

export function ComponentBox({ title, sx, children, ...other }: ComponentBoxProps) {
  return (
    <Stack
      sx={{
        px: 2.5,
        py: 3, 
        width: 1, 
        position: 'relative', 
         ...sx,
      }}
      {...other}
    >
      {title && (
        <Box
          component="span"
          sx={{
            px: 1,
            top: 0,
            ml: 0,
            left: 0,
            py: 0.25,
            borderRadius: 0,
            position: 'absolute',
            color: 'text.primary',
            bgcolor: 'common.white',
            transform: 'translateY(-50%)',
            fontSize: (theme) => theme.typography.caption.fontSize,
            fontWeight: (theme) => theme.typography.fontWeightSemiBold,
            border: (theme) => `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
            [stylesMode.dark]: { bgcolor: 'background.neutral' },
          }}
        >
          {title}
        </Box>
      )}

      {children}
    </Stack>
  );
}

// ----------------------------------------------------------------------

export function ComponentContainer({ children, sx, ...other }: ContainerProps) {
  return (
    <Container
      sx={{
        mt: 10,
        mb: 15,
        gap: 5,
        display: 'flex',
        flexDirection: 'column',
        ...sx,
      }}
      {...other}
    >
      {children}
    </Container>
  );
}


export function ComponentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 700,
          color: 'orange',
          mb: 1,
        }}
      >
        {title}
      </Typography>
      <Box sx={{ p: 2, bgcolor: 'white', borderRadius: 1, boxShadow: 1 }}>{children}</Box>
    </Box>
  );
}