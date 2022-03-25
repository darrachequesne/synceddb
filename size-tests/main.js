import { openDB, SyncManager, LiveQuery } from '../build/index';
a(openDB);
new SyncManager(null, "url");
new LiveQuery(() => Promise.resolve(), []);
