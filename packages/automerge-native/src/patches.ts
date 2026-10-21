import { arrayOf, isRecord, stringOf } from './guards.ts';
import { exportScalar, isObjectType } from './values/export-scalar.ts';
import type { Externals } from './values/import-object.ts';
import { constructScalar } from './values/wrap-scalar.ts';

type Patch = Record<string, unknown>;

// Port of export_patch: object values become empty placeholders.
function patchValue(value: unknown, externals: Externals): unknown {
  if (isRecord(value) && isObjectType(value.t)) {
    switch (value.t) {
      case 'list':
        return [];
      case 'text':
        return '';
      default:
        return {};
    }
  }
  return constructScalar(value, externals);
}

function plainScalar(value: unknown): unknown {
  return exportScalar(value)[1];
}

function markEntry(mark: unknown): [string, unknown] {
  if (!Array.isArray(mark)) {
    throw new Error('expected a mark from the native backend');
  }
  return [stringOf(mark[0]), plainScalar(mark[1])];
}

// The Rust side always sends every field; wasm leaves out the defaults.
function exportPatch(patch: unknown, externals: Externals): Patch {
  if (!isRecord(patch)) {
    throw new Error('expected a patch from the native backend');
  }
  const out: Patch = { action: patch.action, path: patch.path };
  switch (patch.action) {
    case 'put':
      out.value = patchValue(patch.value, externals);
      if (patch.conflict === true) {
        out.conflict = true;
      }
      break;
    case 'insert': {
      out.values = arrayOf(patch.values, (value) =>
        patchValue(value, externals),
      );
      const conflicts = arrayOf(
        patch.conflicts,
        (conflict) => conflict === true,
      );
      if (conflicts.includes(true)) {
        out.conflicts = conflicts;
      }
      break;
    }
    case 'splice':
      out.value = patch.value;
      if (Array.isArray(patch.marks)) {
        out.marks = Object.fromEntries(arrayOf(patch.marks, markEntry));
      }
      break;
    case 'inc':
      out.value = patch.value;
      break;
    case 'del':
      if (typeof patch.length === 'number' && patch.length > 1) {
        out.length = patch.length;
      }
      break;
    case 'mark':
      out.marks = arrayOf(patch.marks, (mark) =>
        isRecord(mark) ? { ...mark, value: plainScalar(mark.value) } : mark,
      );
      break;
    default:
      break;
  }
  return out;
}

export function exportPatches(patches: unknown, externals: Externals): Patch[] {
  return arrayOf(patches, (patch) => exportPatch(patch, externals));
}
