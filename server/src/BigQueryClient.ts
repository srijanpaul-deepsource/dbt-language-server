import { BigQuery } from '@google-cloud/bigquery';

export class BigQueryClient {
  bigQuery: BigQuery;

  constructor(keyFilename: string, projectId: string) {
    const options = {
      keyFilename: keyFilename,
      projectId: projectId,
    };
    this.bigQuery = new BigQuery(options);
  }

  async getTableSchema(dataSet: string, tableName: string) {
    const dataset = this.bigQuery.dataset(dataSet);
    const table = dataset.table(tableName);
    try {
      const metadata = await table.getMetadata();
      return metadata[0].schema;
    } catch (e) {
      console.log(e.message);
    }
  }
}
