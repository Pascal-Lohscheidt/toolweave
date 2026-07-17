import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TsgoUnavailableError } from '../errors';
import { wrapProgram } from '../program/wrap';
import type { Checker, Diagnostic } from '../types';
import { CHECK_COMPILER_OPTIONS, DECLS_FILE, MAIN_FILE } from './check-options';
import { JsonRpcConnection } from './lsp/jsonrpc';
import { resolveTsgoBinary } from './resolve-tsgo';

interface LspDiagnostic {
  range: { start: { line: number; character: number } };
  message: string;
  severity?: number;
  code?: number | string;
}

interface Session {
  child: ChildProcess;
  connection: JsonRpcConnection;
  dir: string;
  mainUri: string;
  declsUri: string;
  mainVersion: number;
  declsVersion: number;
  declsText: string;
  supportsPull: boolean;
  publishListeners: Map<string, (diags: LspDiagnostic[]) => void>;
}

export interface TsgoCheckerOptions {
  /** Override the resolved tsgo binary path. */
  binaryPath?: string;
  /** Per-request timeout. @default 10_000 */
  requestTimeoutMs?: number;
}

/**
 * Checker backend on the native TypeScript compiler (tsgo, TS 7).
 *
 * tsgo does not ship the classic programmatic API, so this speaks LSP to a
 * long-lived `tsgo --lsp -stdio` subprocess: a temp project directory gives
 * it a tsconfig, and each check delivers the wrapped program as a versioned
 * didChange on one virtual document, then pulls diagnostics.
 */
export class TsgoChecker implements Checker {
  private readonly options: TsgoCheckerOptions;
  private session: Promise<Session> | undefined;
  private spawnFailures = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(options: TsgoCheckerOptions = {}) {
    this.options = options;
  }

  check(source: string, decls: string): Promise<Diagnostic[]> {
    // One in-flight check per instance: a single versioned document.
    const run = this.queue.then(() => this.checkExclusive(source, decls));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const pending = this.session;
    this.session = undefined;
    if (pending === undefined) return;
    try {
      const session = await pending;
      try {
        await session.connection.request('shutdown', null, 2_000);
        session.connection.notify('exit', null);
      } catch {
        // Server unresponsive; killing below.
      }
      session.connection.close('disposed');
      session.child.kill('SIGKILL');
      await rm(session.dir, { recursive: true, force: true });
    } catch {
      // Session never came up.
    }
  }

  private async checkExclusive(source: string, decls: string): Promise<Diagnostic[]> {
    if (this.disposed) throw new TsgoUnavailableError('This checker has been disposed.');
    const timeoutMs = this.options.requestTimeoutMs ?? 10_000;
    let session: Session;
    try {
      session = await (this.session ??= this.startSession());
    } catch (error) {
      this.session = undefined;
      throw error;
    }

    try {
      if (session.declsText !== decls) {
        session.declsText = decls;
        session.declsVersion++;
        await writeFile(path.join(session.dir, DECLS_FILE), decls);
        session.connection.notify('textDocument/didChange', {
          textDocument: { uri: session.declsUri, version: session.declsVersion },
          contentChanges: [{ text: decls }],
        });
      }

      const wrapped = wrapProgram(source);
      session.mainVersion++;
      const version = session.mainVersion;

      let published: Promise<LspDiagnostic[]> | undefined;
      if (!session.supportsPull) {
        published = new Promise((resolve) => {
          session.publishListeners.set(session.mainUri, resolve);
        });
      }
      session.connection.notify('textDocument/didChange', {
        textDocument: { uri: session.mainUri, version },
        contentChanges: [{ text: wrapped.text }],
      });

      let items: LspDiagnostic[];
      if (session.supportsPull) {
        const report = (await session.connection.request(
          'textDocument/diagnostic',
          { textDocument: { uri: session.mainUri } },
          timeoutMs,
        )) as { kind?: string; items?: LspDiagnostic[] };
        items = report.items ?? [];
      } else {
        items = await withTimeout(published!, timeoutMs, 'publishDiagnostics');
      }

      const sourceLineCount = source.split('\n').length;
      return items
        .filter((d) => (d.severity ?? 1) <= 2)
        .map((d) => ({
          message: d.message,
          line: clamp(d.range.start.line + 1 - wrapped.lineOffset, 1, sourceLineCount),
          column: d.range.start.character + 1,
          code: typeof d.code === 'number' ? d.code : Number(d.code) || 0,
          severity: d.severity === 2 ? ('warning' as const) : ('error' as const),
        }));
    } catch (error) {
      // A failed request leaves the server state unknown; restart next time.
      await this.teardownSession();
      throw error;
    }
  }

