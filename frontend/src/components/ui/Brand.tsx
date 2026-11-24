/**
 * SmartConnect branding: the official logo, frontend/public/logo.png. That
 * file is the master. The images shown here are derived from it by
 * scripts/generate-brand-assets.mjs, which crops and downscales without
 * redrawing or recolouring: the full logo with its empty margins trimmed, and
 * its "S" emblem on its own. Re-run the script after replacing logo.png.
 *
 * Which form goes where:
 *  - BrandLogo: the full logo (emblem, wordmark and tagline), where there is
 *    room for it to stay readable and a light surface: sign-in and password
 *    screens. Its wordmark is near-black, so in the dark theme it would
 *    disappear; there it falls back to BrandLockup. There is no official
 *    light-on-dark version of the logo, and the artwork is not recoloured.
 *  - BrandLockup: the emblem with the name as text. Used on dark surfaces
 *    (the app header, the sign-in brand panel) and where the full logo would
 *    be too small to read.
 *  - BrandMark: the emblem alone.
 *
 * Sizes are defined once here, so every screen uses the same few.
 */

const LOGO_SRC = '/brand/smartconnect-logo.png';
const MARK_SRC = '/brand/smartconnect-mark.png';
/** Width ÷ height of LOGO_SRC (781 × 192). */
const LOGO_ASPECT = 781 / 192;

type BrandSize = 'sm' | 'md' | 'lg';

/** Emblem box, in CSS px. */
const MARK_PX: Record<BrandSize, number> = { sm: 24, md: 30, lg: 44 };
const NAME_CLASS: Record<BrandSize, string> = { sm: 'text-[13px]', md: 'text-[15px]', lg: 'text-lg' };
const GAP_CLASS: Record<BrandSize, string> = { sm: 'gap-2', md: 'gap-2.5', lg: 'gap-3' };
/** Full-logo height, in CSS px. Below about 52 px its tagline stops being readable. */
const LOGO_PX = { md: 56, lg: 64 } as const;

/** Name colour for the surface it sits on. */
const TONE_CLASS = { default: 'text-fg', sidebar: 'text-sidebar-fg', inverse: 'text-white' } as const;

/**
 * The "S" emblem. `decorative` when the name is shown as text right beside it,
 * so screen readers don't hear "SmartConnect" twice.
 */
export const BrandMark = ({ size = 'md', decorative = false, className = '' }: { size?: BrandSize; decorative?: boolean; className?: string }) => (
  <img
    src={MARK_SRC}
    width={MARK_PX[size]}
    height={MARK_PX[size]}
    alt={decorative ? '' : 'SmartConnect'}
    draggable={false}
    className={`shrink-0 select-none object-contain ${className}`}
  />
);

/** Emblem plus the name as text: dark surfaces and tight spaces. */
export const BrandLockup = ({
  size = 'md',
  tone = 'default',
  className = '',
}: {
  size?: BrandSize;
  tone?: keyof typeof TONE_CLASS;
  className?: string;
}) => (
  <span className={`inline-flex items-center ${GAP_CLASS[size]} ${className}`}>
    <BrandMark size={size} decorative />
    <span className={`${NAME_CLASS[size]} font-semibold tracking-[-0.01em] ${TONE_CLASS[tone]}`}>SmartConnect</span>
  </span>
);

/**
 * The full official logo on light surfaces. In the dark theme it swaps for
 * BrandLockup at the same size step (see the note at the top of this file).
 */
export const BrandLogo = ({ size = 'md', className = '' }: { size?: keyof typeof LOGO_PX; className?: string }) => (
  <span className={`flex ${className}`}>
    <img
      src={LOGO_SRC}
      width={Math.round(LOGO_PX[size] * LOGO_ASPECT)}
      height={LOGO_PX[size]}
      alt="SmartConnect"
      draggable={false}
      // Narrow screens shrink it proportionally (max-w-full + h-auto keep the aspect ratio).
      className="block h-auto max-w-full select-none object-contain dark:hidden"
    />
    <span className="hidden dark:inline-flex">
      <BrandLockup size={size} />
    </span>
  </span>
);
