import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';
import { DashboardWsApp, ObserverWsApp } from '../run/apps.mjs';

/**
* @typedef {import("../src/wallet.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

let txsTaskDoneThisBlock = {};
const network = 'mainnet'; // 'local' | 'testnet' | 'mainnet'
const port = 27260; //? 27260
const testParams = {
    privKey: "27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff27ff",
    unsafeSpamMode: false,
    initListenAddress: network === 'local' ? '/ip4/0.0.0.0/tcp/0' : `/ip4/0.0.0.0/tcp/${port}`,
    useDevArgon2: false, // true => 100txs processProposal: ~7sec | false => 100txs processProposal: ~5.8sec
    nbOfAccounts: 25, // minimum 25
    addressType: 'W',

    nbOfMiners: 0,
    nbOfValidators: 0,
    nbOfMultiNodes: 1,
    dashboardStartPort: 27271, // 27271 || false if not used
    observerPort: 27270, // 27270 || false if not used

    txsSeqs: {
        userSendToAllOthers: { active: true, start: 10, end: 100000, interval: 3 },
        stakeVss: { active: true, start: 100, end: 120, interval: 1 },
        simpleUserToUser: { active: false, start: 2, end: 100000, interval: 2 },
        userSendToNextUser: { active: true, start: 20, end: 100000, interval: 2 }
    },
}
const args = process.argv.slice(2);
if (args.includes('-pk')) {
    const privKey = args[args.indexOf('-pk') + 1];
    testParams.privKey = privKey;
}
if (args.includes('-at')) {
    const addressType = args[args.indexOf('-at') + 1];
    testParams.addressType = addressType;
}
if (args.includes('-nba')) {
    const nbOfAccounts = args[args.indexOf('-nba') + 1];
    testParams.nbOfAccounts = parseInt(nbOfAccounts);
}
/** Simple user to user transaction
 * @param {Node} node
 * @param {Account[]} accounts
 * @param {number} senderAccountIndex
 * @param {number} receiverAccountIndex
 */
async function userSendToUser(node, accounts, senderAccountIndex = 0, receiverAccountIndex = 2) {
    const senderAccount = accounts[senderAccountIndex];
    const receiverAddress = accounts[receiverAccountIndex].address;

    const amountToSend = 2_222;
    const { signedTx, error } = await contrast.Transaction_Builder.createAndSignTransfer(senderAccount, amountToSend, receiverAddress);
    if (signedTx) {
        //console.log(`SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAddress} | txID: ${signedTx.id}`);
        await node.pushTransaction(signedTx);
    } else {
        console.log(error);
    }
    txsTaskDoneThisBlock['userSendToUser'] = true;
}
/** All users send to the next user
* @param {Node} node
* @param {Account[]} accounts
* @param {number} nbOfUsers
 */
async function userSendToNextUser(node, accounts) {
    let startTime = Date.now();
    const pauseEach = 50; // txs

    const transferPromises = [];
    for (let i = 0; i < accounts.length; i++) {
        if (i % pauseEach === 0) { await new Promise(resolve => setTimeout(resolve, 40)); }
        const senderAccount = accounts[i];
        const receiverAccount = i === accounts.length - 1 ? accounts[0] : accounts[i + 1];

        const amountToSend = Math.floor(Math.random() * (1_000) + 1000);
        transferPromises.push(contrast.Transaction_Builder.createAndSignTransfer(senderAccount, amountToSend, receiverAccount.address));
    }
    
    const pushPromises = [];
    for (const promise of transferPromises) {
        const { signedTx, error } = await promise;
        if (error) { continue; }
        pushPromises.push(node.pushTransaction(signedTx));
    }

    const timeToCreateAndSignAllTxs = Date.now() - startTime;
    startTime = Date.now();

    await Promise.all(pushPromises);
    const timeToPushAllTxsToMempool = Date.now() - startTime;

    txsTaskDoneThisBlock['userSendToNextUser'] = true;
    console.info(`[TEST-USTNU] NbTxs: ${pushPromises.length} | timeToCreate: ${(timeToCreateAndSignAllTxs / 1000).toFixed(2)}s | timeToBroadcast: ${(timeToPushAllTxsToMempool / 1000).toFixed(2)}s`);
}
/** User send to all other accounts
* @param {Node} node
* @param {Account[]} accounts
* @param {number} senderAccountIndex
 */
