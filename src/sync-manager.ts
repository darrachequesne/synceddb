import { IDBPDatabase } from './entry.js';
import {
  LOCAL_OFFSETS_STORE,
  IGNORED_STORES,
  LOCAL_CHANGES_STORE,
  VERSION_ATTRIBUTE,
  CHANGE_EVENT_NAME,
} from './constants.js';

const OPERATION_TO_METHOD = new Map([
  ['add', 'POST'],
  ['put', 'PUT'],
  ['delete', 'DELETE'],
]);

const MIN_DELAY_BETWEEN_REQUESTS = 50;
const DEFAULT_RETRY_DELAY = 10000;
const LOCK_TTL = 60 * 1000;
const NO_TRACKING_FLAG = true;

// format of entities in the _local_changes store
interface Change {
  operation: 'add' | 'put' | 'delete';
  storeName: string;
  key: IDBValidKey;
  value?: any;
  syncInProgressSince?: number;
}

// format of entities in the _local_offsets store
interface Offset {
  id: IDBValidKey;
  updatedAt: any;
}

export interface SyncOptions {
  /**
   * Allow to override the request path for a given request
   */
  buildPath: (operation: 'fetch' | 'add' | 'put' | 'delete', storeName: string, key?: IDBValidKey) => string | undefined;
  /**
   * Additional options for all HTTP requests.
   *
   * Reference: https://developer.mozilla.org/en-US/docs/Web/API/fetch
   */
  fetchOptions: any;
  /**
   * Allow to override the query params of the fetch requests. Defaults to "?sort=updated_at:asc&size=100&after=2000-01-01T00:00:00.000Z,123".
   *
   * @param storeName
   * @param offset
   */
  buildFetchParams: (storeName: string, offset: Offset) => URLSearchParams;
  /**
   * The name of the attribute that indicates the last updated date of the entity.
   *
   * @default "updatedAt"
   */
  updatedAtAttribute: string;
  /**
   * The number of ms between two fetch requests for a given store.
   *
   * @default 30000
   */
  fetchInterval: number;
  /**
   * Entities without `keyPath`.
   *
   * @example
   * {
   *   withoutKeyPath: {
   *     common: [
   *       "user"
   *     ]
   *   }
   * }
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/keyPath
   */
  withoutKeyPath: Record<string, IDBValidKey[]>;
}

class FetchError extends Error {
  constructor(message: string, readonly response?: Response) {
    super('Error while fetching changes: ' + message);
  }
}

const defaultBuildPath = (operation: 'fetch' | 'add' | 'put' | 'delete', storeName: string, key?: IDBValidKey) => {
  if (operation === 'fetch' || operation === 'add') {
    return `/${storeName}`;
  } else {
    return `/${storeName}/${key}`;
  }
}

const defaultBuildFetchParams = (storeName: string, offset: Offset) => {
  const searchParams = new URLSearchParams({
    sort: 'updated_at:asc',
    size: '100',
  });
  if (offset) {
    searchParams.append('after', offset.updatedAt);
    searchParams.append('after_id', offset.id.toString());
  }
  return searchParams;
};

export class SyncManager {
  private readonly opts: SyncOptions;
  private isOnline: boolean = true;

  private fetchLoop?: FetchLoop;
  private pushLoop?: PushLoop;

  constructor(
    private readonly db: IDBPDatabase,
    private readonly baseUrl: string,
    opts: Partial<SyncOptions> = {},
  ) {
    this.opts = {
      buildPath: opts.buildPath || defaultBuildPath,
      fetchOptions: opts.fetchOptions || {},
      buildFetchParams: opts.buildFetchParams || defaultBuildFetchParams,
      updatedAtAttribute: opts.updatedAtAttribute || 'updatedAt',
      fetchInterval: opts.fetchInterval || 30_000,
      withoutKeyPath: opts.withoutKeyPath || {},
    };
    this.handleOnlineEvent = this.handleOnlineEvent.bind(this);
    this.handleOfflineEvent = this.handleOfflineEvent.bind(this);
    this.handleUpdateEvent = this.handleUpdateEvent.bind(this);
  }

  /**
   * Starts the sync process with the remote server
   */
  public start() {
    const listenToNetworkEvents =
      typeof window !== undefined &&
      !this.baseUrl.startsWith('http://localhost');
    if (listenToNetworkEvents) {
      this.isOnline = navigator.onLine;
      window.addEventListener('online', this.handleOnlineEvent);
      window.addEventListener('offline', this.handleOfflineEvent);
    }
    addEventListener(CHANGE_EVENT_NAME, this.handleUpdateEvent);
    this.startLoops();
  }

  /**
   * Stops the sync process
   */
  public stop() {
    if (typeof window !== undefined) {
      window.removeEventListener('online', this.handleOnlineEvent);
      window.removeEventListener('offline', this.handleOfflineEvent);
    }
    removeEventListener(CHANGE_EVENT_NAME, this.handleUpdateEvent);
    this.cancelLoops();
  }

  private handleOnlineEvent() {
    this.isOnline = true;
    this.startLoops();
  }

