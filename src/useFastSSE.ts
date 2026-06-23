import { useState, useEffect, useRef, useCallback } from 'react';
import { TurboEventSource } from './TurboEventSource';
import { ReadyState, type FastSSEOptions, type SSEEvent } from './types';

export function useFastSSE(url: string, options?: FastSSEOptions) {
  const [data, setData] = useState<SSEEvent | null>(null);
  const [status, setStatus] = useState<ReadyState>(ReadyState.CLOSED);
  const [error, setError] = useState<Error | null>(null);

  const sourceRef = useRef<TurboEventSource | null>(null);

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    setStatus(ReadyState.CONNECTING);
    setError(null);

    const source = new TurboEventSource(url, options);
    sourceRef.current = source;

    source.addEventListener('open', () => {
      setStatus(ReadyState.OPEN);
    });

    source.addEventListener('message', (event: SSEEvent) => {
      setData(event);
    });

    source.addEventListener('error', (err: Error) => {
      setError(err);
      setStatus(ReadyState.CLOSED);
    });

    source.connect();
  }, [url, options]);

  const disconnect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setStatus(ReadyState.CLOSED);
  }, []);

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
      }
    };
  }, []);

  return {
    data,
    status,
    error,
    connect,
    disconnect,
    source: sourceRef.current,
  };
}
