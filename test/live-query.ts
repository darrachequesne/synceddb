import 'mocha/mocha';
import chai from 'chai/chai';
import { IDBPDatabase, LiveQuery } from '../src/';
import {
  deleteDatabase,
  openDBWithCustomSchema,
  sleep,
  CustomDBSchema,
} from './utils';

const { assert } = chai;

suite.only('LiveQuery', () => {
  let db: IDBPDatabase<CustomDBSchema>;
  let query: LiveQuery<number>;
  let count: number;

  setup(async () => {
    db = await openDBWithCustomSchema();

    count = 0;

    query = new LiveQuery(['object-store'], () => {
      count++;

      return Promise.resolve(42);
    });
  });

  teardown('Close DB', async () => {
    if (db) db.close();
    query.close();
    await deleteDatabase();
  });

  test('onupdate called after run', async () => {
    await query.run();

    assert.equal(count, 1);
  });

  test('onupdate called after readwrite transaction', async () => {
    await db.add('object-store', {
      id: 1,
      title: 'val1',
      date: new Date(),
    });

    assert.equal(count, 1);
  });

  test('onupdate called once after readwrite transaction', async () => {
    const transaction = db.transaction('object-store', 'readwrite');

    transaction.store.add({
      id: 1,
      title: 'val1',
      date: new Date(),
    });

    transaction.store.put({
      id: 2,
      title: 'val2',
      date: new Date(),
    });

    transaction.store.delete(3);

    await transaction.done;
    await sleep(50);

    assert.equal(count, 1);
  });

  test('onupdate not called after readonly transaction', async () => {
    await db.getAll('object-store');

    assert.equal(count, 0);
  });

  test('onupdate not called after operation on another store', async () => {
    await db.add('products', {
      code: '123',
    });

    assert.equal(count, 0);
  });

  test('onupdate not called after close', async () => {
    await db.add('object-store', {
      id: 1,
      title: 'val1',
      date: new Date(),
    });

    assert.equal(count, 1);

    query.close();

    await db.add('object-store', {
      id: 2,
      title: 'val2',
      date: new Date(),
    });

    assert.equal(count, 1);
  });
});
