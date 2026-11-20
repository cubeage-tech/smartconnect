import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageModeration } from './MessageModeration';

const http = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
vi.mock('axios', () => ({ default: http }));

/** QA H6 — moderation results show messages as people saw them, never raw markup. */
describe('QA H6 — Content Moderation', () => {
  it('renders the stored HTML safely (formatting kept, tags and scripts never shown) and names the workspace', async () => {
    http.get.mockResolvedValueOnce({
      data: [
        {
          id: 'm1',
          content: '<p><strong>[QA test] bold</strong> text</p><img src=x onerror="alert(1)"><script>alert(2)</script>',
          fileName: null,
          createdAt: new Date().toISOString(),
          sender: { id: 'u1', username: 'qa.normal.user', profile: { displayName: 'QA Normal User' } },
          channel: { id: 'c1', name: 'General', workspace: { id: 'w1', name: 'SmartConnect Collab' } },
        },
      ],
    });
    const { container } = render(<MessageModeration />);
    fireEvent.change(screen.getByPlaceholderText(/Search message content/), { target: { value: 'QA test' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));

    const bold = await screen.findByText('[QA test] bold');
    expect(bold.tagName).toBe('STRONG');
    expect(container.textContent).not.toMatch(/<p>|<strong>|<\/p>/);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(screen.getByText('QA Normal User')).toBeInTheDocument();
    expect(screen.getByText(/SmartConnect Collab ›/)).toBeInTheDocument();
  });

  it('asks in the app’s own dialog before deleting (QA L36)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    http.get.mockResolvedValueOnce({
      data: [{ id: 'm2', content: '<p>bad</p>', fileName: null, createdAt: new Date().toISOString(), sender: { id: 'u2', username: 'x' }, channel: { id: 'c1', name: 'General' } }],
    });
    http.delete.mockResolvedValueOnce({ data: {} });
    render(<MessageModeration />);
    fireEvent.change(screen.getByPlaceholderText(/Search message content/), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete message' }));
    expect(await screen.findByRole('dialog', { name: 'Delete message?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(http.delete).toHaveBeenCalledWith('/api/admin/messages/m2'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
