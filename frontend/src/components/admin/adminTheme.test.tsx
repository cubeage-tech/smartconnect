import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../../lib/theme';
import { AdminLayout } from './AdminLayout';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('./AdminDashboard', () => ({ AdminDashboard: () => <p>Dashboard</p> }));

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
});

describe('Admin Panel theme', () => {
  it('offers Light / Dark / System in the sidebar (tablet and desktop) and the top bar (phones), kept in sync and remembered', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<AdminLayout />);
    const sidebar = screen.getByRole('complementary', { name: 'Administration' });
    const topBar = screen.getByRole('banner');
    const sidebarTheme = within(sidebar).getByRole('radiogroup', { name: 'Theme' });
    const topBarTheme = within(topBar).getByRole('radiogroup', { name: 'Theme' });
    expect(within(sidebarTheme).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(within(topBarTheme).getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(sidebarTheme).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(within(topBarTheme).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(topBarTheme).getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(within(sidebarTheme).getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps Sign out reachable by name in both places', () => {
    render(<AdminLayout />);
    expect(within(screen.getByRole('complementary', { name: 'Administration' })).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
