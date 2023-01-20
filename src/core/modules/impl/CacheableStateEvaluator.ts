import Arweave from 'arweave';
import { SortKeyCache, SortKeyCacheResult, CacheKey } from '../../../cache/SortKeyCache';
import { CurrentTx } from '../../../contract/Contract';
import { ExecutionContext } from '../../../core/ExecutionContext';
import { ExecutionContextModifier } from '../../../core/ExecutionContextModifier';
import { GQLNodeInterface } from '../../../legacy/gqlResult';
import { LoggerFactory } from '../../../logging/LoggerFactory';
import { indent } from '../../../utils/utils';
import { EvalStateResult, SerializationFormat } from '../StateEvaluator';
import { DefaultStateEvaluator } from './DefaultStateEvaluator';
import { HandlerApi } from './HandlerExecutorFactory';
import { genesisSortKey } from './LexicographicalInteractionsSorter';

/**
 * An implementation of DefaultStateEvaluator that adds caching capabilities.
 *
 * The main responsibility of this class is to compute whether there are
 * any interaction transactions, for which the state hasn't been evaluated yet -
 * if so - it generates a list of such transactions and evaluates the state
 * for them - taking as an input state the last cached state.
 */
export class CacheableStateEvaluator extends DefaultStateEvaluator {
  private readonly cLogger = LoggerFactory.INST.create('CacheableStateEvaluator');

  constructor(
    arweave: Arweave,
    private cache: SortKeyCache<EvalStateResult<unknown>>,
    executionContextModifiers: ExecutionContextModifier[] = []
  ) {
    super(arweave, executionContextModifiers);
  }

  async eval<State>(
    executionContext: ExecutionContext<State, HandlerApi<State>>,
    currentTx: CurrentTx[]
  ): Promise<SortKeyCacheResult<EvalStateResult<State>>> {
    const cachedState = executionContext.cachedState;
    const { wasmSerializationFormat: serializationFormat } = executionContext.evaluationOptions;
    if (cachedState && cachedState.sortKey == executionContext.requestedSortKey) {
      this.cLogger.info(
        `Exact cache hit for sortKey ${executionContext?.contractDefinition?.txId}:${cachedState.sortKey}`
      );
      executionContext.handler?.initState(cachedState.cachedValue.state, serializationFormat);
      return cachedState;
    }

    const missingInteractions = executionContext.sortedInteractions;

    // TODO: this is tricky part, needs proper description
    // for now: it prevents from infinite loop calls between calls that are making
    // internal interact writes.
    const contractTxId = executionContext.contractDefinition.txId;
    // sanity check...
    if (!contractTxId) {
      throw new Error('Contract tx id not set in the execution context');
    }
    for (const entry of currentTx || []) {
      if (entry.contractTxId === executionContext.contractDefinition.txId) {
        const index = missingInteractions.findIndex((tx) => tx.id === entry.interactionTxId);
        if (index !== -1) {
          this.cLogger.debug('Inf. Loop fix - removing interaction', {
            height: missingInteractions[index].block.height,
            contractTxId: entry.contractTxId,
            interactionTxId: entry.interactionTxId,
            sortKey: missingInteractions[index].sortKey
          });
          missingInteractions.splice(index);
        }
      }
    }

    if (missingInteractions.length == 0) {
      this.cLogger.info(`No missing interactions ${contractTxId}`);
      if (cachedState) {
        executionContext.handler?.initState(cachedState.cachedValue.state, serializationFormat);
        return cachedState;
      } else {
        executionContext.handler?.initState(executionContext.contractDefinition.initState, serializationFormat);
        this.cLogger.debug('Inserting initial state into cache');
        const stateToCache = new EvalStateResult(executionContext.contractDefinition.initState, {}, {});
        // no real sort-key - as we're returning the initial state
        await this.cache.put(new CacheKey(contractTxId, genesisSortKey), stateToCache);

        return new SortKeyCacheResult<EvalStateResult<State>>(genesisSortKey, stateToCache);
      }
    }

    const baseState =
      cachedState == null ? executionContext.contractDefinition.initState : cachedState.cachedValue.state;

    const baseValidity = cachedState == null ? {} : cachedState.cachedValue.validity;
    const baseErrorMessages = cachedState == null ? {} : cachedState.cachedValue.errorMessages;

    // eval state for the missing transactions - starting from the latest value from cache.
    return await this.doReadState(
      missingInteractions,
      new EvalStateResult(baseState, baseValidity, baseErrorMessages || {}),
      executionContext,
      currentTx
    );
  }

