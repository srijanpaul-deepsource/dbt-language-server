import { assertThat, greaterThanOrEqualTo, hasItem, hasProperties, hasSize } from 'hamjest';
import { ok } from 'node:assert';
import { CompletionItem, DefinitionLink, Diagnostic, DiagnosticRelatedInformation, Location, Position, Range, Uri, languages } from 'vscode';
import { PREVIEW_URI, sleep, triggerCompletion, triggerDefinition } from './helper';

export async function assertAllDiagnostics(uri: Uri, rawDiagnostics: Diagnostic[], compiledDiagnostics?: Diagnostic[]): Promise<void> {
  await assertDiagnostics(uri, rawDiagnostics);
  await assertDiagnostics(Uri.parse(PREVIEW_URI), compiledDiagnostics ?? rawDiagnostics);
}

export async function assertDiagnostics(uri: Uri, diagnostics: Diagnostic[]): Promise<void> {
  await sleep(200);

  const rawDocDiagnostics = languages.getDiagnostics(uri);
  assertThat(rawDocDiagnostics, hasSize(diagnostics.length));
  if (diagnostics.length > 0) {
    assertDiagnostic(rawDocDiagnostics[0], diagnostics[0]);
  }
}

function assertRange(actualRange: Range, expectedRange: Range): void {
  assertThat(actualRange.start.line, expectedRange.start.line);
  assertThat(actualRange.start.character, expectedRange.start.character);
  assertThat(actualRange.end.line, expectedRange.end.line);
  assertThat(actualRange.end.character, expectedRange.end.character);
}

function assertDiagnostic(actual: Diagnostic, expected: Diagnostic): void {
  assertThat(actual.message, expected.message);
  assertRange(actual.range, expected.range);

  if (expected.relatedInformation && expected.relatedInformation.length > 0) {
    ok(actual.relatedInformation);
    assertRelatedInformation(actual.relatedInformation[0], expected.relatedInformation[0]);
  }
}

function assertRelatedInformation(actual: DiagnosticRelatedInformation, expected: DiagnosticRelatedInformation): void {
  assertThat(actual.message, expected.message);
  assertLocation(actual.location, expected.location);
}

function assertLocation(actual: Location, expected: Location): void {
  assertRange(actual.range, expected.range);
  assertThat(actual.uri.path, expected.uri.path);
}

export async function assertDefinitions(docUri: Uri, position: Position, expectedDefinitions: DefinitionLink[]): Promise<void> {
  const definitions = await triggerDefinition(docUri, position);

  assertThat(definitions.length, expectedDefinitions.length);

  for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    const expectedDefinition = expectedDefinitions[i];

    assertThat(definition.originSelectionRange, expectedDefinition.originSelectionRange);
    assertThat(definition.targetUri.path, expectedDefinition.targetUri.path);
    assertThat(definition.targetRange, expectedDefinition.targetRange);
    assertThat(definition.targetSelectionRange, expectedDefinition.targetSelectionRange);
  }
}

export async function assertCompletions(
  docUri: Uri,
  position: Position,
  expectedCompletionList: CompletionItem[],
  triggerChar?: string,
): Promise<void> {
  const actualCompletionList = await triggerCompletion(docUri, position, triggerChar);

  assertThat(actualCompletionList.items.length, greaterThanOrEqualTo(expectedCompletionList.length));
  expectedCompletionList.forEach((expectedItem, i) => {
    const actualItem = actualCompletionList.items[i];
    assertThat(actualItem.label, expectedItem.label);
    assertThat(actualItem.kind, expectedItem.kind);
    assertThat(actualItem.insertText, expectedItem.insertText ?? expectedItem.label);
    if (expectedItem.detail) {
      assertThat(actualItem.detail, expectedItem.detail);
    }
  });
}

export async function assertCompletionsContain(
  docUri: Uri,
  position: Position,
  expectedCompletionList: CompletionItem[],
  triggerChar?: string,
): Promise<void> {
  const actualCompletionList = await triggerCompletion(docUri, position, triggerChar);

  assertThat(actualCompletionList.items.length, greaterThanOrEqualTo(expectedCompletionList.length));

  for (const expectedItem of expectedCompletionList) {
    assertThat(
      actualCompletionList.items,
      hasItem(
        hasProperties({
          label: expectedItem.label,
          kind: expectedItem.kind,
          insertText: expectedItem.insertText ?? expectedItem.label,
          detail: expectedItem.detail,
        }),
      ),
    );
  }
}
