// Maps Supabase auth errors to friendly, user-facing copy for the login screen.
// Matches on BOTH the error code and a message-substring fallback, because
// Supabase error codes can vary across supabase-js / GoTrue versions. Applied
// at the sendOtp / verifyOtp failure paths so the raw error.message is never
// rendered to the user.
import { AUTH_TIMEOUT_MARKER } from './authFetch';

type MaybeAuthError =
  | { name?: string | null; code?: string | null; message?: string | null }
  | null
  | undefined;

export function friendlyAuthError(error: MaybeAuthError): string {
  const name = (error?.name ?? '').toLowerCase();
  const code = (error?.code ?? '').toLowerCase();
  const message = (error?.message ?? '').toLowerCase();

  // Our own 15s deadline fired (lib/authFetch.ts) — the request was abandoned
  // before the server answered. Checked FIRST: this is the one case where the
  // problem is the connection rather than anything the user typed, and saying
  // "something went wrong" would send them hunting for a mistake that isn't
  // there. Previously this case produced NO message at all, because a hung
  // fetch never resolved and nothing timed it out.
  if (message.includes(AUTH_TIMEOUT_MARKER)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  // Genuine network/CORS failure. auth-js wraps these as
  // AuthRetryableFetchError with the platform's own wording ("Failed to fetch"
  // on Chrome, "Load failed" on Safari), which must never reach the user.
  if (
    name === 'authretryablefetcherror' ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('network request failed')
  ) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  // Email isn't a registered user (shouldCreateUser:false → signups blocked).
  if (code === 'otp_disabled' || message.includes('signups not allowed')) {
    return "That email isn't associated with a Windex account. Check the spelling, or try a different email.";
  }

  // Too many email sends in a short window.
  if (code === 'over_email_send_rate_limit' || message.includes('rate limit')) {
    return 'Too many requests. Wait a minute and try again.';
  }

  // Invalid or expired verification code (verify step).
  if (code === 'otp_expired' || message.includes('expired') || message.includes('invalid')) {
    return 'That code is incorrect or has expired. Request a new one.';
  }

  // Generic fallback for anything unmatched.
  return 'Something went wrong. Please try again.';
}
