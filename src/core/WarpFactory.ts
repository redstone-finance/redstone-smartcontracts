import Arweave from 'arweave';
import { CacheableExecutorFactory, Evolve } from '@warp/plugins';
import {
  CacheableStateEvaluator,
  ConfirmationStatus,
  EvalStateResult,
  HandlerExecutorFactory,
  WARP_GW_URL,
  SourceType,
  Warp,
  WarpBuilder
} from '@warp/core';
import { LevelDbCache, MemCache } from '@warp/cache';

export type GatewayOptions = {
  confirmationStatus: ConfirmationStatus;
  source: SourceType;
  address: string;
};

export type CacheOptions = {
  maxStoredTransactions: number;
  inMemory: boolean;
  dbLocation?: string;
};

export const defaultWarpGwOptions: GatewayOptions = {
  confirmationStatus: { notCorrupted: true },
  source: null,
  address: WARP_GW_URL
};

export const defaultCacheOptions: CacheOptions = {
  maxStoredTransactions: 10,
  inMemory: false
};
/**
 * A factory that simplifies the process of creating different versions of {@link Warp}.
 * All versions use the {@link Evolve} plugin.
 */
export class WarpFactory {
  /**
   * Returns a fully configured {@link Warp} that is using arweave.net compatible gateway
   * (with a GQL endpoint) for loading the interactions and in memory cache.
   * Suitable for testing.
   */
  static forTesting(arweave: Arweave): Warp {
    return this.arweaveGw(arweave, {
      maxStoredTransactions: 20,
      inMemory: true
    });
  }

  /**
   * Returns a fully configured {@link Warp} that is using arweave.net compatible gateway
   * (with a GQL endpoint) for loading the interactions.
   */
  static arweaveGw(arweave: Arweave, cacheOptions: CacheOptions = defaultCacheOptions): Warp {
    return this.custom(arweave, cacheOptions).useArweaveGateway().build();
  }

  /**
   * Returns a fully configured {@link Warp} that is using Warp gateway for loading the interactions.
   */
  static warpGw(
    arweave: Arweave,
    gatewayOptions: GatewayOptions = defaultWarpGwOptions,
    cacheOptions: CacheOptions = defaultCacheOptions
  ): Warp {
    return this.custom(arweave, cacheOptions)
      .useWarpGateway(gatewayOptions.confirmationStatus, gatewayOptions.source, gatewayOptions.address)
      .build();
  }

  static custom(arweave: Arweave, cacheOptions: CacheOptions): WarpBuilder {
    const cache = new LevelDbCache<EvalStateResult<unknown>>(cacheOptions);

    const executorFactory = new CacheableExecutorFactory(arweave, new HandlerExecutorFactory(arweave), new MemCache());
    const stateEvaluator = new CacheableStateEvaluator(arweave, cache, [new Evolve()]);

    return Warp.builder(arweave, cache).setExecutorFactory(executorFactory).setStateEvaluator(stateEvaluator);
  }
}
