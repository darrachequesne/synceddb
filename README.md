# IndexedDB with usability and remote syncing

This is a fork of the awesome [`idb`](https://github.com/jakearchibald/idb) library, which adds the ability to sync an IndexedDB database with a remote REST API.

1. [Features](#features)
   1. [All the usability improvements from the `idb` library](#all-the-usability-improvements-from-the-idb-library) 
   2. [Sync with a remote REST API](#sync-with-a-remote-rest-api)
   3. [Auto-reloading queries](#auto-reloading-queries)
2. [Limitations](#limitations)
3. [Installation](#installation)
4. [API](#api)
   1. [SyncManager](#syncmanager)
      1. [Options](#options)
         1. [`fetchOptions`](#fetchoptions)
         2. [`fetchInterval`](#fetchinterval)
         3. [`buildFetchParams`](#buildfetchparams)
         4. [`updatedAtAttribute`](#updatedatattribute)
      2. [Methods](#methods)
         1. [`start()`](#start)
         2. [`stop()`](#stop)
         3. [`clear()`](#clear)
         4. [`hasLocalChanges()`](#haslocalchanges)
         5. [`onfetchsuccess`](#onfetchsuccess)
         6. [`onfetcherror`](#onfetcherror)
         7. [`onpushsuccess`](#onpushsuccess)
         8. [`onpusherror`](#onpusherror)
   2. [LiveQuery](#livequery)
      1. [Example with Vue.js](#example-with-vuejs)
5. [Expectations for the REST API](#expectations-for-the-rest-api)
   1. [Fetching changes](#fetching-changes)
   2. [Pushing changes](#pushing-changes)
6. [Alternatives](#alternatives)

# Features

## All the usability improvements from the `idb` library

Since it is a fork of the [`idb`](https://github.com/jakearchibald/idb) library, `synceddb` shares the same Promise-based API:

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');

const transaction = db.transaction('items', 'readwrite');
await transaction.store.add({ id: 1, label: 'Dagger' });

// short version
await db.add('items', { id: 1, label: 'Dagger' });
```

More information [here](https://github.com/jakearchibald/idb#api).

## Sync with a remote REST API

Every change is tracked in a store. The [SyncManager](#syncmanager) then sync these changes with the remote REST API when the connection is available, making it easier to build offline-first applications.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.start();

// will result in the following HTTP request: POST /items
await db.add('items', { id: 1, label: 'Dagger' });

// will result in the following HTTP request: DELETE /items/2
await db.delete('items', 2);
```

See also: [Expectations for the REST API](#expectations-for-the-rest-api)

## Auto-reloading queries

The [LiveQuery](#livequery) provides a way to run a query every time the underlying stores are updated:

```js
import { openDB, LiveQuery } from 'synceddb';

const db = await openDB('my awesome database');

let result;

const query = new LiveQuery(['items'], async () => {
  // result will be updated every time the 'items' store is modified
  result = await db.getAll('items');
});

// trigger the liveQuery
await db.put('items', { id: 2, label: 'Long sword' });

// or manually run it
await query.run();
```

Inspired from [Dexie.js liveQuery](https://dexie.org/docs/liveQuery()).

# Limitations

- [out-of-line keys](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology#out-of-line_key)

Entities without `keyPath` are not currently supported.

# Installation

```sh
npm install synceddb
```

Then:

```js
import { openDB, SyncManager, LiveQuery } from 'synceddb';

async function doDatabaseStuff() {
  const db = await openDB('my awesome database');

  // sync your database with a remote server
  const manager = new SyncManager(db, 'https://example.com');

  manager.start();
  
  // create an auto-reloading query
  let result;
  const query = new LiveQuery(['items'], async () => {
    // result will be updated every time the 'items' store is modified
    result = await db.getAll('items');
  });
}
```

# How it works

# API

For database-related operations, please see the `idb` [documentation](https://github.com/jakearchibald/idb#api).

## SyncManager

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.start();
```

### Options

#### `fetchOptions`

Additional options for all HTTP requests.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com', {
  fetchOptions: {
    headers: {
      'accept': 'application/json'
    },
    credentials: 'include'
  }
});

manager.start();
```

Reference: https://developer.mozilla.org/en-US/docs/Web/API/fetch

#### `fetchInterval`

The number of ms between two fetch requests for a given store.

Default value: `30000`

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com', {
  fetchInterval: 10000
});

manager.start();
```

#### `buildPath`

A function that allows to override the request path for a given request.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com', {
  buildPath: (operation, storeName, key) => {
    if (storeName === 'my-local-store') {
      if (key) {
        return `/the-remote-store/${key[1]}`;
      } else {
        return '/the-remote-store/';
      }
    }
    // defaults to `/${storeName}/${key}`
  }
});

manager.start();
```

#### `buildFetchParams`

A function that allows to override the query params of the fetch requests.

Defaults to `?sort=updated_at:asc&size=100&after=2000-01-01T00:00:00.000Z,123`.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com', {
  buildFetchParams: (storeName, offset) => {
    const searchParams = new URLSearchParams({
      sort: '+updatedAt',
      size: '10',
    });
    if (offset) {
      searchParams.append('after', `${offset.updatedAt}+${offset.id}`);
    }
    return searchParams;
  }
});

manager.start();
```

#### `updatedAtAttribute`

The name of the attribute that indicates the last updated date of the entity.

Default value: `updatedAt`

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com', {
  updatedAtAttribute: 'lastUpdateDate'
});

manager.start();
```

### Methods

#### `start()`

Starts the sync process with the remote server.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.start();
```

#### `stop()`

Stops the sync process.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.stop();
```

#### `clear()`

Clears the local stores.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.clear();
```

#### `hasLocalChanges()`

Returns whether a given entity currently has local changes that are not synced yet.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

await db.put('items', { id: 1 });

const hasLocalChanges = await manager.hasLocalChanges('items', 1); // true
```

#### `onfetchsuccess`

Called after some entities are successfully fetched from the remote server.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.onfetchsuccess = (storeName, entities, hasMore) => {
  // ...
}
```

#### `onfetcherror`

Called when something goes wrong when fetching the changes from the remote server.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.onfetcherror = (err) => {
  // ...
}
```

#### `onpushsuccess`

Called after a change is successfully pushed to the remote server.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.onpushsuccess = ({ operation, storeName, key, value }) => {
  // ...
}
```

#### `onpusherror`

Called when something goes wrong when pushing a change to the remote server.

```js
import { openDB, SyncManager } from 'synceddb';

const db = await openDB('my-awesome-database');
const manager = new SyncManager(db, 'https://example.com');

manager.onpusherror = (change, response, retryAfter, discardLocalChange, overrideRemoteChange) => {
  // this is the default implementation
  switch (response.status) {
    case 403:
    case 404:
      return discardLocalChange();
    case 409:
      // last write wins by default
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
```

## LiveQuery

The first argument is an array of stores. Every time one of these stores is updated, the function provided in the 2nd argument will be called.

```js
import { openDB, LiveQuery } from 'synceddb';

const db = await openDB('my awesome database');

let result;

const query = new LiveQuery(['items'], async () => {
  // result will be updated every time the 'items' store is modified
  result = await db.getAll('items');
});
```

### Example with Vue.js

```vue
<script>
import { openDB, LiveQuery } from 'synceddb';

export default {
  data() {
    return {
      items: []
    }
  },
  
  async created() {
    const db = await openDB('test', 1, {
      upgrade(db) {
        db.createObjectStore('items', { keyPath: 'id' });
      },
    });
    
    this.query = new LiveQuery(['items'], async () => {
      this.items = await db.getAll();
    });
  },
  
  unmounted() {
    // !!! IMPORTANT !!! This ensures the query stops listening to the database updates and does not leak memory.
    this.query.close();
  }
}
</script>
```

# Expectations for the REST API

## Fetching changes

Changes are fetched from the REST API with `GET` requests:

```
GET /<storeName>?sort=updated_at:asc&size=100&after=2000-01-01T00:00:00.000Z,123
```

Explanations:

- `sort=updated_at:asc` indicates that we want to sort the entities based on the date of last update
- `size=100` indicates that we want 100 entities max
- `after=2000-01-01T00:00:00.000Z,123` indicates the offset (with an update date above `2000-01-01T00:00:00.000Z`, excluding the entity `123`)

The query parameters can be customized with the [`buildFetchParams`](#buildfetchparams) option.

Expected response:

```js
{
  data: [
    {
      id: 1,
      version: 1,
      updatedAt: '2000-01-01T00:00:00.000Z',
      label: 'Dagger'
    },
    {
      id: 2,
      version: 12,
      updatedAt: '2000-01-02T00:00:00.000Z',
      label: 'Long sword'
    },
    {
      id: 3,
      version: -1, // tombstone
      updatedAt: '2000-01-03T00:00:00.000Z',
    }
  ],
  hasMore: true
}
```

A fetch request will be sent for each store of the database, every X seconds (see the [fetchInterval](#fetchinterval) option).

## Pushing changes

| Operation                                                     | HTTP request                  | Body                                         |
|---------------------------------------------------------------|-------------------------------|----------------------------------------------|
| `db.add('items', { id: 1, label: 'Dagger' })`                 | `POST /items`                 | `{ id: 1, version: 1, label: 'Dagger' }`     |
| `db.put('items', { id: 2, version: 2, label: 'Long sword' })` | `PUT /items/2`                | `{ id: 2, version: 3, label: 'Long sword' }` |
| `db.delete('items', 3)`                                       | `DELETE /items/3`             |                                              |
| `db.clear('items')`                                           | one `DELETE` request per item |                                              |

Success must be indicated by an HTTP 2xx response. Any other response status means the change was not properly synced. You can customize the error handling behavior with the [`onpusherror`](#onpusherror) method.

# Alternatives

Here are some alternatives that you might find interesting:

- idb: https://github.com/jakearchibald/idb
- Dexie.js: https://dexie.org/ (and its [ISyncProtocol](https://dexie.org/docs/Syncable/Dexie.Syncable.ISyncProtocol) part)
- pouchdb: https://pouchdb.com/
