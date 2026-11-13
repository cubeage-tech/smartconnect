import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setThemePreference, THEME_STORAGE_KEY } from '../../lib/theme';
import { ThemeSwitcher } from './ThemeSwitcher';

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
});

const radio = (name: string, scope: HTMLElement = document.body) => within(scope).getByRole('radio', { name });

describe('ThemeSwitcher', () => {
  it('shows the saved choice as the checked radio, and only that one is in the tab order', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeSwitcher />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked'), r.tabIndex])).toEqual([
      ['Light', 'false', -1],
      ['Dark', 'true', 0],
      ['System', 'false', -1],
    ]);
  });

  it('applies a click at once and remembers it for the next visit', () => {
    render(<ThemeSwitcher />);
    fireEvent.click(radio('Dark'));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(radio('Light'));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('moves with the arrow keys, Home and End, wrapping like any radio group', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeSwitcher />);
    fireEvent.keyDown(radio('Light'), { key: 'ArrowRight' });
    expect(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Dark')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // wraps to the first
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); // wraps to the last
    expect(radio('System')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('stays in sync with every other switcher and with changes made elsewhere', () => {
    render(
      <>
        <div data-testid="a"><ThemeSwitcher /></div>
        <div data-testid="b"><ThemeSwitcher iconOnly /></div>
      </>
    );
    act(() => void setThemePreference('dark'));
    expect(radio('Dark', screen.getByTestId('a'))).toHaveAttribute('aria-checked', 'true');
    expect(radio('Dark', screen.getByTestId('b'))).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(radio('System', screen.getByTestId('b')));
    expect(radio('System', screen.getByTestId('a'))).toHaveAttribute('aria-checked', 'true');
  });

  it('icon-only still names every option and gives it a tooltip', () => {
    render(<ThemeSwitcher iconOnly />);
    expect(radio('System')).toHaveAttribute('title', 'System');
    expect(radio('System')).not.toHaveTextContent('System');
  });
});
