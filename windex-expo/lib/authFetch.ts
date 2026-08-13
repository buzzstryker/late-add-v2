/**
 * Hard deadline for every Supabase Auth request.
 *
 * WHY THIS EXISTS: supabase-js sets no timeout on its auth fetches, and neither
 * did we. A request that never settled left the login screen's busy flag
 * latched on forever — spinner spinning, no error, no notice — and, because the
 * fetch never completed, nothing ever reached GoTrue either. That is exactly
 * how a sign-in failed silently in an installed iOS PWA on 2026-08-12: GoTrue
 * logged no /otp request at all for the attempt. iOS freezes a standalone PWA
 * and resumes it from a snapshot, which is a reliable way to end up holding a
 * fetch that will never settle.
 *
 * Wrapping at the FETCH layer rather than around individual sendOtp/verifyOtp
 * calls buys two things a Promise.race around the call cannot:
 *   - it genuinely ABORTS the socket instead of merely abandoning the wait, and
 *   - it covers every auth request, including background token refresh, rather
 *     than only the two call sites we happened to remember.
 *
 * HOW THE TIMEOUT REACHES THE USER: the abort rejects the fetch; auth-js
 * catches that in _handleRequest and rethrows it as AuthRetryableFetchError,
 * preserving our message verbatim (its _getErrorMessage reads `err.message`).
 * AuthRetryableFetchError IS an AuthError, so signInWithOtp / verifyOtp RETURN
 * it as `{ error }` instead of throwing. friendlyAuthError() then matches
 * AUTH_TIMEOUT_MARKER and produces the user-facing copy.
 *
 * AUTH_TIMEOUT_MARKER is a sentinel, not prose. Never render it.
 */

/** Sentinel carried in the error message when OUR deadline fired. */
export const AUTH_TIMEOUT_MARKER = 'windex_auth_timeout';

/** Deadline for a single auth request. */
export const AUTH_TIMEOUT_MS = 15_000;

export function createTimeoutFetch(timeoutMs: number = AUTH_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    // Ancient runtime with no AbortController: fall back to a plain fetch
    // rather than breaking auth outright.
    if (typeof AbortController === 'undefined') return fetch(input, init);

    const controller = new AbortController();
    let timedOut = false;

    // Our own rejection, independent of the fetch. See the timer below.
    let fireDeadline: (reason: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => {
      fireDeadline = reject;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // Abort the socket so the connection is actually released...
      controller.abort();
      // ...AND stop waiting regardless of whether the underlying fetch honours
      // the signal. An AbortController alone would leave us hanging on a fetch
      // that ignores it — and a fetch that never settles is precisely the bug
      // this file exists to fix, so the deadline must not depend on the fetch
      // cooperating.
      fireDeadline(new Error(AUTH_TIMEOUT_MARKER));
    }, timeoutMs);

    // Honour a caller-supplied signal too, so an external abort still works.
    const caller = init?.signal ?? undefined;
    const forwardAbort = () => controller.abort();
    if (caller) {
      if (caller.aborted) controller.abort();
      else caller.addEventListener('abort', forwardAbort);
    }

    try {
      // Promise.race attaches a handler to the fetch promise, so a late
      // AbortError after the deadline wins is still handled, not unhandled.
      return await Promise.race([
        fetch(input, { ...(init ?? {}), signal: controller.signal }),
        deadline,
      ]);
    } catch (err) {
      // Distinguish OUR deadline from a caller abort or a genuine network
      // failure — the login screen words those differently.
      if (timedOut) throw new Error(AUTH_TIMEOUT_MARKER);
      throw err;
    } finally {
      clearTimeout(timer);
      if (caller) caller.removeEventListener('abort', forwardAbort);
    }
  };
}
