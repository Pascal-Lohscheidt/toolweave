import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRuntime, defineTool } from '../src/index';

const db = new Map([
  ['berlin', { tempC: 18, description: 'cloudy' }],
  ['rome', { tempC: 31, description: 'sunny' }],
]);

const getWeather = defineTool({
  name: 'getWeather',
  description: 'Get current weather for a city',
  input: z.object({ city: z.string().describe('City name, lowercase') }),
  output: z.object({ tempC: z.number(), description: z.string() }),
  impl: async ({ city }) => {
    const entry = db.get(city);
    if (!entry) throw new Error(`Unknown city: ${city}`);
    return entry;
  },
});

const listCities = defineTool({
  name: 'listCities',
  description: 'List all known cities',
  input: z.object({}),
  output: z.array(z.string()),
  impl: async () => [...db.keys()],
});

const runtime = createRuntime({
  tools: [getWeather, listCities],
  checker: 'in-process',
  sandbox: 'quickjs',
  maxRepairs: 2,
  limits: { timeoutMs: 5_000, memoryMb: 32 },
});

afterAll(() => runtime.dispose());

describe('end-to-end execute()', () => {
  it('chains tool calls with data dependencies and returns only the final value', async () => {
    const result = await runtime.execute(
      [
        'const cities = await listCities();',
        'const weather: { city: string; tempC: number }[] = [];',
        'for (const city of cities) {',
        '  const w = await getWeather({ city });',
        '  weather.push({ city, tempC: w.tempC });',
        '}',
        'weather.sort((a, b) => b.tempC - a.tempC);',
        'console.log(`checked ${cities.length} cities`);',
        'return weather[0];',
      ].join('\n'),
    );
    expect(result).toEqual({
      ok: true,
      value: { city: 'rome', tempC: 31 },
      logs: ['checked 2 cities'],
    });
  });

  it('returns diagnostics for a mistyped program, then passes after one repair', async () => {
    const bad = await runtime.execute('return await getWeather({ city: 42 });');
    expect(bad.ok).toBe(false);
    if (bad.ok || bad.phase !== 'check') throw new Error('expected check failure');
    expect(bad.diagnostics[0]!.line).toBe(1);
    expect(bad.repairsRemaining).toBe(1);

    const fixed = await runtime.execute("return await getWeather({ city: 'rome' });");
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(fixed.value).toEqual({ tempC: 31, description: 'sunny' });
  });

  it('surfaces tool impl failures as runtime errors with the model-source line', async () => {
    const result = await runtime.execute(
      ["const w = await getWeather({ city: 'atlantis' });", 'return w;'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.phase !== 'runtime') throw new Error('expected runtime failure');
    expect(result.error.message).toMatch(/Unknown city: atlantis/);
    expect(result.error.name).toBe('ToolCallError');
  });

  it('rejects invalid tool input crossing the sandbox boundary at runtime', async () => {
    // Bypass the checker to prove the host-side Zod validation also guards the boundary.
    const unchecked = createRuntime({
      tools: [getWeather],
      checker: 'none',
      limits: { timeoutMs: 5_000, memoryMb: 32 },
    });
    const result = await unchecked.execute('return await getWeather({ city: 42 as never });');
    expect(result.ok).toBe(false);
    if (result.ok || result.phase !== 'runtime') throw new Error('expected runtime failure');
    expect(result.error.message).toMatch(/Invalid input/);
    await unchecked.dispose();
  });

  it('reports limit results for runaway programs', async () => {
    const result = await runtime.execute('while (true) {}');
    expect(result).toMatchObject({ ok: false, phase: 'limit', kind: 'timeout' });
  }, 15_000);
});
