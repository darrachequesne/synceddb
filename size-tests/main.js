import { openDB, SyncManager, LiveQuery, createComputedStore } from '../build/index';
a(openDB);
new SyncManager(null, "url");
new LiveQuery(() => Promise.resolve(), []);
createComputedStore();
