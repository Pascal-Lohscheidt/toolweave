import { z } from 'zod';
import { ToolDefinitionError } from '../errors';
import type { AnyTool } from './define';

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  $ref?: string;
}

/**
 * The ambient declarations for globals the sandbox provides besides the
 * tools themselves. The checked program gets no DOM and no Node types, so
 * console must be declared explicitly.
 */
export const GLOBALS_PRELUDE = `declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};`;

/**
 * Compile tool definitions into the TypeScript declaration text handed to
 * the model and used by every checker backend.
 */
export function generateDeclarations(tools: readonly AnyTool[]): string {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new ToolDefinitionError(`Duplicate tool name "${tool.name}".`);
    }
    seen.add(tool.name);
  }
  const decls = tools.map(declarationFor);
  return [GLOBALS_PRELUDE, ...decls].join('\n\n') + '\n';
}

function declarationFor(tool: AnyTool): string {
  const input = toJsonSchema(tool, tool.input, 'input');
  const output = toJsonSchema(tool, tool.output, 'output');

  const inputType = printType(input, 1, tool);
  const outputType = printType(output, 1, tool);
  const optionalInput = isObjectSchema(input) && (input.required ?? []).length === 0;

  const jsdoc = printJsdoc(tool.description.trim().split('\n'), 0);
  return `${jsdoc}\ndeclare function ${tool.name}(input${optionalInput ? '?' : ''}: ${inputType}): Promise<${outputType}>;`;
}

function toJsonSchema(tool: AnyTool, schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  try {
    return z.toJSONSchema(schema, { io }) as JsonSchema;
  } catch (cause) {
    throw new ToolDefinitionError(
      `Tool "${tool.name}": ${io} schema cannot be represented as a TypeScript declaration ` +
        `(${cause instanceof Error ? cause.message : String(cause)}). ` +
        'Tool IO must be JSON-serializable.',
      { cause },
    );
  }
}

function isObjectSchema(schema: JsonSchema): boolean {
  return schema.type === 'object' && schema.properties !== undefined;
}

/** Render a JSON-Schema node as TypeScript type text. `depth` controls indentation. */
function printType(schema: JsonSchema, depth: number, tool: AnyTool): string {
  if (schema.$ref !== undefined) {
    throw new ToolDefinitionError(
      `Tool "${tool.name}": recursive or $ref-based schemas are not supported in tool IO.`,
    );
  }
  if (schema.const !== undefined) {
    return literal(schema.const);
  }
  if (schema.enum !== undefined) {
    return schema.enum.map(literal).join(' | ');
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const members = schema[key];
    if (members !== undefined) {
      return members.map((m) => maybeParen(printType(m, depth, tool))).join(' | ');
    }
  }
  if (schema.allOf !== undefined) {
    return schema.allOf.map((m) => maybeParen(printType(m, depth, tool))).join(' & ');
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((t) => printType({ ...schema, type: t }, depth, tool)).join(' | ');
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return printArray(schema, depth, tool);
    case 'object':
      return printObject(schema, depth, tool);
    case undefined:
      // An empty schema accepts anything (z.any() / z.unknown()).
      return 'unknown';
    default:
      throw new ToolDefinitionError(
        `Tool "${tool.name}": unsupported JSON-Schema type "${schema.type}".`,
      );
  }
}

function printArray(schema: JsonSchema, depth: number, tool: AnyTool): string {
  if (schema.prefixItems !== undefined) {
    const parts = schema.prefixItems.map((m) => printType(m, depth, tool));
    return `[${parts.join(', ')}]`;
  }
  const item = schema.items === undefined ? 'unknown' : printType(schema.items, depth, tool);
  return `${maybeParen(item)}[]`;
}

function printObject(schema: JsonSchema, depth: number, tool: AnyTool): string {
  const props = Object.entries(schema.properties ?? {});
  const record =
    typeof schema.additionalProperties === 'object'
      ? `Record<string, ${printType(schema.additionalProperties, depth, tool)}>`
      : undefined;

  if (props.length === 0) {
    return record ?? '{}';
  }

  const required = new Set(schema.required ?? []);
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  for (const [name, prop] of props) {
    const jsdocLines: string[] = [];
    if (prop.description !== undefined) {
      jsdocLines.push(...prop.description.split('\n'));
    }
    if (prop.default !== undefined) {
      jsdocLines.push(`@default ${JSON.stringify(prop.default)}`);
    }
    if (jsdocLines.length > 0) {
      lines.push(printJsdoc(jsdocLines, depth));
    }
    const key = IDENTIFIER_KEY_RE.test(name) ? name : JSON.stringify(name);
    const opt = required.has(name) ? '' : '?';
    lines.push(`${pad}${key}${opt}: ${printType(prop, depth + 1, tool)};`);
  }
  const body = `{\n${lines.join('\n')}\n${'  '.repeat(depth - 1)}}`;
  return record === undefined ? body : `${body} & ${record}`;
}

const IDENTIFIER_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function printJsdoc(lines: string[], depth: number): string {
  const pad = '  '.repeat(depth);
  if (lines.length === 1) {
    return `${pad}/** ${lines[0]} */`;
  }
  return `${pad}/**\n${lines.map((l) => `${pad} * ${l}`).join('\n')}\n${pad} */`;
}

function literal(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function maybeParen(type: string): string {
  return /[|&]/.test(type) && !type.startsWith('(') ? `(${type})` : type;
}
