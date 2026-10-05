/** Start only disposable loopback databases; never accepts an external connection string. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const kind = process.argv[2];
assert(['pg', 'mysql', 'mssql'].includes(kind), 'Choose pg, mysql or mssql');
const root = fileURLToPath(new URL('..', import.meta.url));
const password = 'T9!' + randomBytes(24).toString('hex');
const name = 'vb6-data-test-' + kind + '-' + randomBytes(8).toString('hex');
const spec = {
  pg: {image: 'postgres:17', port: 5432, env: {POSTGRES_DB: 'vb6test', POSTGRES_PASSWORD: password}, key: 'VB6_PG_PASSWORD'},
  mysql: {image: 'mysql:8.4', port: 3306, env: {MYSQL_DATABASE: 'vb6test', MYSQL_ROOT_PASSWORD: password}, key: 'VB6_MYSQL_PASSWORD'},
  mssql: {image: 'mcr.microsoft.com/mssql/server:2022-latest', port: 1433, env: {ACCEPT_EULA: 'Y', MSSQL_PID: 'Developer', MSSQL_SA_PASSWORD: password}, key: 'VB6_SQL_PASSWORD'}
}[kind];
const environment = {...process.env, ...spec.env, [spec.key]: password};
let started = false;
try {
  // Values stay in this process environment rather than committed YAML, command arguments or logs.
  const launch = spawnSync('docker', ['run', '--detach', '--rm', '--name', name,
    '--publish', `127.0.0.1:${spec.port}:${spec.port}`,
    ...Object.keys(spec.env).flatMap(key => ['--env', key]), spec.image],
    {cwd: root, env: environment, stdio: 'inherit', timeout: 240000});
  if (launch.error) throw launch.error;
  assert.equal(launch.status, 0, 'Disposable database container did not start');
  started = true;
  const test = spawnSync(process.execPath, ['tools/data-live-drivers.mjs', kind],
    {cwd: root, env: environment, stdio: 'inherit', timeout: 180000});
  if (test.error) throw test.error;
  assert.equal(test.status, 0, 'Live native driver checks failed');
} finally {
  // The randomly generated name identifies only the disposable container created above.
  const cleanup = spawnSync('docker', ['rm', '--force', '--volumes', name],
    {cwd: root, stdio: 'pipe', timeout: 30000});
  if (started && cleanup.status !== 0) throw new Error('Failed to remove disposable database container');
}
