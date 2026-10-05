# Data sources, Data Environment and shipped applications

VB6 Studio has a shared data layer for the IDE, the source runtime and exported
HTML/Electron applications. It is **not a claim of complete native VB6, ADO, DAO,
RDO, Data Environment designer or arbitrary database-provider compatibility**.
Unsupported operations fail rather than being silently emulated by SQLite.

## What is available

| Source | Implementation | Deployment |
|---|---|---|
| SQLite | Bundled SQLite 3.49.1 through pinned sql.js 1.14.2 WebAssembly; SQL, joins, prepared parameters, schema, keyed-table writes and transactions | Entire engine embedded; no CDN, extension, network fetch or separate WASM file |
| REST/JSON | Real Fetch GET/POST reads; configurable POST/PATCH/PUT/DELETE writes; typed/nested field mapping, paging, ETags, timeouts and cancellation | Endpoint must permit the application origin through CORS |
| OData | `value` collections and same-origin `@odata.nextLink` paging; configurable resource writes | HTTP service; not a complete OData metadata/query-language implementation |
| GraphQL | Query text, typed variables, response paths and GraphQL error handling | HTTP service; not subscriptions or a schema/introspection designer |
| JSON/CSV | Virtual project files, typed fields, keyed optimistic writes, quoted CSV values | Files embedded in the project/application snapshot |
| PostgreSQL | Gateway `pg` driver, parameterized statements, schema and dedicated-connection transactions | Install optional `pg` on the trusted gateway |
| MySQL/MariaDB | Gateway `mysql2/promise`, prepared statements, schema and transactions | Install optional `mysql2`; MariaDB compatibility depends on the server/version |
| SQL Server | Gateway `mssql`, typed request parameters, schema and transactions | Install optional `mssql` on the gateway |
| ODBC | Real installed ODBC driver through optional `odbc` Node package | Matching system driver, DSN/connection string, architecture and permissions required |
| OLE DB / Access / Jet / ACE | Windows gateway worker uses native `ADODB.Connection` and parameterized `ADODB.Command` COM objects | Windows, matching installed OLE DB provider and process bitness required; no provider is redistributed |

The dedicated CI tests portable sources and live PostgreSQL, MySQL and SQL Server
through the authenticated HTTP gateway. OLE DB, Jet/ACE and ODBC adapters require
validation against the actual installed providers; their presence in the selector
is not certification of every driver, binary database format or COM behavior.
MariaDB is not a separately certified CI server. MongoDB, Redis, SOAP, proprietary
cloud SDKs, OAuth sign-in flows, database administration tools and live changefeed
subscriptions are not implemented as native providers. Services exposing a suitable
REST/GraphQL API can use the HTTP providers; a JavaScript provider can also be
registered in `DataContext.providers` before opening its connections.

## Classic IDE workflow

Open **Project → Add Data Environment**, **View → Data View**, or **Tools → Data
Environment Designer**. The modeless tool follows the existing docking/detached-
window rules. It contains a connection/command tree, SQL/resource editor and a
bounded tabular preview, rather than a modern replacement dashboard.

**Add Connection** opens **Data Link Properties** with **Provider**, **Connection**,
**Advanced**, and **All** tabs. Choose SQLite, REST, OData, GraphQL, JSON, CSV or the
native gateway. Set the connection name and data source. Advanced properties include
field mappings, pagination, public HTTP headers, REST write operations and timeout.
The All tab displays the configuration that will be saved. Test Connection performs
real provider I/O. Changes participate in project history; Cancel does not save.

**Add Command** opens **Command Properties** with General and Parameters tabs.
Commands contain text or a table name, an owning connection and ordered typed
parameters. Execute prompts for parameter values, runs the real provider and previews
up to 100 rows per page. Schema displays tables/columns when supplied by the provider.
Preview writes are real writes; only execute commands against data you intend to
change. Local committed database bytes are captured back into the project snapshot.

**Import Data File** accepts `.sqlite`, `.sqlite3`, `.db`, `.json` and `.csv`. SQLite
files are validated by their signature and engine when opened. **Export Database**
downloads the selected SQLite connection's committed binary database snapshot.
Jet `.mdb`/ACE `.accdb` files must use an installed gateway provider, not this SQLite
file importer.

