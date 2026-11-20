import { useEffect, useState } from 'react';

const key = (userId: string) => `smartconnect:welcomed:${userId}`;

/**
 * QA L16: true on this person's first visit to Home in this browser (then
 * remembered). Storage may be unavailable (private mode): then it is never a
 * "first visit", which keeps the previous greeting.
 */
export const useFirstVisit = (userId: string | null | undefined) => {
  const [first] = useState(() => {
    if (!userId) return false;
    try {
      return localStorage.getItem(key(userId)) === null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(key(userId), '1');
    } catch {
      // Storage blocked: nothing to remember.
    }
  }, [userId]);
  return first;
};