  private async startSession(): Promise<Session> {
    if (this.spawnFailures >= 2) {
      throw new TsgoUnavailableError('tsgo failed to start twice; giving up on this backend.');
    }
    try {
      const session = await this.doStartSession();
      this.spawnFailures = 0;
      return session;
    } catch (error) {
      this.spawnFailures++;
      if (error instanceof TsgoUnavailableError) throw error;
      throw new TsgoUnavailableError(
        `Failed to start the tsgo language server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async doStartSession(): Promise<Session> {
    const binary = this.options.binaryPath ?? resolveTsgoBinary();
    const timeoutMs = this.options.requestTimeoutMs ?? 10_000;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'toolweave-tsgo-'));
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        { compilerOptions: CHECK_COMPILER_OPTIONS, include: ['*.ts', '*.d.ts'] },
        null,
        2,
      ),
    );
    await writeFile(path.join(dir, DECLS_FILE), '');
    await writeFile(path.join(dir, MAIN_FILE), '');

    const child = spawn(binary, ['--lsp', '-stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (child.stdout === null || child.stdin === null) {
      child.kill('SIGKILL');
      throw new Error('tsgo spawned without stdio pipes');
    }

    const connection = new JsonRpcConnection(child.stdout, child.stdin);
    const session: Session = {
      child,
      connection,
      dir,
      mainUri: pathToFileURL(path.join(dir, MAIN_FILE)).href,
      declsUri: pathToFileURL(path.join(dir, DECLS_FILE)).href,
      mainVersion: 1,
      declsVersion: 1,
      declsText: '',
      supportsPull: false,
      publishListeners: new Map(),
    };

    connection.onRequest((method, params) => {
      if (method === 'workspace/configuration') {
        const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
        return items.map(() => null);
      }
      if (method === 'window/workDoneProgress/create') return null;
      if (method === 'client/registerCapability') return null;
      throw new Error(`unhandled server request: ${method}`);
    });
    connection.onNotification((method, params) => {
      if (method !== 'textDocument/publishDiagnostics') return;
      const p = params as { uri: string; diagnostics: LspDiagnostic[] };
      const listener = session.publishListeners.get(p.uri);
      if (listener !== undefined) {
        session.publishListeners.delete(p.uri);
        listener(p.diagnostics);
      }
    });
    child.once('exit', () => {
      connection.close('tsgo process exited');
      if (this.session !== undefined) this.session = undefined;
    });

    const rootUri = pathToFileURL(dir).href;
    const initResult = (await connection.request(
      'initialize',
      {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'toolweave' }],
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: false },
            diagnostic: { dynamicRegistration: false },
          },
          workspace: { configuration: true },
        },
      },
      timeoutMs,
    )) as { capabilities?: { diagnosticProvider?: unknown } };
    session.supportsPull = Boolean(initResult.capabilities?.diagnosticProvider);
    connection.notify('initialized', {});

    connection.notify('textDocument/didOpen', {
      textDocument: { uri: session.declsUri, languageId: 'typescript', version: 1, text: '' },
    });
    connection.notify('textDocument/didOpen', {
      textDocument: { uri: session.mainUri, languageId: 'typescript', version: 1, text: '' },
    });
    return session;
  }

  private async teardownSession(): Promise<void> {
    const pending = this.session;
    this.session = undefined;
    if (pending === undefined) return;
    try {
      const session = await pending;
      session.connection.close('restarting');
      session.child.kill('SIGKILL');
      await rm(session.dir, { recursive: true, force: true });
    } catch {
      // Nothing to tear down.
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out after ${ms}ms waiting for ${what}`)),
        ms,
      );
      timer.unref?.();
    }),
  ]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
