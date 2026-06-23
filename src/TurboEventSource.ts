import { NitroModules } from 'react-native-nitro-modules';
import type { FastSse } from './FastSse.nitro';
import { ReadyState, type FastSSEOptions, type SSEEvent } from './types';

export class TurboEventSource {
  private _native: FastSse;
  private _url: string;
  private _options: FastSSEOptions;

  private _lastEventId: string = '';
  private _userClosed = false;

  private _listeners: {
    open: Array<() => void>;
    message: Array<(event: SSEEvent) => void>;
    error: Array<(err: Error) => void>;
  } = {
    open: [],
    message: [],
    error: [],
  };

  // Deprecated single-listener properties for backwards compatibility
  private _onOpenCallback?: () => void;
  private _onMessageCallback?: (event: SSEEvent) => void;
  private _onErrorCallback?: (err: Error) => void;

  constructor(url: string, options?: FastSSEOptions) {
    this._url = url;
    this._options = options || {};
    this._native = NitroModules.createHybridObject<FastSse>('FastSse');
  }

  private _log(...args: unknown[]): void {
    if (this._options.debug) {
      console.log('[FastSSE]', ...args);
    }
  }

  private _error(...args: unknown[]): void {
    if (this._options.debug) {
      console.error('[FastSSE]', ...args);
    }
  }

  get readyState(): ReadyState {
    return this._native.readyState as ReadyState;
  }

  public connect(): void {
    this._userClosed = false;
    this._connectInternal();
  }

  // --- Event Listener API ---

  public addEventListener(type: 'open', listener: () => void): void;
  public addEventListener(
    type: 'message',
    listener: (event: SSEEvent) => void
  ): void;
  public addEventListener(type: 'error', listener: (err: Error) => void): void;
  public addEventListener(
    type: 'open' | 'message' | 'error',
    listener: any
  ): void {
    if (type === 'open') {
      this._listeners.open.push(listener);
    } else if (type === 'message') {
      this._listeners.message.push(listener);
    } else if (type === 'error') {
      this._listeners.error.push(listener);
    }
  }

  public removeEventListener(type: 'open', listener: () => void): void;
  public removeEventListener(
    type: 'message',
    listener: (event: SSEEvent) => void
  ): void;
  public removeEventListener(
    type: 'error',
    listener: (err: Error) => void
  ): void;
  public removeEventListener(
    type: 'open' | 'message' | 'error',
    listener: any
  ): void {
    if (type === 'open') {
      this._listeners.open = this._listeners.open.filter(
        (cb) => cb !== listener
      );
    } else if (type === 'message') {
      this._listeners.message = this._listeners.message.filter(
        (cb) => cb !== listener
      );
    } else if (type === 'error') {
      this._listeners.error = this._listeners.error.filter(
        (cb) => cb !== listener
      );
    }
  }

  public removeAllEventListeners(): void {
    this._listeners = { open: [], message: [], error: [] };
    this._onOpenCallback = undefined;
    this._onMessageCallback = undefined;
    this._onErrorCallback = undefined;
  }

  // --- Deprecated Single Listener API ---

  onOpen(cb: () => void): void {
    this._onOpenCallback = cb;
  }

  onMessage(cb: (event: SSEEvent) => void): void {
    this._onMessageCallback = cb;
  }

  onError(cb: (err: Error) => void): void {
    this._onErrorCallback = cb;
  }

  // --- Lifecycle ---

  public close(): void {
    this._log(`User closed connection to ${this._url}`);
    this._userClosed = true;
    this._native.disconnect();
    this.removeAllEventListeners();
  }

  public disconnect(): void {
    this.close();
  }

  private _connectInternal(): void {
    const httpMethod = this._options.method || 'GET';
    const headers = { ...this._options.headers };

    if (this._lastEventId) {
      headers['Last-Event-ID'] = this._lastEventId;
    }

    this._log(`Connecting to ${this._url} with method ${httpMethod}`);

    this._native.connect(
      this._url,
      httpMethod,
      headers,
      this._options.body || '',
      this._options.connectTimeoutMs ?? 10000,
      this._options.readTimeoutMs ?? 0,
      () => {
        this._log(`Connected successfully to ${this._url}`);
        this._onOpenCallback?.();
        this._listeners.open.forEach((cb) => cb());
      },
      (event: string, id: string, data: string) => {
        this._log(
          `Received message - Event: ${event}, ID: ${id}, Data length: ${data.length}`
        );
        if (id) {
          this._lastEventId = id;
        }
        const sseEvent = { event, id, data };
        this._onMessageCallback?.(sseEvent);
        this._listeners.message.forEach((cb) => cb(sseEvent));
      },
      (message: string) => {
        this._error(`Native error: ${message}`);
        const err = new Error(message);
        this._onErrorCallback?.(err);
        this._listeners.error.forEach((cb) => cb(err));
        this._handleDisconnect(message);
      },
      () => {
        this._log(`Native connection closed.`);
        this._handleDisconnect();
      }
    );
  }

  private _handleDisconnect(errorMsg?: string): void {
    if (this._userClosed) return;
    this._log(`Disconnected. Error: ${errorMsg || 'None'}`);
  }
}
