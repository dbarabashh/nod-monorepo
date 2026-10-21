/**
 * A typed value as the Rust library takes it (rust/src/protocol.rs). Numbers
 * travel as decimal strings, because a JSON number would lose 64-bit integers,
 * -0 and infinities; bytes travel as base64.
 */
export type Scalar =
  | { t: 'str'; v: string }
  | { t: 'int' | 'uint' | 'f64' | 'counter' | 'timestamp'; v: string }
  | { t: 'boolean'; v: boolean }
  | { t: 'null' }
  | { t: 'bytes'; v: string };

export type Tree =
  | { t: 'map'; v: [string, Tree][] }
  | { t: 'list'; v: Tree[] }
  | { t: 'text'; v: string }
  | Scalar;

export type Key = string | number;
type Heads = string[] | undefined;

type Lifecycle =
  | { op: 'info' }
  | { op: 'create'; actor?: string }
  | {
      op: 'load';
      bytes: string;
      actor?: string;
      unchecked?: boolean;
      allowMissingDeps?: boolean;
      convertImmutableStringsToText?: boolean;
    }
  | { op: 'free'; doc: number }
  | { op: 'clone'; doc: number; actor?: string }
  | { op: 'fork'; doc: number; actor?: string; heads?: Heads }
  | { op: 'merge' | 'getChangesAdded'; doc: number; other: number };

/** An operation on one document, without its handle. */
export type DocOp =
  | {
      op: 'put' | 'putObject' | 'putObjectFromHydrate';
      obj: string;
      prop: Key;
      value: Tree;
    }
  | {
      op: 'insert' | 'insertObject' | 'insertObjectFromHydrate';
      obj: string;
      index: number;
      value: Tree;
    }
  | { op: 'push' | 'pushObject'; obj: string; value: Tree }
  | {
      op: 'spliceFromHydrate';
      obj: string;
      index: number;
      delete: number;
      values: Tree[];
    }
  | { op: 'initRootFromHydrate'; value: Tree }
  | {
      op: 'splice';
      obj: string;
      start: number;
      delete: number;
      text?: string;
      values?: Tree[];
    }
  | { op: 'updateText'; obj: string; text: string }
  | { op: 'delete'; obj: string; prop: Key }
  | { op: 'increment'; obj: string; prop: Key; value: number }
  | { op: 'commit' | 'emptyChange'; message?: string; time?: number }
  | { op: 'keys' | 'length' | 'text'; obj: string; heads?: Heads }
  | { op: 'getWithType' | 'getAll'; obj: string; prop: Key; heads?: Heads }
  | { op: 'materialize'; obj: string; heads?: Heads; updateCursor?: boolean }
  | { op: 'saveSince' | 'getChanges' | 'getMissingDeps'; heads?: Heads }
  | { op: 'isolate'; heads: string[] }
  | { op: 'loadIncremental'; bytes: string }
  | { op: 'applyChanges'; changes: string[] }
  | {
      op:
        | 'rollback'
        | 'pendingOps'
        | 'getHeads'
        | 'getActorId'
        | 'save'
        | 'saveIncremental'
        | 'getLastLocalChange'
        | 'integrate'
        | 'updateDiffCursor'
        | 'resetDiffCursor'
        | 'diffIncremental';
    };

export type Request = Lifecycle | (DocOp & { doc: number });
