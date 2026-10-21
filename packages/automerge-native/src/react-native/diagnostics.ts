import { scenarioFixtures } from '../testing/scenario-fixtures.ts';
import { compareWithFixtures, runScenarios } from '../testing/scenarios.ts';
import { installNativeAutomerge } from './index.ts';

/** Runs the compatibility scenarios and compares them with what wasm wrote. */
export function checkNativeAutomerge(): { name: string; ok: boolean }[] {
  installNativeAutomerge();
  return compareWithFixtures(runScenarios(), scenarioFixtures);
}
