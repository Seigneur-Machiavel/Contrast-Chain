import { DashboardWsApp, ObserverWsApp } from './apps.mjs';
import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';
import { extractBlocksMiningInfo, saveBlockchainInfoLocally } from '../storage/local-storage-management.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

//#region NODE INITIALIZATION -------------------------------------------
const factory = new NodeFactory();
const nodePrivateKey = "11ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00";
async function initMultiNode(local = false, useDevArgon2 = false) {
    const wallet = new contrast.Wallet(nodePrivateKey, useDevArgon2);
    const restored = await wallet.restore();
    if (!restored) { console.error('Failed to restore wallet.'); return; }
    wallet.loadAccounts();
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(2, "C");
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    wallet.saveAccounts();

    const multiNode = await factory.createNode(
        derivedAccounts[0], // validator account
        ['validator', 'miner', 'observer'], // roles
        {listenAddress: local ? '/ip4/0.0.0.0/tcp/0' : '/ip4/0.0.0.0/tcp/27260'},
        //{listenAddress: local ? '/ip4/0.0.0.0/tcp/0/ws' : '/ip4/0.0.0.0/tcp/27260/ws'},
        derivedAccounts[1].address // miner address
    );
    multiNode.useDevArgon2 = useDevArgon2; // we remove that one ?
    await multiNode.start();
    multiNode.memPool.useDevArgon2 = useDevArgon2;

    return multiNode;
}
const multiNode = await initMultiNode(false); // true === local node
console.log(`Multi node started, account : ${multiNode.account.address}`);
//#endregion ------------------------------------------------------------

// DASHBOARD APP INITIALIZATION -----------------------------------------
new DashboardWsApp(factory, 27271); // network port 27271

// OBSERVER APP INITIALIZATION ------------------------------------------
new ObserverWsApp(factory, 27270); // network port 27270

// basic informations .csv ----------------------------------------------
const startime = new Date().getTime();
//const chainPart = await multiNode.getBlocksInfo(0, multiNode.blockchain.currentHeight -1);
const chainPart = [];
for (let i = 0; i < multiNode.blockchain.currentHeight; i++) {
    const block = await multiNode.blockchain.getBlockFromDiskByHeight(i);
    chainPart.push(block);
}
const blocksInfo = extractBlocksMiningInfo(chainPart);
saveBlockchainInfoLocally(blocksInfo);
console.info(`Blockchain info saved locally, elapsed time: ${new Date().getTime() - startime}ms`);