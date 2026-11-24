import { BrandMark } from './Brand';

/**
 * Full-page loading state (T.32): the logo's "S" emblem and a thin
 * indeterminate bar — calm, no bouncing dots. Announced to assistive tech.
 * The emblem rather than the full logo: this screen is usually up for a
 * moment only, and the small emblem image is there in time, in both themes.
 */
export const LoadingScreen = ({ label = 'Loading SmartConnect…' }: { label?: string }) => (
  <div role="status" aria-live="polite" className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-surface-secondary">
    <BrandMark size="lg" decorative className="animate-pop-in" />
    <div className="h-1 w-32 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
      <div className="loading-bar h-full w-1/3 rounded-full bg-brand" />
    </div>
    <span className="sr-only">{label}</span>
  </div>
);
