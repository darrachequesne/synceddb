import type {
  DBSchema,
  IDBPCursor,
  IDBPCursorWithValue,
  IDBPDatabase,
  IDBPIndex,
  IDBPObjectStore,
  IDBPTransaction,
  StoreNames,
} from './entry.js';
import { Constructor, Func, instanceOfAny } from './util.js';
import {
  LOCAL_CHANGES_STORE,
  IGNORED_STORES,
  VERSION_ATTRIBUTE,
  CHANGE_EVENT_NAME,
  BROADCAST_CHANNEL_NAME,
} from './constants.js';

let idbProxyableTypes: Constructor[];
let cursorAdvanceMethods: Func[];

// This is a function to prevent it throwing up in node environments.
function getIdbProxyableTypes(): Constructor[] {
  return (
    idbProxyableTypes ||
    (idbProxyableTypes = [
      IDBDatabase,
      IDBObjectStore,
      IDBIndex,
      IDBCursor,
      IDBTransaction,
    ])
  );
}

// This is a function to prevent it throwing up in node environments.
function getCursorAdvanceMethods(): Func[] {
  return (
    cursorAdvanceMethods ||
    (cursorAdvanceMethods = [
      IDBCursor.prototype.advance,
      IDBCursor.prototype.continue,
      IDBCursor.prototype.continuePrimaryKey,
    ])
  );
}

const writeMethods = [
  IDBObjectStore.prototype.add,
  IDBObjectStore.prototype.put,
  IDBObjectStore.prototype.delete,
  IDBObjectStore.prototype.clear,
];

export class UpdateEvent extends Event {
  constructor(readonly impactedStores: string[]) {
    super(CHANGE_EVENT_NAME);
  }
}

let channel: BroadcastChannel;

if (typeof BroadcastChannel === 'function') {
  channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  channel.onmessage = (evt) => {
    const impactedStores = evt.data as string[];
    dispatchEvent(new UpdateEvent(impactedStores));
  };
}

const cursorRequestMap: WeakMap<
  IDBPCursor,
  IDBRequest<IDBCursor>
> = new WeakMap();
const transactionDoneMap: WeakMap<
  IDBTransaction,
  Promise<void>
> = new WeakMap();
const transactionStoreNamesMap: WeakMap<IDBTransaction, string[]> =
  new WeakMap();
const transformCache = new WeakMap();
export const reverseTransformCache = new WeakMap();

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  const promise = new Promise<T>((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener('success', success);
      request.removeEventListener('error', error);
    };
    const success = () => {
      resolve(wrap(request.result as any) as any);
      unlisten();
    };
    const error = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener('success', success);
    request.addEventListener('error', error);
  });

  promise
    .then((value) => {
      // Since cursoring reuses the IDBRequest (*sigh*), we cache it for later retrieval
      // (see wrapFunction).
      if (value instanceof IDBCursor) {
        cursorRequestMap.set(
          value as unknown as IDBPCursor,
          request as unknown as IDBRequest<IDBCursor>,
        );
      }
      // Catching to avoid "Uncaught Promise exceptions"
    })
    .catch(() => {});

  // This mapping exists in reverseTransformCache but doesn't doesn't exist in transformCache. This
  // is because we create many promises from a single IDBRequest.
  reverseTransformCache.set(promise, request);
  return promise;
}

function cacheDonePromiseForTransaction(tx: IDBTransaction): void {
  // Early bail if we've already created a done promise for this transaction.
  if (transactionDoneMap.has(tx)) return;

  const done = new Promise<void>((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener('complete', complete);
      tx.removeEventListener('error', error);
      tx.removeEventListener('abort', error);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error = () => {
      reject(tx.error || new DOMException('AbortError', 'AbortError'));
      unlisten();
    };
    tx.addEventListener('complete', complete);
    tx.addEventListener('error', error);
    tx.addEventListener('abort', error);
  });

  // Cache it for later retrieval.
  transactionDoneMap.set(tx, done);
}

let idbProxyTraps: ProxyHandler<any> = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      // Special handling for transaction.done.
      if (prop === 'done') return transactionDoneMap.get(target);
      // Polyfill for objectStoreNames because of Edge.
      if (prop === 'objectStoreNames') {
        return target.objectStoreNames || transactionStoreNamesMap.get(target);
      }
      // Make tx.store return the only store in the transaction, or undefined if there are many.
      if (prop === 'store') {
        const storeNames =
          receiver._initialStoreNames || receiver.objectStoreNames;
        return storeNames.length === 1
          ? receiver.objectStore(storeNames[0])
          : undefined;
      }
    }
    // Else transform whatever we get back.
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (
      target instanceof IDBTransaction &&
      (prop === 'done' || prop === 'store')
    ) {
      return true;
    }
    return prop in target;
  },
};

