import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { JsonRpcConnection, JsonRpcError } from './jsonrpc';

function frame(message: object): Buffer {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii'), json]);
}

function setup() {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const connection = new JsonRpcConnection(fromServer, toServer);
  const written: Buffer[] = [];
  toServer.on('data', (chunk: Buffer) => written.push(chunk));
  return { fromServer, connection, written };
}

describe('JsonRpcConnection', () => {
  it('frames outgoing requests and resolves on the response', async () => {
    const { fromServer, connection, written } = setup();
    const pending = connection.request('initialize', { a: 1 }, 1_000);
    const sent = Buffer.concat(written).toString('utf8');
    expect(sent).toMatch(/^Content-Length: \d+\r\n\r\n/);
    expect(sent).toContain('"method":"initialize"');

    fromServer.write(frame({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('handles partial frames and two messages in one chunk', async () => {
    const { fromServer, connection } = setup();
    const p1 = connection.request('a', null, 1_000);
    const p2 = connection.request('b', null, 1_000);
    const combined = Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, result: 'one' }),
      frame({ jsonrpc: '2.0', id: 2, result: 'two' }),
    ]);
    // Split mid-header of the second frame.
    const cut = frame({ jsonrpc: '2.0', id: 1, result: 'one' }).length + 7;
    fromServer.write(combined.subarray(0, cut));
    await expect(p1).resolves.toBe('one');
    fromServer.write(combined.subarray(cut));
    await expect(p2).resolves.toBe('two');
  });

  it('rejects a request when the server returns an error response', async () => {
    const { fromServer, connection } = setup();
    const failing = connection.request('x', null, 1_000);
    fromServer.write(frame({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope' } }));
    await expect(failing).rejects.toThrow(JsonRpcError);
  });

  it('rejects a request that outlives its timeout', async () => {
    const { connection } = setup();
    const timingOut = connection.request('y', null, 20);
    await expect(timingOut).rejects.toThrow(/timed out/);
  });

  it('drops an unparseable frame and resyncs on the next one', async () => {
    const { fromServer, connection } = setup();
    const pending = connection.request('x', null, 1_000);
    // A header with no Content-Length: the reader must discard it and recover.
    fromServer.write(Buffer.from('Bogus-Header: 1\r\n\r\n', 'ascii'));
    fromServer.write(frame({ jsonrpc: '2.0', id: 1, result: 'recovered' }));
    await expect(pending).resolves.toBe('recovered');
  });

  it('dispatches notifications and answers server requests', async () => {
    const { fromServer, connection, written } = setup();
    const seen: Array<[string, unknown]> = [];
    connection.onNotification((method, params) => seen.push([method, params]));
    connection.onRequest((method) => {
      if (method === 'workspace/configuration') return [null];
      throw new Error('unhandled');
    });

    fromServer.write(frame({ jsonrpc: '2.0', method: 'note', params: { n: 1 } }));
    fromServer.write(frame({ jsonrpc: '2.0', id: 9, method: 'workspace/configuration' }));
    fromServer.write(frame({ jsonrpc: '2.0', id: 10, method: 'mystery/method' }));
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual([['note', { n: 1 }]]);
    const sent = Buffer.concat(written).toString('utf8');
    expect(sent).toContain('"id":9');
    expect(sent).toContain('[null]');
    expect(sent).toContain('"id":10');
    expect(sent).toContain('-32601');
  });

  it('rejects all pending requests on close', async () => {
    const { connection } = setup();
    const pending = connection.request('x', null, 60_000);
    connection.close('gone');
    await expect(pending).rejects.toThrow(/gone/);
  });
});
