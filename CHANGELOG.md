# History

| Version                  | Release date |
|--------------------------|--------------|
| [0.1.1](#011-2024-10-08) | October 2024 |
| [0.1.0](#010-2024-10-07) | October 2024 |
| [0.0.2](#002-2022-03-26) | March 2022   |
| [0.0.1](#001-2022-03-25) | March 2022   |

# Release notes

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


### Features

* add SyncManager and LiveQuery features ([dab36fb](https://github.com/darrachequesne/idb/commit/dab36fb1000bc40d70988d5292f434601fa9fff0))
