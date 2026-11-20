import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar, avatarColor } from '../components/ui/Avatar';
import { photoProblem } from '../components/profile/ProfileSettingsModal';
import { displayNameOf, initialsOf, nameIn, setPeople, updatePerson, usePersonName } from './people';

afterEach(() => act(() => setPeople([])));

describe('QA H4 — one display rule', () => {
  it('shows the display name, else the username, else a fallback', () => {
    expect(displayNameOf({ username: 'qa.normal.user', displayName: 'QA Normal User' })).toBe('QA Normal User');
    expect(displayNameOf({ username: 'qa.normal.user', displayName: '   ' })).toBe('qa.normal.user');
    expect(displayNameOf(null, 'Someone')).toBe('Someone');
  });

  it('resolves people by id from the directory, falling back to what the screen has', () => {
    act(() => setPeople([{ id: 'u1', username: 'sam.karale', displayName: 'Sam Karale' }]));
    const Name = ({ id, username }: { id: string; username: string }) => <span>{usePersonName({ id, username })}</span>;
    render(
      <>
        <Name id="u1" username="sam.karale" />
        <Name id="u2" username="someone.else" />
      </>
    );
    expect(screen.getByText('Sam Karale')).toBeInTheDocument();
    expect(screen.getByText('someone.else')).toBeInTheDocument();
    act(() => updatePerson('u1', { displayName: 'Samarth K' }));
    expect(screen.getByText('Samarth K')).toBeInTheDocument();
    expect(nameIn(new Map([['u1', { id: 'u1', username: 'sam.karale', displayName: 'Sam Karale' }]]), { id: 'u1', username: 'x' })).toBe('Sam Karale');
  });
});

describe('QA L8 / L9 — the same initials and colour for one person everywhere', () => {
  it('initials come from the words of the name', () => {
    expect(initialsOf('QA Normal User')).toBe('QN');
    expect(initialsOf('qa.normal.user')).toBe('QN');
    expect(initialsOf('Sam')).toBe('S');
    expect(initialsOf('Sam Karale', 1)).toBe('S');
    expect(initialsOf('')).toBe('?');
  });

  it('the avatar colour follows the person id, not the name string a screen happens to have', () => {
    const { container } = render(
      <>
        <Avatar name="sam.karale" userId="u1" />
        <Avatar name="Sam Karale" userId="u1" size="lg" />
      </>
    );
    const swatches = [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter((el) => el.style.backgroundColor);
    expect(swatches).toHaveLength(2);
    expect(swatches[0].style.backgroundColor).toBe(swatches[1].style.backgroundColor);
    expect(swatches[0].textContent).toBe(swatches[1].textContent); // "SK" in the header and the sidebar alike
    expect(avatarColor('u1')).toBe(avatarColor('u1'));
  });
});

describe('QA H4 — profile photo checks before upload', () => {
  it('accepts JPEG/PNG/WebP/GIF up to 5 MB only', () => {
    expect(photoProblem({ type: 'image/png', size: 1024 })).toBeNull();
    expect(photoProblem({ type: 'image/svg+xml', size: 1024 })).toMatch(/JPEG, PNG/);
    expect(photoProblem({ type: 'application/pdf', size: 1024 })).toMatch(/JPEG, PNG/);
    expect(photoProblem({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
  });
});