  private startLoops() {
    if (!this.isOnline) {
      return;
    }
    if (!this.fetchLoop) {
      this.fetchLoop = new FetchLoop(this, this.db, this.baseUrl, this.opts);
    }
    if (!this.pushLoop) {
      this.pushLoop = new PushLoop(this, this.db, this.baseUrl, this.opts);
      this.pushLoop.oncomplete = () => {
        this.pushLoop = undefined;
      };
    }
  }

  private cancelLoops() {
    if (this.fetchLoop) {
      this.fetchLoop.cancel();
      this.fetchLoop = undefined;
    }
    if (this.pushLoop) {
      this.pushLoop.cancel();
      this.pushLoop = undefined;
    }
  }

  private handleOfflineEvent() {
    this.isOnline = false;
    this.cancelLoops();
  }

  private handleUpdateEvent() {
    if (!this.pushLoop) {
      this.pushLoop = new PushLoop(this, this.db, this.baseUrl, this.opts);
      this.pushLoop.oncomplete = () => {
        this.pushLoop = undefined;
      };
    }
  }

  /**
   * Clears the local stores
   */
  public clear() {
    return Promise.all([
      this.db.clear(LOCAL_OFFSETS_STORE),
      this.db.clear(LOCAL_CHANGES_STORE),
    ]);
  }

  /**
   * Returns whether a given entity currently has local changes that are not synced yet.
   *
   * @param storeName
   * @param key
   */
  public hasLocalChanges(storeName: string, key: IDBValidKey): Promise<boolean> {
    return this.db
      .countFromIndex(LOCAL_CHANGES_STORE, 'storeName, key', [storeName, key])
      .then((count) => count > 0);
  }

  /**
   * Called after some entities are successfully fetched from the remote server.
   *
   * @param storeName
   * @param entities
   * @param hasMore
   */
  public onfetchsuccess(storeName: string, entities: any[], hasMore: boolean) {}

  /**
   * Called when something goes wrong when fetching the changes from the remote server.
   * @param error
   */
  public onfetcherror(error: FetchError) {}

  /**
   * Called after a change is successfully pushed to the remote server.
   *
   * @param change
   */
  public onpushsuccess(change: Change) {}

  /**
   * Called when something goes wrong when pushing a change to the remote server.
   *
   * @param change
   * @param response
   * @param retryAfter
   * @param discardLocalChange
   * @param overrideRemoteChange
   */
  public onpusherror(
    change: Change,
    response: Response,
    retryAfter: (delay: number) => void,
    discardLocalChange: () => void,
    overrideRemoteChange: (entity: any) => void,
  ) {
    switch (response.status) {
      case 403:
      case 404:
        return discardLocalChange();
      case 409:
        response.json().then((content) => {
          const version = content[VERSION_ATTRIBUTE];
          change.value[VERSION_ATTRIBUTE] = version + 1;
          overrideRemoteChange(change.value);
        });
        break;
      default:
        return retryAfter(DEFAULT_RETRY_DELAY);
    }
  }
}

abstract class Loop {
  protected isRunning: boolean = true;

  constructor(
    protected readonly manager: SyncManager,
    protected readonly db: IDBPDatabase,
    protected readonly baseUrl: string,
    protected readonly opts: SyncOptions,
  ) {
    this.run();
  }

  abstract run(): void;

  public cancel() {
    this.isRunning = false;
  }
}

function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

class FetchLoop extends Loop {
  async run() {
    if (!this.isRunning) {
      return;
    }
    const storeNames = this.db.objectStoreNames;

    try {
      for (let storeName of storeNames) {
        if (
          !IGNORED_STORES.includes(storeName) &&
          !this.opts.withoutKeyPath[storeName]
        ) {
          while (await this.fetchUpdates(storeName)) {
            await sleep(MIN_DELAY_BETWEEN_REQUESTS);
          }
        }
      }
      for (const storeName in this.opts.withoutKeyPath) {
        for (const key of this.opts.withoutKeyPath[storeName]) {
          await this.fetchUpdatesForKey(storeName, key);
        }
      }
    } catch (e) {
      this.manager.onfetcherror(e);
    }

    setTimeout(() => this.run(), this.opts.fetchInterval);
  }

