import { deferred, DeferredResult } from 'dbt-language-server-common';
import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  commands,
  CompletionItem,
  CompletionList,
  DefinitionLink,
  extensions,
  ExtensionTerminalOptions,
  LanguageStatusItem,
  Position,
  Pseudoterminal,
  QuickPick,
  QuickPickItem,
  Range,
  Selection,
  SignatureHelp,
  TextDocument,
  TextDocumentChangeEvent,
  TextEditor,
  TextEditorEdit,
  Uri,
  window,
  workspace,
} from 'vscode';
import EventEmitter = require('node:events');

interface ExtensionApi {
  manifestParsedEventEmitter: EventEmitter;
  statusHandler: unknown;
  quickPick?: QuickPick<QuickPickItem>;
}
const LS_MANIFEST_PARSED_EVENT = 'manifestParsedEvent';

type LanguageStatusItemsType = {
  activeDbtProject: LanguageStatusItem;
  python: LanguageStatusItem;
  dbt: LanguageStatusItem;
  dbtAdapters: LanguageStatusItem;
  dbtPackages: LanguageStatusItem;
  profilesYml: LanguageStatusItem;
};

let pathEqual: (actual: string, expected: string) => boolean;

export let doc: TextDocument;
let editor: TextEditor;

type VoidFunc = () => void;

const PROJECTS_PATH = path.resolve(__dirname, '../projects');
const DOWNLOADS_PATH = path.resolve(__dirname, '../.downloads');

export const TEST_FIXTURE_PATH = path.resolve(PROJECTS_PATH, 'test-fixture');
export const POSTGRES_PATH = path.resolve(PROJECTS_PATH, 'postgres');
export const COMPLETION_JINJA_PATH = path.resolve(PROJECTS_PATH, 'completion-jinja');
export const SPECIAL_PYTHON_SETTINGS_PATH = path.resolve(PROJECTS_PATH, 'special-python-settings');
export const SNOWFLAKE_PATH = path.resolve(PROJECTS_PATH, 'snowflake');

export const PREVIEW_URI = 'query-preview:Preview?dbt-language-server';
export const PROJECT1_PATH = path.resolve(PROJECTS_PATH, 'two-projects/project1');

export const MAX_RANGE = new Range(0, 0, 999, 999);

workspace.onDidChangeTextDocument(onDidChangeTextDocument);

let previewPromiseResolve: VoidFunc | undefined;
let documentPromiseResolve: VoidFunc | undefined;

let extensionApi: ExtensionApi | undefined = undefined;
const languageServerReady = new Array<[string, DeferredResult<void>]>();

let tempModelIndex = 0;

export async function openDocument(docUri: Uri): Promise<void> {
  doc = await workspace.openTextDocument(docUri);
  editor = await window.showTextDocument(doc);
}

export async function activateAndWait(docUri: Uri): Promise<void> {
  const existingEditor = findExistingEditor(docUri);
  const waitOnlySwitchingBetweenTabs = Boolean(existingEditor && existingEditor === window.activeTextEditor && getPreviewEditor());
  console.log(`waitOnlySwitchingBetweenTabs: ${waitOnlySwitchingBetweenTabs.toString()}`);
  const activateFinished = waitOnlySwitchingBetweenTabs ? Promise.resolve() : createChangePromise('preview');

  await openDocument(docUri);
  await showPreview();
  await activateFinished;
}

export async function activateAndWaitManifestParsed(docUri: Uri, projectFolderName: string): Promise<void> {
  const existingEditor = findExistingEditor(docUri);
  await openDocument(docUri);
  await (existingEditor ? Promise.resolve() : waitForManifestParsed(projectFolderName));
}

function findExistingEditor(docUri: Uri): TextEditor | undefined {
  return window.visibleTextEditors.find(e => e.document.uri.path === docUri.path);
}