async function userSendToAllOthers(node, accounts, senderAccountIndex = 0) {
    //const startTime = Date.now();
    const senderAccount = accounts[senderAccountIndex];
    const transfers = [];
    for (let i = 0; i < accounts.length; i++) {
        if (i === senderAccountIndex) { continue; }
        // from 5_000 to 10_000
        const amount = Math.floor(Math.random() * 5_000 + 5_000);
        const transfer = { recipientAddress: accounts[i].address, amount };
        transfers.push(transfer);
    }
    try {
        const transaction = await contrast.Transaction_Builder.createTransfer(senderAccount, transfers);
        const signedTx = await senderAccount.signTransaction(transaction);

        if (signedTx) {
            //console.log(`[TEST] SEND: ${senderAccount.address} -> rnd() -> ${transfers.length} users`);
            //console.log(`[TEST] Submit transaction: ${signedTx.id} to mempool.`);
            await node.pushTransaction(signedTx);
        } else {
            console.log(error);
        }
    } catch (error) {
        console.log(`[TEST-USTAO] Can't send to all others: ${error.message}`);
    }
    txsTaskDoneThisBlock['userSendToAllOthers'] = true;
    //console.log(`[TEST-USTAO] NbTxs: ${transfers.length} | Time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
}
/** User stakes in VSS
 * @param {Node} node
 * @param {Account[]} accounts
 * @param {number} senderAccountIndex
 * @param {number} amountToStake
 */
async function userStakeInVSS(node, accounts, senderAccountIndex = 0, amountToStake = 120_000) {
    const senderAccount = accounts[senderAccountIndex];
    const stakingAddress = senderAccount.address;

    try {
        const transaction = await contrast.Transaction_Builder.createStakingVss(senderAccount, stakingAddress, amountToStake);
        const signedTx = await senderAccount.signTransaction(transaction);
        if (signedTx) {
            //console.log(`[TEST] STAKE: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToStake)}`);
            //console.log(`[TEST] Pushing transaction: ${signedTx.id} to mempool.`);
            await node.pushTransaction(signedTx);
        } else {
            console.log(error);
        }
    } catch (error) {
        
    }
    txsTaskDoneThisBlock['userStakeInVSS'] = true;
}
/**
 * @param {Node} node
 * @param {Account[]} accounts
 */
async function refreshAllBalances(node, accounts) {
    for (let i = 0; i < accounts.length; i++) {
        const { spendableBalance, balance, UTXOs } = await node.getAddressUtxos(accounts[i].address);
        const spendableUtxos = [];
        for (const utxo of UTXOs) {
            if (node.memPool.transactionByAnchor[utxo.anchor] !== undefined) { continue; }
            spendableUtxos.push(utxo);
        }
        accounts[i].setBalanceAndUTXOs(balance, spendableUtxos);
    }
}

/**
 * @param {NodeFactory} factory
 * @param {Account} account
 */
async function initMinerNode(factory, account, listenAddress) {
    const minerNode = await factory.createNode(account, 'miner', { listenAddress });
    await minerNode.start();
    minerNode.miner.useDevArgon2 = testParams.useDevArgon2;
    minerNode.memPool.useDevArgon2 = testParams.useDevArgon2;

    return minerNode;
}
/**
 * @param {NodeFactory} factory
 * @param {Account} account
 */
async function initValidatorNode(factory, account, listenAddress) {
    const validatorNode = await factory.createNode(account, ['validator', 'observer'], { listenAddress });
    await validatorNode.start();
    validatorNode.useDevArgon2 = testParams.useDevArgon2;
    validatorNode.memPool.useDevArgon2 = testParams.useDevArgon2;

    return validatorNode;
}
/**
 * @param {NodeFactory} factory
 * @param {Account} account
 */
