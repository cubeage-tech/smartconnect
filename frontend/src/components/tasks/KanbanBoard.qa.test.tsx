import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanBoard } from './KanbanBoard';

/** QA M5 — inline "Add task" shows what it is doing straight away. */
describe('QA M5 — board quick add feedback', () => {
  it('clears the input and shows an "Adding" placeholder until the task exists; puts the title back if refused', async () => {
    let settle!: (ok: boolean) => void;
    const onQuickAdd = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    render(<KanbanBoard tasks={[]} canCreate onOpen={vi.fn()} onMove={vi.fn()} onQuickAdd={onQuickAdd} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Add task/ })[0]);
    const input = screen.getByRole('textbox', { name: /New task in/ });
    fireEvent.change(input, { target: { value: 'Write release notes' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('Adding “Write release notes”…');
    expect(input).toHaveValue('');
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    await act(async () => settle(false));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(input).toHaveValue('Write release notes');
  });
});
