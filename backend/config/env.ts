import dotenv from 'dotenv';
import { corsOrigins, DEV_APP_URL, normalizeAppUrl, trustProxySetting } from './deployment';
import { missingEmailSettings } from '../lib/emailDelivery';
import { credentialSetting } from '../lib/settings';

dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

export const PORT = Number(process.env.PORT) || 3000;
export const NODE_ENV = process.env.NODE_ENV || 'development';

// The frontend's public origin: the CORS / Socket.IO origin and the base of every
// link the backend sends (invitations, activation, password reset). Required in
// production (on Render: the frontend static site's URL); locally it defaults to
// the Vite dev server.
const appUrl = normalizeAppUrl(process.env.APP_URL);
if (process.env.APP_URL && !appUrl) {
  console.error('FATAL: APP_URL must be an absolute http(s) URL such as https://smartconnect-frontend.onrender.com. Exiting.');
  process.exit(1);
}
if (NODE_ENV === 'production' && !appUrl) {
  console.error('FATAL: APP_URL (the frontend URL) must be set in production. Exiting.');
  process.exit(1);
}
export const APP_URL = appUrl ?? DEV_APP_URL;
export const ALLOWED_ORIGINS = corsOrigins(NODE_ENV, APP_URL);
export const TRUST_PROXY = trustProxySetting(NODE_ENV, process.env.TRUST_PROXY);

export { credentialSetting };

// Fail fast rather than let every upload silently 500 the first time someone
// attaches a file — same reasoning as JWT_SECRET above. Whether the values are
// accepted by Cloudinary is checked after startup (lib/cloudinary.ts).
export const CLOUDINARY_CLOUD_NAME = credentialSetting(process.env.CLOUDINARY_CLOUD_NAME);
export const CLOUDINARY_API_KEY = credentialSetting(process.env.CLOUDINARY_API_KEY);
export const CLOUDINARY_API_SECRET = credentialSetting(process.env.CLOUDINARY_API_SECRET);
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('FATAL: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must all be set. Exiting.');
  process.exit(1);
}

// E-mail (Brevo, utils/mailer.ts) is not required to run: without it every
// screen says no e-mail was sent and shows the one-time details to share.
// Production names what is missing at startup — names only, never values.
if (NODE_ENV === 'production') {
  const missing = missingEmailSettings();
  if (missing.length > 0) {
    console.warn(`E-mail delivery is OFF: ${missing.join(' and ')} not set or invalid (Brevo). Activation and invitation e-mails will not be sent.`);
  }
}
