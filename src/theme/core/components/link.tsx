import type { Theme, Components } from '@mui/material/styles';

// ----------------------------------------------------------------------

const MuiLink: Components<Theme>['MuiLink'] = {
  /** **************************************
   * DEFAULT PROPS
   *************************************** */
  defaultProps: { underline: 'none' },

  /** **************************************
   * STYLE
   *************************************** */

  styleOverrides: {
    root: {
     
      color: 'text.disabled', cursor: 'pointer',
      position: 'relative',
      '&::after': {
        content: '""',
        position: 'absolute',
        width: '0%',
        height: '1px',
        left: 0,
        bottom: 0,
        backgroundColor: 'currentColor',
        transition: 'width 0.3s ease-in-out',
      },
      '&:hover::after': {
        width: '100%',
      },
    },
  },
};

// ----------------------------------------------------------------------

export const link = { MuiLink };
