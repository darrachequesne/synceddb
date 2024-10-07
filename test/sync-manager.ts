import 'mocha/mocha';
import chai from 'chai/chai';
import { IDBPDatabase, SyncManager } from '../src/';
import {
  deleteDatabase,
  openDBWithCustomSchema,
  openDBWithSchema,
} from './utils';

const { assert } = chai;
const BASE_URL = 'http://localhost:4000';
const NO_TRACKING_FLAG = true;

async function waitForFetchSuccess(manager: SyncManager, count: number = 1) {
  return new Promise<any[]>((resolve) => {
    manager.onfetchsuccess = (_storeName, entities) => {
      if (--count === 0) {
        resolve(entities);
      }
    };
  });
}

async function waitForPushSuccess(manager: SyncManager, count: number = 1) {
  return new Promise<any>((resolve) => {
    manager.onpushsuccess = (change) => {
      if (--count === 0) {
        resolve(change);
      }
    };
  });
}

suite.only('SyncManager', () => {
  let db: IDBPDatabase;
  let manager: SyncManager;

  teardown('Close DB', async () => {
    if (db) db.close();
    if (manager) manager.stop();
    await deleteDatabase();
  });

  suite('fetch changes', () => {
    test('no conflict', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      manager.start();
      await waitForFetchSuccess(manager);

      const itemCount = await db.count('object-store');

      assert.equal(itemCount, 2);

      const item = await db.get('object-store', 1);

      assert.deepEqual(item, {
        id: 1,
        version: 1,
        label: 'lorem1',
        updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const offset = await db.get('_local_offsets', 'object-store');

      assert.deepEqual(offset, {
        id: 3,
        updatedAt: '2000-01-03T00:00:00.000Z',
      });

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('conflict', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      // untracked
      await db.add(
        'object-store',
        {
          id: 2,
          version: 1,
          label: 'lorem2',
          updatedAt: '2000-01-02T00:00:00.000Z',
        },
        undefined,
        // @ts-ignore
        NO_TRACKING_FLAG,
      );

      await db.put('object-store', {
        id: 2,
        version: 1,
        label: 'lorem2 updated',
        updatedAt: '2000-01-02T00:00:00.000Z',
      });

      manager.start();
      await waitForPushSuccess(manager);

      const item = await db.get('object-store', 2);

      assert.deepEqual(item, {
        id: 2,
        version: 2, // version is incremented, but change from the server is ignored
        label: 'lorem2 updated',
        updatedAt: '2000-01-02T00:00:00.000Z',
      });
    });

    test('tombstone', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      // untracked
      await db.add(
        'object-store',
        {
          id: 3,
          version: 1,
        },
        undefined,
        // @ts-ignore
        NO_TRACKING_FLAG,
      );

      manager.start();
      await waitForFetchSuccess(manager);

      const item = await db.get('object-store', 3);

      assert.isUndefined(item);

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('custom keyPath and updatedAt attribute', async () => {
      const schemaDB = await openDBWithCustomSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL, {
        buildPath: (operation, storeName, key) => {
          if (storeName !== "products") {
            return;
          }
          return "/company-products" + (key ? ("/" + key) : "");
        },
        updatedAtAttribute: 'lastUpdateDate',
      });

      manager.start();
      await waitForFetchSuccess(manager, 2);

      const product = await db.get('products', '123');

      assert.deepEqual(product, {
        code: '123',
        version: 1,
        label: 'lorem1',
        lastUpdateDate: '2000-02-01T00:00:00.000Z',
      });

      const offset = await db.get('_local_offsets', 'products');

      assert.deepEqual(offset, {
        id: '456',
        updatedAt: '2000-02-02T00:00:00.000Z',
      });
    });

    test('without keyPath', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL, {
        withoutKeyPath: {
          'key-val-store': ['foo'],
        },
        buildPath: (_operation, storeName, key) => {
          if (storeName === 'key-val-store') {
            return `/${storeName}/${key}`;
          }
          return;
        },
      });

      manager.start();

      await waitForFetchSuccess(manager); // object-store
      const items = await waitForFetchSuccess(manager);

      assert.equal(items.length, 1);
      assert.deepEqual(items[0], {
        version: 1,
        label: 'bar',
      });

      const foo = await db.get('key-val-store', 'foo');

      assert.deepEqual(foo, {
        version: 1,
        label: 'bar',
      });
    });
  });

  suite('push changes', () => {
    test('add', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      await db.add('object-store', {
        id: 3,
        label: 'lorem3',
      });

      const item = await db.get('object-store', 3);

      assert.deepEqual(item, {
        id: 3,
        version: 1,
        label: 'lorem3',
      });

      const change = await db.get('_local_changes', 1);

      assert.deepEqual(change, {
        operation: 'add',
        storeName: 'object-store',
        key: 3,
        value: {
          id: 3,
          version: 1,
          label: 'lorem3',
        },
      });

      manager.start();
      await waitForPushSuccess(manager);

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('put', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      await db.add('object-store', {
        id: 4,
        label1: 'lorem4',
        label2: 'lorem4',
      });

      await db.put('object-store', {
        id: 4,
        version: 1,
        label1: 'lorem4',
        label2: 'lorem5',
      });

      const change = await db.get('_local_changes', 2);

      assert.deepEqual(change, {
        operation: 'put',
        storeName: 'object-store',
        key: 4,
        value: {
          id: 4,
          version: 2,
          label1: 'lorem4',
          label2: 'lorem5',
        },
      });

      manager.start();
      await waitForPushSuccess(manager, 2);

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('put (discard local)', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      await db.put('object-store', {
        id: 6,
        version: 1,
      });

      const pushError = new Promise<void>((resolve) => {
        manager.onpusherror = (
          change,
          response,
          retryAfter,
          discardLocalChange,
        ) => {
          assert.equal(response.status, 404);
          discardLocalChange();
          resolve();
        };
      });

      manager.start();

      await pushError;

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('put (override remote)', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      await db.put('object-store', {
        id: 7,
        version: 1,
      });

      const pushError = new Promise<void>((resolve) => {
        manager.onpusherror = (
          change,
          response,
          retryAfter,
          discardLocalChange,
          overrideRemoteChange,
        ) => {
          assert.equal(response.status, 409);
          overrideRemoteChange(change.value);
          resolve();
        };
      });

      manager.start();

      await pushError;

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 1);
    });

    test('delete', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      await db.add('object-store', {
        id: 4,
        label1: 'lorem4',
        label2: 'lorem4',
      });

      await db.delete('object-store', 4);

      const change = await db.get('_local_changes', 2);

      assert.deepEqual(change, {
        operation: 'delete',
        storeName: 'object-store',
        key: 4,
      });

      manager.start();
      await waitForPushSuccess(manager, 2);

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('clear', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;

      // untracked
      await db.add(
        'object-store',
        {
          id: 1,
        },
        undefined,
        // @ts-ignore
        NO_TRACKING_FLAG,
      );

      // untracked
      await db.add(
        'object-store',
        {
          id: 2,
        },
        undefined,
        // @ts-ignore
        NO_TRACKING_FLAG,
      );

      await db.clear('object-store');

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 2);

      const change1 = await db.get('_local_changes', 1);

      assert.deepEqual(change1, {
        operation: 'delete',
        storeName: 'object-store',
        key: 1,
      });

      const change2 = await db.get('_local_changes', 2);

      assert.deepEqual(change2, {
        operation: 'delete',
        storeName: 'object-store',
        key: 2,
      });
    });

    test('no tracking if transaction is aborted', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;

      // untracked
      await db.add(
        'object-store',
        {
          id: 5,
        },
        undefined,
        // @ts-ignore
        NO_TRACKING_FLAG,
      );

      try {
        await db.add('object-store', {
          id: 5,
        });
        assert.fail('should not happen');
      } catch (e) {
        // expected
      }

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });

    test('has pending changes', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL);

      // untracked
      await db.add(
        'object-store',
        {
          id: 1,
        },
        undefined,
        // @ts-ignore
        NO_TRACKING_FLAG,
      );

      await db.add('object-store', {
        id: 2,
      });

      assert.equal(await manager.hasLocalChanges('object-store', 1), false);
      assert.equal(await manager.hasLocalChanges('object-store', 2), true);
      assert.equal(await manager.hasLocalChanges('object-store', 3), false);
    });

    test('without keyPath', async () => {
      const schemaDB = await openDBWithSchema();
      db = schemaDB as IDBPDatabase;
      manager = new SyncManager(db, BASE_URL, {
        withoutKeyPath: {
          'key-val-store': ['foo'],
        },
        buildPath: (operation, storeName, key) => {
          if (storeName === 'key-val-store') {
            return `/${storeName}/${key}`;
          }
          return;
        },
      });

      await db.put(
        'key-val-store',
        {
          label: 'baz',
        },
        'bar',
      );

      manager.start();

      const change = await waitForPushSuccess(manager);

      assert.equal(change.key, 'bar');

      const localChangesCount = await db.count('_local_changes');

      assert.equal(localChangesCount, 0);
    });
  });
});
