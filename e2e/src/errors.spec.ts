import { assertThat, endsWith } from 'hamjest';
import { Diagnostic, DiagnosticSeverity, Position, Range } from 'vscode';
import { assertAllDiagnostics } from './asserts';
import { activateAndWait, getDocUri, getPreviewText, insertText, replaceText } from './helper';

suite('Errors', () => {
  const ERRORS_URI = getDocUri('errors.sql');
  const COMPLEX_QUERY_URI = getDocUri('complex_query.sql');
  const EPHEMERAL_URI = getDocUri('ephemeral.sql');
  const COMPARE_DATES_URI = getDocUri('compare_dates.sql');
  const TABLE_DOES_NOT_EXIST_URI = getDocUri('table_does_not_exist.sql');

  const ERROR = 'Syntax error: SELECT list must not be empty';

  test('Should show error', async () => {
    // arrange
    await activateAndWait(ERRORS_URI);

    // assert
    await assertAllDiagnostics(ERRORS_URI, [new Diagnostic(new Range(0, 8, 0, 12), ERROR)]);
  });

  test('Should show no errors after fix query', async () => {
    // arrange
    await activateAndWait(ERRORS_URI);

    // act
    await insertText(new Position(0, 7), '*');

    // assert
    await assertAllDiagnostics(ERRORS_URI, []);
  });

  test('Should show no errors for query with different constructions', async () => {
    // act
    await activateAndWait(COMPLEX_QUERY_URI);

    // assert
    await assertAllDiagnostics(COMPLEX_QUERY_URI, []);
  });

  test("Should show no errors for queries with materialized='ephemeral'", async () => {
    // act
    await activateAndWait(EPHEMERAL_URI);

    // assert
    assertThat(getPreviewText(), endsWith('select * from dbt_ls_e2e_dataset.test_table1'));
    await assertAllDiagnostics(EPHEMERAL_URI, []);
  });

  test('Should clear diagnostics when catalog changed due to fix from other file', async () => {
    await activateAndWait(COMPARE_DATES_URI);
    await assertAllDiagnostics(COMPARE_DATES_URI, [
      {
        severity: DiagnosticSeverity.Error,
        range: new Range(2, 6, 2, 14),
        message:
          'No matching signature for operator = for argument types: INT64, DATE. Supported signatures: ANY = ANY; INT64 = UINT64; UINT64 = INT64',
      },
    ]);

    await activateAndWait(TABLE_DOES_NOT_EXIST_URI);
    await assertAllDiagnostics(TABLE_DOES_NOT_EXIST_URI, []);

    await replaceText('2 as new_date', 'current_date() as new_date');
    await activateAndWait(COMPARE_DATES_URI);
    await assertAllDiagnostics(COMPARE_DATES_URI, []);
    await assertAllDiagnostics(TABLE_DOES_NOT_EXIST_URI, []);
  });
});
