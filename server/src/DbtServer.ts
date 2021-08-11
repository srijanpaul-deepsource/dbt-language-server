import * as child from 'child_process';
import axios from 'axios';
import { v4 as uuid } from 'uuid';

interface PostData {
  jsonrpc: '2.0';
  method: 'status' | 'compile' | 'compile_sql' | 'poll' | 'kill';
  id: string;
  params?: StatusParams | CompileModelParams | CompileSqlParams | PollParams | KillParams;
}

interface Params {
  timeout?: number;
}

interface StatusParams extends Params {}

interface CompileModelParams extends Params {
  threads?: string;
  models: string;
}

interface CompileSqlParams extends Params {
  sql: string;
  name: string;
}

interface PollParams extends Params {
  request_token: string;
  logs: false;
}

interface KillParams extends Params {
  task_id: string;
}

interface Response {
  error?: {
    data?: {
      message?: string;
    };
  };
}

interface StatusResponse extends Response {
  result: {
    state: 'ready' | 'compiling' | 'error';
    pid: number;
    error?: {
      message: string;
    };
  };
}

export interface CompileResponse extends Response {
  result: {
    request_token: string;
  };
}

interface PollResponse extends Response {
  result: {
    state: string;
    elapsed: number;
    results?: CompileResult[];
  };
}

export interface CompileResult {
  status: string;
  node: {
    compiled: boolean;
    compiled_sql: string;
  };
}

export class DbtServer {
  static PORT = '8588';

  pid = -1;

  startDbtRpc() {
    const existingRpc = child.spawnSync('lsof', ['-ti:8588']);
    const pids = String(existingRpc.stdout).split(/\n|\r/g);
    console.log('killing pid "' + pids + '"');
    child.spawn('kill', pids); // TODO delete this

    const rpc = child.exec('dbt --partial-parse rpc --port ' + DbtServer.PORT, (error, stdout, stderr) => {
      if (error) {
        console.error(`error: ${error.message}`);
        return;
      }

      if (stderr) {
        console.error(`stderr: ${stderr}`);
        return;
      }

      console.log(`stdout:\n${stdout}`);
    });

    rpc.on('exit', code => {
      console.log(`Child exited with code ${code}`);
    });

    function exitHandler() {
      rpc.kill();
    }

    process.on('exit', exitHandler);

    // Catches Ctrl+C event
    process.on('SIGINT', exitHandler);

    // Catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', exitHandler);
    process.on('SIGUSR2', exitHandler);

    // Catches uncaught exceptions
    process.on('uncaughtException', exitHandler);
  }

  refreshServer() {
    if (this.pid !== -1) {
      // const result = child.spawnSync('kill', ['-HUP', this.pid.toString()]);
      // console.log(`kill -HUP ${this.pid}`);
    }
  }

  async isAvailable() {
    for (let i = 0; i < 10; i++) {
      try {
        const ready = await this.checkServerReadyOrError();
        console.log('ready: ' + ready);
        if (ready) {
          return true;
        }
      } catch (e) {
        if (e.code !== 14) {
          return false;
        }
      }
      await this.delay(200);
    }
    return false;
  }

  async getReadyOrErrorStatus() {
    for (let i = 0; i < 1; i++) {
      const status = await this.getCurrentStatus();
      console.log('ready: ' + !!status);
      if (status) {
        return status;
      }
      await this.delay(200);
    }
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms, []));
  }

  async getCurrentStatus() {
    const statusRespopnse = await this.getStatus();
    if (statusRespopnse?.result.pid) {
      this.pid = statusRespopnse?.result.pid;
    }
    const state = statusRespopnse?.result.state;
    if (state === 'ready' || state === 'error') {
      return statusRespopnse?.result;
    }
  }

  async checkServerReadyOrError() {
    const statusRespopnse = await this.getStatus();
    this.pid = statusRespopnse ? statusRespopnse.result.pid : -1;
    const state = statusRespopnse?.result.state;
    return state === 'ready' || state === 'error';
  }

  async getStatus() {
    const data: PostData = {
      jsonrpc: '2.0',
      method: 'status',
      id: uuid(),
      params: {
        timeout: 1,
      },
    };

    return await this.makePostRequest<StatusResponse>(data);
  }

  async compileModule(moduleName: string): Promise<CompileResponse | undefined> {
    const data: PostData = {
      jsonrpc: '2.0',
      method: 'compile',
      id: uuid(),
      params: {
        models: moduleName,
      },
    };

    return await this.makePostRequest<CompileResponse>(data);
  }

  async compileSql(sql: string): Promise<CompileResponse> {
    const data: PostData = {
      jsonrpc: '2.0',
      method: 'compile_sql',
      id: uuid(),
      params: {
        timeout: 60,
        sql: Buffer.from(sql).toString('base64'),
        name: 'compile_sql',
      },
    };

    const result = await this.makePostRequest<CompileResponse>(data);
    if (!result) {
      return {
        result: { request_token: '' },
        error: {
          data: {
            message: 'Error while running compile sql',
          },
        },
      };
    }
    return result;
  }

  async pollOnceCompileResult(requestToken: string): Promise<PollResponse | undefined> {
    const data: PostData = {
      jsonrpc: '2.0',
      method: 'poll',
      id: uuid(),
      params: {
        request_token: requestToken,
        logs: false,
      },
    };

    return await this.makePostRequest<PollResponse>(data);
  }

  async pollCompileResult(requestToken: string): Promise<PollResponse | undefined> {
    let pollResponse: PollResponse | undefined;
    do {
      pollResponse = await this.pollOnceCompileResult(requestToken);
      console.log(pollResponse?.result.state);
    } while (pollResponse?.result.state === 'running');
    return pollResponse;
  }

  async kill(requestToken: string) {
    const data: PostData = {
      jsonrpc: '2.0',
      method: 'kill',
      id: uuid(),
      params: {
        task_id: requestToken,
        timeout: 1,
      },
    };

    return await this.makePostRequest<PollResponse>(data);
  }

  async makePostRequest<T extends Response>(postData: object): Promise<T | undefined> {
    try {
      const response = await axios.post<T>(`http://localhost:${DbtServer.PORT}/jsonrpc`, postData, { timeout: 6000 });
      console.log(response);
      const { data } = response;
      if (data?.error?.data?.message) {
        const message = data?.error?.data?.message;
        if (message && message.indexOf('invalid_grant') > 0) {
          console.warn('Reauth required for dbt!');
          return;
        }
      }
      return data;
    } catch (error) {
      console.error(error);
    }
  }
}