Connections and commands are saved under `project.dataSources` and appear as
`DataEnvironment1.ConnectionName`, `DataEnvironment1.CommandName` and
`DataEnvironment1.rsCommandName`. Executing a command preserves its observable
recordset identity so controls bound to it continue receiving updates.

## Examples

The New Project examples include four working data projects. Their sources are in
`examples/*.vb6web`; built, independently runnable applications are in
`dist/examples/*.html`:

| Example | What to try |
|---|---|
| `sqlite-customers` | Open offline; edit a bound name, Save, Reload, Add New and Delete. The example creates a real SQLite database and seeds it inside a transaction. |
| `rest-customers` | Start `npm run data:examples`, open the application, then Reload. Uses real paged HTTP reads, CRUD and per-record ETags. |
| `rest-public-users` | Reload calls the public JSONPlaceholder users endpoint with nested `address.city`/`company.name` mappings. Public availability and CORS are outside this project; this example is read-only. |
| `graphql-customers` | Start the same local service and Reload. Executes a typed Boolean GraphQL command; the Data Environment also includes an OData connection. |

The local example service binds `127.0.0.1:4286`. It has **disposable in-memory data,
no authentication, and is not a production service**. Its explicit development
origin list is `null`, `http://127.0.0.1:4173`, and `http://localhost:4173`. To use
another development origin, supply `VB6_EXAMPLE_ORIGINS` as a comma-separated list.
The `null` origin is allowed only for these disposable teaching fixtures; do not
copy that rule into a gateway with private data. HTTPS pages may prohibit HTTP
loopback requests; serve a local development copy or deploy an HTTPS API instead.

## VB source programming

```vb
Dim cn As New ADODB.Connection
Dim cmd As New ADODB.Command
Dim rs As ADODB.Recordset
Dim affected As Long

cn.Open "Local" ' Named SQLite connection from Data Link Properties
cn.Execute "CREATE TABLE IF NOT EXISTS Customers(id INTEGER PRIMARY KEY, name TEXT)"
Set cmd.ActiveConnection = cn
cmd.CommandText = "INSERT INTO Customers(name) VALUES(?)"
cmd.Parameters.Append cmd.CreateParameter("Name", adVarWChar, adParamInput, 80, "Ada")
cmd.Execute affected
Debug.Print affected

Set rs = New ADODB.Recordset
rs.Open "Customers", cn, adOpenStatic, adLockOptimistic, adCmdTable
rs.Fields("name").Value = "Ada Lovelace"
rs.Update
rs.MoveFirst
Debug.Print rs.Fields("name").Value
rs.Close
cn.Close
```

`CreateObject("ADODB.Connection")`, `New ADODB.Command`, `New ADODB.Recordset`,
`DAO.DBEngine`, and `OpenDatabase("NamedConnection")` are source-runtime entry
points. ADO calls that perform I/O are awaited by the VB interpreter. Application
code does not need JavaScript promises or an `Await` keyword. Native `RecordsAffected`
arguments are passed ByRef. Failures are catchable through `On Error` and `Err`.

Supported cursor operations include Fields/Item/Value, BOF/EOF, RecordCount,
MoveFirst/Next/Previous/Last, AddNew, Update, Delete, CancelUpdate, Requery,
Filter, Sort, Find, Bookmark, AbsolutePosition, GetRows and GetString.
Queries are **bounded, client-materialized static snapshots**, not server cursors.
Action commands return a closed recordset with RowsAffected; an empty SELECT retains
its schema and remains open. Input parameter types and sizes are checked before I/O.
Large exact integer/decimal gateway values may remain strings to avoid rounding.

SQLite arbitrary SELECTs are read-only. For editable SQLite data, open a keyed table
using `adCmdTable`; the writer verifies original values to prevent lost updates.
REST writes must be configured explicitly. Client batch optimistic locking is supported
(see below). Calls requesting pessimistic locking, dynamic/keyset cursors,
stored-procedure CommandType, output parameters or
native asynchronous flags fail with a capability error. XML/ADTG persistence,
server-side cursors, every ADO event, distributed transactions, full DAO catalogs/
QueryDefs/workspaces and RDO are not provided. DAO convenience APIs are not a Jet
engine; native Jet SQL is executed only by a configured native provider.

