import { Command, CompletionItem, CompletionItemKind, CompletionParams, CompletionTriggerKind, InsertTextFormat } from 'vscode-languageserver';
import { DestinationDefinition } from '../DestinationDefinition';
import { HelpProviderWords } from '../HelpProviderWords';
import { ActiveTableInfo, CompletionInfo } from '../ZetaSqlAst';

export class SqlCompletionProvider {
  static readonly BQ_KEYWORDS = [
    'abort',
    'access',
    'action',
    'add',
    'aggregate',
    'all',
    'alter',
    'analyze',
    'and',
    'anonymization',
    'any',
    'as',
    'asc',
    'assert',
    'assert_rows_modified',
    'at',
    'batch',
    'begin',
    'between',
    'bigdecimal',
    'bignumeric',
    'break',
    'by',
    'call',
    'cascade',
    'cast',
    'check',
    'clamped',
    'cluster',
    'collate',
    'column',
    'columns',
    'commit',
    'connection',
    'constant',
    'constraint',
    'contains',
    'continue',
    'clone',
    'create',
    'cross',
    'cube',
    'current',
    'data',
    'database',
    'decimal',
    'declare',
    'default',
    'define',
    'definer',
    'delete',
    'desc',
    'describe',
    'descriptor',
    'deterministic',
    'distinct',
    'do',
    'drop',
    'else',
    'elseif',
    'end',
    'enforced',
    'enum',
    'escape',
    'except',
    'exception',
    'exclude',
    'execute',
    'exists',
    'explain',
    'export',
    'external',
    'false',
    'fetch',
    'filter',
    'filter_fields',
    'fill',
    'first',
    'following',
    'for',
    'foreign',
    'from',
    'full',
    'function',
    'generated',
    'grant',
    'group',
    'group_rows',
    'grouping',
    'groups',
    'hash',
    'having',
    'hidden',
    'ignore',
    'immediate',
    'immutable',
    'import',
    'in',
    'include',
    'inout',
    'index',
    'inner',
    'insert',
    'intersect',
    'interval',
    'iterate',
    'into',
    'invoker',
    'is',
    'isolation',
    'join',
    'json',
    'key',
    'language',
    'last',
    'lateral',
    'leave',
    'level',
    'like',
    'limit',
    'lookup',
    'loop',
    'match',
    'matched',
    'materialized',
    'message',
    'model',
    'module',
    'merge',
    'natural',
    'new',
    'no',
    'not',
    'null',
    'nulls',
    'numeric',
    'of',
    'offset',
    'on',
    'only',
    'options',
    'or',
    'order',
    'out',
    'outer',
    'over',
    'partition',
    'percent',
    'pivot',
    'unpivot',
    'policies',
    'policy',
    'primary',
    'preceding',
    'procedure',
    'private',
    'privileges',
    'proto',
    'public',
    'qualify',
    'raise',
    'range',
    'read',
    'recursive',
    'references',
    'rename',
    'repeatable',
    'replace_fields',
    'respect',
    'restrict',
    'return',
    'returns',
    'revoke',
    'rollback',
    'rollup',
    'row',
    'rows',
    'run',
    'safe_cast',
    'schema',
    'search',
    'security',
    'select',
    'set',
    'show',
    'simple',
    'some',
    'source',
    'storing',
    'sql',
    'stable',
    'start',
    'stored',
    'struct',
    'system',
    'system_time',
    'table',
    'tablesample',
    'target',
    'temp',
    'temporary',
    'then',
    'to',
    'transaction',
    'transform',
    'treat',
    'true',
    'truncate',
    'type',
    'unbounded',
    'union',
    'unnest',
    'unique',
    'until',
    'update',
    'using',
    'value',
    'values',
    'volatile',
    'view',
    'views',
    'weight',
    'when',
    'where',
    'while',
    'window',
    'with',
    'within',
    'write',
    'zone',
  ];

