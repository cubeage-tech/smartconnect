import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * QA H1 / M2 / L23: renders an overlay (dialog, drawer, lobby) at the end of
 * <body> instead of where it is declared.
 *
 * Declared in place, an overlay inherits its ancestors' limits: <main> is
 * `relative z-10` (a stacking context), so a dialog opened inside it could
 * never rise above the app header (z-[100]) — the task drawer's Close / Share
 * / Delete sat under the header and every dialog backdrop left the header
 * live. The sidebar slides with a transform, and a transformed ancestor is
 * the containing block for `position: fixed`, so dialogs opened from it
 * (New message, Create a channel) were boxed into the 316px sidebar.
 *
 * Overlay layers above the header (z-[100]): task drawer 105/110, call lobby
 * 140, dialog 150, bottom sheet 160, command palette 170, call 200,
 * toasts 400. React events still bubble through the React tree as before.
 */
export const Layer = ({ children }: { children: ReactNode }) =>
  typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
