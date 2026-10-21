import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fingerprintScenarios,
  runScenarios,
} from '../src/testing/scenarios.ts';

const fixtures = fingerprintScenarios(runScenarios());
await writeFile(
  path.join(
    import.meta.dirname,
    '..',
    'src',
    'testing',
    'scenario-fixtures.ts',
  ),
  `export const scenarioFixtures: Record<string, string> = ${JSON.stringify(fixtures)};\n`,
);
