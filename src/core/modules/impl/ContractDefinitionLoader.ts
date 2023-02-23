import Arweave from 'arweave';
import { ContractType } from '../../../contract/deploy/CreateContract';
import { ContractDefinition, ContractSource, ContractCache, SrcCache } from '../../../core/ContractDefinition';
import { SmartWeaveTags } from '../../../core/SmartWeaveTags';
import { Benchmark } from '../../../logging/Benchmark';
import { LoggerFactory } from '../../../logging/LoggerFactory';
import { ArweaveWrapper } from '../../../utils/ArweaveWrapper';
import { DefinitionLoader } from '../DefinitionLoader';
import { GW_TYPE } from '../InteractionsLoader';
import { TagsParser } from './TagsParser';
import { WasmSrc } from './wasm/WasmSrc';
import { WarpEnvironment } from '../../Warp';
import { SortKeyCache } from '../../../cache/SortKeyCache';
import { Transaction } from '../../../utils/types/arweave-types';

const supportedSrcContentTypes = ['application/javascript', 'application/wasm'];

export class ContractDefinitionLoader implements DefinitionLoader {
  private readonly logger = LoggerFactory.INST.create('ContractDefinitionLoader');

  protected arweaveWrapper: ArweaveWrapper;
  private readonly tagsParser: TagsParser;

  constructor(private readonly arweave: Arweave, private readonly env: WarpEnvironment) {
    this.arweaveWrapper = new ArweaveWrapper(arweave);
    this.tagsParser = new TagsParser();
  }

  async load<State>(contractTxId: string, evolvedSrcTxId?: string): Promise<ContractDefinition<State>> {
    const benchmark = Benchmark.measure();
    const contract = await this.doLoad<State>(contractTxId, evolvedSrcTxId);
    this.logger.info(`Contract definition loaded in: ${benchmark.elapsed()}`);

    return contract;
  }

  async doLoad<State>(contractTxId: string, forcedSrcTxId?: string): Promise<ContractDefinition<State>> {
    const benchmark = Benchmark.measure();

    const contractTx = await this.arweaveWrapper.tx(contractTxId);
    const owner = await this.arweave.wallets.ownerToAddress(contractTx.owner);
    this.logger.debug('Contract tx and owner', benchmark.elapsed());
    benchmark.reset();

    const contractSrcTxId = forcedSrcTxId
      ? forcedSrcTxId
      : this.tagsParser.getTag(contractTx, SmartWeaveTags.CONTRACT_SRC_TX_ID);
    const testnet = this.tagsParser.getTag(contractTx, SmartWeaveTags.WARP_TESTNET) || null;
    if (testnet && this.env !== 'testnet') {
      throw new Error('Trying to use testnet contract in a non-testnet env. Use the "forTestnet" factory method.');
    }
    if (!testnet && this.env === 'testnet') {
      throw new Error('Trying to use non-testnet contract in a testnet env.');
    }
    const minFee = this.tagsParser.getTag(contractTx, SmartWeaveTags.MIN_FEE);
    let manifest = null;
    const rawManifest = this.tagsParser.getTag(contractTx, SmartWeaveTags.MANIFEST);
    if (rawManifest) {
      manifest = JSON.parse(rawManifest);
    }

    this.logger.debug('Tags decoding', benchmark.elapsed());
    benchmark.reset();
    const s = await this.evalInitialState(contractTx);
    this.logger.debug('init state', s);
    const initState = JSON.parse(await this.evalInitialState(contractTx));
    this.logger.debug('Parsing src and init state', benchmark.elapsed());

    const { src, srcBinary, srcWasmLang, contractType, metadata, srcTx } = await this.loadContractSource(
      contractSrcTxId
    );

    return {
      txId: contractTxId,
      srcTxId: contractSrcTxId,
      src,
      srcBinary,
      srcWasmLang,
      initState,
      minFee,
      owner,
      contractType,
      metadata,
      manifest,
      contractTx: contractTx.toJSON(),
      srcTx,
      testnet
    };
  }

  async loadContractSource(contractSrcTxId: string): Promise<ContractSource> {
    const benchmark = Benchmark.measure();

    const contractSrcTx = await this.arweaveWrapper.tx(contractSrcTxId);
    const srcContentType = this.tagsParser.getTag(contractSrcTx, SmartWeaveTags.CONTENT_TYPE);
    if (!supportedSrcContentTypes.includes(srcContentType)) {
      throw new Error(`Contract source content type ${srcContentType} not supported`);
    }
    const contractType: ContractType = srcContentType == 'application/javascript' ? 'js' : 'wasm';

    const src =
      contractType == 'js'
        ? await this.arweaveWrapper.txDataString(contractSrcTxId)
        : await this.arweaveWrapper.txData(contractSrcTxId);

    let srcWasmLang;
    let wasmSrc: WasmSrc;
    let srcMetaData;
    if (contractType == 'wasm') {
      wasmSrc = new WasmSrc(src as Buffer);
      srcWasmLang = this.tagsParser.getTag(contractSrcTx, SmartWeaveTags.WASM_LANG);
      if (!srcWasmLang) {
        throw new Error(`Wasm lang not set for wasm contract src ${contractSrcTxId}`);
      }
      srcMetaData = JSON.parse(this.tagsParser.getTag(contractSrcTx, SmartWeaveTags.WASM_META));
    }

    this.logger.debug('Contract src tx load', benchmark.elapsed());
    benchmark.reset();

    return {
      src: contractType == 'js' ? (src as string) : null,
      srcBinary: contractType == 'wasm' ? wasmSrc.wasmBinary() : null,
      srcWasmLang,
      contractType,
      metadata: srcMetaData,
      srcTx: contractSrcTx.toJSON()
    };
  }

  private async evalInitialState(contractTx: Transaction): Promise<string> {
    if (this.tagsParser.getTag(contractTx, SmartWeaveTags.INIT_STATE)) {
      return this.tagsParser.getTag(contractTx, SmartWeaveTags.INIT_STATE);
    } else if (this.tagsParser.getTag(contractTx, SmartWeaveTags.INIT_STATE_TX)) {
      const stateTX = this.tagsParser.getTag(contractTx, SmartWeaveTags.INIT_STATE_TX);
      return this.arweaveWrapper.txDataString(stateTX);
    } else {
      return this.arweaveWrapper.txDataString(contractTx.id);
    }
  }

  type(): GW_TYPE {
    return 'arweave';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setCache(cache: SortKeyCache<ContractDefinition<unknown>>): void {
    throw new Error('No cache implemented for this loader');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setSrcCache(cache: SortKeyCache<SrcCache>): void {
    throw new Error('No cache implemented for this loader');
  }

  getCache(): SortKeyCache<ContractCache<unknown>> {
    throw new Error('No cache implemented for this loader');
  }

  getSrcCache(): SortKeyCache<SrcCache> {
    throw new Error('No cache implemented for this loader');
  }
}
