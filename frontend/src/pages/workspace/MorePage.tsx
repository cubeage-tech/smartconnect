import { ArrowLeftRight, ClipboardList, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MoreView } from '../../components/layout/MoreView';
import { Avatar } from '../../components/ui/Avatar';
import { usePersonName } from '../../lib/people';
import { ThemeSwitcher } from '../../components/ui/ThemeSwitcher';
import { useAuth } from '../../contexts/AuthContext';
import { openNavigationDrawer } from './ChatsPage';
import { useWorkspace } from './WorkspaceContext';
import { useWorkspaces } from './WorkspacesProvider';

/**
 * T.39 — the phone's "More" tab: who is signed in, appearance, switching
 * workspace and (for leads) Team Tasks — then the existing More options.
 * Phones only (md:hidden); tablets and desktop are unchanged.
 */
const PhoneAccountPanel = ({ onNavigate }: { onNavigate: (view: string) => void }) => {
  const { user, logout } = useAuth();
  const myName = usePersonName(user, '?'); // QA H4: your display name, as in the header
  const { workspaceId } = useWorkspace();
  const workspace = useWorkspaces().getWorkspace(workspaceId);
  const leads = !!workspace && !workspace.isDefault && !!workspace.capabilities?.canManage;
  const row = 'flex min-h-12 w-full select-none items-center gap-3 px-4 text-left text-[15px] text-fg active:bg-surface-tertiary';
  return (
    <div className="-mx-2 mb-8 space-y-4 md:hidden">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-secondary p-4">
        <Avatar name={myName} userId={user?.id} size="lg" presence="online" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{myName}</p>
          <p className="truncate text-sm text-fg-muted">{user?.email}</p>
        </div>
      </div>
      <section aria-labelledby="more-appearance" className="rounded-2xl border border-line p-3">
        <h2 id="more-appearance" className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Appearance
        </h2>
        <ThemeSwitcher />
      </section>
      <div className="overflow-hidden rounded-2xl border border-line">
        <button type="button" className={row} onClick={openNavigationDrawer}>
          <ArrowLeftRight size={19} className="shrink-0" aria-hidden="true" />
          <span className="shrink-0 whitespace-nowrap">Switch workspace</span>
          <span className="ml-auto min-w-0 truncate text-sm text-fg-subtle">{workspace?.name}</span>
        </button>
        {leads && (
          <button type="button" className={`${row} border-t border-line`} onClick={() => onNavigate('team-tasks')}>
            <ClipboardList size={19} aria-hidden="true" /> Team tasks
          </button>
        )}
        <button type="button" className={`${row} border-t border-line text-danger`} onClick={logout}>
          <LogOut size={19} aria-hidden="true" /> Sign out
        </button>
      </div>
    </div>
  );
};

export const MorePage = () => {
  const { workspaceId } = useWorkspace();
  const navigate = useNavigate();
  const go = (view: string) => navigate(`/${workspaceId}/${view}`);
  return <MoreView onViewChange={go} header={<PhoneAccountPanel onNavigate={go} />} />;
};
