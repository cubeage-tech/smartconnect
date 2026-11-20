import { AdminPageHeader } from './AdminPageHeader';
import axios from 'axios';
import { FileText, Hash, Loader2, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { displayNameOf } from '../../lib/people';
import { sanitizeMessageHtml } from '../../lib/sanitizeHtml';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface SearchResultMessage {
  id: string;
  content: string | null;
  fileName: string | null;
  createdAt: string;
  sender: { id: string; username: string; profile?: { displayName: string | null } | null };
  channel: { id: string; name: string | null; workspace?: { id: string; name: string } | null };
}

export const MessageModeration = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // QA L36: the app's own confirmation dialog, not the browser's confirm().
  const [confirming, setConfirming] = useState<SearchResultMessage | null>(null);

  const flash = (setter: (v: string | null) => void, text: string) => {
    setter(text);
    setTimeout(() => setter(null), 3000);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await axios.get<SearchResultMessage[]>('/api/admin/messages/search', { params: { q: query.trim() } });
      setResults(res.data);
    } catch (err) {
      console.error('Failed to search messages', err);
      flash(setError, 'Failed to search messages');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (message: SearchResultMessage) => {
    setConfirming(null);
    setDeletingId(message.id);
    try {
      await axios.delete(`/api/admin/messages/${message.id}`);
      setResults(prev => prev.filter(m => m.id !== message.id));
      flash(setSuccess, 'Message deleted');
    } catch (err: any) {
      flash(setError, err.response?.data?.error || 'Failed to delete message');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-8 h-full flex flex-col bg-gray-50">
      <AdminPageHeader title="Content Moderation" description="Search every channel for a message and remove it instantly — direct messages are never included." />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg font-medium">{error}</div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg font-medium">{success}</div>
      )}

      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search message content across all channels..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 text-sm rounded-lg pl-10 pr-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 transition-all shadow-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-6 py-3 bg-violet-600 text-white font-bold rounded-lg hover:bg-violet-700 transition-all disabled:opacity-50 flex items-center gap-2 text-sm shrink-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Search
        </button>
      </form>

      <div className="flex-1 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-y-auto flex-1">
          {!searched ? (
            <div className="py-16 text-center text-gray-400 font-medium text-sm">
              Enter a search term to find messages across the workspace.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-violet-500" size={28} />
            </div>
          ) : results.length === 0 ? (
            <div className="py-16 text-center text-gray-500 font-medium text-sm uppercase tracking-wider">
              No matching messages found
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {results.map((m) => (
                <div key={m.id} className="px-6 py-4 flex items-start gap-4 hover:bg-gray-50 transition-colors group">
                  <Avatar name={displayNameOf({ username: m.sender.username, displayName: m.sender.profile?.displayName })} userId={m.sender.id} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold text-gray-900">{displayNameOf({ username: m.sender.username, displayName: m.sender.profile?.displayName })}</span>
                      {/* QA H6: which workspace's channel (several are called "General"). */}
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200 flex items-center gap-1">
                        {m.channel.workspace?.name && <>{m.channel.workspace.name} ›</>} <Hash size={10} aria-hidden="true" /> {m.channel.name ?? 'unknown'}
                      </span>
                    </div>
                    {m.content ? (
                      // QA H6: the message as people saw it — rendered through the
                      // same sanitizer as the chat (formatting kept, nothing
                      // unsafe), never the stored markup as text.
                      <div className="rich-text text-sm text-gray-700 break-words line-clamp-6" dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(m.content) }} />
                    ) : (
                      <p className="text-sm text-gray-400 italic flex items-center gap-1.5">
                        <FileText size={13} /> {m.fileName ? `Attachment: ${m.fileName}` : 'No text content'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400 font-medium whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirming(m)}
                      disabled={deletingId === m.id}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50"
                      title="Delete message"
                      aria-label="Delete message"
                    >
                      {deletingId === m.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Delete message?"
          message={`This removes the message from #${confirming.channel.name ?? 'channel'} for everyone, instantly.`}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => handleDelete(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
};
