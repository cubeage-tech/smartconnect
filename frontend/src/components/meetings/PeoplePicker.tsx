import { Check, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listWorkspaceMembers } from '../../lib/api/workspaces';
import { nameIn, usePeopleDirectory } from '../../lib/people';
import { WorkspaceMember } from '../../types';
import { TextInput } from '../ui';
import { Avatar } from '../ui/Avatar';

interface PeoplePickerProps {
  workspaceId: string;
  /** People who can't be picked (yourself, people already invited). */
  excludeIds: string[];
  selected: WorkspaceMember[];
  onChange: (selected: WorkspaceMember[]) => void;
  legend?: string;
}

/**
 * Pick people from the workspace member directory (the same endpoint as the
 * People page, so only members are ever offered). Shows names only.
 */
export const PeoplePicker = ({ workspaceId, excludeIds, selected, onChange, legend = 'Invite people' }: PeoplePickerProps) => {
  const people = usePeopleDirectory();
  const nameOf = (m: WorkspaceMember) => nameIn(people, { id: m.id, username: m.username });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceMember[]>([]);
  const [searching, setSearching] = useState(true);
  const excluded = excludeIds.join(',');

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      listWorkspaceMembers(workspaceId, { q: query.trim() || undefined, limit: 20 })
        .then((page) => !cancelled && setResults(page.items.filter((m) => !excluded.split(',').includes(m.id))))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, workspaceId, excluded]);

  const toggle = (member: WorkspaceMember) =>
    onChange(selected.some((m) => m.id === member.id) ? selected.filter((m) => m.id !== member.id) : [...selected, member]);

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-fg">{legend}</legend>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((m) => (
            <li key={m.id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 text-sm text-brand">
              {nameOf(m)}
              <button type="button" onClick={() => toggle(m)} aria-label={`Remove ${nameOf(m)}`} className="rounded-full p-0.5 hover:bg-brand/10">
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people in this workspace" aria-label="Search people" className="pl-9" />
      </div>
      <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-line" aria-label="People" aria-busy={searching}>
        {results.length === 0 && <li className="px-3 py-2.5 text-sm text-fg-muted">{searching ? 'Searching…' : 'No one found.'}</li>}
        {results.map((m) => {
          const isSelected = selected.some((s) => s.id === m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                onClick={() => toggle(m)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-secondary"
              >
                <Avatar name={nameOf(m)} userId={m.id} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {nameOf(m)}
                  {m.title && <span className="text-fg-muted"> · {m.title}</span>}
                </span>
                {isSelected && <Check size={15} className="text-brand" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
};
