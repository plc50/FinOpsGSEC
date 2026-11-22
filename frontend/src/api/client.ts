import type { ApiErrorBody, ErrorCode } from './types';
import { isMockMode, mockFetch } from './mocks';

/**
 * Centralized API error carrying the backend contract error shape (§4).
 * The UI error states (§8) read `code` and `message` from this.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly type: string;
  readonly param: string | null;

  constructor(params: {
    status: number;
    message: string;
    code: ErrorCode;
    type?: string;
    param?: string | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.type = params.type ?? 'api_error';
    this.param = params.param ?? null;
  }

  get isForbiddenScope(): boolean {
    return this.status === 403 || this.code === 'forbidden_scope';
  }

  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.code === 'invalid_api_key' ||
      this.code === 'missing_api_key'
    );
  }
}

/**
 * In dev we call relative paths and let the Vite proxy forward to the backend
 * (avoids CORS). VITE_API_BASE_URL is still honored for prod builds or when a
 * fully-qualified base is desired.
 */
function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (import.meta.env.DEV) {
    // Prefer the dev proxy (relative paths).
    return '';
  }
  return configured ?? 'http://localhost:8000';
}

const BASE_URL = resolveBaseUrl();

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  apiKey: string;
  signal?: AbortSignal;
  /** Override the build-wide transport for isolated rehearsal/live flows. */
  transport?: 'default' | 'live' | 'mock';
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = undefined;
  }
  const err = body?.error;
  return new ApiError({
    status: res.status,
    message: err?.message ?? `Request failed with status ${res.status}`,
    code: (err?.code as ErrorCode) ?? `http_${res.status}`,
    type: err?.type ?? 'api_error',
    param: err?.param ?? null,
  });
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions,
): Promise<T> {
  const {
    method = 'GET',
    query,
    body,
    apiKey,
    signal,
    transport = 'default',
  } = options;

  if (!apiKey) {
    throw new ApiError({
      status: 401,
      message: 'No API key provided. Sign in with a FinOps API key.',
      code: 'missing_api_key',
      type: 'invalid_request_error',
    });
  }

  const url = buildUrl(path, query);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const doFetch =
    transport === 'mock'
      ? mockFetch
      : transport === 'live'
        ? fetch
        : isMockMode()
          ? mockFetch
          : fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError({
      status: 0,
      message:
        'Unable to reach the FinOps backend. Check that it is running or enable mocks (VITE_USE_MOCKS=true).',
      code: 'network_error',
      type: 'connection_error',
    });
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