function onDidChangeTextDocument(e: TextDocumentChangeEvent): void {
  if (e.document.uri.path === 'Preview' && previewPromiseResolve) {
    if (
      // When we switch to a new document, the preview content is set to '' we skip this such events here
      e.contentChanges.length === 1 &&
      e.contentChanges[0].text === '' &&
      e.contentChanges[0].range.start.line === 0 &&
      e.contentChanges[0].range.start.character === 0
    ) {
      return;
    }
    console.log(`Preview changed: ${e.contentChanges[0].text}`);
    previewPromiseResolve();
  } else if (e.document === doc && documentPromiseResolve) {
    documentPromiseResolve();
  }
}

export function waitWithTimeout(promise: Promise<void>, timeout: number): Promise<void> {
  return Promise.race([promise, setTimeout(timeout)]);
}

export async function waitDocumentModification(func: () => Promise<void>): Promise<void> {
  const promise = createChangePromise('document');
  await func();
  await waitWithTimeout(promise, 1000);
}

async function waitPreviewModification(func?: () => Promise<void>): Promise<void> {
  const promise = createChangePromise('preview');
  if (func) {
    await func();
  }
  await promise;
}

export function getMainEditorText(): string {
  return doc.getText();
}

async function showPreview(): Promise<void> {
  await commands.executeCommand('WizardForDbtCore(TM).showQueryPreview');
}

export async function analyzeEntireProject(): Promise<void> {
  await commands.executeCommand('WizardForDbtCore(TM).analyzeEntireProject');
}

export async function closeAllEditors(): Promise<void> {
  await commands.executeCommand('workbench.action.closeAllEditors');
}

export async function triggerAndAcceptFirstSuggestion(): Promise<void> {
  await commands.executeCommand('editor.action.triggerSuggest');
  await sleep(400);
  await waitDocumentModification(async () => {
    await commands.executeCommand('acceptSelectedSuggestion');
  });
}

export function getPreviewText(): string {
  const previewEditor = getPreviewEditor();
  if (!previewEditor) {
    throw new Error('Preview editor not found');
  }

  return previewEditor.document.getText();
}

function getPreviewEditor(): TextEditor | undefined {
  return window.visibleTextEditors.find(e => e.document.uri.toString() === PREVIEW_URI);
}

export function sleep(ms: number): Promise<unknown> {
  return setTimeout(ms);
}

function getDocPath(p: string): string {
  return path.resolve(TEST_FIXTURE_PATH, 'models', p);
}

export function getDocUri(docName: string): Uri {
  return Uri.file(getDocPath(docName));
}

export function getAbsolutePath(pathRelativeToProject: string): string {
  return path.resolve(PROJECTS_PATH, pathRelativeToProject);
}

export function getCustomDocUri(p: string): Uri {
  return Uri.file(getAbsolutePath(p));
}

export async function setTestContent(content: string, waitForPreview = true): Promise<void> {
  if (waitForPreview) {
    await showPreview();
  }

  if (doc.getText() === content) {
    return;
  }

  const all = new Range(doc.positionAt(0), doc.positionAt(doc.getText().length));

  const editCallback = (eb: TextEditorEdit): void => eb.replace(all, content);
  await (waitForPreview ? edit(editCallback) : editor.edit(editCallback));

  const lastPos = doc.positionAt(doc.getText().length);
  editor.selection = new Selection(lastPos, lastPos);
}

export async function appendText(value: string): Promise<void> {
  return insertText(editor.document.positionAt(editor.document.getText().length), value);
}

export async function insertText(position: Position, value: string): Promise<void> {
  return edit(eb => eb.insert(position, value));
}

export async function replaceText(oldText: string, newText: string, waitForPreview = true): Promise<void> {
  const callback = prepareReplaceTextCallback(oldText, newText);
  await (waitForPreview ? edit(callback) : editor.edit(callback));
}

function prepareReplaceTextCallback(oldText: string, newText: string): (editBuilder: TextEditorEdit) => void {
  const offsetStart = editor.document.getText().indexOf(oldText);
  if (offsetStart === -1) {
    throw new Error(`Text "${oldText}"" not found in "${editor.document.getText()}"`);
  }

  const positionStart = editor.document.positionAt(offsetStart);
  const positionEnd = editor.document.positionAt(offsetStart + oldText.length);

  return eb => eb.replace(new Range(positionStart, positionEnd), newText);
}

