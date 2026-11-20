import { ReactNode } from 'react';

/**
 * QA L42 / L45: one page header for the admin console — the style Users and
 * Team Management already used (title, one line of description, actions on
 * the right). Pages had three different headers (big icon tile + very large
 * title, plain, small). On phones the actions sit under the title instead of
 * squeezing it.
 */
export const AdminPageHeader = ({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) => (
  <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0 flex-1">
      <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
);