  private async fetchUpdates(storeName: string): Promise<boolean> {
    const path = this.opts.buildPath('fetch', storeName) || defaultBuildPath( 'fetch', storeName);
    const url = this.baseUrl + path;
    const lastUpdatedEntity = await this.db.get(LOCAL_OFFSETS_STORE, storeName);
    const searchParams = this.opts.buildFetchParams(
      storeName,
      lastUpdatedEntity,
    );

    let response;
    try {
      response = await fetch(`${url}?${searchParams}`, {
        ...this.opts.fetchOptions,
      });
    } catch (e) {
      throw new FetchError(e.message);
    }

    if (!response.ok) {
      throw new FetchError('unexpected response from server', response);
    }

    const content = await response.json();

    if (!Array.isArray(content.data)) {
      throw new FetchError('invalid response format', response);
    }

    const items = content.data;

    if (items.length === 0) {
      this.manager.onfetchsuccess(storeName, items, content.hasMore);
      return false;
    }

    const transaction = this.db.transaction(
      [LOCAL_CHANGES_STORE, LOCAL_OFFSETS_STORE, storeName],
      'readwrite',
    );
    const store = transaction.objectStore(storeName);
    const keyPath = store.keyPath as string;
    const changeIndex = transaction
      .objectStore(LOCAL_CHANGES_STORE)
      .index('storeName, key');

    for (const entity of items) {
      const hasLocalUpdates = await changeIndex.count([
        storeName,
        entity[keyPath],
      ]);
      if (hasLocalUpdates) {
        continue;
      }
      const isTombstone = entity[VERSION_ATTRIBUTE] === -1;
      if (isTombstone) {
        // @ts-ignore
        store.delete(entity[store.keyPath], NO_TRACKING_FLAG);
      } else {
        // @ts-ignore
        store.put(entity, undefined, NO_TRACKING_FLAG);
      }
    }

    const lastEntity = items[items.length - 1];

    transaction.objectStore(LOCAL_OFFSETS_STORE).put(
      {
        id: lastEntity[keyPath],
        updatedAt: lastEntity[this.opts.updatedAtAttribute],
      },
      storeName,
    );

    await transaction.done;

    const hasMore = !!content.hasMore;

    this.manager.onfetchsuccess(storeName, items, hasMore);

    return hasMore;
  }

  private async fetchUpdatesForKey(
    storeName: string,
    key: IDBValidKey,
  ): Promise<void> {
    const path =
      this.opts.buildPath('fetch', storeName, key) ||
      defaultBuildPath('fetch', storeName, key);

    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...this.opts.fetchOptions,
      });
    } catch (e) {
      throw new FetchError(e.message);
    }

    if (!response.ok) {
      throw new FetchError('unexpected response from server', response);
    }

    const item = await response.json();

    const transaction = this.db.transaction(
      [LOCAL_CHANGES_STORE, storeName],
      'readwrite',
    );
    const store = transaction.objectStore(storeName);
    const changeIndex = transaction
      .objectStore(LOCAL_CHANGES_STORE)
      .index('storeName, key');

    const [hasLocalUpdates, isUpToDate] = await Promise.all([
      changeIndex.count([storeName, key]),
      store.get(key).then((current) => {
        return current && current.version === item.version;
      }),
    ]);

    if (hasLocalUpdates || isUpToDate) {
      return;
    }

    // @ts-ignore
    await store.put(item, key, NO_TRACKING_FLAG);

    this.manager.onfetchsuccess(storeName, [item], false);
  }
}

class PushLoop extends Loop {
  async run(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const transaction = this.db.transaction(LOCAL_CHANGES_STORE, 'readwrite');
    const cursor = await transaction.store.openCursor();

    const hasSomethingToPush = cursor && cursor.value;
    if (!hasSomethingToPush) {
      return this.oncomplete();
    }

    const change = cursor!.value as Change;
    const syncInProgressSince = change.syncInProgressSince;
    const isSyncAlreadyInProgress =
      syncInProgressSince && Date.now() - syncInProgressSince < LOCK_TTL;
    if (isSyncAlreadyInProgress) {
      return this.oncomplete();
    }

    change.syncInProgressSince = Date.now();
    cursor!.update(change);

    const changeKey = cursor!.key;
    const { operation, storeName, key, value } = change;
    const path = this.opts.buildPath(operation, storeName, key) || defaultBuildPath(operation, storeName, key);
    const url = this.baseUrl + path;
    const method = OPERATION_TO_METHOD.get(operation);

    const rerunAfter = (delay: number) => {
      setTimeout(() => {
        this.run();
      }, delay);
    };

    const retryAfter = async (delay: number) => {
      delete change.syncInProgressSince;

      await this.db.put(LOCAL_CHANGES_STORE, change, changeKey);

      rerunAfter(delay);
    };

    let response;
    try {
      const options = {
        method,
        headers: {},
        ...this.opts.fetchOptions,
      }
      if (value) {
        options.body = JSON.stringify(value);
        options.headers['Content-Type'] = 'application/json';
      }
      response = await fetch(url, options);
    } catch (e) {
      return retryAfter(DEFAULT_RETRY_DELAY);
    }

    if (response.ok) {
      await this.db.delete(LOCAL_CHANGES_STORE, changeKey);

      this.manager.onpushsuccess(change);

      return rerunAfter(MIN_DELAY_BETWEEN_REQUESTS);
    }

    const discardLocalChange = async () => {
      await this.db.delete(LOCAL_CHANGES_STORE, changeKey);

      rerunAfter(MIN_DELAY_BETWEEN_REQUESTS);
    };

    const overrideRemoteChange = async (updatedEntity: any) => {
      change.value = updatedEntity;
      delete change.syncInProgressSince;

      await this.db.put(LOCAL_CHANGES_STORE, change, changeKey);

      rerunAfter(MIN_DELAY_BETWEEN_REQUESTS);
    };

    this.manager.onpusherror(
      change,
      response,
      retryAfter,
      discardLocalChange,
      overrideRemoteChange,
    );
  }

  public oncomplete() {}
}
