import 'mocha/mocha';
import chai from 'chai/chai';
import type { IDBPDatabase } from '../src/';
import { createComputedStore } from '../src/';
import {
  deleteDatabase,
  openDBWithCustomSchema,
  CustomDBSchema,
} from './utils';

const { assert } = chai;

suite.only('Computed stores', () => {
  let db: IDBPDatabase<CustomDBSchema>;

  setup(async () => {
    db = await openDBWithCustomSchema();
  });

  teardown('Close DB', async () => {
    if (db) db.close();
    await deleteDatabase();
  });

  test('init computed store', async () => {
    await db.add('object-store', {
      id: 1,
      title: 'lorem',
      date: new Date(),
    });

    await createComputedStore(
      db,
      'object-store-computed',
      'object-store',
      [],
      async (tx, change) => {
        assert.equal(change.operation, 'add');
        assert.equal(change.storeName, 'object-store');
        assert.equal(change.key, 1);
        assert.equal(change.value.title, 'lorem');

        const computed = change.value;
        computed.title = computed.title.split('').reverse().join('');
        tx.objectStore('object-store-computed').add(computed);
      },
    );

    const val = await db.get('object-store-computed', 1);

    assert.ok(val);
    assert.equal(val?.id, 1);
    assert.equal(val?.title, 'merol');
  });

  test('update computed store', async () => {
    await createComputedStore(
      db,
      'object-store-computed',
      'object-store',
      [],
      async (tx, change) => {
        const store = tx.objectStore('object-store-computed');
        switch (change.operation) {
          case 'add':
            store.add(change.value);
            break;
          case 'put':
            store.put(change.value);
            break;
          case 'delete':
            store.delete(change.key);
            break;
        }
      },
    );

    await db.add('object-store', {
      id: 2,
      title: 'lorem',
      date: new Date(),
    });

    const val = await db.get('object-store-computed', 2);

    assert.ok(val);
    assert.equal(val!.title, 'lorem');

    await db.put('object-store', {
      id: 2,
      title: 'ipsum',
      date: new Date(),
    });

    const val2 = await db.get('object-store-computed', 2);

    assert.ok(val2);
    assert.equal(val2!.title, 'ipsum');

    await db.delete('object-store', 2);

    const val3 = await db.get('object-store-computed', 2);

    assert.notExists(val3);
  });
});
