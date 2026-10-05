# Third-party notices

No third-party JavaScript framework, compiler package, font binary, Microsoft runtime DLL, OCX, or copied Microsoft icon artwork is bundled in this release. Runtime and IDE source are provided under the accompanying MIT License. Browser-provided APIs and installed system fonts remain subject to their respective platforms.

Python Playwright and Chromium are development-time validation tools and are not included in the distributed application. Node.js is needed to rebuild, not to run a standalone exported app.

Visual Basic, Microsoft and other product names identify compatibility targets or referenced technologies. They are trademarks of their respective owners. This independent project is not affiliated with or endorsed by those owners. Reference documentation is linked in `docs/COMPATIBILITY.md`; no ownership of that documentation is asserted.

## sql.js 1.14.2 / SQLite

The offline data provider embeds sql.js 1.14.2 JavaScript and WebAssembly,
including SQLite 3.49.1. sql.js is MIT licensed; the complete notice is retained
in `src/data/vendor/LICENSE.sql.js`. SQLite is public domain.

Upstream: https://github.com/sql-js/sql.js and https://sqlite.org/copyright.html

`tools/vendor-sqlite.mjs` adds an explicitly documented in-memory snapshot bridge
to the verified, pinned wrapper without changing the SQLite WASM binary. It embeds
the WASM as base64 so standalone applications do not depend on a CDN. Exact engine
hashes and reproduction checks are in that tool and the generated module header.

Optional native gateway drivers (`pg`, `mysql2`, `mssql`, `odbc`) are operator-installed
server dependencies and are not bundled into the browser distribution. Their
installed packages carry their respective licenses. OLE DB/Jet/ACE/ODBC drivers and
Microsoft runtime components are not redistributed by this project.
