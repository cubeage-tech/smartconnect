/** A message's reaction summary, as the server sends it. */
export interface ReactionSummary {
  emoji: string;
  count: number;
  users: { id: string; username: string }[];
}

/**
 * QA L14: the reaction the current user just clicked, applied locally at once
 * (the server's toggle is idempotent on the same rule: add when absent, remove
 * when present). The socket's `reaction_updated` replaces it with the server's
 * truth; a refused request restores the previous list.
 */
export const toggleReactionLocally = (reactions: ReactionSummary[], emoji: string, me: { id: string; username: string }): ReactionSummary[] => {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return [...reactions, { emoji, count: 1, users: [me] }];
  if (existing.users.some((u) => u.id === me.id)) {
    const users = existing.users.filter((u) => u.id !== me.id);
    const count = Math.max(0, existing.count - 1);
    return count === 0 ? reactions.filter((r) => r !== existing) : reactions.map((r) => (r === existing ? { ...r, users, count } : r));
  }
  return reactions.map((r) => (r === existing ? { ...r, users: [...r.users, me], count: r.count + 1 } : r));
};

export interface PopoverBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * QA H2: where a popover of the preferred size goes next to its anchor so it
 * is fully on screen — below when it fits, else above, else as low as the
 * viewport allows; right-aligned to the anchor and kept inside the side
 * margins. Shrinks to the viewport on small screens.
 */
export const placePopover = (
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  preferred: { width: number; height: number },
  margin = 8,
  gap = 4
): PopoverBox => {
  const width = Math.min(preferred.width, viewport.width - margin * 2);
  const height = Math.min(preferred.height, viewport.height - margin * 2);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const left = clamp(anchor.right - width, margin, viewport.width - width - margin);
  const fitsBelow = viewport.height - anchor.bottom - gap - margin >= height;
  const fitsAbove = anchor.top - gap - margin >= height;
  const top = fitsBelow ? anchor.bottom + gap : fitsAbove ? anchor.top - gap - height : viewport.height - height - margin;
  return { top: clamp(top, margin, viewport.height - height - margin), left, width, height };
};
