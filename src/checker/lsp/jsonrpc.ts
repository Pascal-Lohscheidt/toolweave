import type { Readable, Writable } from 'node:stream';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
  }
}

type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (method: string, params: unknown) => unknown;

/**
 * Minimal LSP-style JSON-RPC client over stdio: Content-Length framing,
 * requests, notifications, and just enough server-request handling to keep
 * a language server from stalling. Deliberately not vscode-jsonrpc — the
 * checker needs 3 requests and 4 notifications, not an editor framework.
 */
export class JsonRpcConnection {
  private readonly writer: Writable;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private notificationHandler: NotificationHandler | undefined;
  private requestHandler: RequestHandler | undefined;
  private closed = false;

  constructor(reader: Readable, writer: Writable) {
    this.writer = writer;
    reader.on('data', (chunk: Buffer) => this.onData(chunk));
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /** Handle server→client requests; return value becomes the response result. */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new JsonRpcError(-32000, 'Connection closed'));
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JsonRpcError(-32001, `Request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** Reject all in-flight requests and stop writing; used on process exit. */
  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, entry] of this.pending) {
      entry.reject(new JsonRpcError(-32000, reason));
    }
    this.pending.clear();
  }

  private send(message: JsonRpcMessage): void {
    const json = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii');
    this.writer.write(Buffer.concat([header, json]));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = header.match(/Content-Length: *(\d+)/i);
      if (!match) {
        // Unparseable frame; drop the header and resync.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.dispatch(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Malformed JSON from the server; skip the frame.
      }
    }
  }

  private dispatch(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.method !== undefined) {
      // Server→client request: answer it or the server may stall.
      let result: unknown = null;
      let error: { code: number; message: string } | undefined;
      try {
        result = this.requestHandler?.(message.method, message.params) ?? null;
      } catch {
        error = { code: -32601, message: `Method not handled: ${message.method}` };
      }
      this.send(
        error
          ? { jsonrpc: '2.0', id: message.id, error }
          : { jsonrpc: '2.0', id: message.id, result },
      );
      return;
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(Number(message.id));
      if (entry === undefined) return;
      this.pending.delete(Number(message.id));
      if (message.error !== undefined) {
        entry.reject(new JsonRpcError(message.error.code, message.error.message));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (message.method !== undefined) {
      this.notificationHandler?.(message.method, message.params);
    }
  }
}
