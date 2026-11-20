import axios from 'axios';
import { useEffect, useState } from 'react';
import { teamManagementApi } from '../lib/api';
import type { Hierarchy } from '../lib/api/teamManagement';

/**
 * Stage 3 (T.22): the signed-in account's company level (Company Admin, Team
 * Lead or Member) and what the UI may offer. Hints only — the server enforces
 * every action. null while loading or if it could not be loaded, so callers
 * decide their own fallback.
 */
/**
 * QA M18: one request shared by every component that asks (six do, on one
 * screen), reused for a minute, and never across accounts (keyed by the
 * session's Authorization header).
 */
const TTL_MS = 60_000;
let cache: { key: string; at: number; value: Promise<Hierarchy> } | null = null;
const sessionKey = () => String(axios.defaults.headers.common['Authorization'] ?? '');

export const loadHierarchy = (): Promise<Hierarchy> => {
  const key = sessionKey();
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = teamManagementApi.myHierarchy();
  const entry = { key, at: Date.now(), value };
  cache = entry;
  value.catch(() => {
    if (cache === entry) cache = null; // a failure is not cached
  });
  return value;
};

/** Tests only. */
export const resetHierarchyCache = () => {
  cache = null;
};

export const useHierarchy = (): Hierarchy | null => {
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  useEffect(() => {
    let alive = true;
    loadHierarchy()
      .then((value) => alive && setHierarchy(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return hierarchy;
};
