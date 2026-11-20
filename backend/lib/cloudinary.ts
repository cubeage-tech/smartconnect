import { v2 as cloudinary } from 'cloudinary';
import { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } from '../config/env';

/**
 * The one configured Cloudinary client (T.32). Previously configured as a
 * side effect of importing the upload middleware, which left modules that
 * only sign URLs or delete files (lib/attachments.ts) depending on import
 * order. Credentials come from the environment (config/env.ts refuses to
 * start without them) and are never logged.
 */
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/** Outcome of asking Cloudinary whether it accepts this server's credentials. */
export type StorageCredentialCheck = 'ok' | 'credentials_rejected' | 'quota' | 'unreachable';

/** The HTTP status in a Cloudinary SDK rejection (it uses two shapes). */
export const storageHttpCode = (err: unknown): number | null => {
  const direct = (err as { http_code?: unknown })?.http_code;
  if (typeof direct === 'number') return direct;
  const nested = (err as { error?: { http_code?: unknown } })?.error?.http_code;
  return typeof nested === 'number' ? nested : null;
};

/**
 * QA C1: config/env.ts only proves the three settings are present. Present
 * but wrong (a typo, a key from another account, a placeholder) used to show
 * up only as every upload failing. This asks Cloudinary once (the Admin API
 * ping, read-only) so startup can name the problem. Never throws, never
 * returns or logs credential values.
 */
export const checkStorageCredentials = async (ping: () => Promise<unknown> = () => cloudinary.api.ping()): Promise<StorageCredentialCheck> => {
  try {
    await ping();
    return 'ok';
  } catch (err) {
    const code = storageHttpCode(err);
    if (code === 401 || code === 403 || code === 404) return 'credentials_rejected';
    if (code === 420 || code === 429) return 'quota';
    return 'unreachable';
  }
};

const STARTUP_MESSAGES: Record<Exclude<StorageCredentialCheck, 'ok'>, string> = {
  credentials_rejected:
    'File storage is OFF: Cloudinary rejected this server\'s credentials. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (values are never logged). Every upload will fail with 503 until they are corrected.',
  quota: 'File storage: Cloudinary reports its usage or rate limit is reached. Uploads will fail with 503 until it resets.',
  unreachable: 'File storage: Cloudinary could not be reached at startup. Uploads will be retried per request.',
};

/** Logs the startup credential check (names only). Returns the outcome for tests. */
export const reportStorageCredentials = async (check: () => Promise<StorageCredentialCheck> = checkStorageCredentials) => {
  const result = await check();
  if (result === 'ok') console.log('File storage: Cloudinary accepted the server credentials.');
  else console.error(STARTUP_MESSAGES[result]);
  return result;
};
