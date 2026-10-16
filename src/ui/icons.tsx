/**
 * The app's one icon set: simple geometric glyphs on a 24 px grid, 2 px strokes, `currentColor` so tokens decide
 * colour. No game art is copied. Pair icons with a word in tabs, buttons and first-use places.
 *
 *   <Icon name="isk" />                      decorative (aria-hidden)
 *   <Icon name="lock" title="Private" />     meaningful (role="img" with a title)
 *   <ResourceIcon kind="morphite" />         mineral/material icon in its card colour
 *   <FactionGlyph faction="caldari" />       ▲ ◆ ● ■ in the faction colour
 *   <DieFace die="black" face="aimDamage" /> a die face tile, as printed (white tiles light, black tiles dark)
 */
import type { ReactNode, SVGProps } from 'react';
import type { BlackFace, FactionId, ResourceKey, WhiteFace } from '../data/types';

/** An n-pointed star path (outer radius R, inner r), first point straight up. */
function burst(cx: number, cy: number, R: number, r: number, n: number): string {
  const pts: string[] = [];
  for (let k = 0; k < n * 2; k++) {
    const a = (Math.PI * k) / n - Math.PI / 2;
    const rad = k % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
}

const solid = { fill: 'currentColor', stroke: 'none' } as const;
const tint = { fill: 'currentColor', fillOpacity: 0.28 } as const;

const AIM = (
  <>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" />
    <circle cx="12" cy="12" r="1.3" {...solid} />
  </>
);
const DAMAGE = <path d={burst(12, 12, 10.5, 4.6, 8)} {...solid} />;
const CRIT = (
  <>
    <path d={`${burst(12, 12, 10.5, 5.4, 8)}${circlePath(12, 12, 3.4)}`} fillRule="evenodd" {...solid} />
    <circle cx="12" cy="12" r="1.5" {...solid} />
  </>
);

const PATHS = {
  /* Resources */
  isk: (
    <>
      <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" />
      <path d="M12 8.2 15.3 10.1v3.8L12 15.8 8.7 13.9v-3.8z" {...solid} />
    </>
  ),
  vp: <path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.6l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" {...tint} />,
  pyrite: (
    <>
      <path d="M4 9.5h11v11H4zM4 9.5 8.5 4h11L15 9.5M19.5 4v11L15 20.5" {...tint} />
      <path d="M4 9.5 8.5 4h11v11L15 20.5H4z" />
    </>
  ),
  mexallon: (
    <>
      <path d="M12 2.5 17 8v9l-5 4.5L7 17V8z" {...tint} />
      <path d="M12 2.5v19M7 8l5 3 5-3" />
    </>
  ),
  tritanium: (
    <>
      <path d="M2.5 17.5 6.5 8h11l4 9.5z" {...tint} />
      <path d="M6.5 8 9 13h6l2.5-5M9 13l-6.5 4.5M15 13l6.5 4.5" />
    </>
  ),
  morphite: <path d="M3.5 20.5 6.5 9l3.2 4.5L12 2.5l2.3 11L17.5 9l3 11.5z" {...tint} />,
  planetary: (
    <>
      <circle cx="12" cy="12" r="5.5" {...tint} />
      <ellipse cx="12" cy="12" rx="10.5" ry="3.4" transform="rotate(-20 12 12)" />
    </>
  ),
  moon: <path d="M19.5 15A8.5 8.5 0 1 1 9 4.5a7 7 0 0 0 10.5 10.5z" {...tint} />,
  component: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" {...solid} />
      <path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
    </>
  ),
  research: (
    <>
      <path d="M9 3h6M10 3v6l-5.3 9.6A1.6 1.6 0 0 0 6.1 21h11.8a1.6 1.6 0 0 0 1.4-2.4L14 9V3" />
      <path d="M7.2 15h9.6l2 3.6A1.6 1.6 0 0 1 17.9 21H6.1a1.6 1.6 0 0 1-1.4-2.4z" {...tint} />
    </>
  ),
  bp: (
    <>
      <path d="M4 20.5v-17l17 17z" {...tint} />
      <path d="M8 16.5v-5l5 5z" />
    </>
  ),
  cube: <rect x="5" y="5" width="14" height="14" rx="2" />,
  cubeFilled: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />,
  /* A development card (portrait); rotated 90° when tapped, like the physical card */
  devCard: (
    <>
      <rect x="5.5" y="2.5" width="13" height="19" rx="2" {...tint} />
      <path d="M9 7.5h6M9 11h6M9 14.5h3.5" />
    </>
  ),

  /* Dice glyphs (also used inline in card text) */
  aim: AIM,
  damage: DAMAGE,
  crit: CRIT,

  /* Actions */
  move: <path d="M12 3.5 19.5 19 12 15.2 4.5 19z" {...tint} />,
  claim: <path d="M5.5 21V3.5M5.5 4h12l-2.5 4.5 2.5 4.5h-12" />,
  extract: (
    <>
      <path d="M12 2.5v8.5M8.5 7.5 12 11l3.5-3.5" />
      <path d="M4.5 21 7 15.5h10l2.5 5.5z" {...tint} />
    </>
  ),
  trade: <path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5M20 16H5M8.5 12.5 5 16l3.5 3.5" />,
  manufacture: (
    <>
      <path d="M3 20.5V10.5l5 3.2v-3.2l5 3.2V4h5.5v16.5z" {...tint} />
      <path d="M1.5 20.5h21" />
    </>
  ),
  build: (
    <>
      <path d="M4 20l8.5-8.5" />
      <path d="M10 8 15 3l6 6-5 5z" {...tint} />
    </>
  ),
  pass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12h9" />
    </>
  ),
  endTurn: <path d="M3.5 12h12M11 6.5l5.5 5.5-5.5 5.5M20.5 5v14" />,

  /* Tabs */
  panel: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 9.5v11" />
    </>
  ),
  table: (
    <>
      <rect x="6.5" y="7" width="11" height="10" rx="2" {...tint} />
      <path d="M9.5 3.5h5M9.5 20.5h5M3 10.5v3M21 10.5v3" />
    </>
  ),
  combat: <path d="M4 4l11 11M20 4 9 15M6 14.5l3.5 3.5M18 14.5 14.5 18M3.5 20.5l3-3M20.5 20.5l-3-3" />,
  reference: (
    <>
      <path d="M5 18.5V5a2 2 0 0 1 2-2h12v14H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12" />
      <path d="M9 7.5h6" />
    </>
  ),

  /* Interface */
  more: (
    <>
      <circle cx="12" cy="5" r="1.7" {...solid} />
      <circle cx="12" cy="12" r="1.7" {...solid} />
      <circle cx="12" cy="19" r="1.7" {...solid} />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  warn: <path d="M12 3.5 21.5 20h-19zM12 10v4.5M12 17.3v.2" />,
  danger: (
    <>
      <path d="M8.3 2.5h7.4l5.8 5.8v7.4l-5.8 5.8H8.3l-5.8-5.8V8.3z" />
      <path d="M12 7.5v5.5M12 16.3v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.7v.2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 16.8v.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5v-3a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 5.7A10 10 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6A16.5 16.5 0 0 0 2 12s3.5 6.5 10 6.5a9.6 9.6 0 0 0 5.4-1.6" />
      <path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  clockwise: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  chevronUp: <path d="M5 15l7-7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  qr: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 19.5v1M19.5 14v1.5" />
    </>
  ),
  swap: <path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4" />,
  shuffle: <path d="M3 7h3.5c5 0 6 10 11 10H21M18 14l3 3-3 3M3 17h3.5c1.8 0 3-1.3 4-3M13.5 10c1-1.7 2.2-3 4-3H21M18 4l3 3-3 3" />,
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.6" cy="8.6" r="1.4" {...solid} />
      <circle cx="12" cy="12" r="1.4" {...solid} />
      <circle cx="15.4" cy="15.4" r="1.4" {...solid} />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" {...tint} />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  leave: <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16.5 5.5 12 10 7.5M5.5 12H15" />,
  crown: <path d="M3.5 8l4.5 4 4-7 4 7 4.5-4-2 11h-13z" {...tint} />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  offline: (
    <path d="M2.5 8.5a14 14 0 0 1 5-3M11 4.6a14 14 0 0 1 10.5 3.9M5.5 12a9.5 9.5 0 0 1 4-2.2M14.5 9.8a9.5 9.5 0 0 1 4 2.2M8.5 15.5a5 5 0 0 1 7 0M12 19.5v.2M3 3l18 18" />
  ),
  hourglass: <path d="M6.5 3h11M6.5 21h11M8 3v3.5l4 5.5-4 5.5V21M16 3v3.5L12 12l4 5.5V21" />,
  first: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9l2.5-1.5V17" />
    </>
  ),
  home: <path d="M4 11 12 4l8 7M6 9.5V20h12V9.5" />,
  /* Structures on the board (the Table's counts): a station with an antenna */
  structure: (
    <>
      <path d="M3.5 20.5h17M12 10.5V4M9.5 6h5" />
      <path d="M6 20.5v-10h12v10" {...tint} />
    </>
  ),
  /* The central (Tier-3) system: a target */
  central: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" {...tint} />
      <circle cx="12" cy="12" r="1.6" {...solid} />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  /* A balance: house rule interpretations */
  ruling: (
    <>
      <path d="M12 3.5V20M8 20.5h8M4.5 7h15" />
      <path d="M4.5 7 2 13.5h5zM19.5 7 17 13.5h5z" {...tint} />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixels (number) or any CSS length; defaults to 1.5em so icons follow the text size. */
  size?: number | string;
  /** Accessible name; without it the icon is decorative. */
  title?: string;
}

