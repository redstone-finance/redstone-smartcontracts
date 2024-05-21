import { WarpPlugin, WarpPluginType } from '../src/core/WarpPlugin';
import { FetchRequest } from '../src/core/WarpFetchWrapper';
import { JWKInterface } from 'arweave/node/lib/wallet';
import fs from 'fs';
import path from 'path';
import { LoggerFactory } from '../src/logging/LoggerFactory';
import { defaultCacheOptions, WarpFactory } from '../src/core/WarpFactory';
import { DeployPlugin } from 'warp-contracts-plugin-deploy';
import { ArweaveSigner } from 'warp-arbundles';

class FetchOptionsPlugin implements WarpPlugin<FetchRequest, RequestInit> {
  process(request: FetchRequest): Partial<RequestInit> {
    const url = request.input;

    let fetchOptions: Partial<RequestInit> = {};

    if (url == `https://d1o5nlqr4okus2.cloudfront.net/gateway/sequencer/register`) {
      fetchOptions = {
        keepalive: true
      };
    }

    if (
      url ==
      'https://gw.warp.cc/gateway/v3/interactions-sort-key?contractId=nf5TUVkzyZBGtl0NmVXZvheC3EN5d4XA-5ewpGgaYRo&fromSdk=true&confirmationStatus=not_corrupted'
    ) {
      fetchOptions = {
        headers: {
          'x-api-key': 'test'
        }
      };
    }

    return fetchOptions;
  }

  type(): WarpPluginType {
    return 'fetch-options';
  }
}

async function main() {
  const wallet: JWKInterface = readJSON('./.secrets/jwk.json');
  LoggerFactory.INST.logLevel('debug');
  const logger = LoggerFactory.INST.create('FetchOptionsPlugin');

  try {
    const warp = WarpFactory.forMainnet({ ...defaultCacheOptions, inMemory: true })
      .use(new DeployPlugin())
      .use(new FetchOptionsPlugin());

    const jsContractSrc = fs.readFileSync(path.join(__dirname, 'data/js/token-pst.js'), 'utf8');
    const initialState = fs.readFileSync(path.join(__dirname, 'data/js/token-pst.json'), 'utf8');

    const { contractTxId } = await warp.deploy({
      wallet: new ArweaveSigner(wallet),
      initState: initialState,
      src: jsContractSrc
    });

    const contract = warp.contract(contractTxId).connect(new ArweaveSigner(wallet));

    await contract.writeInteraction({
      function: 'transfer',
      target: 'uhE-QeYS8i4pmUtnxQyHD7dzXFNaJ9oMK-IM-QPNY6M',
      qty: 55555
    });

    const { cachedValue } = await contract.readState();
    logger.info(`Cached value: ${cachedValue}`);
  } catch (e) {
    logger.error(e);
  }
}

export function readJSON(path: string): JWKInterface {
  const content = fs.readFileSync(path, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`File "${path}" does not contain a valid JSON`);
  }
}

// eslint-disable-next-line no-console
main().catch((e) => console.error(e));