async function edit(callback: (editBuilder: TextEditorEdit) => void): Promise<void> {
  return waitPreviewModification(async () => {
    await editor.edit(callback);
  });
}

async function createChangePromise(type: 'preview' | 'document'): Promise<void> {
  return new Promise<void>(resolve => {
    if (type === 'preview') {
      previewPromiseResolve = resolve;
    } else {
      documentPromiseResolve = resolve;
    }
  });
}

export function getCursorPosition(): Position {
  return editor.selection.end;
}

export function installDbtPackages(projectFolder: string): void {
  spawnSync('dbt', ['deps'], { cwd: getAbsolutePath(projectFolder) });
}

export function installExtension(extensionId: string): void {
  console.log(`Installing extension ${extensionId}`);
  const installResult = installUninstallExtension('install', extensionId);
  if (installResult.status !== 0) {
    console.log(`Failed to install '${extensionId}' extension from marketplace.`);

    ensureDirectoryExists(DOWNLOADS_PATH);
    const extensionFilePath = path.resolve(DOWNLOADS_PATH, `${extensionId}.vsix`);

    const downloadResult = spawnSync('npx', ['ovsx', 'get', extensionId, '-o', extensionFilePath], {
      encoding: 'utf8',
      stdio: 'inherit',
    });

    if (downloadResult.status !== 0) {
      throw new Error(`Failed to download '${extensionId}' extension from open-vsx.`);
    }

    const openVsxInstallResult = installUninstallExtension('install', extensionFilePath);
    if (openVsxInstallResult.status !== 0) {
      throw new Error(`Failed to install '${extensionId}' extension from open-vsx.`);
    }
  }
  console.log(`Installation extension ${extensionId} finished successfully.`);
}

export function disableExtension(extensionId: string): SpawnSyncReturns<string> {
  console.log(`Disabling extension ${extensionId}`);
  const extensionsInstallPathParam = `--extensions-dir=${process.env['EXTENSIONS_INSTALL_PATH'] ?? ''}`;
  const result = runCliCommand([`--disable-extension=${extensionId}`, extensionsInstallPathParam]);
  console.log(`Disabling extension ${extensionId} finished successfully.`);
  return result;
}

function installUninstallExtension(command: 'install' | 'uninstall', extensionId: string): SpawnSyncReturns<string> {
  const extensionsInstallPathParam = `--extensions-dir=${process.env['EXTENSIONS_INSTALL_PATH'] ?? ''}`;
  return runCliCommand([`--${command}-extension=${extensionId}`, extensionsInstallPathParam]);
}

function runCliCommand(args: string[]): SpawnSyncReturns<string> {
  const cliPath = process.env['CLI_PATH'];
  if (!cliPath) {
    throw new Error('CLI_PATH environment variable not found');
  }

  return spawnSync(cliPath, args, {
    encoding: 'utf8',
    stdio: 'inherit',
  });
}

export function getLanguageStatusItems(): LanguageStatusItemsType {
  type ItemsType = {
    activeDbtProject: { item: LanguageStatusItem };
    python: { item: LanguageStatusItem };
    dbt: { item: LanguageStatusItem };
    dbtAdapters: { item: LanguageStatusItem };
    dbtPackages: { item: LanguageStatusItem };
    profilesYml: { item: LanguageStatusItem };
  };
  const items = (extensionApi?.statusHandler as { statusItems: unknown }).statusItems as ItemsType;

  return {
    activeDbtProject: items.activeDbtProject.item,
    python: items.python.item,
    dbt: items.dbt.item,
    dbtAdapters: items.dbtAdapters.item,
    dbtPackages: items.dbtPackages.item,
    profilesYml: items.profilesYml.item,
  };
}

export async function triggerCompletion(docUri: Uri, position: Position, triggerChar?: string): Promise<CompletionList<CompletionItem>> {
  return commands.executeCommand<CompletionList>('vscode.executeCompletionItemProvider', docUri, position, triggerChar);
}

