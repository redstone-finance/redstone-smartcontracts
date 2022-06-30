/* eslint-disable */
import {defaultArweaveMs, EvalStateResult, SmartWeaveTags, sortingLast} from '@warp/core';
import Arweave from 'arweave';
import { LoggerFactory } from '@warp/logging';
import Transaction from 'arweave/node/lib/transaction';
import { ContractData, CreateContract, FromSrcTxContractData, SourceImpl } from '@warp/contract';
import {LevelDbCache} from "@warp";
import knex from "knex";

export type MigrationResult = Array<{contractTxId: string, height: number, sortKey: string}>

export class MigrationTool {
  private readonly logger = LoggerFactory.INST.create('MigrationTool');

  constructor(private readonly arweave: Arweave, private readonly levelDb: LevelDbCache<EvalStateResult<unknown>>) {
  }

  async migrateSqlite(sqlitePath: string): Promise<MigrationResult> {
    this.logger.info(`Migrating from sqlite ${sqlitePath} to leveldb.`);

    const knexDb = knex({
      client: 'sqlite3',
      connection: {
        filename: sqlitePath
      },
      useNullAsDefault: true
    });

    const cache = await knexDb
      .select(['contract_id', 'height', 'state'])
      .from('states')
      .max('height')
      .groupBy(['contract_id']);

    this.logger.info(`Migrating ${cache?.length} contracts' state`);

    const result = [];

    for (let entry of cache) {
      const contractTxId = entry['contract_id'];
      const height = entry['height'];
      const state = JSON.parse(entry['state']);

      const blockHeightString = `${height}`.padStart(12, '0');
      const sortKey = `${blockHeightString},${defaultArweaveMs},${sortingLast}`

      this.logger.debug(`Migrating ${contractTxId} at height ${height}: ${sortKey}`);

      await this.levelDb.put({
        contractTxId,
        sortKey: `${blockHeightString},${defaultArweaveMs},${sortingLast}`
      }, new EvalStateResult(state.state, state.validity, {}));

      result.push({contractTxId, height, sortKey});
    }

    this.logger.info(`Migration done.`);

    return result;
  }

}
