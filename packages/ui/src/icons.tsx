import type { SVGProps } from "react";

/**
 * Just See icon set. Drawn for this project on a 24px grid, 1.8px rounded
 * strokes. Not derived from any other icon library.
 */
const paths = {
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  undo: <path d="M9 7 5 11l4 4M5.5 11H14a5 5 0 0 1 0 10h-2" />,
  redo: <path d="m15 7 4 4-4 4M18.5 11H10a5 5 0 0 0 0 10h2" />,
  split: (
    <>
      <path d="M12 3v18" />
      <path d="M8 7H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3M16 7h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10 11v5M14 11v5" />,
  speed: (
    <>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="m12 16 4-5" />
      <circle cx="12" cy="16" r="1.4" fill="currentColor" />
    </>
  ),
  volume: <path d="M4 9.5h3l4.5-4v13L7 14.5H4zM15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4 9.5h3l4.5-4v13L7 14.5H4zM15.5 9.5l5 5M20.5 9.5l-5 5" />,
  effects: (
    <path d="M12 3.5 13.6 8.4 18.5 10l-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
  ),
  transition: (
    <>
      <rect x="3.5" y="6" width="10" height="12" rx="2" />
      <path d="M13.5 8.5h5a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-5" strokeDasharray="2 2.2" />
      <path d="m9 10 2.5 2L9 14" />
    </>
  ),
  text: <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />,
  music: (
    <>
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  media: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m3.5 15.5 4.5-4 4 3.5 3-2.5 5.5 4.5" />
      <circle cx="15.5" cy="9" r="1.5" />
    </>
  ),
  canvas: (
    <>
      <rect x="7" y="3.5" width="10" height="17" rx="2" />
      <path d="M3.5 8v8M20.5 8v8" />
    </>
  ),
  export: <path d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />,
  back: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  adjust: <path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5s1-5.9 3.5-8.5z" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: <path d="M4 4l16 16M10 6a9 9 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1M9.9 10a2.8 2.8 0 0 0 4 4" />,
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5M7.5 10.5h6" />
    </>
  ),
  skipStart: <path d="M6 5v14M18 5.5v13L9 12z" />,
  skipEnd: <path d="M18 5v14M6 5.5v13L15 12z" />,
  animation: <path d="M4 17c3 0 3-10 6-10s3 10 6 10 2-5 4-5M4 20h16" />,
  style: (
    <>
      <path d="M4 20 9.5 5h1L16 20M6.2 14.5h7.6" />
      <circle cx="18.5" cy="17.5" r="2.5" />
    </>
  ),
  fade: <path d="M3.5 18 9 6h6l5.5 12" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  dots: (
    <>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  share: <path d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />,
  download: <path d="M12 4v11M8 11l4 4 4-4M5 19.5h14" />,
  crop: <path d="M7 3v14h14M3 7h14v14" />,
  freeze: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />,
  keyframe: <path d="M12 4 20 12 12 20 4 12z" />,
  logo: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export const ICON_NAMES = Object.keys(paths) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Accessible label. Without it the icon is hidden from screen readers. */
  label?: string;
}

export function Icon({ name, size = 22, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
