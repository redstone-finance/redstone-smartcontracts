import { BatchDBOp, CacheKey, SortKeyCache, SortKeyCacheResult } from '../SortKeyCache';
import { Level } from 'level';
import { MemoryLevel } from 'memory-level';
import { CacheOptions } from '../../core/WarpFactory';
import { LoggerFactory } from '../../logging/LoggerFactory';

/**
 * The LevelDB is a lexicographically sorted key-value database - so it's ideal for this use case
 * - as it simplifies cache look-ups (e.g. lastly stored value or value "lower-or-equal" than given sortKey).
 * The cache for contracts are implemented as sub-levels - https://www.npmjs.com/package/level#sublevel--dbsublevelname-options.
 *
 * The default location for the node.js cache is ./cache/warp.
 * The default name for the browser IndexedDB cache is warp-cache
 *
 * In order to reduce the cache size, the oldest entries are automatically pruned.
 */

export class LevelDbCache<V> implements SortKeyCache<V> {
  private readonly logger = LoggerFactory.INST.create('LevelDbCache');

  /**
   * not using the Level type, as it is not compatible with MemoryLevel (i.e. has more properties)
   * and there doesn't seem to be any public interface/abstract type for all Level implementations
   * (the AbstractLevel is not exported from the package...)
   */
  private _db: MemoryLevel<string, V>;

  // Lazy initialization upon first access
  private get db(): MemoryLevel<string, V> {
    if (!this._db) {
      if (this.cacheOptions.inMemory) {
        this._db = new MemoryLevel({ valueEncoding: 'json' });
      } else {
        if (!this.cacheOptions.dbLocation) {
          throw new Error('LevelDb cache configuration error - no db location specified');
        }
        const dbLocation = this.cacheOptions.dbLocation;
        this.logger.info(`Using location ${dbLocation}`);
        this._db = new Level<string, V>(dbLocation, { valueEncoding: 'json' });
      }
    }
    return this._db;
  }

  constructor(private readonly cacheOptions: CacheOptions) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async get(cacheKey: CacheKey, returnDeepCopy?: boolean): Promise<SortKeyCacheResult<V> | null> {
    const contractCache = this.db.sublevel<string, V>(cacheKey.key, { valueEncoding: 'json' });
    // manually opening to fix https://github.com/Level/level/issues/221
    await contractCache.open();
    try {
      const result = await contractCache.get(cacheKey.sortKey);

      return {
        sortKey: cacheKey.sortKey,
        cachedValue: result
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.code == 'LEVEL_NOT_FOUND') {
        return null;
      } else {
        throw e;
      }
    }
  }

  async getLast(key: string): Promise<SortKeyCacheResult<V> | null> {
    const contractCache = this.db.sublevel<string, V>(key, { valueEncoding: 'json' });
    // manually opening to fix https://github.com/Level/level/issues/221
    await contractCache.open();
    const keys = await contractCache.keys({ reverse: true, limit: 1 }).all();
    if (keys.length) {
      return {
        sortKey: keys[0],
        cachedValue: await contractCache.get(keys[0])
      };
    } else {
      return null;
    }
  }

  async getLessOrEqual(key: string, sortKey: string): Promise<SortKeyCacheResult<V> | null> {
    const contractCache = this.db.sublevel<string, V>(key, { valueEncoding: 'json' });
    // manually opening to fix https://github.com/Level/level/issues/221
    await contractCache.open();
    const keys = await contractCache.keys({ reverse: true, lte: sortKey, limit: 1 }).all();
    if (keys.length) {
      return {
        sortKey: keys[0],
        cachedValue: await contractCache.get(keys[0])
      };
    } else {
      return null;
    }
  }

  async put(stateCacheKey: CacheKey, value: V): Promise<void> {
    const contractCache = this.db.sublevel<string, V>(stateCacheKey.key, { valueEncoding: 'json' });
    // manually opening to fix https://github.com/Level/level/issues/221
    await contractCache.open();
    await contractCache.put(stateCacheKey.sortKey, value);
  }

  async delete(key: string): Promise<void> {
    const contractCache = this.db.sublevel<string, V>(key, { valueEncoding: 'json' });
    await contractCache.open();
    await contractCache.clear();
  }

  async batch(opStack: BatchDBOp<V>[]) {
    for (const op of opStack) {
      if (op.type === 'put') {
        await this.put(op.key, op.value);
      } else if (op.type === 'del') {
        await this.delete(op.key);
      }
    }
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    if (this._db) {
      await this._db.close();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async dump(): Promise<any> {
    const result = await this.db.iterator().all();
    return result;
  }

  // TODO: this implementation is sub-optimal
  // the lastSortKey should be probably memoized during "put"
  async getLastSortKey(): Promise<string | null> {
    let lastSortKey = '';
    await this.db.open();
    const keys = await this.db.keys().all();

    for (const key of keys) {
      // default key format used by sub-levels:
      // !<contract_tx_id (43 chars)>!<sort_key>
      const sortKey = key.substring(45);
      if (sortKey.localeCompare(lastSortKey) > 0) {
        lastSortKey = sortKey;
      }
    }

    return lastSortKey == '' ? null : lastSortKey;
  }

  async keys(): Promise<string[]> {
    await this.db.open();
    const keys = await this.db.keys().all();

    const result = new Set<string>();
    keys.forEach((k) => result.add(k.substring(1, 44)));

    return Array.from(result);
  }

  storage<S>(): S {
    return this.db as S;
  }

  async getNumEntries(): Promise<number> {
    const keys = await this.db.keys().all();
    return keys.length;
  }

  /**
   Let's assume that given contract cache contains these sortKeys: [a, b, c, d, e, f]
   Let's assume entriesStored = 2
   After pruning, the cache should be left with these keys: [e,f].

   const entries = await contractCache.keys({ reverse: true, limit: entriesStored }).all();
   This would return in this case entries [f, e] (notice the "reverse: true").

   await contractCache.clear({ lt: entries[entries.length - 1] });
   This effectively means: await contractCache.clear({ lt: e });
   -> hence the entries [a,b,c,d] are removed and left are the [e,f]
  */
  async prune(entriesStored = 5): Promise<null> {
    if (!entriesStored || entriesStored <= 0) {
      entriesStored = 1;
    }

    const contracts = await this.keys();
    for (let i = 0; i < contracts.length; i++) {
      const contractCache = this.db.sublevel<string, V>(contracts[i], { valueEncoding: 'json' });

      // manually opening to fix https://github.com/Level/level/issues/221
      await contractCache.open();

      // Get keys that will be left, just to get the last one of them
      const entries = await contractCache.keys({ reverse: true, limit: entriesStored }).all();
      if (!entries || entries.length < entriesStored) {
        continue;
      }
      await contractCache.clear({ lt: entries[entries.length - 1] });
      await contractCache.close();
    }

    return null;
  }
}