export function replaceTraps(
  callback: (currentTraps: ProxyHandler<any>) => ProxyHandler<any>,
): void {
  idbProxyTraps = callback(idbProxyTraps);
}

interface Change<DBTypes extends DBSchema | unknown = unknown> {
  operation: 'add' | 'put' | 'delete';
  storeName: StoreNames<DBTypes>;
  key: any;
  value?: any;
}

type ChangeHandler<DBTypes extends DBSchema | unknown = unknown> = (
  tx: IDBPTransaction<DBTypes, StoreNames<DBTypes>[], 'readwrite'>,
  change: Change<DBTypes>,
) => Promise<void>;

const computedStores = new Map<
  string,
  { storeNames: string[]; onChange: ChangeHandler }
>();

export function isComputedStore(storeName: string) {
  return computedStores.has(storeName);
}

export async function createComputedStore<DBTypes>(
  db: IDBPDatabase<DBTypes>,
  computedStoreName: StoreNames<DBTypes>,
  mainStoreName: StoreNames<DBTypes>,
  secondaryStoreNames: Array<StoreNames<DBTypes>>,
  onChange: ChangeHandler<DBTypes>,
): Promise<void> {
  // @ts-expect-error
  computedStores.set(computedStoreName, {
    storeNames: [mainStoreName, ...secondaryStoreNames],
    onChange,
  });

  const tx = db.transaction(
    [computedStoreName, mainStoreName, ...secondaryStoreNames],
    'readwrite',
  );

  const computedStore = tx.objectStore(computedStoreName);
  // @ts-expect-error the flag is used to prevent a partial init
  const initFlag = await computedStore.get('__init_complete');

  if (initFlag) {
    return;
  }

  let cursor = await tx.objectStore(mainStoreName).openCursor();
  while (cursor) {
    await onChange(tx, {
      storeName: mainStoreName,
      operation: 'add',
      key: cursor.key,
      value: cursor.value,
    });
    cursor = await cursor.continue();
  }
  // @ts-expect-error
  await computedStore.add({
    [computedStore.keyPath as string]: '__init_complete',
  });

  await tx.done;
}

function pushIfMissing<T>(array: T[], e: T): void {
  if (!array.includes(e)) {
    array.push(e);
  }
}

function includesAny<T>(array1: T[], array2: T[]): boolean {
  return array2.some((e) => array1.includes(e));
}

function wrapFunction<T extends Func>(func: T): Function {
  // Due to expected object equality (which is enforced by the caching in `wrap`), we
  // only create one new func per func.

  // Edge doesn't support objectStoreNames (booo), so we polyfill it here.
  if (
    func === IDBDatabase.prototype.transaction &&
    !('objectStoreNames' in IDBTransaction.prototype)
  ) {
    return function (
      this: IDBPDatabase,
      storeNames: string | string[],
      ...args: any[]
    ) {
      const tx = func.call(unwrap(this), storeNames, ...args);
      transactionStoreNamesMap.set(
        tx,
        (storeNames as any).sort ? (storeNames as any[]).sort() : [storeNames],
      );
      return wrap(tx);
    };
  }

  // Cursor methods are special, as the behaviour is a little more different to standard IDB. In
  // IDB, you advance the cursor and wait for a new 'success' on the IDBRequest that gave you the
  // cursor. It's kinda like a promise that can resolve with many values. That doesn't make sense
  // with real promises, so each advance methods returns a new promise for the cursor object, or
  // undefined if the end of the cursor has been reached.
  if (getCursorAdvanceMethods().includes(func)) {
    return function (this: IDBPCursor, ...args: Parameters<T>) {
      // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
      // the original object.
      func.apply(unwrap(this), args);
      return wrap(cursorRequestMap.get(this)!);
    };
  }

  return function (this: any, ...args: Parameters<T>) {
    if (
      func === IDBDatabase.prototype.transaction &&
      args[1] === 'readwrite' &&
      args[0] !== LOCAL_CHANGES_STORE
    ) {
      if (!Array.isArray(args[0])) {
        args[0] = [args[0]];
      }
      const initialStoreNames = args[0].slice(0);
      // transform `db.transaction("my-store", "readwrite")` into `db.transaction(["my-store", "_local_changes"], "readwrite")`
      pushIfMissing(args[0], LOCAL_CHANGES_STORE);

      for (const [computedStoreName, { storeNames }] of computedStores) {
        if (includesAny(storeNames, args[0])) {
          pushIfMissing(args[0], computedStoreName);
          for (const storeName of storeNames) {
            pushIfMissing(args[0], storeName);
          }
        }
      }

      // @ts-ignore
      const transaction = wrap(
        func.apply(unwrap(this), args),
      ) as IDBPTransaction;
      // @ts-expect-error store the initial values to resolve `transaction.store` later
      transaction._initialStoreNames = initialStoreNames;
      transaction.done.then(() => {
        const impactedStores = Array.from(transaction.objectStoreNames);
        // notify LiveQueries in the same browser tab
        dispatchEvent(new UpdateEvent(impactedStores));
        // notify other browser tabs
        channel?.postMessage(impactedStores);
      });
      return transaction;
    }
    // track any update into the _local_changes store
    if (writeMethods.includes(func)) {
      const storeName = this.name;

      if (!IGNORED_STORES.includes(storeName) && !isComputedStore(storeName)) {
        // updates from the server are not tracked, i.e. `store.add(value, key, true)` or `store.delete(key, true)`
        const isUpdateIgnored =
          args.length === 3 ||
          (args.length === 2 && func === IDBObjectStore.prototype.delete);

        if (!isUpdateIgnored || computedStores.size > 0) {
          const store = this.transaction.objectStore(LOCAL_CHANGES_STORE);

          const computeChange = (callback: (change: Change) => void) => {
            const change: any = {
              operation: func.name,
              storeName,
            };

            switch (func) {
              case IDBObjectStore.prototype.clear:
                change.operation = 'delete';
                this.getAllKeys().then((keys: IDBValidKey[]) => {
                  keys.forEach((key) => {
                    change.key = key;
                    callback(change);
                  });
                });
                break;

              case IDBObjectStore.prototype.delete:
                change.key = args[0];
                callback(change);
                break;

              default: // store the full entity
                // add or put
                const value = args[0];
                const key = args[1] || value[this.keyPath];

                change.key = key;
                change.value = value;
                callback(change);
                break;
            }
          };

          computeChange((change) => {
            if (!isUpdateIgnored) {
              if (typeof change.value === 'object') {
                change.value[VERSION_ATTRIBUTE] =
                  (change.value[VERSION_ATTRIBUTE] || 0) + 1;
              }
              store.add(change);
            }

            for (const [_, { storeNames, onChange }] of computedStores) {
              if (storeNames.includes(storeName)) {
                onChange(this.transaction, change);
              }
            }
          });
        }
      }
    }
    // Calling the original function with the proxy as 'this' causes ILLEGAL INVOCATION, so we use
    // the original object.
    return wrap(func.apply(unwrap(this), args));
  };
}

