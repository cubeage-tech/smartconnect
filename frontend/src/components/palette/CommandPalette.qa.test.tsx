import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), defaults: { headers: { common: {} } } }));
vi.mock('axios', () => ({ default: axiosMock }));

import { setPeople } from '../../lib/people';
import { CommandPalette } from './CommandPalette';

/** QA M7 — channels on screen and known people match as you type, before the server answers. */
afterEach(() => act(() => setPeople([])));

describe('QA M7 — instant local matches in the search palette', () => {
  it('"gen" shows #General and matching people at once, while the server search is still running', async () => {
    axiosMock.get.mockImplementation(() => new Promise(() => undefined)); // server never answers in this test
    act(() => setPeople([{ id: 'u1', username: 'gena.r', displayName: 'Gena Rao' }]));
    render(
      <MemoryRouter>
        <CommandPalette workspaceId="ws" onMessagePerson={vi.fn()} channels={[{ id: 'c1', name: 'General' }, { id: 'c2', name: 'Random' }, { id: 'd1', name: 'gen.dm', isDM: true }]} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'gen' } });
    expect(await screen.findByRole('option', { name: /General/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Gena Rao/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Random/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /gen\.dm/ })).not.toBeInTheDocument(); // DMs are not channels
  });
});
