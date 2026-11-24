import { formatDistanceToNowStrict } from 'date-fns';
import { Activity, Hash, Lock, MessageSquare, Search, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useFirstVisit } from '../../lib/firstVisit';
import { nameIn, usePeopleDirectory, usePersonName } from '../../lib/people';
import { Channel, User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface HomeViewProps {
  channels: Channel[];
  dms: Channel[];
  onSelectChannel: (channel: Channel) => void;
  onViewChange: (view: string) => void;
  /** Unread messages per conversation id (WorkspaceContext). */
  unreadCounts?: Record<string, number>;
  /** People connected right now (WorkspaceContext presence). */
  onlineUsers?: User[];
  workspaceName?: string;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ago = (iso?: string | null) => {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : formatDistanceToNowStrict(t, { addSuffix: true });
};

const UnreadBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-white">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread</span>
    </span>
  ) : null;

/**
 * Workspace home: a live "pulse" of the workspace (what is unread, who is
 * here now), then the conversations to pick up and the channels you are in.
 * Everything shown comes from the workspace's real lists, presence and read
 * state; every row is a real button.
 */
export const HomeView = ({ channels, dms, onSelectChannel, onViewChange, unreadCounts = {}, onlineUsers = [], workspaceName }: HomeViewProps) => {
  const { user } = useAuth();
  const myName = usePersonName(user);
  const people = usePeopleDirectory();
  const firstVisit = useFirstVisit(user?.id);
  const myChannels = channels.filter((c) => !c.isDM);

  const unreadIn = (c: Channel) => unreadCounts[c.id] ?? 0;
  const conversations = [...myChannels, ...dms];
  const totalUnread = conversations.reduce((sum, c) => sum + unreadIn(c), 0);
  const unreadPlaces = conversations.filter((c) => unreadIn(c) > 0).length;
  const others = onlineUsers.filter((u) => u.id !== user?.id);

  const dmName = (dm: Channel) => (dm.isGroupDM ? dm.name : nameIn(people, { id: dm.otherUserId, username: dm.name }, dm.name));
  const recent = [...dms]
    .sort((a, b) => new Date(b.lastActivityAt ?? b.createdAt ?? 0).getTime() - new Date(a.lastActivityAt ?? a.createdAt ?? 0).getTime())
    .slice(0, 6);
  // Channels with news first, then alphabetical.
  const channelList = [...myChannels].sort((a, b) => unreadIn(b) - unreadIn(a) || a.name.localeCompare(b.name)).slice(0, 8);

  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-surface-secondary app-scrollbar">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
        {/* The workspace pulse — the one bold element on this page. */}
        <header className="relative mb-8 overflow-hidden rounded-2xl bg-accent-900 px-6 py-7 text-white shadow-sm animate-fade-in md:px-9 md:py-9">
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-accent-200">
                {greeting()} · {today}
              </p>
              <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.025em] md:text-[36px]">
                {/* QA L16: "Welcome" on your first visit, then "Welcome back"; your display name (QA H4). */}
                {firstVisit ? 'Welcome' : 'Welcome back'}, {myName}
              </h1>
              <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-accent-100">
                {totalUnread === 0
                  ? `You're all caught up in ${workspaceName ?? 'this workspace'}.`
                  : `${plural(totalUnread, 'unread message', 'unread messages')} in ${plural(unreadPlaces, 'conversation', 'conversations')} since you last looked.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onViewChange('directory?tab=People')}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#ffffff] px-3.5 py-2 text-sm font-semibold text-[#0c454b] transition-colors hover:bg-[#eef9fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Users size={15} aria-hidden="true" /> Find people
                </button>
                <button
                  type="button"
                  onClick={() => onViewChange('directory')}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Search size={15} aria-hidden="true" /> Browse channels
                </button>
                <button
                  type="button"
                  onClick={() => onViewChange('activity')}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Activity size={15} aria-hidden="true" /> Activity
                </button>
              </div>
            </div>

            <section aria-label="Online now" className="shrink-0 md:text-right">
              <p className="text-sm font-medium text-accent-100">
                {others.length === 0 ? 'Nobody else is online' : `${plural(others.length, 'person', 'people')} online now`}
              </p>
              {others.length > 0 && (
                <ul className="mt-2.5 flex gap-1.5 md:justify-end">
                  {others.slice(0, 6).map((u) => (
                    <li key={u.id} className="inline-flex" title={nameIn(people, u)}>
                      <Avatar name={nameIn(people, u)} userId={u.id} size="md" />
                      <span className="sr-only">{nameIn(people, u)}</span>
                    </li>
                  ))}
                  {others.length > 6 && (
                    <li className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-accent-800 px-2 text-xs font-semibold text-accent-100">
                      +{others.length - 6}
                    </li>
                  )}
                </ul>
              )}
            </section>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section aria-labelledby="home-recent">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="home-recent" className="text-base font-semibold text-fg">Pick up where you left off</h2>
              <button type="button" onClick={() => onViewChange('dms')} className="text-sm font-medium text-brand transition-colors hover:text-brand-hover">
                All messages
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-10 text-center">
                <MessageSquare size={20} className="mx-auto mb-2 text-fg-subtle" aria-hidden="true" />
                <p className="text-sm text-fg-muted">No conversations yet. Say hello to someone on your team.</p>
                <button type="button" onClick={() => onViewChange('directory?tab=People')} className="mt-3 text-sm font-semibold text-brand hover:text-brand-hover">
                  Find people
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {recent.map((dm) => {
                  const name = dmName(dm);
                  const unread = unreadIn(dm);
                  const online = !dm.isGroupDM && others.some((u) => u.id === dm.otherUserId);
                  const preview = dm.lastMessage
                    ? `${dm.lastMessage.senderId === user?.id ? 'You: ' : ''}${dm.lastMessage.preview}`
                    : 'No messages yet';
                  return (
                    <li key={dm.id}>
                      <button
                        type="button"
                        onClick={() => onSelectChannel(dm)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                      >
                        {dm.isGroupDM ? (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-fg-muted" aria-hidden="true">
                            <Users size={16} />
                          </span>
                        ) : (
                          <Avatar name={name} userId={dm.otherUserId} size="md" presence={online ? 'online' : 'offline'} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={`truncate text-sm text-fg ${unread ? 'font-semibold' : 'font-medium'}`}>{name}</span>
                            <span className="shrink-0 text-xs text-fg-subtle">{ago(dm.lastMessage?.createdAt ?? dm.lastActivityAt)}</span>
                          </span>
                          <span className={`block truncate text-[13px] ${unread ? 'text-fg-muted' : 'text-fg-subtle'}`}>{preview}</span>
                        </span>
                        <UnreadBadge count={unread} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="home-channels">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="home-channels" className="text-base font-semibold text-fg">Your channels</h2>
              <button type="button" onClick={() => onViewChange('directory')} className="text-sm font-medium text-brand transition-colors hover:text-brand-hover">
                See all
              </button>
            </div>
            {channelList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-10 text-center">
                <Hash size={20} className="mx-auto mb-2 text-fg-subtle" aria-hidden="true" />
                <p className="text-sm text-fg-muted">You're not in any channels yet.</p>
                <button type="button" onClick={() => onViewChange('directory')} className="mt-3 text-sm font-semibold text-brand hover:text-brand-hover">
                  Browse channels
                </button>
              </div>
            ) : (
              <ul className="space-y-1">
                {channelList.map((ch) => {
                  const unread = unreadIn(ch);
                  return (
                    <li key={ch.id}>
                      <button
                        type="button"
                        onClick={() => onSelectChannel(ch)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${unread ? 'bg-brand-soft text-brand' : 'bg-surface-tertiary text-fg-muted'}`}
                          aria-hidden="true"
                        >
                          {ch.icon && ch.icon !== 'hash' ? <span className="text-base leading-none">{ch.icon}</span> : ch.visibility === 'PRIVATE' ? <Lock size={14} /> : <Hash size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm text-fg ${unread ? 'font-semibold' : 'font-medium'}`}>{ch.name}</span>
                          <span className="block truncate text-xs text-fg-subtle">{ch.visibility === 'PRIVATE' ? 'Private channel' : ch.description || 'Public channel'}</span>
                        </span>
                        <UnreadBadge count={unread} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
