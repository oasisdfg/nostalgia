import { session } from 'electron';

// Dev (HMR via the Vite dev server) needs a relaxed policy; the built app uses
// the strict one. Strict-file:// CSP validation happens at packaging (Phase 9).
const DEV_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' asset: data: blob:",
  "media-src 'self' asset: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
].join('; ');

const PROD_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' asset: data:",
  "media-src 'self' asset:",
  "font-src 'self'",
  "connect-src 'self'",
].join('; ');

export function installCsp(): void {
  const isDev = !!process.env.ELECTRON_RENDERER_URL;
  const policy = isDev ? DEV_POLICY : PROD_POLICY;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}
