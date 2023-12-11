import { Warp, WarpEnvironment } from '../../Warp';
import { SortKeyCache } from '../../../cache/SortKeyCache';
import { ContractType } from '../../../contract/deploy/CreateContract';
import {
  ContractCache,
  ContractDefinition,
  ContractSource,
  SrcCache,
  SUPPORTED_SRC_CONTENT_TYPES
} from '../../../core/ContractDefinition';
import { SMART_WEAVE_TAGS, WARP_TAGS } from '../../KnownTags';
import { GQLTagInterface, GQLTransaction } from '../../../legacy/gqlResult';
import { Benchmark } from '../../../logging/Benchmark';
import { LoggerFactory } from '../../../logging/LoggerFactory';
import { ArweaveWrapper } from '../../../utils/ArweaveWrapper';
import { DefinitionLoader } from '../DefinitionLoader';
import { GW_TYPE } from '../InteractionsLoader';
import { ArweaveGQLTxsFetcher } from './ArweaveGQLTxsFetcher';
import { WasmSrc } from './wasm/WasmSrc';
import Arweave from 'arweave';

function getTagValue(tags: GQLTagInterface[], tagName: string, orDefault = undefined) {
  const tag = tags.find(({ name }) => name === tagName);
  return tag ? tag.value : orDefault;
}

export class ArweaveGatewayBundledContractDefinitionLoader implements DefinitionLoader {
  private arweaveWrapper: ArweaveWrapper;
  private arweaveTransactions: ArweaveGQLTxsFetcher;
  private readonly logger = LoggerFactory.INST.create(ArweaveGatewayBundledContractDefinitionLoader.name);

  constructor(private readonly env: WarpEnvironment) {}

  async load<State>(contractTxId: string, evolvedSrcTxId?: string): Promise<ContractDefinition<State>> {
    const benchmark = Benchmark.measure();
    const contractTx: GQLTransaction = await this.fetchContractTx(contractTxId);
    this.logger.debug('Contract tx fetch time', benchmark.elapsed());
    const owner = contractTx.owner.address;

    const contractSrcTxId = evolvedSrcTxId
      ? evolvedSrcTxId
      : getTagValue(contractTx.tags, SMART_WEAVE_TAGS.CONTRACT_SRC_TX_ID);

    const minFee = getTagValue(contractTx.tags, SMART_WEAVE_TAGS.MIN_FEE);
    const manifest = getTagValue(contractTx.tags, WARP_TAGS.MANIFEST)
      ? JSON.parse(getTagValue(contractTx.tags, WARP_TAGS.MANIFEST))
      : null;

    this.logger.debug('Tags decoding', benchmark.elapsed());
    const rawInitState = await this.evalInitialState(contractTx);
    this.logger.debug('init state', rawInitState);
    const initState = JSON.parse(rawInitState);

    this.logger.debug('Parsing src and init state', benchmark.elapsed());

    const { src, srcBinary, srcWasmLang, contractType, metadata, srcTx } = await this.loadContractSource(
      contractSrcTxId
    );
    const contractDefinition: ContractDefinition<State> = {
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
      contractTx: await this.convertToWarpCompatibleContractTx(contractTx),
      srcTx: await this.convertToWarpCompatibleContractTx(srcTx)
    };

    this.logger.info(`Contract definition loaded in: ${benchmark.elapsed()}`);

    return contractDefinition;
  }

  async fetchContractTx(contractTxId: string): Promise<GQLTransaction | null> {
    const txUsingId = await this.arweaveTransactions.transaction(contractTxId);
    if (txUsingId == null) {
      return await this.arweaveTransactions.transactionUsingUploaderTag(contractTxId);
    }
    return txUsingId;
  }

