# History

| Version                  | Release date |
|--------------------------|--------------|
| [0.2.0](#020-2025-04-23) | April 2025   |
| [0.1.1](#011-2024-10-08) | October 2024 |
| [0.1.0](#010-2024-10-07) | October 2024 |
| [0.0.2](#002-2022-03-26) | March 2022   |
| [0.0.1](#001-2022-03-25) | March 2022   |

# Release notes

## [0.2.0](https://github.com/darrachequesne/synceddb/compare/0.1.1...0.2.0) (2025-04-23)

Based on [`idb@7.0.2`](https://github.com/jakearchibald/idb/releases/tag/v7.0.2) (Jun 2022).

### Bug Fixes

* fix cjs async ittr entry file ([32e66ec](https://github.com/darrachequesne/synceddb/commit/32e66ecf27e6a0e14ac3fecf0159f1a227ec971d)) (cherry-picked from origin)
* **ts:** `moduleResolution: node12` compat ([a392065](https://github.com/darrachequesne/synceddb/commit/a39206507aa6731645e2fdbe2c1a3b814afa18df)) (cherry-picked from origin)


### Features

* **ts:** add DB types to the SyncManager class ([393fe86](https://github.com/darrachequesne/synceddb/commit/393fe8630c4d832d3f1e2210677af99e10554c81))
* implement computed stores ([b25b03a](https://github.com/darrachequesne/synceddb/commit/b25b03a80839eead8d84c48e455f0ec3df123ed9))



## [0.1.1](https://github.com/darrachequesne/synceddb/compare/0.1.0...0.1.1) (2024-10-08)


### Bug Fixes

* include object stores without keyPath in the fetch loop ([66c927c](https://github.com/darrachequesne/synceddb/commit/66c927c442261f7b74106fd9520f22f1c0b279be))



## [0.1.0](https://github.com/darrachequesne/synceddb/compare/0.0.2...0.1.0) (2024-10-07)


### Features

* add support for object stores without keyPath ([b59b095](https://github.com/darrachequesne/synceddb/commit/b59b095326d7b71a86ce73f961cdac5b32db59d1))
* update the format of the default search params ([3ffd2f4](https://github.com/darrachequesne/synceddb/commit/3ffd2f4c441b7e44d2319e61b506e8dbb1664793))


### BREAKING CHANGES

* The format of the default search params is updated:

Before: `?sort=updated_at:asc&size=100&after=2000-01-01T00:00:00.000Z,123`

After: `?sort=updated_at:asc&size=100&after=2000-01-01T00:00:00.000Z&after_id=123`



## [0.0.2](https://github.com/darrachequesne/synceddb/compare/0.0.1...0.0.2) (2022-03-26)


### Bug Fixes

* add missing Content-Type header ([6903318](https://github.com/darrachequesne/synceddb/commit/69033182d28a7948cf184f15aab999cd3f14020a))
* prevent infinite loop when pushing updates ([0a94d53](https://github.com/darrachequesne/synceddb/commit/0a94d53212a512873518efa52a46978eada75da5))



## [0.0.1](https://github.com/darrachequesne/synceddb/releases/tag/0.0.1) (2022-03-25)

Based on [`idb@7.0.0`](https://github.com/jakearchibald/idb/releases/tag/v7.0.0) (November 2021).

### Features

* add SyncManager and LiveQuery features ([dab36fb](https://github.com/darrachequesne/idb/commit/dab36fb1000bc40d70988d5292f434601fa9fff0))
