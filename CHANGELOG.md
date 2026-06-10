# Changelog

## [1.2.1](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.2.0...v1.2.1) (2026-06-10)


### Bug Fixes

* correct arrival-only time filter behavior ([1345e52](https://github.com/XLixl4snSU/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))
* fix Docker volume permissions for direct connection data ([1345e52](https://github.com/XLixl4snSU/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))
* improve Docker production image and runtime setup ([1345e52](https://github.com/XLixl4snSU/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))
* restore Bahn API requests on Node 24 ([1345e52](https://github.com/XLixl4snSU/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))

## [1.2.0](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.1.2...v1.2.0) (2026-05-29)


### Features

* departure until and arrival from filters ([#49](https://github.com/XLixl4snSU/sparpreis.guru/issues/49)) ([fa1739e](https://github.com/XLixl4snSU/sparpreis.guru/commit/fa1739e849b9c0c07f338c1285d6b9af21299059))


### Bug Fixes

* CI docker build and performance issues ([fa1739e](https://github.com/XLixl4snSU/sparpreis.guru/commit/fa1739e849b9c0c07f338c1285d6b9af21299059))

## [1.1.2](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.1.1...v1.1.2) (2026-05-13)


### Bug Fixes

* **deps:** bump next from 16.2.5 to 16.2.6 for security reasons ([43b17e3](https://github.com/XLixl4snSU/sparpreis.guru/commit/43b17e3ad968d5bfbfc10d14d8ea6439e073233a))

## [1.1.1](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.1.0...v1.1.1) (2026-05-07)


### Bug Fixes

* Overflowing Train Timeline in Urlaubsfinder ([392c37d](https://github.com/XLixl4snSU/sparpreis.guru/commit/392c37d6b72390aa8d3e4e28f1d965bec8a91191))
* Remove package-lock and update CI setup ([8af914d](https://github.com/XLixl4snSU/sparpreis.guru/commit/8af914da625aef330591f17bb34e5c0358efd4df))

## [1.1.0](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.6...v1.1.0) (2026-05-06)


### Features

* add direct connections feature ([e4f7bdd](https://github.com/XLixl4snSU/sparpreis.guru/commit/e4f7bdd55e43a7d21c4c0fafadce00f6f46c3294))
* **observability:** add structured logs and search metrics ([b30b791](https://github.com/XLixl4snSU/sparpreis.guru/commit/b30b79127fe71e41bd06d01b07281bbb63d55d0f))
* **search:** improve station matching and suggestion ranking ([fc4e658](https://github.com/XLixl4snSU/sparpreis.guru/commit/fc4e65856e5e8e7a04bc4c7add89ad411414a547))
* **urlaubsfinder:** add vacation destination search ([027ed3e](https://github.com/XLixl4snSU/sparpreis.guru/commit/027ed3e013f7f88c0c7552d128a893bbb85f8e61))


### Bug Fixes

* Add feature flag and prop to control Footer ([e0070cc](https://github.com/XLixl4snSU/sparpreis.guru/commit/e0070cc5908ee122f4553f40d8a4cf1b9afb9ee6))
* **ci:** use node 22 for docker builds ([2dd36e7](https://github.com/XLixl4snSU/sparpreis.guru/commit/2dd36e7f5f3e095d2ec599cde2241c8ac1efccc1))
* restore urlaubsfinder journey times ([57a9adf](https://github.com/XLixl4snSU/sparpreis.guru/commit/57a9adff8103ffab1a50532768a510bb009bafcc))

## [1.0.6](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.5...v1.0.6) (2026-02-15)


### Bug Fixes

* cache metrics, debug endpoint & footer ([74fa463](https://github.com/XLixl4snSU/sparpreis.guru/commit/74fa4631bb07432f52877b56905bd8f874e98f5c))
* Switch release-please release-type to node ([1f08b2d](https://github.com/XLixl4snSU/sparpreis.guru/commit/1f08b2db699f163909f9f1c1dfd636382ad018f1))

## [1.0.5](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.4...v1.0.5) (2026-01-29)


### Bug Fixes

* next CVE ([0fb751e](https://github.com/XLixl4snSU/sparpreis.guru/commit/0fb751e3bc2a94485722374b36ebc19140da0308))

## [1.0.4](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.3...v1.0.4) (2026-01-10)


### Bug Fixes

* session completion ([f66df53](https://github.com/XLixl4snSU/sparpreis.guru/commit/f66df53c539a2468dee53253dfff866346b2108a))
* time filter and connection ID logic ([#22](https://github.com/XLixl4snSU/sparpreis.guru/issues/22)) ([cc3a1a9](https://github.com/XLixl4snSU/sparpreis.guru/commit/cc3a1a94edd22121edc62d7311dd306f84c98bda))

## [1.0.3](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.2...v1.0.3) (2026-01-06)


### Bug Fixes

* re-rendering of PriceHistoryChart when new results come in ([c7b2475](https://github.com/XLixl4snSU/sparpreis.guru/commit/c7b2475c0e338dde74a84226892ccf7e4c066467))
* Wrong train names for regional trains ([ea67a10](https://github.com/XLixl4snSU/sparpreis.guru/commit/ea67a10b502865037d369b01815ce1b31fe708d2))

## [1.0.2](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.1...v1.0.2) (2026-01-02)


### Bug Fixes

* Bump qs from 6.14.0 to 6.14.1 ([f095189](https://github.com/XLixl4snSU/sparpreis.guru/commit/f0951897e52b49f67d3878e1dbd184c2b4edee7d))
* Change default for showOnlyCheapest to false ([fda5246](https://github.com/XLixl4snSU/sparpreis.guru/commit/fda52464667875114460c86f85755dff69b8ee5d))
* date selection to use weekdays and ranges ([bc44a51](https://github.com/XLixl4snSU/sparpreis.guru/commit/bc44a5167f35fcac904a3d5eb2ff56e41fa6a1cc))

## [1.0.1](https://github.com/XLixl4snSU/sparpreis.guru/compare/v1.0.0...v1.0.1) (2025-12-29)


### Bug Fixes

* Improve day navigation with animated transitions ([4db19b6](https://github.com/XLixl4snSU/sparpreis.guru/commit/4db19b6b13587a8c6c88396eb3058455261af406))
* mobile data age display ([3748ddd](https://github.com/XLixl4snSU/sparpreis.guru/commit/3748ddd581552527746d13773dfaa09580ada9a0))

## [1.0.0](https://github.com/XLixl4snSU/sparpreis.guru/compare/v0.9.10...v1.0.0) (2025-12-28)


### ⚠ BREAKING CHANGES

* Results and stations are now cached in an SQLite Database. Make sure to set a volume to /app/data to keep the database persistent.

### Features

* prepare 1.0.0 release ([842c645](https://github.com/XLixl4snSU/sparpreis.guru/commit/842c645ab79446ee9dfd7fc2adbfd83912737047))