  private async convertToWarpCompatibleContractTx(gqlTransaction: GQLTransaction) {
    const tags = gqlTransaction.tags.map(({ name, value }) => ({
      name: Buffer.from(name).toString('base64url'),
      value: Buffer.from(value).toString('base64url')
    }));

    return {
      tags,
      owner: gqlTransaction.owner.key,
      target: gqlTransaction.recipient,
      signature: gqlTransaction.signature,
      data: (await this.arweaveWrapper.txData(gqlTransaction.id)).toString('base64url')
    };
  }

  async loadContractSource(srcTxId: string): Promise<ContractSource> {
    const benchmark = Benchmark.measure();

    const contractSrcTx = await this.fetchContractTx(srcTxId);
    const srcContentType = getTagValue(contractSrcTx.tags, SMART_WEAVE_TAGS.CONTENT_TYPE);

    if (!SUPPORTED_SRC_CONTENT_TYPES.includes(srcContentType)) {
      throw new Error(`Contract source content type ${srcContentType} not supported`);
    }

    const contractType: ContractType = srcContentType === 'application/javascript' ? 'js' : 'wasm';

    const src = await this.contractSource(contractSrcTx, contractType);

    let srcWasmLang: string | undefined;
    let wasmSrc: WasmSrc;
    let srcMetaData;
    if (contractType == 'wasm') {
      wasmSrc = new WasmSrc(src as Buffer);
      srcWasmLang = getTagValue(contractSrcTx.tags, WARP_TAGS.WASM_LANG);
      if (!srcWasmLang) {
        throw new Error(`Wasm lang not set for wasm contract src ${contractSrcTx.id}`);
      }
      srcMetaData = JSON.parse(getTagValue(contractSrcTx.tags, WARP_TAGS.WASM_META));
    }

    this.logger.debug('Contract src tx load', benchmark.elapsed());
    benchmark.reset();

    return {
      src: contractType == 'js' ? (src as string) : null,
      srcBinary: contractType == 'wasm' ? wasmSrc.wasmBinary() : null,
      srcWasmLang,
      contractType,
      metadata: srcMetaData,
      srcTx: contractSrcTx
    };
  }

  private async contractSource(contractSrcTx: GQLTransaction, contractType: ContractType): Promise<string | Buffer> {
    const uploaderId = getTagValue(contractSrcTx.tags, WARP_TAGS.UPLOADER_TX_ID);

    if (uploaderId != null) {
      const txString = await this.arweaveWrapper.txDataString(contractSrcTx.id);
      if (contractType === 'wasm') {
        throw new Error('WASM contracts in legacy format are not supported using AR GW');
      }
      return Arweave.utils.b64UrlToString(JSON.parse(txString).data);
    }

    return contractType === 'js'
      ? await this.arweaveWrapper.txDataString(contractSrcTx.id)
      : await this.arweaveWrapper.txData(contractSrcTx.id);
  }

  private async evalInitialState(contractTx: GQLTransaction): Promise<string> {
    if (getTagValue(contractTx.tags, WARP_TAGS.INIT_STATE)) {
      return getTagValue(contractTx.tags, WARP_TAGS.INIT_STATE);
    } else if (getTagValue(contractTx.tags, WARP_TAGS.INIT_STATE_TX)) {
      const stateTX = getTagValue(contractTx.tags, WARP_TAGS.INIT_STATE_TX);
      return this.arweaveWrapper.txDataString(stateTX);
    } else {
      return this.arweaveWrapper.txDataString(contractTx.id);
    }
  }

  setCache(): void {
    throw new Error('Method not implemented.');
  }
  setSrcCache(): void {
    throw new Error('Method not implemented.');
  }
  getCache(): SortKeyCache<ContractCache<unknown>> {
    throw new Error('Method not implemented.');
  }
  getSrcCache(): SortKeyCache<SrcCache> {
    throw new Error('Method not implemented.');
  }

  type(): GW_TYPE {
    return 'arweave';
  }

  set warp(warp: Warp) {
    this.arweaveWrapper = new ArweaveWrapper(warp);
    this.arweaveTransactions = new ArweaveGQLTxsFetcher(warp);
  }
}
