import { useNavigate } from 'react-router-dom';
import { HomeView } from '../../components/layout/HomeView';
import { Channel } from '../../types';
import { useWorkspace } from './WorkspaceContext';
import { useWorkspaces } from './WorkspacesProvider';

export const HomePage = () => {
  const { workspaceId, channels, dms, unreadCounts, onlineUsers } = useWorkspace();
  const workspaceName = useWorkspaces().getWorkspace(workspaceId)?.name;
  const navigate = useNavigate();

  return (
    <HomeView
      channels={channels}
      dms={dms}
      unreadCounts={unreadCounts}
      onlineUsers={onlineUsers}
      workspaceName={workspaceName}
      onSelectChannel={(ch: Channel) => navigate(`/${workspaceId}/c/${ch.id}`)}
      onViewChange={(view: string) => navigate(`/${workspaceId}/${view}`)}
    />
  );
};
