/** Base class for every error toolweave throws. */
export class ToolweaveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** An invalid tool definition (bad name, unrepresentable schema, ...). */
export class ToolDefinitionError extends ToolweaveError {}

/** A checker backend cannot run in this environment. */
export class CheckerUnavailableError extends ToolweaveError {}

/** The tsgo binary could not be resolved or the LSP process cannot be started. */
export class TsgoUnavailableError extends CheckerUnavailableError {}

/** Type stripping failed. Should be unreachable for programs that passed the checker. */
export class TranspileError extends ToolweaveError {}

/** Base class for sandbox failures. */
export class SandboxError extends ToolweaveError {}

/** The program exceeded its wall-clock budget. */
export class SandboxTimeoutError extends SandboxError {
  readonly kind = 'timeout';
}

/** The program exceeded its memory cap. */
export class SandboxMemoryError extends SandboxError {
  readonly kind = 'memory';
}

/** The program exceeded the guest stack size. */
export class SandboxStackError extends SandboxError {
  readonly kind = 'stack';
}

/** An uncaught exception inside the guest program. */
export class SandboxRuntimeError extends SandboxError {
  readonly guestName: string;
  readonly guestStack: string | undefined;
  /** 1-based line in the model's original source, when recoverable from the guest stack. */
  readonly line: number | undefined;

  constructor(message: string, guestName: string, guestStack?: string, line?: number) {
    super(message);
    this.guestName = guestName;
    this.guestStack = guestStack;
    this.line = line;
  }
}

/** A tool call from the guest failed schema validation or the impl threw. */
export class ToolCallError extends ToolweaveError {
  readonly toolName: string;

  constructor(toolName: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.toolName = toolName;
  }
}
