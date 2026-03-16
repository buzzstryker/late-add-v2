/**
 * API client for Late Add v2 (late-add-api).
 * Base URL from env; all requests use Bearer JWT when token is set.
 * Assumes late-add-api Edge Functions base: /functions/v1
 */
const BASE =
  typeof import.meta.env !== 'undefined' && import.meta.env.VITE_LATE_ADD_API_URL
    ? import.meta.env.VITE_LATE_ADD_API_URL
    : 'http://127.0.0.1:54321/functions/v1';

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // use text as message
    }
    throw new ApiError(res.status, (body as { error?: string })?.error ?? text, body);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
