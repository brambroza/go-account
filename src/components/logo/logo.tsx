import type { BoxProps } from '@mui/material/Box';

import {   forwardRef } from 'react'; // import { useId, forwardRef } from 'react';

import Box from '@mui/material/Box';
import NoSsr from '@mui/material/NoSsr';
/*  import { useTheme } from '@mui/material/styles';   */

import { RouterLink } from 'src/routes/components';

 import { CONFIG } from 'src/config-global'; 

import { logoClasses } from './classes';

// ----------------------------------------------------------------------

export type LogoProps = BoxProps & {
  href?: string;
  disableLink?: boolean;
};

export const Logo = forwardRef<HTMLDivElement, LogoProps>(
  ({ width = 40, height = 40, disableLink = false, className, href = '/', sx, ...other }, ref) => {

    // log Goalong
  /* const theme = useTheme(); 
      
     const gradientId = useId();
 
     const PRIMARY_LIGHT = theme.vars.palette.primary.light;
 
     const PRIMARY_MAIN = theme.vars.palette.primary.main;
 
     const PRIMARY_DARK = theme.vars.palette.primary.dark;
 
     const logo = (
       <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 512 512">
         <defs>
           <linearGradient id={`${gradientId}-1`} x1="100%" x2="50%" y1="9.946%" y2="50%">
             <stop offset="0%" stopColor={PRIMARY_DARK} />
             <stop offset="100%" stopColor={PRIMARY_MAIN} />
           </linearGradient>
 
           <linearGradient id={`${gradientId}-2`} x1="50%" x2="50%" y1="0%" y2="100%">
             <stop offset="0%" stopColor={PRIMARY_LIGHT} />
             <stop offset="100%" stopColor={PRIMARY_MAIN} />
           </linearGradient>
 
           <linearGradient id={`${gradientId}-3`} x1="50%" x2="50%" y1="0%" y2="100%">
             <stop offset="0%" stopColor={PRIMARY_LIGHT} />
             <stop offset="100%" stopColor={PRIMARY_MAIN} />
           </linearGradient>
         </defs>
 
         <g fill={PRIMARY_MAIN} fillRule="evenodd" stroke="none" strokeWidth="100">
           <path d="M220 90 L75 240 L220 400" stroke={PRIMARY_MAIN} fill="none" />
 
           <path d="M300 90 L450 240 L300 400" stroke={PRIMARY_MAIN} fill="none" />
         </g>
       </svg>
     ); 
    */
  
  


    /* logo จาก public/logo — เปลี่ยนไฟล์ได้ตามแบรนด์ของ project */
   const logo = (
      <Box
        alt="logo"
        component="img"
        src={`${CONFIG.site.basePath}/logo/logo-single.svg`}
        width={width}
        height={height}
      />
    );
 




    /*
      * OR using local (public folder)
      * const logo = ( <Box alt="logo" component="img" src={`${CONFIG.site.basePath}/logo/logo-single.svg`} width={width} height={height} /> );
      */

    /* 
    const logo2 = (
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 512 512">
        <defs>
          <linearGradient id="gradient-1" x1="100%" x2="50%" y1="9.946%" y2="50%">
            <stop offset="0%" stopColor="#FFA500" />
            <stop offset="100%" stopColor="#FF8C00" />
          </linearGradient>
          <linearGradient id="gradient-2" x1="50%" x2="50%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#ADD8E6" />
            <stop offset="100%" stopColor="#1E90FF" />
          </linearGradient>
        </defs>

        

        <line x1="226" y1="216" x2="120" y2="50" stroke="black" strokeWidth="5" />
        <line x1="256" y1="256" x2="412" y2="100" stroke="black" strokeWidth="5" />
        <line x1="256" y1="256" x2="100" y2="412" stroke="black" strokeWidth="5" />
        <line x1="256" y1="256" x2="412" y2="412" stroke="black" strokeWidth="5" />

        <circle cx="150" cy="90" r="30" fill="url(#gradient-1)" />
        <circle cx="412" cy="100" r="30" fill="url(#gradient-1)" />
        <circle cx="100" cy="412" r="30" fill="url(#gradient-1)" />
        <circle cx="412" cy="412" r="30" fill="url(#gradient-1)" />

        <circle cx="256" cy="256" r="70" fill="url(#gradient-2)" />

       
      </svg>
    ); */

    return (
      <NoSsr
        fallback={
          <Box
            width={width}
            height={height}
            className={logoClasses.root.concat(className ? ` ${className}` : '')}
            sx={{ flexShrink: 0, display: 'inline-flex', verticalAlign: 'middle', ...sx }}
          />
        }
      >
        <Box
          ref={ref}
          component={RouterLink}
          href={href}
          width={width}
          height={height}
          className={logoClasses.root.concat(className ? ` ${className}` : '')}
          aria-label="logo"
          sx={{
            flexShrink: 0,
            display: 'inline-flex',
            verticalAlign: 'middle',
            ...(disableLink && { pointerEvents: 'none' }),
            ...sx,
          }}
          {...other}
        >
          {logo}
        </Box>
      </NoSsr>
    );
  }
);