  async onStateEvaluated<State>(
    transaction: GQLNodeInterface,
    executionContext: ExecutionContext<State>,
    state: EvalStateResult<State>
  ): Promise<void> {
    const contractTxId = executionContext.contractDefinition.txId;
    this.cLogger.debug(
      `${indent(executionContext.contract.callDepth())}onStateEvaluated: cache update for contract ${contractTxId} [${
        transaction.sortKey
      }]`
    );

    await this.putInCache(contractTxId, transaction, state);
  }

  async onStateUpdate<State>(
    transaction: GQLNodeInterface,
    executionContext: ExecutionContext<State>,
    state: EvalStateResult<State>,
    force = false
  ): Promise<void> {
    if (executionContext.evaluationOptions.updateCacheForEachInteraction || force) {
      this.cLogger.debug(
        `onStateUpdate: cache update for contract ${executionContext.contractDefinition.txId} [${transaction.sortKey}]`,
        {
          contract: executionContext.contractDefinition.txId,
          state: state.state,
          sortKey: transaction.sortKey
        }
      );
      await this.putInCache(executionContext.contractDefinition.txId, transaction, state);
    }
  }

  async latestAvailableState<State>(
    contractTxId: string,
    sortKey?: string
  ): Promise<SortKeyCacheResult<EvalStateResult<State>> | null> {
    this.cLogger.debug('Searching for', { contractTxId, sortKey });
    if (sortKey) {
      const stateCache = (await this.cache.getLessOrEqual(contractTxId, sortKey)) as SortKeyCacheResult<
        EvalStateResult<State>
      >;
      if (stateCache) {
        this.cLogger.debug(`Latest available state at ${contractTxId}: ${stateCache.sortKey}`);
      }
      return stateCache;
    } else {
      return (await this.cache.getLast(contractTxId)) as SortKeyCacheResult<EvalStateResult<State>>;
    }
  }

  async onInternalWriteStateUpdate<State>(
    transaction: GQLNodeInterface,
    contractTxId: string,
    state: EvalStateResult<State>
  ): Promise<void> {
    this.cLogger.debug('Internal write state update:', {
      sortKey: transaction.sortKey,
      dry: transaction.dry,
      contractTxId,
      state: state.state
    });
    await this.putInCache(contractTxId, transaction, state);
  }

  async onContractCall<State>(
    transaction: GQLNodeInterface,
    executionContext: ExecutionContext<State>,
    state: EvalStateResult<State>
  ): Promise<void> {
    if (executionContext.sortedInteractions?.length == 0) {
      return;
    }
    const txIndex = executionContext.sortedInteractions.indexOf(transaction);
    if (txIndex < 1) {
      return;
    }
    await this.putInCache(
      executionContext.contractDefinition.txId,
      executionContext.sortedInteractions[txIndex - 1],
      state
    );
  }

  public async putInCache<State>(
    contractTxId: string,
    transaction: GQLNodeInterface,
    state: EvalStateResult<State>
  ): Promise<void> {
    if (transaction.dry) {
      return;
    }
    if (transaction.confirmationStatus !== undefined && transaction.confirmationStatus !== 'confirmed') {
      return;
    }
    const stateToCache = new EvalStateResult(state.state, state.validity, state.errorMessages || {});

    this.cLogger.debug('Putting into cache', {
      contractTxId,
      transaction: transaction.id,
      sortKey: transaction.sortKey,
      dry: transaction.dry
    });

    await this.cache.put(new CacheKey(contractTxId, transaction.sortKey), stateToCache);
  }

  async syncState(contractTxId: string, sortKey: string, state: any, validity: any): Promise<void> {
    const stateToCache = new EvalStateResult(state, validity, {});
    await this.cache.put(new CacheKey(contractTxId, sortKey), stateToCache);
  }

  async dumpCache(): Promise<any> {
    return await this.cache.dump();
  }

  async internalWriteState<State>(
    contractTxId: string,
    sortKey: string
  ): Promise<SortKeyCacheResult<EvalStateResult<State>> | null> {
    return (await this.cache.get(contractTxId, sortKey)) as SortKeyCacheResult<EvalStateResult<State>>;
  }

  async hasContractCached(contractTxId: string): Promise<boolean> {
    return (await this.cache.getLast(contractTxId)) != null;
  }

  async lastCachedSortKey(): Promise<string | null> {
    return await this.cache.getLastSortKey();
  }

  async allCachedContracts(): Promise<string[]> {
    return await this.cache.allContracts();
  }

  setCache(cache: SortKeyCache<EvalStateResult<unknown>>): void {
    this.cache = cache;
  }

  getCache(): SortKeyCache<EvalStateResult<unknown>> {
    return this.cache;
  }
}