## Binding controls

The toolbox includes a classic `Adodc` navigation control alongside `Data`.
`DataSource`, `DataMember` and `DataField` are exposed in the property inspector.
DataGrid/MSFlexGrid/MSHFlexGrid bind to recordsets; TextBox, Label, CheckBox, ComboBox
and DTPicker bind individual fields. Set `DataSource` to a data control or to
`DataEnvironment1` with the command name in `DataMember`. VB can also assign
`Set Data1.Recordset = rs` and `Set Text1.DataSource = Data1`.

A bound field stages an edit; blur, explicit Update/Save, or awaited navigation
commits it. Overlapping blur/Save calls share one pending write. Failed writes keep
the edit pending; use CancelUpdate/Requery to discard and reload. Do not mutate
cursor properties during an outstanding provider write. Grid writes report errors
on `LastDataError`/the cell tooltip, rather than accepting a failed edit as saved.

## REST configuration

The editable local example uses this public, serializable definition:

```json
{
  "name": "CustomersAPI",
  "provider": "rest",
  "url": "http://127.0.0.1:4286/customers",
  "rowsPath": "items",
  "keyField": "id",
  "etagField": "etag",
  "requireETag": true,
  "pagination": {"mode": "page", "size": 2, "hasMorePath": "hasMore"},
  "fields": [{"name": "id", "type": 3}, {"name": "name", "type": 202}],
  "write": {
    "insert": {"url": "/customers"},
    "update": {"url": "/customers/{id}"},
    "delete": {"url": "/customers/{id}"}
  }
}
```

Pagination supports next-link, page-number and offset modes. Typed fields can map
nested paths. URL placeholders are encoded, not concatenated as raw parameter text.
GraphQL uses the command text as `query` and named command parameters as `variables`.
GraphQL mutations may be supplied as command text, but automatic rowset CRUD is not
a generated GraphQL mutation layer. Configure and authorize writes deliberately.

HTTP requests have bounded response bytes, rows, cells, pages and duration.
Redirects are rejected and pagination cannot forward credentials to another origin.
Cancellation aborts Fetch. A collection-level ETag is not incorrectly applied to
individual records. Per-record ETags are sent as If-Match; HTTP 409/412 is exposed
as an optimistic conflict. There are no automatic write retries. A timeout after a
server accepted a write has an uncertain outcome: requery before deciding to retry.

## Credentials and deployment

Never put database passwords or long-lived API secrets into browser projects,
source literals, virtual files or exported HTML. Saved data definitions reject
credential-bearing headers, connection strings and URLs. This is not a general
secret scanner for arbitrary user code or database contents.

Use a `credentialRef` in the public connection definition. The runtime requests the
credential in a masked dialog, or a host can provide `dataCredential`.
`DataEnvironment1.SetCredential "ReferenceName", "runtime token"` also sets an
in-memory token; obtain that token interactively, not from a shipped literal.
Closing the data context clears its credential cache. Direct ADO Open username/
password arguments and SetHeader are runtime-only and are not serialized back to
the project. They are still readable by code authorized to run in that app.