function transformCachableValue(value: any): any {
  if (typeof value === 'function') return wrapFunction(value);

  // This doesn't return, it just creates a 'done' promise for the transaction,
  // which is later returned for transaction.done (see idbObjectHandler).
  if (value instanceof IDBTransaction) cacheDonePromiseForTransaction(value);

  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);

  // Return the same value back if we're not going to transform it.
  return value;
}

/**
 * Enhance an IDB object with helpers.
 *
 * @param value The thing to enhance.
 */
export function wrap(value: IDBDatabase): IDBPDatabase;
export function wrap(value: IDBIndex): IDBPIndex;
export function wrap(value: IDBObjectStore): IDBPObjectStore;
export function wrap(value: IDBTransaction): IDBPTransaction;
export function wrap(
  value: IDBOpenDBRequest,
): Promise<IDBPDatabase | undefined>;
export function wrap<T>(value: IDBRequest<T>): Promise<T>;
export function wrap(value: any): any {
  // We sometimes generate multiple promises from a single IDBRequest (eg when cursoring), because
  // IDB is weird and a single IDBRequest can yield many responses, so these can't be cached.
  if (value instanceof IDBRequest) return promisifyRequest(value);

  // If we've already transformed this value before, reuse the transformed value.
  // This is faster, but it also provides object equality.
  if (transformCache.has(value)) return transformCache.get(value);
  const newValue = transformCachableValue(value);

  // Not all types are transformed.
  // These may be primitive types, so they can't be WeakMap keys.
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }

  return newValue;
}

/**
 * Revert an enhanced IDB object to a plain old miserable IDB one.
 *
 * Will also revert a promise back to an IDBRequest.
 *
 * @param value The enhanced object to revert.
 */
interface Unwrap {
  (value: IDBPCursorWithValue<any, any, any, any, any>): IDBCursorWithValue;
  (value: IDBPCursor<any, any, any, any, any>): IDBCursor;
  (value: IDBPDatabase): IDBDatabase;
  (value: IDBPIndex<any, any, any, any, any>): IDBIndex;
  (value: IDBPObjectStore<any, any, any, any>): IDBObjectStore;
  (value: IDBPTransaction<any, any, any>): IDBTransaction;
  <T extends any>(value: Promise<IDBPDatabase<T>>): IDBOpenDBRequest;
  (value: Promise<IDBPDatabase>): IDBOpenDBRequest;
  <T>(value: Promise<T>): IDBRequest<T>;
}
export const unwrap: Unwrap = (value: any): any =>
  reverseTransformCache.get(value);
