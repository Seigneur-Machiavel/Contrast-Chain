import { ObserverWsApp } from './apps.mjs';
import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';
//import { extractBlocksMiningInfo, saveBlockchainInfoLocally } from '../storage/local-storage-management.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

//#region NODE INITIALIZATION -------------------------------------------
const factory = new NodeFactory();
const nodePrivateKey = "0000000000000000000000000000000000000000000000000000000000000000";
async function initMultiNode(local = false, useDevArgon2 = false) {
    const wallet = new contrast.Wallet(nodePrivateKey, useDevArgon2);
    const restored = await wallet.restore();
    if (!restored) { console.error('Failed to restore wallet.'); return; }

    wallet.loadAccounts();
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(1, "C");
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    wallet.saveAccounts();

    const multiNode = await factory.createNode(
        derivedAccounts[0], // validator account
        ['validator', 'observer'], // roles
        {listenAddress: local ? '/ip4/0.0.0.0/tcp/0' : '/ip4/0.0.0.0/tcp/27260'},
    );
    multiNode.useDevArgon2 = useDevArgon2; // we remove that one ?
    await multiNode.start();
    multiNode.memPool.useDevArgon2 = useDevArgon2;

    return multiNode;
}
const multiNode = await initMultiNode(false); // true === local node
console.log(`Multi node started, account : ${multiNode.account.address}`);
//#endregion ------------------------------------------------------------

// OBSERVER APP INITIALIZATION ------------------------------------------
new ObserverWsApp(factory, 27279); // network port 27270