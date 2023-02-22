import {GQLNodeInterface} from '../../../legacy/gqlResult';
import {LoggerFactory} from '../../../logging/LoggerFactory';
import {GW_TYPE, InteractionsLoader} from '../InteractionsLoader';
import {EvaluationOptions} from '../StateEvaluator';
import {genesisSortKey} from "./LexicographicalInteractionsSorter";

export class CacheableInteractionsLoader implements InteractionsLoader {
  private readonly logger = LoggerFactory.INST.create('CacheableInteractionsLoader');
  private readonly interactionsCache: Map<string, GQLNodeInterface[]> = new Map();

  constructor(private readonly delegate: InteractionsLoader) {
  }

  async load(
    contractTxId: string,
    fromSortKey?: string,
    toSortKey?: string,
    evaluationOptions?: EvaluationOptions
  ): Promise<GQLNodeInterface[]> {
    this.logger.debug(`Loading interactions for`, {
      contractTxId,
      fromSortKey,
      toSortKey
    });

    if (!this.interactionsCache.has(contractTxId)) {
      const interactions = await this.delegate.load(contractTxId, fromSortKey, toSortKey, evaluationOptions);
      if (interactions?.length) {
        this.interactionsCache.set(contractTxId, interactions);
      } else {
        this.interactionsCache.set(contractTxId, []);
      }
      return interactions;
    } else {
      const cachedInteractions = this.interactionsCache.get(contractTxId);
      const lastCachedKey = cachedInteractions?.length
        ? cachedInteractions[cachedInteractions.length - 1].sortKey
        : genesisSortKey;
      if (lastCachedKey.localeCompare(toSortKey) < 0) {
        const missingInteractions = await this.delegate.load(
          contractTxId,
          lastCachedKey,
          toSortKey,
          evaluationOptions
        );
        const allInteractions = cachedInteractions.concat(missingInteractions);
        this.interactionsCache.set(contractTxId, allInteractions);
        return allInteractions;
      }

      return cachedInteractions;
    }
  }

  type(): GW_TYPE {
    return this.delegate.type();
  }

  clearCache(): void {
    this.interactionsCache.clear();
  }
}