Exported HTML contains the shared runtime, bundled engine, public definitions and
initial virtual data files. It can access REST/GraphQL/OData/gateway services at
runtime. Offline SQLite needs no companion process. The existing Electron packaged
application path uses that same source runtime.
The Windows packager declares the exact HTTP(S) origins from named connections in
`manifest.json`. Dynamic code-only connections or Studio builds must declare each
additional origin explicitly, for example `--data-origin https://api.example.com`.
Only Fetch/XMLHttpRequest is permitted to those origins; remote scripts, frames and
navigation remain blocked. WebAssembly compilation is permitted without enabling
JavaScript `eval`. The renderer remains sandboxed with Node disabled and web security
on. APIs must allow the packaged application's `vb6://app` origin in their CORS
policy (configure the local fixture's `VB6_EXAMPLE_ORIGINS` accordingly).
 **The PE32/x86 AOT compiler and
classic Microsoft VB6 compiler output do not automatically gain these JavaScript
providers**; unsupported AOT data code is diagnosed, not replaced by an empty DB.
Original native VB6 applications still need their normal runtime/ADO/DAO/OCX/provider
dependencies. No universal single-executable native database deployment is claimed.

`.vb6web` retains the complete model. Native source export adds a
`<project>.vbp.vb6data.json` sidecar containing browser definitions and virtual data
when needed. Import the source ZIP/folder with that sidecar to restore it. The
sidecar is **not** a Microsoft `.dsr` Data Environment file; native VB6 ignores it.
Unmodified classic projects without modern definitions receive no new sidecar.

Persistence uses the application's existing private virtual filesystem and host
storage snapshot. Browser quota/eviction and opaque-origin restrictions still
apply. Export/back up important databases. These SQLite snapshots are not a
multi-tab database server: use a single writer/application instance or the gateway
for shared data. Server transaction rollback/commit and SQLite nested savepoints
are explicit; closing with a transaction rolls it back.

## Native gateway

Copy `examples/data/server-profiles.example.json` to `server-profiles.local.json`.
Keep only the profiles and commands needed by your application. SQLite needs no
optional npm dependency. For remote database drivers, install the chosen packages
**on the gateway machine**, never in exported HTML:

```sh
npm install --no-save --package-lock=false --ignore-scripts pg@8.23.1 mysql2@3.24.5 mssql@12.7.3
# ODBC separately needs its native Node package and matching system driver.
# Configure process environment variables named by each profile's environment map.
# Set VB6_DATA_TOKEN to a freshly generated secret of at least 32 bytes.
node tools/data-gateway.mjs server-profiles.local.json
```

Generate the bearer token with a cryptographically secure tool. Do not copy the CI
fixture passwords/tokens into real deployments. The browser connection contains
only provider `gateway`, URL `http://127.0.0.1:4287/data`, the profile name and a
credentialRef. `CommandText` is a **server-allowlisted command name** by default;
input parameters are passed separately. This is not a public SQL proxy. Setting
`allowAdHoc: true` deliberately grants the bearer holder arbitrary SQL execution
under that database account. Prefer allowlisted commands and least-privileged DB
accounts, and separate gateway instances/tokens for different trust boundaries.
The gateway token grants access to every configured profile; it is not per-user RBAC.

The gateway binds loopback, checks Host against loopback names, enforces an explicit
Origin allowlist and constant-time bearer comparison, rejects client-supplied
connection strings, limits request/result sizes and sessions, and redacts native
error descriptions. It opens no listener on public interfaces. A deployed remote
service needs a properly authenticated HTTPS reverse proxy, strict CORS and
server-side authorization; preserving a permitted loopback Host is required.
Do not enable wildcard/null origins for private data.

PostgreSQL parameters use `$1`; MySQL/SQLite/ODBC/OLE DB use `?`; SQL Server uses
`@p1`, `@p2`, etc. Do not interpolate values into SQL. Native schema/transactions
use the same live connection inside a gateway session. Idle sessions roll back and
expire. Browser cancellation aborts the request, not necessarily an in-flight
native database statement; provider timeouts and close/expiry provide cleanup.
For native drivers, configure a read-only database role rather than relying on a
client flag. Only SQLite implements the gateway profile's `readOnly` flag.

For OLE DB set the server environment connection string, for example an installed
ACE provider and server-owned `.accdb` path. `profile.powershell` can select the
matching Windows PowerShell executable (including 32-bit for a 32-bit provider).
The worker executes a local fixed script, not SQL as PowerShell, and respects the
machine's script execution policy. The operator must install/authorize the provider;
Jet/ACE/ODBC drivers and Microsoft runtime components are not bundled or emulated.

## Validation and reproduction

Run `npm test`, `npm run test:data`, and after `npm run build`,
`npm run test:data:browser`. Chromium tests use the actual classic dialogs and
standalone app controls. REST CRUD/GraphQL/OData use the local HTTP service; public
REST nested mapping is tested against a deterministic browser fixture, not a claim
that a public API was available during the test.

The data workflow also exercises disposable PostgreSQL 17, MySQL 8.4 and SQL Server
2022 through the real gateway. It tests prepared Unicode/injection-shaped values,
binary and Null values, schema, commit/rollback, close rollback and database errors.
See Actions for the result for the exact commit being used.

`node tools/vendor-sqlite.mjs <extracted sql.js@1.14.2 package>` verifies pinned JS
and WASM SHA-256 hashes and reproduces the vendored module. The tiny committed
snapshot bridge reads SQLite's in-memory file without closing/reopening the live
connection; temporary tables and last_insert_rowid therefore survive persistence.
The patch depends on that exact pinned engine and fails closed on version/hash
mismatch. Licenses are in `src/data/vendor/LICENSE.sql.js` and
[THIRD-PARTY-NOTICES](../THIRD-PARTY-NOTICES.md).

Primary API references: [Microsoft ADO](https://learn.microsoft.com/en-us/sql/ado/reference/ado-api/ado-api-reference),
[sql.js](https://github.com/sql-js/sql.js),
[node-postgres](https://node-postgres.com/features/queries),
[MySQL2](https://sidorares.github.io/node-mysql2/docs),
[node-mssql](https://github.com/tediousjs/node-mssql),
[node-odbc](https://github.com/IBM/node-odbc).

## Client recordset compatibility

`ADODB.Recordset` supports `adLockBatchOptimistic` on writable keyed SQLite and
configured REST/JSON/CSV results, and on field-defined disconnected cursors.
`Update`, navigation and `AddNew` commit the edit to the client cache in this mode;
only `UpdateBatch` sends changes to the provider. `CancelBatch` restores originals
and removes uncommitted inserts. Both accept current/group/all scope. Partial
failures preserve failed rows and their original values, add `Connection.Errors`
entries and expose `Status`/`adFilterConflictingRecords`; successful rows are not
resent on retry. A batch is **not implicitly an atomic database transaction**.
Use explicit connection transactions where the provider supports them.

`Clone` shares row data, batch state and bookmarks but has independent positions
and filters; the clone begins at the first unfiltered row. A read-only clone rejects
writes. Requery detaches the refreshed original from existing clones. Edits and
provider writes through different clones are serialized; finish a pending edit on
one clone before editing another. Batch/read-only cursors can detach with
`Set rs.ActiveConnection = Nothing`; batch writes require reconnection to their
original open connection. `Close` refuses a pending immediate edit instead of
silently writing it; explicitly call `Update` or `CancelUpdate` first. Closing a
batch cursor discards pending batch changes, without closing the other cursors.

Implemented cursor APIs include bookmark-array filters, pending/affected/fetched/
conflicting filter groups, `PageSize`, `PageCount`, `AbsolutePage`, `Supports`, field
`OriginalValue`, `ActualSize`, and text/binary `GetChunk`/`AppendChunk`. SQLite keyed
table cursors additionally implement `Resync` and `UnderlyingValue` by querying the
original primary key; they do not substitute a cached value for a database read.
Client cursors remain materialized static cursors: this does not implement native
server-side dynamic/keyset/pessimistic cursors, chapters, join-update inference,
or native ADO event sinks. `Supports` reports only the implemented capabilities.

Validation: `node --test tests/data-batch.test.mjs` and
`python tools/browser-data-recordsets.py --browser chromium` exercise batch
writeback/conflicts, clone lifetimes, original values, typed chunks, pagination,
and actual VB source in the exported runtime. The browser test also accepts
`firefox`/`webkit` when the matching Playwright browsers are installed.

Behavior references: [ADO batch mode](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/batch-mode),
[UpdateBatch](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/updatebatch-method-ado),
[Clone](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/clone-method-ado),
[Close](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/close-method-ado),
and [filter groups](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/filtergroupenum).


## DAO workspaces, databases, QueryDefs and catalogs

The portable source runtime now provides `DAO.DBEngine`, `DAO.Workspace`,
`DAO.Database`, `DAO.QueryDef`, `DAO.TableDef`, `DAO.Index`, `DAO.Field`,
`DAO.Parameter` and `DAO.Recordset` object surfaces. `DBEngine`, `OpenDatabase`
and `CreateDatabase` are also VB globals. `DAO.DBEngine.36` and `.120` activate
this portable implementation, **not** the Microsoft COM binaries.

`OpenDatabase` accepts a named configured provider or a virtual SQLite path.
Use an explicitly configured gateway for a native database: a `.mdb`/`.accdb`
path is never guessed to be SQLite. SQLite `CreateDatabase` and
`CompactDatabase` write genuine independent database files and validate integrity;
Jet/ACE format creation, encryption, workgroup security, replication, locale
collation and native file sharing still require the native provider/host.

DAO cursors implement the distinct **Edit → assign → Update** copy-buffer
contract. Assignment without Edit/AddNew raises 3020. Moving, CancelUpdate and
Close discard unposted edits; Clone shares posted records but not edit buffers.
Failed optimistic updates retain the private copy buffer. AddNew does not create
an observable row before Update, preserves the previous position, and exposes
`LastModified` for moving to the newly inserted/generated-key row. Bookmarks,
zero-based AbsolutePosition, PercentPosition, advancing GetRows, Find methods,
NoMatch, Index/Seek, Filter/Sort-derived OpenRecordset, Requery and CopyQueryDef
are supported. Snapshot and forward-only cursors are read-only. These are
**bounded materialized client views**, not native dynamic/pessimistic page-lock
cursors; `RecordCount` is the full materialized count, not an unknown server count.

`Find*` and filtered child cursors use a bounded, non-evaluating criteria parser:
AND/OR/NOT, comparisons, IS NULL, IN, BETWEEN, date literals and DAO-style LIKE
wildcards. Index/Seek uses real table/index metadata. Writable SQL projection
support is intentionally conservative: direct columns from a single keyed SQLite
table, with every key included. Computed columns, aliases, joins and aggregate
queries are not guessed to be writable. Updating a projection preserves columns
not selected by that projection.

QueryDefs accept `PARAMETERS` declarations, typed/named/positional values,
`RecordsAffected`, `MaxRecords`, and per-query `ODBCTimeout`. Declared parameter
names are rewritten lexically, not by string replacement; comments, string
literals, quoted identifiers and qualified names remain intact. Named QueryDefs
are stored in the SQLite file's hidden `__vb6_dao_querydefs` catalog and survive
binary export/reopen. Rename/Delete/SQL edits update that catalog and participate
in transactions. Their parameters support VB default-value assignment. TableDefs
and Indexes create real SQLite DDL with AutoNumber keys, null/zero-length checks,
literal defaults, uniqueness and index direction; failed DDL rolls back only its
own savepoint. Attached field schema edits use explicit SQL, not pretend in-memory
schema updates. Native catalog mutation is not implemented by this portable layer.

A workspace shares one connection for duplicate handles to the same configuration,
including concurrent opens. BeginTrans/CommitTrans support nesting on that
resource; Rollback cancels the entire workspace transaction and refreshes catalog
state. Different workspaces do not borrow each other's active transaction.
**Multi-resource/distributed atomicity is rejected**, not emulated with sequential
commits. A connection cannot join an already active workspace transaction. Closing
a database rolls back an active workspace transaction and discards pending edits.

The supported command timeout range remains 1–600 seconds; QueryDef -1 inherits
Database.QueryTimeout (60 seconds by default). Infinite timeout, pass-through
connection reconfiguration on QueryDef, server cursors and pessimistic locking
are diagnosed rather than silently accepted. Native DAO SQL grammar beyond the
parameter preamble is not a replacement for Jet's complete expression language.

```vb
Dim db As DAO.Database, q As DAO.QueryDef, rs As DAO.Recordset
Set db = OpenDatabase("/customers.sqlite")
db.Execute "CREATE TABLE IF NOT EXISTS Customers(id INTEGER PRIMARY KEY, name TEXT)"
Set q = db.CreateQueryDef("", "PARAMETERS key Long; SELECT * FROM Customers WHERE id=key")
q.Parameters("key") = 1
Set rs = q.OpenRecordset(dbOpenDynaset)
If Not rs.EOF Then
    rs.Edit
    rs!name = "Updated"
    rs.Update
    Debug.Print rs.Fields("name")
End If
rs.Close
db.Close
```

Only registered library Field/Parameter objects receive VB default-member
coercion; a forged `__type` label does not expose arbitrary JavaScript objects.
`Set f = rs.Fields("name")` retains the object, while `Debug.Print f` and `f = ...`
use its Value. GUID, Decimal and database date/time ADO fields now validate and
coerce through the shared typed field implementation. Regression fixtures run
compiled VB programs in the Node VM and exported Chromium/Firefox/WebKit runtimes.
