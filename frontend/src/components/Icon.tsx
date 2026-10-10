import type { ReactNode, SVGProps } from 'react';

type IconName = 'church' | 'mail' | 'lock' | 'eye' | 'eye-off' | 'arrow' | 'check' | 'close' | 'logout';
const paths: Record<IconName, ReactNode> = {
  church: <><path d="M12 3v6m-3-3h6M4 21V12l8-5 8 5v9H4Z"/><path d="M9 21v-6a3 3 0 0 1 6 0v6M2 21h20"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  'eye-off': <><path d="m3 3 18 18M10.5 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.1 4M6.4 6.4A19 19 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.6-1.6M10 10a3 3 0 0 0 4 4"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m5-12 4 4-4 4m-6-4h10"/></>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
