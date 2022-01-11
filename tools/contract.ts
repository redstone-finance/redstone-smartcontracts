/* eslint-disable */
import Arweave from 'arweave';
import {
  BenchmarkStats,
  LoggerFactory, MemCache, RedstoneGatewayContractDefinitionLoader,
  RedstoneGatewayInteractionsLoader,
  SmartWeaveWebFactory
} from '../src';

import {max, mean, median, min, standardDeviation, variance} from "simple-statistics";
import * as path from "path";
import * as fs from "fs";

const stringify = require('safe-stable-stringify')


const logger = LoggerFactory.INST.create('Contract');

let os = require("os");

//LoggerFactory.use(new TsLogFactory());
LoggerFactory.INST.logLevel("fatal");
LoggerFactory.INST.logLevel("info", "ArweaveGatewayInteractionsLoader");
LoggerFactory.INST.logLevel("debug", "ArweaveWrapper");
LoggerFactory.INST.logLevel("info", "Contract");


//LoggerFactory.INST.logLevel("info", "HandlerBasedContract");

/*LoggerFactory.INST.logLevel("debug", "ArweaveGatewayInteractionsLoader");
LoggerFactory.INST.logLevel("debug", "HandlerBasedContract");
LoggerFactory.INST.logLevel("debug", "ContractDefinitionLoader");
LoggerFactory.INST.logLevel("debug", "CacheableContractInteractionsLoader");*/

const colors = require('colors');
async function main() {
  const arweave = Arweave.init({
    host: 'arweave.net', // Hostname or IP address for a Arweave host
    port: 443, // Port
    protocol: 'https', // Network protocol http or https
    timeout: 60000, // Network request timeouts in milliseconds
    logging: false // Enable network request logging
  });

  const contractTxId = 'Daj-MNSnH55TDfxqC7v4eq0lKzVIwh98srUaWqyuZtY'; //844916
  //const contractTxId = 't9T7DIOGxx4VWXoCEeYYarFYeERTpWIC1V3y-BPZgKE'; //749180

  //const interactionsLoader = new FromFileInteractionsLoader(path.join(__dirname, 'data', 'interactions.json'));

  // const smartweave = SmartWeaveWebFactory.memCachedBased(arweave).setInteractionsLoader(interactionsLoader).build();


  /* const usedBefore = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100
   const contractR = smartweaveR.contract(contractTxId);
   const {state, validity} = await contractR.readState();
   const usedAfter = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100
   logger.warn("Heap used in MB", {
     usedBefore,
     usedAfter
   });*/

  const stats = require('simple-statistics')

  const results: BenchmarkStats[] = [];

  for (let i = 1; i <= 1; i++) {

    const smartweaveR = SmartWeaveWebFactory
      .memCachedBased(arweave, 1)
      .build();

    const contract = smartweaveR.contract("Ar1RAJDSAJdAGCI22nkAveDbtgtcMx1bNXopk2pfENs");
    const readResult = await contract.readState();

    const result = contract.lastReadStateStats();

    results.push(result);
    fs.writeFileSync(path.join(__dirname, 'data', 'state.json'), stringify(readResult.state).trim());

    console.log("total evaluation: " + result.total + "ms")
  }

  console.log(results);

  //const result2 = await readContract(arweave, "t9T7DIOGxx4VWXoCEeYYarFYeERTpWIC1V3y-BPZgKE")


  //fs.writeFileSync(path.join(__dirname, 'data', 'validity.json'), JSON.stringify(validity));

  //fs.writeFileSync(path.join(__dirname, 'data', 'validity_old.json'), JSON.stringify(result.validity));

  //fs.writeFileSync(path.join(__dirname, 'data', 'state_old.json'), stringify(result2).trim());
  //fs.writeFileSync(path.join(__dirname, 'data', 'state_arweave.json'), JSON.stringify(result.state));

  // console.log('second read');
  // await lootContract.readState();
}

main().catch((e) => console.error(e));
