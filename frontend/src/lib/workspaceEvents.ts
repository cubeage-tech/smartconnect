/**
 * QA M12: dispatched on `window` by WorkspaceLayout when a message arrives for
 * one of the user's OTHER workspaces (their rooms are subscribed too). The
 * workspace rail listens and refreshes its unread dots.
 */
export const OTHER_WORKSPACE_MESSAGE = 'smartconnect:other-workspace-message';
