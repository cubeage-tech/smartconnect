import { describe, expect, it } from 'vitest';
import { readableDetails } from './AuditLogViewer';

/** QA L43 — audit entries read as sentences. */
describe('QA L43 — readableDetails', () => {
  it('shows ISO timestamps as local dates and the user id an entry is about as @name', () => {
    const text = readableDetails({
      details: 'Provisioned Team Lead "sam" (login s@x.io); invitation expires 2026-11-20T10:36:14.300Z for user 7bd7b365-bb66-49a6-89c9-e1d3f930e405',
      targetId: '7bd7b365-bb66-49a6-89c9-e1d3f930e405',
      targetLabel: 'sam.karale',
    });
    expect(text).not.toMatch(/2026-11-20T10:36:14\.300Z/);
    expect(text).toMatch(/2026/);
    expect(text).toContain('@sam.karale');
    expect(text).not.toContain('7bd7b365-bb66-49a6-89c9-e1d3f930e405');
  });

  it('leaves details alone when there is nothing to resolve', () => {
    expect(readableDetails({ details: 'Deleted channel #old', targetId: null, targetLabel: null })).toBe('Deleted channel #old');
  });
});