export async function triggerDefinition(docUri: Uri, position: Position): Promise<DefinitionLink[]> {
  return commands.executeCommand<DefinitionLink[]>('vscode.executeDefinitionProvider', docUri, position);
}

export async function executeSignatureHelpProvider(docUri: Uri, position: Position, triggerChar?: string): Promise<SignatureHelp> {
  return commands.executeCommand<SignatureHelp>('vscode.executeSignatureHelpProvider', docUri, position, triggerChar);
}

export async function executeInstallDbtCore(): Promise<void> {
  return commands.executeCommand('WizardForDbtCore(TM).installDbtCore', undefined, true);
}

export async function executeCreateDbtProject(fsPath: string): Promise<void> {
  return commands.executeCommand('WizardForDbtCore(TM).createDbtProject', fsPath, true);
}

export async function executeCreateFile(): Promise<void> {
  return commands.executeCommand('workbench.action.files.newUntitledFile');
}

export async function moveCursorLeft(): Promise<unknown> {
  return commands.executeCommand('cursorMove', {
    to: 'left',
    by: 'wrappedLine',
    select: false,
    value: 1,
  });
}

export async function createAndOpenTempModel(workspaceName: string, waitFor: 'preview' | 'manifest' = 'preview'): Promise<Uri> {
  const thisWorkspaceUri = workspace.workspaceFolders?.find(w => w.name === workspaceName)?.uri;
  if (thisWorkspaceUri === undefined) {
    throw new Error('Workspace not found');
  }
  const newUri = Uri.parse(`${thisWorkspaceUri.toString()}/models/temp_model${tempModelIndex}.sql`);
  tempModelIndex++;

  console.log(`Creating new file: ${newUri.toString()}`);
  fs.writeFileSync(newUri.fsPath, '-- Empty');

  await (waitFor === 'preview' ? activateAndWait(newUri) : activateAndWaitManifestParsed(newUri, thisWorkspaceUri.path));
  if (waitFor === 'manifest') {
    console.log(`createAndOpenTempModel: wait for manifest parsed in '${thisWorkspaceUri.path}'`);
  }

  return newUri;
}

export function getTextInQuotesIfNeeded(text: string, withQuotes: boolean): string {
  return withQuotes ? `'${text}'` : text;
}

function ensureDirectoryExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
}

function waitForManifestParsed(projectFolderName: string): Promise<void> {
  console.log(`waitForManifestParsed '${normalizePath(projectFolderName)}'`);
  return getLanguageServerReadyDeferred(projectFolderName).promise;
}

export async function initializeExtension(): Promise<void> {
  const ext = extensions.getExtension('Fivetran.dbt-language-server');
  ({ pathEqual } = await import('path-equal'));

  if (!ext) {
    throw new Error('Fivetran.dbt-language-server not found');
  }
  extensionApi = (await ext.activate()) as ExtensionApi;

  extensionApi.manifestParsedEventEmitter.on(LS_MANIFEST_PARSED_EVENT, (languageServerRootPath: string) => {
    console.log(`Language Server '${normalizePath(languageServerRootPath)}' ready`);
    getLanguageServerReadyDeferred(languageServerRootPath).resolve();
  });
}

function getLanguageServerReadyDeferred(rootPath: string): DeferredResult<void> {
  const normalizedPath = normalizePath(rootPath);
  let lsReadyDeferred = languageServerReady.find(r => pathEqual(r[0], normalizedPath));
  if (lsReadyDeferred === undefined) {
    lsReadyDeferred = [normalizedPath, deferred<void>()];
    languageServerReady.push(lsReadyDeferred);
  }

  return lsReadyDeferred[1];
}

function normalizePath(rawPath: string): string {
  return process.platform === 'win32' ? trimPath(rawPath).toLocaleLowerCase() : rawPath;
}

function trimPath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+$/, '');
}

export function getCreateProjectPseudoterminal(): Pseudoterminal {
  return (window.terminals.find(t => t.name === 'Create dbt project')?.creationOptions as ExtensionTerminalOptions).pty;
}

export function getQuickPickItems(): readonly QuickPickItem[] | undefined {
  return extensionApi?.quickPick?.items;
}
