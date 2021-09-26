import { WorkDoneProgress, WorkDoneProgressBegin, WorkDoneProgressEnd, _Connection } from 'vscode-languageserver';

export class ProgressReporter {
  static uris = new Set<string>();
  static token = 'Progress';

  connection: _Connection;

  constructor(connection: _Connection) {
    this.connection = connection;
  }

  async sendStart(uri?: string): Promise<void> {
    if (uri) {
      ProgressReporter.uris.add(uri);
    }
    this.connection.sendProgress(WorkDoneProgress.type, ProgressReporter.token, <WorkDoneProgressBegin>{
      kind: 'begin',
    });
  }

  sendFinish(uri?: string): void {
    if (uri) {
      ProgressReporter.uris.delete(uri);
    }
    if (ProgressReporter.uris.size === 0) {
      this.connection.sendProgress(WorkDoneProgress.type, ProgressReporter.token, <WorkDoneProgressEnd>{ kind: 'end' });
    }
  }
}
