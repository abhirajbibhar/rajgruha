/**
 * Inline SVG icons.
 *
 * A handful of paths instead of an icon package: nothing to keep in sync with a
 * framework upgrade, no font file to load, and they inherit `currentColor` so
 * they always match the theme.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 18}
      height={size ?? 18}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={rest.className ?? 'icon'}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-5.5h5V20" />
  </Icon>
);

export const BookIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4.5h6.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H4z" />
    <path d="M20 4.5h-6.5A2.5 2.5 0 0 0 11 7v13a2 2 0 0 1 2-2h7z" />
  </Icon>
);

export const HighlighterIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 3.5 20.5 9.5 12 18H6l-2.5-2.5z" />
    <path d="M4 21h9" />
    <path d="M11 7 17 13" />
  </Icon>
);

export const NotebookIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="M12 8h5M12 12h5M12 16h3" />
  </Icon>
);

export const QuoteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 6C6.5 7.5 5 10 5 13v5h5v-6H7.5c0-2 .8-3.4 2.6-4.4z" />
    <path d="M19 6c-3 1.5-4.5 4-4.5 7v5h5v-6h-2.5c0-2 .8-3.4 2.6-4.4z" />
  </Icon>
);

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9.8 5a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.3 1z" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const MoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="5" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="12" cy="19" r="1.4" />
  </Icon>
);

export const StarIcon = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <Icon {...props} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6.5 7l.8 12.5a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    <path d="M10.5 11v6M13.5 11v6" />
  </Icon>
);

export const EditIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20h4L20 8l-4-4L4 16z" />
    <path d="M14.5 5.5 18.5 9.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 12.5 9.5 17.5 19.5 7" />
  </Icon>
);

export const CloudIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 18a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.6 1.6A3.5 3.5 0 0 1 17.5 18z" />
  </Icon>
);

export const UploadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v12" />
    <path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
    <path d="M4 19h16" />
  </Icon>
);

export const SparkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8L5.5 10l4.8-1.7z" />
    <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </Icon>
);

export const FlameIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3c3 3.5 5.5 6 5.5 9.5A5.5 5.5 0 0 1 12 18a5.5 5.5 0 0 1-5.5-5.5C6.5 9 9 6.5 12 3z" />
    <path d="M12 21a3 3 0 0 0 3-3c0-1.6-1.2-2.8-3-4.5-1.8 1.7-3 2.9-3 4.5a3 3 0 0 0 3 3z" />
  </Icon>
);

export const LibraryMark = (props: IconProps) => (
  <svg viewBox="0 0 64 64" width={props.size ?? 26} height={props.size ?? 26} aria-hidden="true" className={props.className}>
    <path d="M14 46V24l18-9 18 9v22" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinejoin="round" />
    <path d="M22 46V28h20v18" fill="none" stroke="var(--text)" strokeWidth="3.2" strokeLinejoin="round" />
    <path d="M32 28v18M22 37h20" stroke="var(--accent)" strokeWidth="2.4" />
  </svg>
);

export const EmptyBoxIcon = (props: IconProps) => (
  <Icon {...props} size={props.size ?? 40}>
    <path d="M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5z" />
    <path d="m3.5 8.5 8.5 4.5 8.5-4.5M12 13v7" />
  </Icon>
);
