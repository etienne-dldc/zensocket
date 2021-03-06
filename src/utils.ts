import immerProduce, { enableMapSet } from 'immer';
import { Subscription, Unsubscribe, VoidSubscriptionCallback } from 'suub';

enableMapSet();

export function expectNever<T extends never>(_val: T): void {
  throw new Error(`Expected never !`);
}

export interface DeepMap<K extends string | number | symbol, T> {
  get(group: K, keys: Array<any>): T | undefined;
  set(group: K, keys: Array<any>, value: T): void;
  delete(group: K, keys: Array<any>): void;
  forEach(exec: (group: K, keys: Array<any>, value: T) => void): void;
  updateEach(exec: (group: K, keys: Array<any>, value: T) => T): void;
  getState(): DeepMapState<K, T>;
  subscribe(callback: VoidSubscriptionCallback): Unsubscribe;
}

export type DeepMapState<K extends string | number | symbol, T> = Map<any, T | DeepMapState<K, T>>;

export interface DeepMapOptions {
  immutable?: boolean;
}

export function createDeepMap<K extends string | number | symbol, T>(
  options: DeepMapOptions = {}
): DeepMap<K, T> {
  const { immutable = false } = options;
  // used to make sure each flow always return the same number of keys
  const keysLength = new Map<K, number>();

  const produce: typeof immerProduce = immutable
    ? immerProduce
    : (((s: any, exec: any) => {
        exec(s);
        return s;
      }) as any);

  let internal: DeepMapState<K, T> = new Map();
  const stateSub = Subscription();

  const result: DeepMap<K, T> = {
    get,
    delete: remove,
    set,
    forEach,
    updateEach,
    getState: () => internal,
    subscribe: stateSub.subscribe
  };

  (result as any).__internal = internal;

  return result;

  function checkKeys(group: K, keys: Array<any>) {
    const v = keysLength.get(group);
    if (!v) {
      keysLength.set(group, keys.length);
    } else {
      if (v !== keys.length) {
        throw new Error(`Invalid keys length for ${group}`);
      }
    }
  }

  function forEach(exec: (group: K, keys: Array<any>, value: T) => void): void {
    internal.forEach((sub, group) => {
      const size = keysLength.get(group);
      if (size === undefined) {
        throw new Error(`Cannot find size for group ${group}`);
      }
      let values: Array<[Array<any>, Map<any, any>]> = [[[], sub as any]];
      for (let i = 0; i < size; i++) {
        const next: Array<[Array<any>, Map<any, any>]> = [];
        values.forEach(([keys, obj]) => {
          obj.forEach((nextObj, k) => {
            next.push([[...keys, k], nextObj]);
          });
        });
        values = next;
      }
      values.forEach(([keys, obj]) => {
        exec(group, keys, obj as any);
      });
    });
  }

  function updateEach(exec: (group: K, keys: Array<any>, value: T) => T): void {
    internal = produce(internal, (draft: DeepMapState<K, T>) => {
      forEach((group, keys, value) => {
        const nextValue = exec(group, keys, value);
        if (nextValue !== value) {
          setInternal(draft, group, keys, nextValue);
        }
      });
    });
    stateSub.emit();
  }

  function remove(group: K, keys: Array<any>) {
    checkKeys(group, keys);
    if (!getInternal(internal, group, keys)) {
      return;
    }
    internal = produce(internal, (draft: DeepMapState<K, T>) => {
      if (keys.length === 0) {
        draft.delete(group);
        return;
      }
      let root = draft.get(group);
      if (!root) {
        return;
      }
      let current: T | DeepMapState<K, T> = root;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (current instanceof Map) {
          if (i === keys.length - 1) {
            // last delete value
            current.delete(key);
          } else {
            let next = current.get(key);
            if (!next) {
              return;
            }
            current = next;
          }
        } else {
          throw new Error(`Expected a Map`);
        }
      }
      // cleanup
      for (let i = 0; i < keys.length; i++) {
        const parentKey = keys.slice(0, keys.length - 1 - i);
        const key = keys[parentKey.length];
        const parent = getInternal(draft, group, parentKey);
        if (parent instanceof Map) {
          const val = parent.get(key);
          if (val && val instanceof Map && val.size === 0) {
            parent.delete(key);
          }
        }
      }
    });
    stateSub.emit();
  }

  function getInternal(obj: DeepMapState<K, T>, group: K, keys: Array<any>): T | undefined {
    const root = obj.get(group);
    if (!root) {
      return undefined;
    }
    let current: T | DeepMapState<K, T> | undefined = root;
    for (const key of keys) {
      if (!current) {
        return undefined;
      }
      if (current instanceof Map) {
        current = current.get(key);
      } else {
        return undefined;
      }
    }
    if (!current) {
      return undefined;
    }
    return current as any;
  }

  function get(group: K, keys: Array<any>): T | undefined {
    checkKeys(group, keys);
    return getInternal(internal, group, keys);
  }

  function setInternal(draft: DeepMapState<K, T>, group: K, keys: Array<any>, value: T) {
    let root = draft.get(group);
    if (keys.length === 0) {
      draft.set(group, value);
      return;
    }
    if (!root) {
      root = new Map();
      draft.set(group, root);
    }
    let current: T | DeepMapState<K, T> = root;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (current instanceof Map) {
        if (i === keys.length - 1) {
          // last set value
          current.set(key, value);
        } else {
          let next = current.get(key);
          if (!next) {
            next = new Map();
            current.set(key, next);
          }
          current = next;
        }
      }
    }
  }

  function set(group: K, keys: Array<any>, value: T) {
    checkKeys(group, keys);
    internal = produce(internal, (draft: DeepMapState<K, T>) => {
      setInternal(draft, group, keys, value);
    });
    stateSub.emit();
  }
}
