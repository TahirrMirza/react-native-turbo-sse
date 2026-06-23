export interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface FastSSEOptions {
  /** The HTTP Method to use. Defaults to 'GET'. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Optional HTTP headers to include in the request. */
  headers?: Record<string, string>;
  /** Optional request body, useful for POST requests. */
  body?: string;
  /** Milliseconds to wait to establish the native TCP connection (Android only). */
  connectTimeoutMs?: number;
  /** Milliseconds to wait between incoming chunks before terminating a dead connection. */
  readTimeoutMs?: number;
  /** Enable detailed console logs for debugging. */
  debug?: boolean;
}

export const ReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
} as const;

export type ReadyState = (typeof ReadyState)[keyof typeof ReadyState];