  async onSqlCompletion(
    text: string,
    completionParams: CompletionParams,
    destinationDefinition?: DestinationDefinition,
    completionInfo?: CompletionInfo,
  ): Promise<CompletionItem[]> {
    const result: CompletionItem[] = [];

    if (completionInfo && completionInfo.activeTables.length > 0) {
      if (completionParams.context?.triggerKind === CompletionTriggerKind.TriggerCharacter) {
        result.push(...this.getColumnsForActiveTable(text, completionInfo.activeTables));
      } else {
        result.push(...this.getColumnsForActiveTables(completionInfo.activeTables));
      }
    } else if (completionParams.context?.triggerKind !== CompletionTriggerKind.TriggerCharacter) {
      if (completionInfo) {
        result.push(...this.getWithNames(completionInfo.withNames));
      }
      result.push(...this.getDatasets(destinationDefinition));
    }

    if (completionParams.context?.triggerKind === CompletionTriggerKind.TriggerCharacter) {
      result.push(...(await this.getTableSuggestions(text, destinationDefinition)));
    } else {
      result.push(...this.getKeywords(), ...this.getFunctions());
    }

    return result;
  }

  getWithNames(withNames: Set<string>): CompletionItem[] {
    return [...withNames].map<CompletionItem>(w => ({
      label: w,
      kind: CompletionItemKind.Value,
      detail: 'Table',
      sortText: `1${w}`,
    }));
  }

  getColumnsForActiveTables(tables: ActiveTableInfo[]): CompletionItem[] {
    if (tables.length === 1) {
      const [tableInfo] = tables;
      return tableInfo.columns.map<CompletionItem>(c => ({
        label: c.name,
        kind: CompletionItemKind.Value,
        detail: `${tableInfo.name} ${String(c.type)}`,
        sortText: `1${c.name}`,
      }));
    }

    if (tables.length > 1) {
      return tables.flatMap(table => {
        const { name } = table;
        return table.columns.map<CompletionItem>(column => ({
          label: `${name}.${column.name}`,
          kind: CompletionItemKind.Value,
          detail: `${String(column.type)}`,
          sortText: `1${name}.${column.name}`,
        }));
      });
    }
    return [];
  }

  getColumnsForActiveTable(text: string, tables: ActiveTableInfo[]): CompletionItem[] {
    for (const table of tables) {
      if (text === table.name || text === table.alias) {
        return table.columns.map<CompletionItem>(column => ({
          label: `${column.name}`,
          kind: CompletionItemKind.Value,
          detail: `${table.name} ${String(column.type)}`,
          sortText: `1${column.name}`,
        }));
      }
    }
    return [];
  }

  async getTableSuggestions(datasetName: string, destinationDefinition?: DestinationDefinition): Promise<CompletionItem[]> {
    if (!destinationDefinition) {
      return [];
    }

    const tables = await destinationDefinition.getTables(datasetName);
    return tables.map<CompletionItem>(t => ({
      label: t.id,
      kind: CompletionItemKind.Value,
      detail: `Table in ${destinationDefinition.activeProject}.${datasetName}`,
    }));
  }

  getDatasets(destinationDefinition?: DestinationDefinition): CompletionItem[] {
    return destinationDefinition
      ? destinationDefinition.getDatasets().map<CompletionItem>(d => ({
          label: d.id,
          kind: CompletionItemKind.Value,
          detail: `Dataset in ${destinationDefinition.activeProject}`,
          commitCharacters: ['.'],
        }))
      : [];
  }

  getKeywords(): CompletionItem[] {
    return SqlCompletionProvider.BQ_KEYWORDS.map<CompletionItem>(k => ({
      label: k,
      kind: CompletionItemKind.Keyword,
      insertText: `${k} `,
      sortText: `3${k}`,
      detail: '',
    }));
  }

  getFunctions(): CompletionItem[] {
    return HelpProviderWords.map<CompletionItem>(w => ({
      label: w.name,
      kind: CompletionItemKind.Function,
      detail: w.signatures[0].signature,
      documentation: w.signatures[0].description,
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: `${w.name}($0)`,
      sortText: `2${w.name}($0)`,
      command: Command.create('triggerParameterHints', 'editor.action.triggerParameterHints'),
    }));
  }
}