export function Icon({ name, size = '1.5em', title, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className === undefined ? 'icon' : `icon ${className}`}
      role={title === undefined ? undefined : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {title !== undefined && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

const RESOURCE_TITLE: Record<ResourceKey | 'vp', string> = {
  isk: 'ISK',
  vp: 'VP',
  pyrite: 'Pyrite',
  mexallon: 'Mexallon',
  tritanium: 'Tritanium',
  morphite: 'Morphite',
  planetary: 'Planetary',
  moon: 'Moon',
  component: 'Component',
};

/** A resource icon in its own colour (minerals in their card colours). */
export function ResourceIcon({ kind, size, title }: { kind: ResourceKey | 'vp'; size?: number | string; title?: string | null }) {
  return (
    <Icon
      name={kind}
      size={size}
      className={`res-icon res-${kind}`}
      title={title === null ? undefined : (title ?? RESOURCE_TITLE[kind])}
    />
  );
}

const GLYPH: Record<FactionId, ReactNode> = {
  amarr: <path d="M12 3 22 20.5H2z" />,
  caldari: <path d="M12 2 22 12 12 22 2 12z" />,
  gallente: <circle cx="12" cy="12" r="9.5" />,
  minmatar: <rect x="3.5" y="3.5" width="17" height="17" rx="1" />,
};

/** The faction's shape (Amarr ▲, Caldari ◆, Gallente ●, Minmatar ■), filled in the faction colour. */
export function FactionGlyph({ faction, size = '1.25em', title }: { faction: FactionId; size?: number | string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="faction-glyph"
      data-faction={faction}
      fill="currentColor"
      role={title === undefined ? undefined : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
      focusable="false"
    >
      {title !== undefined && <title>{title}</title>}
      {GLYPH[faction]}
    </svg>
  );
}

export type DieColor = 'white' | 'black';
export type Face = WhiteFace | BlackFace;

export const FACE_LABEL: Record<Face, string> = {
  blank: 'Blank',
  aim: 'Aim',
  aim2: 'Double aim',
  damage: 'Damage',
  damage2: 'Double damage',
  crit: 'Critical hit',
  aimDamage: 'Aim and damage',
};

const FACE_GLYPHS: Record<Face, ReactNode[]> = {
  blank: [],
  aim: [AIM],
  damage: [DAMAGE],
  crit: [CRIT],
  aim2: [AIM, AIM],
  damage2: [DAMAGE, DAMAGE],
  aimDamage: [AIM, DAMAGE],
};

/**
 * A die face as printed: white dice are light tiles with a dark glyph, black dice dark tiles with a light glyph and a
 * hairline border (so they don't vanish on the dark UI). Double faces show the glyph twice, side by side.
 */
export function DieFace({ face, die, size = 48, title }: { face: Face; die: DieColor; size?: number | string; title?: string | null }) {
  const glyphs = FACE_GLYPHS[face];
  const label = title === null ? undefined : (title ?? `${die === 'white' ? 'White' : 'Black'} die: ${FACE_LABEL[face]}`);
  const place = glyphs.length === 1 ? [{ x: 24, y: 24, s: 1.45 }] : [{ x: 14, y: 24, s: 0.82 }, { x: 34, y: 24, s: 0.82 }];
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`die-face die-${die}`}
      role={label === undefined ? undefined : 'img'}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      focusable="false"
    >
      {label !== undefined && <title>{label}</title>}
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="9"
        style={{ fill: die === 'white' ? 'var(--die-white)' : 'var(--die-black)', stroke: die === 'white' ? 'none' : 'var(--line-strong)' }}
        strokeWidth="1.5"
      />
      <g
        style={{ color: die === 'white' ? 'var(--die-white-ink)' : 'var(--die-black-ink)' }}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyphs.map((g, i) => (
          <g key={i} transform={`translate(${place[i]!.x} ${place[i]!.y}) scale(${place[i]!.s}) translate(-12 -12)`}>
            {g}
          </g>
        ))}
      </g>
    </svg>
  );
}
