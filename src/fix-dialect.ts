import { createPendingIds, noteToolsListRequest, rewriteToolsListResponse, type JsonRpcMessage } from "./jsonrpc.js";

export interface TransportSendOptions {
  relatedRequestId?: string | number;
  resumptionToken?: string;
  onresumptiontoken?: (token: string) => void;
}

/**
 * Structural subset of `@modelcontextprotocol/sdk` `Transport`.
 * SDK v1 transports satisfy {@link TransportShape}; this interface is the
 * shape the wrapper itself speaks.
 */
export interface McpTransport {
  start(): Promise<void>;
  send(message: JsonRpcMessage, options?: TransportSendOptions): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JsonRpcMessage, extra?: unknown) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;
}

/**
 * Minimal transport contract. Message parameters are `never` so SDK transports
 * (whose JSON-RPC types are narrower than a hand-written message) are accepted
 * without importing the SDK.
 */
export interface TransportShape {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: never, options?: never): Promise<void>;
  onclose?: () => void;
  onerror?: (error: never) => void;
  onmessage?: (message: never, extra?: never) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;
}

/**
 * Wrap a server transport so responses to `tools/list` carry JSON Schema
 * 2020-12 `inputSchema` and `outputSchema` values. Every other message is
 * forwarded unchanged. Request ids are taken from incoming `tools/list`
 * requests; responses are not detected by shape.
 */
export function fixDialect<T extends TransportShape>(transport: T): T {
  const pending = createPendingIds();
  const inner = transport as McpTransport;
  let onmessage: McpTransport["onmessage"];
  let onclose: McpTransport["onclose"];
  let onerror: McpTransport["onerror"];

  const previousOnMessage = inner.onmessage;
  inner.onmessage = (message, extra) => {
    noteToolsListRequest(message, pending);
    previousOnMessage?.(message, extra);
    onmessage?.(message, extra);
  };

  const previousOnClose = inner.onclose;
  inner.onclose = () => {
    previousOnClose?.();
    onclose?.();
  };

  const previousOnError = inner.onerror;
  inner.onerror = (error) => {
    previousOnError?.(error);
    onerror?.(error);
  };

  const wrapped: McpTransport = {
    start: () => inner.start(),
    close: () => inner.close(),
    send: (message, options) => inner.send(rewriteToolsListResponse(message, pending), options),
    setProtocolVersion: (version) => {
      inner.setProtocolVersion?.(version);
    },
  };

  Object.defineProperty(wrapped, "sessionId", {
    configurable: true,
    enumerable: true,
    get: () => inner.sessionId,
    set: (value: string | undefined) => {
      inner.sessionId = value;
    },
  });
  Object.defineProperty(wrapped, "onmessage", {
    configurable: true,
    enumerable: true,
    get: () => onmessage,
    set: (value: McpTransport["onmessage"]) => {
      onmessage = value;
    },
  });
  Object.defineProperty(wrapped, "onclose", {
    configurable: true,
    enumerable: true,
    get: () => onclose,
    set: (value: McpTransport["onclose"]) => {
      onclose = value;
    },
  });
  Object.defineProperty(wrapped, "onerror", {
    configurable: true,
    enumerable: true,
    get: () => onerror,
    set: (value: McpTransport["onerror"]) => {
      onerror = value;
    },
  });

  return wrapped as T;
}
