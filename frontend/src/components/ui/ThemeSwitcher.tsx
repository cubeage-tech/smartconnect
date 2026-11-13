import { Monitor, Moon, Sun } from 'lucide-react';
import { KeyboardEvent, useRef } from 'react';
import { setThemePreference, ThemePreference, useThemePreference } from '../../lib/theme';
import { focusRing } from './Button';

const OPTIONS: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

const SIZES = {
  md: { button: 'min-h-10 gap-1.5 rounded-lg text-sm', icon: 15 },
  sm: { button: 'min-h-8 gap-1.5 rounded-md text-xs', icon: 14 },
} as const;

interface ThemeSwitcherProps {
  /** md: phone settings screens; sm: sidebars and menus. */
  size?: keyof typeof SIZES;
  /** Icons only (named and tooltipped) — for tight top bars. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Light / Dark / System. The choice, its storage and how it is applied all
 * live in lib/theme — this is only the control, so every copy stays in sync.
 * A radio group: arrow keys, Home and End move the choice, Tab leaves it.
 */
export const ThemeSwitcher = ({ size = 'md', iconOnly = false, className = '' }: ThemeSwitcherProps) => {
  const preference = useThemePreference();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (index: number) => {
    setThemePreference(OPTIONS[index].id);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = OPTIONS.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    choose(next);
  };

  const { button, icon } = SIZES[size];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`grid grid-cols-3 bg-surface-secondary ${iconOnly ? 'gap-0.5 rounded-lg p-0.5' : 'gap-1 rounded-xl p-1'} ${className}`}
    >
      {OPTIONS.map((option, index) => {
        const checked = preference === option.id;
        return (
          <button
            key={option.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconOnly ? option.label : undefined}
            title={iconOnly ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`flex select-none items-center justify-center font-medium transition-colors ${button} ${iconOnly ? 'min-w-8 px-1.5' : 'px-2'} ${focusRing} ${
              checked ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <option.icon size={icon} aria-hidden="true" className="shrink-0" />
            {!iconOnly && option.label}
          </button>
        );
      })}
    </div>
  );
};
