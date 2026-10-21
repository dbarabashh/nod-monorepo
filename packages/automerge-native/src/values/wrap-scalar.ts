import { isRecord } from '../guards.ts';
import { exportScalar } from './export-scalar.ts';
import { DATATYPE, RAW_DATA, setHidden } from './hidden.ts';
import type { Externals } from './import-object.ts';

/**
 * Port of ExportCache::wrap_scalar: a registered datatype becomes its JS class,
 * carrying the raw value and datatype as hidden properties.
 */
export function wrapScalar(scalar: unknown, externals: Externals): unknown {
  const [datatype, raw] = exportScalar(scalar);
  const external = externals.get(datatype);
  if (!external) {
    return raw;
  }
  const wrapped = external.construct(raw);
  if (!isRecord(wrapped)) {
    throw new Error(
      `data handler for type ${datatype} did not return an object`,
    );
  }
  setHidden(wrapped, RAW_DATA, raw);
  setHidden(wrapped, DATATYPE, datatype);
  return wrapped;
}

/** Port of export_patch's scalar export: registered datatypes, but no hidden properties. */
export function constructScalar(
  scalar: unknown,
  externals: Externals,
): unknown {
  const [datatype, raw] = exportScalar(scalar);
  const external = externals.get(datatype);
  return external ? external.construct(raw) : raw;
}
