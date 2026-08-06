import React from "react";

/**
 * Minimal Lucide-style icon set (16px, stroke=currentColor) so every glyph in
 * the chat renders consistently across OSes instead of relying on emoji fonts.
 */

function Svg({
  children,
  className,
  filled = false,
  size = 16,
}: {
  children: React.ReactNode;
  className?: string;
  filled?: boolean;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function HistoryIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Svg>
  );
}

export function PlusIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  );
}

export function SettingsIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function EditIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

export function PinIcon({ size, filled }: { size?: number; filled?: boolean }) {
  return (
    <Svg size={size} filled={filled}>
      <path
        d="M12 17v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </Svg>
  );
}

export function ExportIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Svg>
  );
}

export function ArchiveIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </Svg>
  );
}

export function CopyIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  );
}

export function ForkIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
      <path d="M12 12v3" />
    </Svg>
  );
}

export function AttachIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}

export function DotsIcon({ size }: { size?: number }) {
  return (
    <Svg size={size} filled>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </Svg>
  );
}

export function ChevronDownIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronUpIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m18 15-6-6-6 6" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function ChartIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3 3v18h18" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-3" />
    </Svg>
  );
}

export function SearchIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function BrainIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.923 14.5a4 4 0 0 1 .172-1.5" />
      <path d="M20.077 14.5a4 4 0 0 0-.172-1.5" />
      <path d="M8.5 21c1.5 0 2-1 3-1s1.5 1 3 1" />
    </Svg>
  );
}

export function EyeIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

/** Stacked coins — cost signal without a currency glyph. */
export function CoinsIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </Svg>
  );
}

/** Tiny filled flag pictograms (14×10) — hosting region, not emoji. */
function FlagSvg({ children }: { children: React.ReactNode }) {
  return (
    <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function FlagUsIcon() {
  return (
    <FlagSvg>
      <rect width="14" height="10" fill="#B22234" rx="1" />
      <rect y="1.1" width="14" height="1.1" fill="#fff" />
      <rect y="3.3" width="14" height="1.1" fill="#fff" />
      <rect y="5.5" width="14" height="1.1" fill="#fff" />
      <rect y="7.7" width="14" height="1.1" fill="#fff" />
      <rect width="6" height="5.5" fill="#3C3B6E" rx="1" />
    </FlagSvg>
  );
}

export function FlagCnIcon() {
  return (
    <FlagSvg>
      <rect width="14" height="10" fill="#DE2910" rx="1" />
      <path
        fill="#FFDE00"
        d="M3.2 2.2 3.5 3.2H4.5L3.7 3.8l.3 1-.8-.6-.8.6.3-1-.8-.6h1z"
      />
    </FlagSvg>
  );
}

export function FlagEuIcon() {
  return (
    <FlagSvg>
      <rect width="14" height="10" fill="#003399" rx="1" />
      <g fill="#FFCC00">
        <circle cx="7" cy="2.2" r="0.45" />
        <circle cx="9.2" cy="3" r="0.45" />
        <circle cx="10" cy="5" r="0.45" />
        <circle cx="9.2" cy="7" r="0.45" />
        <circle cx="7" cy="7.8" r="0.45" />
        <circle cx="4.8" cy="7" r="0.45" />
        <circle cx="4" cy="5" r="0.45" />
        <circle cx="4.8" cy="3" r="0.45" />
      </g>
    </FlagSvg>
  );
}

export function CheckIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function CloseIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function ArrowUpIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Svg>
  );
}

export function ArrowDownIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Svg>
  );
}

export function BoltIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </Svg>
  );
}

/** Magic wand — prompt enhancement (gateway). */
export function WandIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4" />
      <path d="M19 14v4" />
      <path d="M10 2v2" />
      <path d="M7 8H3" />
      <path d="M21 16h-4" />
      <path d="M11 3H9" />
    </Svg>
  );
}

export function StarIcon({ size, filled }: { size?: number; filled?: boolean }) {
  return (
    <Svg size={size} filled={filled}>
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </Svg>
  );
}

export function ChatIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Svg>
  );
}

export function BotIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </Svg>
  );
}

export function PlanIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </Svg>
  );
}

export function BugIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M6 13c-2.33 2.33-2.7 4.7-2 6" />
      <path d="M6 13c2.33 2.33 2.7 4.7 2 6" />
      <path d="M17.47 9c1.93-.2 3.53-1.9 3.53-4" />
      <path d="M18 13h4" />
      <path d="M18 13c2.33 2.33 2.7 4.7 2 6" />
      <path d="M18 13c-2.33 2.33-2.7 4.7-2 6" />
    </Svg>
  );
}

export function TrashIcon({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}

export function PlayIcon({ size }: { size?: number }) {
  return (
    <Svg size={size} filled>
      <polygon points="10,8 16,12 10,16" stroke="none" />
    </Svg>
  );
}

/** Partial arc used with `.todo-spin` for in-progress todo status. */
export function LoaderIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 2a10 10 0 0 1 10 10" />
    </Svg>
  );
}

/** Filled send arrow, sized for the round send button. */
/** Filled microphone, sized for the round send/mic button. */
export function MicIcon() {
  return (
    <svg className="send-btn-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1Z"
      />
      <path
        fill="currentColor"
        d="M3.5 6.5a.75.75 0 0 1 .75.75v.25a3.75 3.75 0 0 0 7.5 0v-.25a.75.75 0 0 1 1.5 0v.25a5.25 5.25 0 0 1-4.5 5.2v1.55h1.75a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1 0-1.5h1.75v-1.55a5.25 5.25 0 0 1-4.5-5.2v-.25a.75.75 0 0 1 .75-.75Z"
      />
    </svg>
  );
}

/** Filled stop square, sized for the round stop button. */
export function StopIcon() {
  return (
    <svg className="send-btn-icon send-btn-icon-stop" viewBox="0 0 16 16" aria-hidden="true">
      <rect fill="currentColor" x="4" y="4" width="8" height="8" rx="1.25" />
    </svg>
  );
}
