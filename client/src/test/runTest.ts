import * as path from 'path';
import { spawnSync } from 'child_process';

import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { homedir } from 'os';
import { BigQuery, TableField } from '@google-cloud/bigquery';

async function main() {
  try {
    await prepareBigQuery();

    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './index');

    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    spawnSync(cliPath, ['--install-extension=ms-python.python'], {
      encoding: 'utf-8',
      stdio: 'inherit',
    });

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [path.resolve(__dirname, '../../test-fixture/')],
      extensionTestsEnv: { CLI_PATH: cliPath },
    });
  } catch (err) {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

async function prepareBigQuery() {
  const options = {
    keyFilename: `${homedir()}/.dbt/bq-test-project.json`,
    projectId: 'singular-vector-135519',
  };
  const bigQuery = new BigQuery(options);

  const dsName = 'dbt_ls_e2e_dataset';
  let dataset = bigQuery.dataset(dsName);
  await dataset.get({ autoCreate: true });

  ensureTableExists(bigQuery, dsName, 'test_table1', [
    { name: 'id', type: 'INTEGER' },
    { name: 'time', type: 'TIMESTAMP' },
    { name: 'name', type: 'STRING' },
    { name: 'date', type: 'DATE' },
  ]);

  ensureTableExists(bigQuery, dsName, 'users', [
    { name: 'id', type: 'INTEGER' },
    { name: 'name', type: 'STRING' },
    { name: 'division', type: 'STRING' },
    { name: 'role', type: 'STRING' },
    { name: 'email', type: 'STRING' },
    { name: 'phone', type: 'STRING' },
    { name: 'profile_id', type: 'STRING' },
  ]);
}

async function ensureTableExists(bigQuery: BigQuery, dsName: string, tableName: string, columns: TableField[]) {
  let dataset = bigQuery.dataset(dsName);
  let table = dataset.table(tableName);
  const [exists] = await table.exists();
  if (!exists) {
    await dataset.createTable(tableName, {
      schema: columns,
    });
  }
}

main();
