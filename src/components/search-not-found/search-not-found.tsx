import type { BoxProps } from '@mui/material/Box';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useTranslate } from 'src/locales';
// ----------------------------------------------------------------------

type SearchNotFoundProps = BoxProps & {
  query?: string;
};

export function SearchNotFound({ query, sx, ...other }: SearchNotFoundProps) {
  const { t: tt } = useTranslate('translation');
  if (!query) {
    return (
      <Typography variant="body2" sx={sx}>
        Please enter keywords
      </Typography>
    );
  }




  return (
    <Box sx={{ textAlign: 'center', borderRadius: 1.5, ...sx }} {...other}>
      <Box sx={{ mb: 1, typography: 'h6' }}>{tt('msgnotfound')}</Box>

      <Typography variant="body2">
        No results found for &nbsp;
        <strong>{`"${query}"`}</strong>
        .
        <br /> Try checking for typos or using complete words.
      </Typography>
    </Box>
  );
}
