/**
 * Framework-free demo of the toolweave loop.
 *
 * 1. Define tools with Zod schemas.
 * 2. Print the declarations you would hand to your model.
 * 3. Execute a program "the model wrote" — first a broken one to show the
 *    diagnostic feedback, then the repaired version.
 */
import { z } from 'zod';
import { createRuntime, defineTool } from 'toolweave';

const stations = new Map([
  ['berlin', { tempC: 18, wind: 22 }],
  ['rome', { tempC: 31, wind: 9 }],
  ['oslo', { tempC: 11, wind: 30 }],
]);

const listCities = defineTool({
  name: 'listCities',
  description: 'List all cities with a weather station',
  input: z.object({}),
  output: z.array(z.string()),
  impl: async () => [...stations.keys()],
});

const getWeather = defineTool({
  name: 'getWeather',
  description: 'Read the current weather at a city station',
  input: z.object({ city: z.string().describe('Lowercase city name') }),
  output: z.object({ tempC: z.number(), wind: z.number() }),
  impl: async ({ city }) => {
    const reading = stations.get(city);
    if (!reading) throw new Error(`No station in ${city}`);
    return reading;
  },
});

const runtime = createRuntime({
  tools: [listCities, getWeather],
  checker: 'in-process',
  sandbox: 'quickjs',
  maxRepairs: 2,
});

console.log('=== declarations handed to the model ===\n');
console.log(runtime.declarations());

console.log('=== a broken program comes back with diagnostics ===\n');
const broken = await runtime.execute('return await getWeather({ town: "rome" });');
console.log(JSON.stringify(broken, null, 2));

console.log('\n=== the repaired program runs in the sandbox ===\n');
const repaired = await runtime.execute(
  [
    'const cities = await listCities();',
    'let warmest = { city: "", tempC: -Infinity };',
    'for (const city of cities) {',
    '  const w = await getWeather({ city });',
    '  if (w.tempC > warmest.tempC) warmest = { city, tempC: w.tempC };',
    '}',
    'console.log(`compared ${cities.length} cities`);',
    'return warmest;',
  ].join('\n'),
);
console.log(JSON.stringify(repaired, null, 2));

await runtime.dispose();