async function initMultiNode(factory, account, listenAddress, minerAddress) {
    const multiNode = await factory.createNode(account, ['validator', 'miner', 'observer'], { listenAddress }, minerAddress);

    await multiNode.start();
    multiNode.useDevArgon2 = testParams.useDevArgon2;
    multiNode.memPool.useDevArgon2 = testParams.useDevArgon2;

    return multiNode;
}
/** @param {Account[]} accounts */
async function nodeSpecificTest(accounts) {
    if (!contrast.utils.isNode) { return; }

    let minerNodeId;
    let validatorNodeId;

    //const initListenAddress = testParams.network === 'local' ? '/ip4/0.0.0.0/tcp/0' : '/ip4/0.0.0.0/tcp/27260';
    // only one node can be network listener
    const listenAddress = () => nodesPromises.length === 0 ? testParams.initListenAddress : '/ip4/0.0.0.0/tcp/0'

    // WS
    //const initListenAddress = testParams.network === 'local' ? '/ip4/0.0.0.0/tcp/0/ws' : '/ip4/0.0.0.0/tcp/27260/ws';
    // only one node can be network listener
    //const listenAddress = () => nodesPromises.length === 0 ? initListenAddress : '/ip4/0.0.0.0/tcp/0/ws'

    //#region init nodes
    const factory = new NodeFactory(port);
    const nodesPromises = [];
    for (let i = 0; i < testParams.nbOfMiners; i++) {
        nodesPromises.push(initMinerNode(factory, accounts[i], listenAddress()));
    }
    for (let i = testParams.nbOfMiners; i < testParams.nbOfValidators + testParams.nbOfMiners; i++) {
        nodesPromises.push(initValidatorNode(factory, accounts[i], listenAddress()));
    }
    for (let i = testParams.nbOfMiners + testParams.nbOfValidators; i < testParams.nbOfMultiNodes + testParams.nbOfMiners + testParams.nbOfValidators; i++) {
        const minerAddress = accounts[i+1].address;
        nodesPromises.push(initMultiNode(factory, accounts[i], listenAddress(), minerAddress));
    }

    const nodes = await Promise.all(nodesPromises);

    // use second validator as observer to avoid intensive task one the first validator
    const observerIndex = (testParams.nbOfMultiNodes + testParams.nbOfValidators) > 1 ? 1 : 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.roles.includes('miner')) { if (!minerNodeId) { minerNodeId = node.id; } }
        if (node.roles.includes('validator')) { if (!validatorNodeId) { validatorNodeId = node.id; } }
        if (!node.roles.includes('validator')) { continue; }

        if (testParams.observerPort && i === observerIndex) { new ObserverWsApp(factory, testParams.observerPort); }
        if (testParams.dashboardStartPort) { new DashboardWsApp(factory, testParams.dashboardStartPort + i); }
    }

    console.log('[TEST] Nodes Initialized.');
    //#endregion

    /* TEST OF HEAVY MESSAGES NETWORKING OVER P2P
    let msgWeight = 1_000;
    while(true) {
        const aBigObject = {}
        //const heavyMessageUint8 = new Uint8Array(msgWeight);
        for (let i = 0; i < msgWeight; i++) {
            aBigObject[i] = Math.floor(Math.random() * 256);
            //heavyMessageUint8[i] = Math.floor(Math.random() * 256);
        }
        const msgPackStartTimestamp = Date.now();
        const heavyMessageUint8 = contrast.utils.compression.msgpack_Zlib.rawData.toBinary_v1(aBigObject);
        console.log(`[TEST] heavy msg bytes: ${heavyMessageUint8.length} - compressed in: ${Date.now() - msgPackStartTimestamp}ms`);
        await minerNode.p2pNetwork.broadcast('test', heavyMessageUint8);
        msgWeight += 10;
        await new Promise(resolve => setTimeout(resolve, 100));
    }*/

    // Loop and spent different transactions
    const lastBlockIndexAndTime = { index: 0, time: Date.now() };
    for (let i = 0; i < 1_000_000; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const minerNode = factory.getNode(minerNodeId);
        const validatorNode = factory.getNode(validatorNodeId);
        const currentHeight = validatorNode.blockchain.currentHeight;
        if (validatorNode.syncHandler.isSyncing) { continue; }

        if (currentHeight > lastBlockIndexAndTime.index) { // new block only
            lastBlockIndexAndTime.index = currentHeight;
            // delete txsTaskDoneThisBlock if the operation is done(value=true)
            for (let key in txsTaskDoneThisBlock) {
                if (txsTaskDoneThisBlock.hasOwnProperty(key) && testParams.unsafeSpamMode) { delete txsTaskDoneThisBlock[key]; break; } // Will spam event if intensive computation
                if (txsTaskDoneThisBlock.hasOwnProperty(key) && txsTaskDoneThisBlock[key] === true) { delete txsTaskDoneThisBlock[key]; }
            }

            /*const timeDiff = Date.now() - lastBlockIndexAndTime.time;
            console.log(`[TEST] New block: ${node.blockCandidate.index} | Time: ${timeDiff}ms`);
            lastBlockIndexAndTime.time = Date.now();*/
        }

        await refreshAllBalances(validatorNode, accounts);

        // user send to all others
        if (testParams.txsSeqs.userSendToAllOthers.active && currentHeight >= testParams.txsSeqs.userSendToAllOthers.start && (currentHeight - 1) % testParams.txsSeqs.userSendToAllOthers.interval === 0 && txsTaskDoneThisBlock['userSendToAllOthers'] === undefined) {
            try {
                txsTaskDoneThisBlock['userSendToAllOthers'] = false;
                await userSendToAllOthers(minerNode, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        // user stakes in VSS
        if (testParams.txsSeqs.stakeVss.active && currentHeight >= testParams.txsSeqs.stakeVss.start && currentHeight < testParams.txsSeqs.stakeVss.end && txsTaskDoneThisBlock['userStakeInVSS'] === undefined) {
            try {
                txsTaskDoneThisBlock['userStakeInVSS'] = false;
                const senderAccountIndex = currentHeight + 1 - testParams.txsSeqs.stakeVss.start;
                await userStakeInVSS(minerNode, accounts, senderAccountIndex);
            } catch (error) {
                console.error(error.message);
                //console.error(error);
            }
        }

        // simple user to user transactions
        if (testParams.txsSeqs.simpleUserToUser.active && currentHeight >= testParams.txsSeqs.simpleUserToUser.start && (currentHeight - 1) % testParams.txsSeqs.simpleUserToUser.interval === 0 && txsTaskDoneThisBlock['userSendToUser'] === undefined) {
            try {
                txsTaskDoneThisBlock['userSendToUser'] = false;
                await userSendToUser(minerNode, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        // users Send To Next Users
        if (testParams.txsSeqs.userSendToNextUser.active && currentHeight >= testParams.txsSeqs.userSendToNextUser.start && (currentHeight - 1) % testParams.txsSeqs.userSendToNextUser.interval === 0 && txsTaskDoneThisBlock['userSendToNextUser'] === undefined) {
            try {
                txsTaskDoneThisBlock['userSendToNextUser'] = false;
                await userSendToNextUser(minerNode, accounts, validatorNode);
            } catch (error) {
                console.error(error);
            }
        }
    }

    console.log('[TEST] Node test completed. - stop mining');
}
export async function test() {
    const timings = { walletRestore: 0, deriveAccounts: 0, startTime: Date.now(), checkPoint: Date.now() };

    //const wallet = new contrast.Wallet("00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", testParams.useDevArgon2);
    const wallet = new contrast.Wallet(testParams.privKey, testParams.useDevArgon2);
    const restored = await wallet.restore();
    if (!restored) { console.error('Failed to restore wallet.'); return; }
    timings.walletRestore = Date.now() - timings.checkPoint; timings.checkPoint = Date.now();

    wallet.loadAccounts();

    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(testParams.nbOfAccounts, testParams.addressType);
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    timings.deriveAccounts = Date.now() - timings.checkPoint; timings.checkPoint = Date.now();

    wallet.saveAccounts();

    console.log(`[TEST] account0 address: [ ${contrast.utils.addressUtils.formatAddress(derivedAccounts[0].address, ' ')} ]`);

    console.log(
        `__Timings -----------------------
| -- walletRestore: ${timings.walletRestore}ms
| -- deriveAccounts(${testParams.nbOfAccounts}): ${timings.deriveAccounts}ms
| -- deriveAccountsAvg: ~${(timings.deriveAccounts / testParams.nbOfAccounts).toFixed(2)}ms
| -- deriveAccountAvgIterations: ${avgIterations}
| -- total: ${Date.now() - timings.startTime}ms
---------------------------------`
    );

    nodeSpecificTest(derivedAccounts);
};
test();