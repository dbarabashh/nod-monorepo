export const RAW_DATA = Symbol.for('_am_raw_value_');
export const DATATYPE = Symbol.for('_am_datatype_');
export const RAW_OBJECT = Symbol.for('_am_objectId');
export const META = Symbol.for('_am_meta');

export function setHidden(target: object, key: symbol, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}
