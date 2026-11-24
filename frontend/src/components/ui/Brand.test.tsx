import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, BrandLogo, BrandMark } from './Brand';

/**
 * The official logo (public/logo.png) as the UI shows it: derived images
 * served from /brand/, proportions kept, and "SmartConnect" announced once.
 */
describe('SmartConnect branding', () => {
  it('BrandMark is the emblem image from /brand/, square at the named size, and silent when decorative', () => {
    const { rerender } = render(<BrandMark size="lg" />);
    const mark = screen.getByRole('img', { name: 'SmartConnect' });
    expect(mark).toHaveAttribute('src', '/brand/smartconnect-mark.png');
    expect(mark).toHaveAttribute('width', '44');
    expect(mark).toHaveAttribute('height', '44');
    expect(mark).toHaveClass('object-contain');

    rerender(<BrandMark size="sm" decorative />);
    expect(screen.queryByRole('img', { name: 'SmartConnect' })).not.toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('BrandLockup shows the name as text once, with the emblem beside it hidden from screen readers', () => {
    render(<BrandLockup size="sm" tone="sidebar" />);
    expect(screen.getByText('SmartConnect')).toHaveClass('text-sidebar-fg');
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); // the emblem is decorative here
  });

  it('BrandLogo shows the full logo at its own proportions, with the emblem-and-name version for the dark theme', () => {
    const { container, rerender } = render(<BrandLogo />);
    const logo = screen.getByRole('img', { name: 'SmartConnect' });
    expect(logo).toHaveAttribute('src', '/brand/smartconnect-logo.png');
    // Same width:height as the image file (781 × 192), so it is never stretched.
    expect(Number(logo.getAttribute('width')) / Number(logo.getAttribute('height'))).toBeCloseTo(781 / 192, 1);
    expect(logo).toHaveClass('dark:hidden', 'object-contain', 'max-w-full', 'h-auto');
    // The dark-theme version is present but hidden until the theme is dark.
    const darkVersion = container.querySelector('.dark\\:inline-flex');
    expect(darkVersion).toHaveClass('hidden');
    expect(darkVersion).toHaveTextContent('SmartConnect');

    rerender(<BrandLogo size="lg" />);
    expect(screen.getByRole('img', { name: 'SmartConnect' })).toHaveAttribute('height', '64');
  });
});
