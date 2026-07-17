import type TS from 'typescript';
import { CheckerUnavailableError } from '../errors';
import { wrapProgram } from '../program/wrap';
import type { Checker, Diagnostic } from '../types';
import { CHECK_COMPILER_OPTIONS, DECLS_FILE, MAIN_FILE } from './check-options';

const MAIN = `/toolweave/${MAIN_FILE}`;
const DECLS = `/toolweave/${DECLS_FILE}`;

// Parsing lib.*.d.ts dominates cold-start cost. Both caches are shared
// across checker instances so a process pays it once.
let tsModulePromise: Promise<typeof TS> | undefined;
let sharedRegistry: TS.DocumentRegistry | undefined;
const libSnapshotCache = new Map<string, TS.IScriptSnapshot | null>();

async function loadTypescript(): Promise<typeof TS> {
  tsModulePromise ??= import('typescript').then(
    (m) => (m as { default?: typeof TS }).default ?? (m as unknown as typeof TS),
    (cause: unknown) => {
      tsModulePromise = undefined;
      throw new CheckerUnavailableError(
        'The "in-process" checker needs the optional peer dependency "typescript" (>=5.8 <7). ' +
          'Install it, or use checker: "tsgo" or "none".',
        { cause },
      );
    },
  );
  const ts = await tsModulePromise;
  const major = Number(ts.version.split('.')[0]);
  if (Number.isFinite(major) && major >= 7) {
    throw new CheckerUnavailableError(
      `typescript@${ts.version} no longer ships the in-process LanguageService API. ` +
        'Install typescript@6 alongside it, or use checker: "tsgo".',
    );
  }
  return ts;
}

interface VirtualFile {
  text: string;
  version: number;
}

/**
 * Warm in-process backend on the classic TypeScript LanguageService.
 * One long-lived service per instance; each check swaps the content of a
 * single virtual main file and bumps its version, which is exactly the
 * incremental path the LanguageService optimizes for.
 */
export class InProcessChecker implements Checker {
  private service: TS.LanguageService | undefined;
  private ts: typeof TS | undefined;
  private options: TS.CompilerOptions | undefined;
  private readonly files = new Map<string, VirtualFile>([
    [MAIN, { text: '', version: 0 }],
    [DECLS, { text: '', version: 0 }],
  ]);

  async check(source: string, decls: string): Promise<Diagnostic[]> {
    const ts = (this.ts ??= await loadTypescript());
    this.service ??= this.createService(ts);

    const declsFile = this.files.get(DECLS)!;
    if (declsFile.text !== decls) {
      declsFile.text = decls;
      declsFile.version++;
    }
    const wrapped = wrapProgram(source);
    const mainFile = this.files.get(MAIN)!;
    mainFile.text = wrapped.text;
    mainFile.version++;

    const raw = [
      ...this.service.getSyntacticDiagnostics(MAIN),
      ...this.service.getSemanticDiagnostics(MAIN),
    ];
    const sourceLineCount = source.split('\n').length;
    const diagnostics: Diagnostic[] = [];
    for (const d of raw) {
      if (d.file !== undefined && d.file.fileName !== MAIN) continue;
      let line = 1;
      let column = 1;
      if (d.file !== undefined && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        line = clamp(pos.line + 1 - wrapped.lineOffset, 1, sourceLineCount);
        column = pos.character + 1;
      }
      diagnostics.push({
        message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
        line,
        column,
        code: d.code,
        severity: d.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
      });
    }
    return diagnostics;
  }

  async dispose(): Promise<void> {
    this.service?.dispose();
    this.service = undefined;
  }

  private createService(ts: typeof TS): TS.LanguageService {
    const converted = ts.convertCompilerOptionsFromJson(CHECK_COMPILER_OPTIONS, '/');
    if (converted.errors.length > 0) {
      throw new CheckerUnavailableError(
        `Invalid checker compiler options: ${converted.errors
          .map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' '))
          .join('; ')}`,
      );
    }
    this.options = converted.options;
    sharedRegistry ??= ts.createDocumentRegistry();
    const files = this.files;
    const options = this.options;

    const host: TS.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [DECLS, MAIN],
      getScriptVersion: (fileName) => String(files.get(fileName)?.version ?? 1),
      getScriptSnapshot: (fileName) => {
        const virtual = files.get(fileName);
        if (virtual !== undefined) return ts.ScriptSnapshot.fromString(virtual.text);
        return readLibSnapshot(ts, fileName) ?? undefined;
      },
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      getCurrentDirectory: () => '/',
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (fileName) => files.has(fileName) || readLibSnapshot(ts, fileName) !== null,
      readFile: (fileName) => files.get(fileName)?.text,
    };
    return ts.createLanguageService(host, sharedRegistry);
  }
}

function readLibSnapshot(ts: typeof TS, fileName: string): TS.IScriptSnapshot | null {
  const cached = libSnapshotCache.get(fileName);
  if (cached !== undefined) return cached;
  let snapshot: TS.IScriptSnapshot | null = null;
  if (fileName.includes('typescript/lib/') && fileName.endsWith('.d.ts')) {
    const text = ts.sys.readFile(fileName);
    if (text !== undefined) snapshot = ts.ScriptSnapshot.fromString(text);
  }
  libSnapshotCache.set(fileName, snapshot);
  return snapshot;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
