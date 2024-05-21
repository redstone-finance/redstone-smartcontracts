import Arweave from 'arweave';
import { LexicographicalInteractionsSorter } from '../../core/modules/impl/LexicographicalInteractionsSorter';
import {
  ConfirmationStatus,
  WarpGatewayInteractionsLoader
} from '../../core/modules/impl/WarpGatewayInteractionsLoader';
import { GQLNodeInterface } from '../../legacy/gqlResult';
import { LoggerFactory } from '../../logging/LoggerFactory';
import { WarpFactory } from '../../core/WarpFactory';
import { NetworkCommunicationError } from '../../utils/utils';

const responseData = {
  paging: {
    total: '1',
    limit: 500,
    items: 1,
    page: 1,
    pages: 1
  },
  interactions: [
    {
      id: 'XyJm1OERe__Q-YcwTQrCeYsI14_ylASey6eYdPg-HYg',
      fee: {
        winston: '48173811033'
      },
      tags: [],
      block: {
        id: 'w8y2bxCQd3-26lvvy2NOt6Qz0kVooN9h4rwy6UIeC5mEfVnbftqcnWEavZfT14vY',
        height: 655393,
        timestamp: 1617060107
      },
      owner: {
        address: 'oZjQWwcTYbEvnwr6zkxFqpEoDTPvWkaL3zO3-SFq2g0'
      },
      parent: null,
      quantity: {
        winston: '0'
      },
      recipient: '',
      sortKey: '000000645844,0000000000000,4e49e10a3c76445b00501b704e9caab118c14ad56694a16e7e4c43c2c142e006'
    },
    {
      id: 'XyJm1OERe__Q-YcwTQrCeYsI14_ylASey6eYdPg-HYg',
      fee: {
        winston: '48173811033'
      },
      tags: [],
      block: {
        id: 'w8y2bxCQd3-26lvvy2NOt6Qz0kVooN9h4rwy6UIeC5mEfVnbftqcnWEavZfT14vY',
        height: 655393,
        timestamp: 1617060107
      },
      owner: {
        address: 'oZjQWwcTYbEvnwr6zkxFqpEoDTPvWkaL3zO3-SFq2g0'
      },
      parent: null,
      quantity: {
        winston: '0'
      },
      recipient: '',
      sortKey: '000000662481,0000000000000,82ef246cdc8be74447260bcbf44c21239f8ee7a36af51b29c3dc714bcefb0509'
    }
  ]
};

const responseDataPaging = {
  paging: {
    total: '5',
    limit: 500,
    items: 1,
    page: 1,
    pages: 5
  },
  interactions: []
};

LoggerFactory.INST.logLevel('error');

const sorter = new LexicographicalInteractionsSorter(Arweave.init({}));
const contractId = 'SJ3l7474UHh3Dw6dWVT1bzsJ-8JvOewtGoDdOecWIZo';
const fromBlockHeight = sorter.generateLastSortKey(600000);
const toBlockHeight = sorter.generateLastSortKey(655393);
const baseUrl = `http://baseUrl/gateway/v3/interactions-sort-key?contractId=SJ3l7474UHh3Dw6dWVT1bzsJ-8JvOewtGoDdOecWIZo&from=000000600000%2C9999999999999%2Czzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz&to=000000655393%2C9999999999999%2Czzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`;
const fetchMock = jest
  .spyOn(global, 'fetch')
  .mockImplementation(
    () => Promise.resolve({ json: () => Promise.resolve(responseData), ok: true, status: 200 }) as Promise<Response>
  );

describe('WarpGatewayInteractionsLoader -> load', () => {
  it('should return correct number of interactions', async () => {
    const loader = getLoader();
    const response: GQLNodeInterface[] = await loader.load(contractId, fromBlockHeight, toBlockHeight);
    expect(fetchMock).toHaveBeenCalled();
    expect(response.length).toEqual(2);
  });
  it('should be called with correct params', async () => {
    const loader = getLoader();
    await loader.load(contractId, fromBlockHeight, toBlockHeight);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&fromSdk=true`, undefined);
  });
  it('should be called accordingly to the amount of pages', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        Promise.resolve({
          json: () => Promise.resolve(responseDataPaging),
          ok: true,
          status: 200
        }) as Promise<Response>
    );
    const loader = getLoader();
    await loader.load(contractId, fromBlockHeight, toBlockHeight);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&fromSdk=true`, undefined);
    /*expect(fetchMock).toBeCalledWith(`${baseUrl}&page=2&fromSdk=true`);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&page=3&fromSdk=true`);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&page=4&fromSdk=true`);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&page=4&fromSdk=true`);
    expect(fetchMock).toHaveBeenCalledTimes(5);*/
  });
  it('should be called with confirmationStatus set to "confirmed"', async () => {
    const loader = getLoader({ confirmed: true });
    await loader.load(contractId, fromBlockHeight, toBlockHeight);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&fromSdk=true&confirmationStatus=confirmed`, undefined);
  });
  it('should be called with confirmationStatus set to "not_corrupted"', async () => {
    const loader = getLoader({ notCorrupted: true });
    await loader.load(contractId, fromBlockHeight, toBlockHeight);
    expect(fetchMock).toBeCalledWith(`${baseUrl}&fromSdk=true&confirmationStatus=not_corrupted`, undefined);
  });
  it('should throw an error in case of timeout', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => Promise.reject({ status: 504, ok: false }));
    const loader = getLoader();
    try {
      await loader.load(contractId, fromBlockHeight, toBlockHeight);
    } catch (e) {
      expect(e).toEqual(new NetworkCommunicationError('Error during network communication: {"status":504,"ok":false}'));
    }
  });
  it('should throw an error when request fails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => Promise.reject({ status: 500, ok: false, body: { message: 'request fails' } }));
    const loader = getLoader();
    try {
      await loader.load(contractId, fromBlockHeight, toBlockHeight);
    } catch (e) {
      expect(e).toEqual(
        new NetworkCommunicationError(
          'Error during network communication: {"status":500,"ok":false,"body":{"message":"request fails"}}'
        )
      );
    }
  });
});

function getLoader(source: ConfirmationStatus = null) {
  const loader = new WarpGatewayInteractionsLoader(source);
  loader.warp = WarpFactory.forLocal().useGwUrl('http://baseUrl');
  return loader;
}
