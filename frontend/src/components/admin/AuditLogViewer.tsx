import { AdminPageHeader } from './AdminPageHeader';
import axios from 'axios';
import { Loader2, Search, ShieldAlert } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useEffect, useState } from 'react';

interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: string;
  createdAt: string;
  actor: { id: string; username: string };
  /** QA L43: the current username of the user an entry is about. */
  targetLabel?: string | null;
}

interface AuditLogPage {
  logs: AuditLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  actions?: string[];
}

const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/g;
/**
 * QA L43: entries read as sentences — ISO timestamps written into details are
 * shown as local dates, and a user id the entry is about is shown as @name.
 * The stored record itself is unchanged.
 */
export const readableDetails = (log: Pick<AuditLogEntry, 'details' | 'targetId' | 'targetLabel'>) => {
  let text = log.details.replace(ISO_TIMESTAMP, (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  });
  if (log.targetId && log.targetLabel) text = text.split(log.targetId).join(`@${log.targetLabel}`);
  return text;
};

const ACTION_BADGE_STYLES: Record<string, string> = {
  BAN_USER: 'bg-red-100 text-red-700 border-red-200',
  SUSPEND_USER: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  REACTIVATE_USER: 'bg-green-100 text-green-700 border-green-200',
  CHANGE_ROLE: 'bg-purple-100 text-purple-700 border-purple-200',
  DELETE_USER: 'bg-red-100 text-red-700 border-red-200',
  FORCE_PASSWORD_RESET: 'bg-blue-100 text-blue-700 border-blue-200',
  DELETE_CHANNEL: 'bg-orange-100 text-orange-700 border-orange-200',
  DELETE_MESSAGE: 'bg-orange-100 text-orange-700 border-orange-200',
  DELETE_FILE: 'bg-orange-100 text-orange-700 border-orange-200',
};

const formatActionLabel = (action: string) =>
  action.split('_').map(w => w[0] + w.slice(1).toLowerCase()).join(' ');

export const AuditLogViewer = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // QA L43: filter by action type and search details / actor.
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const [actions, setActions] = useState<string[]>([]);

  const fetchPage = async (cursor?: string) => {
    try {
      const params = { ...(cursor ? { cursor } : {}), ...(action ? { action } : {}), ...(query.trim() ? { q: query.trim() } : {}) };
      const res = await axios.get<AuditLogPage>('/api/admin/audit-logs', { params });
      setLogs(prev => (cursor ? [...prev, ...res.data.logs] : res.data.logs));
      if (res.data.actions) setActions(res.data.actions);
      setNextCursor(res.data.nextCursor);
      setHasMore(res.data.hasMore);
    } catch (err) {
      console.error('Failed to fetch audit logs', err);
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void fetchPage(), query ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, query]);

  const handleLoadMore = () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    fetchPage(nextCursor);
  };

  return (
    <div className="p-8 h-full flex flex-col bg-gray-50">
      {/* QA L42 / L43: the shared header; the log covers the whole company, not one workspace. */}
      <AdminPageHeader title="Audit Logs" description="A permanent record of every administrative action across the company." />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search the audit log"
            placeholder="Search details or people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {formatActionLabel(a)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg font-medium flex items-center gap-2">
          <ShieldAlert size={16} /> {error}
        </div>
      )}

      <div className="flex-1 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-violet-500" size={28} />
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-gray-500 font-medium text-sm uppercase tracking-wider">
              {action || query ? 'No entries match these filters' : 'No admin actions recorded yet'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {logs.map((log) => (
                <div key={log.id} className="px-6 py-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                  <Avatar name={log.actor.username} userId={log.actor.id} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold text-gray-900">{log.actor.username}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${ACTION_BADGE_STYLES[log.action] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}
                      >
                        {formatActionLabel(log.action)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 break-words">{readableDetails(log)}</p>
                  </div>
                  <div className="text-xs text-gray-400 font-medium shrink-0 whitespace-nowrap mt-1">
                    {new Date(log.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasMore && (
          <div className="p-4 border-t border-gray-100 flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-5 py-2 text-sm font-bold text-violet-600 hover:bg-violet-50 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
