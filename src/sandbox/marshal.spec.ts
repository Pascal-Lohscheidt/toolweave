import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import { errorToHandle, formatLogLine, marshalToHandle } from './marshal';

let mod: QuickJSWASMModule;
let context: QuickJSContext;

beforeAll(async () => {
  const variant = (await import('@jitl/quickjs-singlefile-mjs-release-sync')).default;
  mod = await newQuickJSWASMModuleFromVariant(variant);
  context = mod.newContext();
});

afterAll(() => {
  context.dispose();
});

describe('marshalToHandle', () => {
  it('round-trips JSON-safe values into the guest', () => {
    const handle = marshalToHandle(context, { a: 1, b: ['x', true] });
    expect(context.dump(handle)).toEqual({ a: 1, b: ['x', true] });
    handle.dispose();
  });

  it('maps undefined to the guest undefined', () => {
    // Shared handle — do not dispose.
    expect(context.dump(marshalToHandle(context, undefined))).toBeUndefined();
  });

  it('maps a value that JSON cannot represent to undefined', () => {
    // A function stringifies to undefined; the marshaller must not emit `(undefined)`.
    expect(context.dump(marshalToHandle(context, () => 0))).toBeUndefined();
  });

  it('escapes U+2028/U+2029 so the generated source stays valid', () => {
    const raw = 'a\u2028b\u2029c';
    const handle = marshalToHandle(context, raw);
    expect(context.dump(handle)).toBe(raw);
    handle.dispose();
  });
});

describe('errorToHandle', () => {
  it('preserves the name and message of a real Error', () => {
    const handle = errorToHandle(context, new TypeError('boom'));
    expect(context.getProp(handle, 'name').consume((h) => context.dump(h))).toBe('TypeError');
    expect(context.getProp(handle, 'message').consume((h) => context.dump(h))).toBe('boom');
    handle.dispose();
  });

  it('coerces a non-Error throw to a plain Error with a string message', () => {
    const handle = errorToHandle(context, 'just a string');
    expect(context.getProp(handle, 'name').consume((h) => context.dump(h))).toBe('Error');
    expect(context.getProp(handle, 'message').consume((h) => context.dump(h))).toBe(
      'just a string',
    );
    handle.dispose();
  });
});

describe('formatLogLine', () => {
  it('joins strings verbatim and JSON-encodes everything else', () => {
    expect(formatLogLine(['hi', 1, { x: 2 }])).toBe('hi 1 {"x":2}');
  });

  it('falls back to String() for values JSON cannot encode', () => {
    expect(formatLogLine([undefined])).toBe('undefined');
  });
});
