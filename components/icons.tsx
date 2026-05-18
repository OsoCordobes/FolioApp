/**
 * Folio · iconset
 *
 * Port de folio/icons.jsx del prototipo: Lucide-customizado (stroke 1.5,
 * grid 24, corners 2) + 4 domain icons (vertebra, voice, soap, anatomia).
 * Cada icono acepta `size` (default 16). Inline SVG, sin sprite ni dep externa.
 */

import type { SVGProps } from "react";

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "children" | "fill" | "stroke" | "viewBox">;

const baseAttrs = (size = 16) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

// ─── Generic icons ──────────────────────────────────────────────────────────

export const Calendar = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

export const CalendarDay = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
    <path d="M16 2v4M8 2v4M3 10h18" />
    <rect x="7" y="13" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
  </svg>
);

export const Inbox = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

export const Users = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 4a3.5 3.5 0 0 1 0 7" />
    <path d="M21 21c0-2.5-1.5-4.7-3.6-5.6" />
  </svg>
);

export const Wallet = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <rect x="2.5" y="5" width="19" height="14.5" rx="2.5" />
    <path d="M2.5 9h19" />
    <circle cx="17" cy="14" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const Settings = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const Search = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4.3-4.3" />
  </svg>
);

export const Plus = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Check = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const ArrowRight = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

export const ChevronRight = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const ChevronDown = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const Edit = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

export const Phone = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7a2 2 0 0 1 1.72 2z" />
  </svg>
);

export const Logout = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export const ExternalLink = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M15 3h6v6M14 10l7-7M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </svg>
);

export const Printer = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
  </svg>
);

export const Drag = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} strokeWidth={1.8} {...rest}>
    <circle cx="9" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
  </svg>
);

export const Play = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M6 4l14 8-14 8V4z" fill="currentColor" />
  </svg>
);

export const Sun = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const Moon = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const Bell = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const Google = ({ size = 14, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

// ─── Domain icons ───────────────────────────────────────────────────────────

export const Vertebra = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M5 5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    <path d="M5 19c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2" />
    <path d="M7 5h10M7 9h10M7 13h10M7 17h10" />
    <path d="M6.5 7h11M6.5 11h11M6.5 15h11" />
  </svg>
);

export const Voice = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M3 12h2M7 9v6M11 5v14M15 9v6M19 12h2" />
  </svg>
);

export const Soap = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M5 6h1.5M9 6h10M5 11h1.5M9 11h10M5 16h1.5M9 16h7" />
  </svg>
);

export const Alert = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const Star = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor" stroke="none" />
  </svg>
);

export const X = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const Mic = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10a7 7 0 0 1-14 0M12 19v3" />
  </svg>
);

export const WhatsApp = ({ size = 16, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
    <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4-.1-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2.2C6.6 2.2 2.2 6.6 2.2 12c0 1.9.5 3.7 1.5 5.3L2 22l4.8-1.6C8.4 21.4 10.2 22 12 22c5.4 0 9.8-4.4 9.8-9.8S17.4 2.2 12 2.2zm0 17.9c-1.7 0-3.3-.5-4.7-1.3l-.3-.2-3.3 1.1 1.1-3.2-.2-.4c-.9-1.4-1.4-3.1-1.4-4.8 0-4.9 4-8.9 8.9-8.9s8.9 4 8.9 8.9-4.1 8.8-9 8.8z" />
  </svg>
);

export const Save = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </svg>
);

export const History = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M1 4v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    <path d="M12 7v5l4 2" />
  </svg>
);

export const Activity = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

export const Stethoscope = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M4.8 2.3A.3.3 0 0 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 0 0-.2.3" />
    <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4" />
    <circle cx="20" cy="10" r="2" />
  </svg>
);

export const Lock = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const User = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
  </svg>
);

export const Trash = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const Copy = ({ size, ...rest }: IconProps) => (
  <svg {...baseAttrs(size)} {...rest}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
