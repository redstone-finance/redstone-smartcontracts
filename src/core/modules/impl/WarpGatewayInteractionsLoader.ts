import {
  Benchmark,
  EvaluationOptions,
  GQLNodeInterface,
  InteractionsLoader,
  LoggerFactory,
  stripTrailingSlash
} from '@warp';
import 'redstone-isomorphic';
import { GW_TYPE } from '../InteractionsLoader';

export type ConfirmationStatus =
  | {
      notCorrupted?: boolean;
      confirmed?: null;
    }
  | {
      notCorrupted?: null;
      confirmed?: boolean;
    };

export const enum SourceType {
  ARWEAVE = 'arweave',
  WARP_SEQUENCER = 'redstone-sequencer'
}

/**
 * The aim of this implementation of the {@link InteractionsLoader} is to make use of
 * Warp Gateway ({@link https://github.com/redstone-finance/redstone-sw-gateway})
 * endpoint and retrieve contracts' interactions.
 *
 * Optionally - it is possible to pass:
 * 1. {@link ConfirmationStatus.confirmed} flag - to receive only confirmed interactions - ie. interactions with
 * enough confirmations, whose existence is confirmed by at least 3 Arweave peers.
 * 2. {@link ConfirmationStatus.notCorrupted} flag - to receive both already confirmed and not yet confirmed (ie. latest)
 * interactions.
 * 3. {@link SourceType} - to receive interactions based on their origin ({@link SourceType.ARWEAVE} or {@link SourceType.REDSTONE_SEQUENCER}).
 * If not set, interactions from all sources will be loaded.
 *
 * Passing no flag is the "backwards compatible" mode (ie. it will behave like the original Arweave GQL gateway endpoint).
 * Note that this may result in returning corrupted and/or forked interactions
 * - read more {@link https://github.com/warp-contracts/redstone-sw-gateway#corrupted-transactions}.
 */
export class WarpGatewayInteractionsLoader implements InteractionsLoader {
  constructor(
    private readonly baseUrl: string,
    private readonly confirmationStatus: ConfirmationStatus = null,
    private readonly source: SourceType = null
  ) {
    this.baseUrl = stripTrailingSlash(baseUrl);
    Object.assign(this, confirmationStatus);
    this.source = source;
  }

  private readonly logger = LoggerFactory.INST.create('WarpGatewayInteractionsLoader');

  async load(
    contractId: string,
    fromSortKey?: string,
    toSortKey?: string,
    evaluationOptions?: EvaluationOptions
  ): Promise<GQLNodeInterface[]> {
    this.logger.debug('Loading interactions: for ', { contractId, fromSortKey, toSortKey });

    const interactions: GQLNodeInterface[] = [];
    let page = 0;
    let totalPages = 0;

    const benchmarkTotalTime = Benchmark.measure();
    do {
      const benchmarkRequestTime = Benchmark.measure();

      const url = `${this.baseUrl}/gateway/interactions-sort-key`;

      const response = await fetch(
        `${url}?${new URLSearchParams({
          contractId: contractId,
          ...(fromSortKey ? { from: fromSortKey } : ''),
          ...(toSortKey ? { to: toSortKey } : ''),
          page: (++page).toString(),
          minimize: 'true',
          ...(this.confirmationStatus && this.confirmationStatus.confirmed ? { confirmationStatus: 'confirmed' } : ''),
          ...(this.confirmationStatus && this.confirmationStatus.notCorrupted
            ? { confirmationStatus: 'not_corrupted' }
            : ''),
          ...(this.source ? { source: this.source } : '')
        })}`
      )
        .then((res) => {
          return res.ok ? res.json() : Promise.reject(res);
        })
        .catch((error) => {
          if (error.body?.message) {
            this.logger.error(error.body.message);
          }
          throw new Error(`Unable to retrieve transactions. Warp gateway responded with status ${error.status}.`);
        });
      totalPages = response.paging.pages;

      this.logger.debug(
        `Loading interactions: page ${page} of ${totalPages} loaded in ${benchmarkRequestTime.elapsed()}`
      );

      response.interactions.forEach((interaction) => {
        interactions.push({
          ...interaction.interaction,
          confirmationStatus: interaction.status
        });
      });

      this.logger.debug(`Loaded interactions length: ${interactions.length}, from: ${fromSortKey}, to: ${toSortKey}`);
    } while (page < totalPages);

    this.logger.debug('All loaded interactions:', {
      from: fromSortKey,
      to: toSortKey,
      loaded: interactions.length,
      time: benchmarkTotalTime.elapsed()
    });

    return interactions;
  }

  type(): GW_TYPE {
    return 'warp';
  }
}
