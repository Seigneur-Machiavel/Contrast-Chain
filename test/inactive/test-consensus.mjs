import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../../src/node-factory.mjs';
import { Transaction_Builder } from '../../src/transaction.mjs';
import { Wallet } from '../../src/wallet.mjs';
import { DashboardWsApp, ObserverWsApp } from '../../run/apps.mjs';
describe('Comprehensive Consensus Test', function () {
    this.timeout(360000000000); // 1 hour

    const NUM_NODES = 4;
    const NUM_MINERS = 0;
    const INITIAL_MINER_BALANCE = 30000000;
    const DISTRIBUTION_AMOUNT = 3000000;
    const CONSENSUS_CHECK_INTERVAL = 2000; // Check consensus every minute
    const BALANCE_CHECK_INTERVAL = 2000; // Check balances every 5 minutes

    let factory;
    let nodeIds = [];
    let wallet;
    let continueSendingTransactions = true;
    let transactionCount = 0;
    let failedTransactions = 0;
    let accounts = [];

    before(async function () {
        console.info('Initializing test environment...');
        factory = new NodeFactory();
        wallet = new Wallet();

       
        const derivedAccounts = await wallet.loadOrCreateAccounts();

        accounts = derivedAccounts;
        wallet.saveAccounts();
        if (!derivedAccounts) throw new Error('Failed to derive addresses.');

        console.info(`Derived ${derivedAccounts.length} accounts. `);

        // Create and start nodes
        for (let i = 0; i < NUM_NODES; i++) {
            const role = i < NUM_MINERS ? 'miner' : 'validator';
            let listenAddress = '/ip4/0.0.0.0/tcp/27260';
            if(i > 0){
                listenAddress = '/ip4/0.0.0.0/tcp/0';
            }
            const node = await factory.createNode(derivedAccounts[i], ['miner', 'validator' , 'observer'], { listenAddress });
            nodeIds.push(node.id);
            await factory.startNode(node.id);
        }
        //new DashboardWsApp(factory, 27271); // network port 27271
        await waitForP2PNetworkReady(nodeIds);
        await new Promise(resolve => setTimeout(resolve, 500000000));

        // Start mining on all miner nodes
        // nodeIds.filter(nodeId => factory.getNode(nodeId).roles.includes('miner')).forEach(nodeId => factory.getNode(nodeId).miner.startWithWorker());
    });

    after(async function () {
        console.info('Cleaning up test environment...');
        continueSendingTransactions = false;
        for (const nodeId of nodeIds) {
            await factory.stopNode(nodeId);
        }
    });

    it('should maintain consensus with various transaction scenarios', async function () {
        const validatorNodeId = nodeIds.find(nodeId => {
            const node = factory.getNode(nodeId);
            return node.roles.includes('validator');
        });
        const validatorNode = factory.getNode(validatorNodeId);
       // await validatorNode.createBlockCandidateAndBroadcast();

        const minerWithBalanceId = await waitForMinerWithBalance(nodeIds, INITIAL_MINER_BALANCE);
        if (!minerWithBalanceId) throw new Error('No miner accumulated sufficient balance within the expected time');

        const minerWithBalance = factory.getNode(minerWithBalanceId);

        // Wait a second for the miner to broadcast the block
        await new Promise(resolve => setTimeout(resolve, 3000));

        await distributeFunds(minerWithBalanceId, nodeIds.filter(nId => nId !== minerWithBalanceId), DISTRIBUTION_AMOUNT, validatorNodeId);

        await refreshAllBalances(validatorNodeId, nodeIds.map(nId => factory.getNode(nId).account));

        const transactionSender = continuouslySendTransactions(nodeIds, validatorNodeId, accounts);

        await Promise.all([
            transactionSender,
            periodicConsensusCheck(nodeIds),
            periodicBalanceCheck(nodeIds)
        ]);

        continueSendingTransactions = false;

        console.info(`Test completed. Total transactions: ${transactionCount}, Failed: ${failedTransactions}`);
    });

    async function continuouslySendTransactions(nodeIds, broadcastNodeId, allAccounts) {
        const BATCH_SIZE = 2; // Number of transactions to prepare in each batch
        const BATCH_INTERVAL = 500; // Time in ms between batches

        while (continueSendingTransactions) {
            let transactionPromises = [];

            for (let i = 0; i < BATCH_SIZE && continueSendingTransactions; i++) {

                const scenario = getRandomScenario();
                const transactionPromise = executeTransactionScenario(scenario, nodeIds, broadcastNodeId, allAccounts)
                    .then(() => {
                        transactionCount++;
                    })
                    .catch(error => {
                        failedTransactions++;
                    });

                transactionPromises.push(transactionPromise);
            }

            // Wait for all transactions in the batch to complete
            await Promise.all(transactionPromises);

            // Refresh balances after each batch
            await refreshAllBalances(broadcastNodeId, nodeIds.map(nId => factory.getNode(nId).account));

            // Wait for the specified interval before starting the next batch
            await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL));
        }
    }

    function getRandomScenario() {
        const scenarios = ['simple', 'random-account'];
        return scenarios[Math.floor(Math.random() * scenarios.length)];
    }

    async function executeTransactionScenario(scenario, nodeIds, broadcastNodeId, allAccounts) {

        const sender = accounts[Math.floor(Math.random() * accounts.length)];
        let recipient, amount, outputs;

        const broadcastNode = factory.getNode(broadcastNodeId);
        // Check sender's balance before proceeding
        const senderBalance = broadcastNode.utxoCache.getBalanceAndUTXOs(sender.address).balance;
        if (senderBalance <= 1) {
            throw new Error(`Skipping transaction: Sender ${sender.address} has insufficient balance (${senderBalance})`);
        }
        console.info(`Executing transaction scenario: ${scenario} from ${sender.address}`);
        switch (scenario) {
            case 'simple':
                const recipientNodeId = nodeIds[Math.floor(Math.random() * nodeIds.length)];
                recipient = factory.getNode(recipientNodeId).account;
                amount = Math.min(1, senderBalance - 1);
                return sendTransaction(sender, [{ recipientAddress: recipient.address, amount }], broadcastNodeId);
            case 'random-account':
                recipient = allAccounts[Math.floor(Math.random() * allAccounts.length)];
                amount = Math.min(1, senderBalance - 1);
                return sendTransaction(sender, [{ recipientAddress: recipient.address, amount }], broadcastNodeId);
        }
    }

    async function sendTransaction(sender, outputs, broadcastNodeId) {
        try {
            const transaction = await Transaction_Builder.createTransfer(sender, outputs, 1);
            const signedTx = await sender.signTransaction(transaction);
            const broadcastNode = factory.getNode(broadcastNodeId);
            await broadcastNode.p2pBroadcast('new_transaction', signedTx);
        } catch (error) {
            console.error(`Error preparing transaction: ${error.message}`);
            throw error;
        }
    }

    async function distributeFunds(senderNodeId, recipientNodeIds, amount, broadcastNodeId) {
        const senderNode = factory.getNode(senderNodeId);
        console.info(`Distributing ${amount} from ${senderNode.account.address} to ${recipientNodeIds.length} recipients`);
        await refreshAllBalances(broadcastNodeId, recipientNodeIds.map(nId => factory.getNode(nId).account));

        for (const recipientNodeId of recipientNodeIds) {
            const recipientNode = factory.getNode(recipientNodeId);
            try {
                await sendTransaction(senderNode.account, [{ recipientAddress: recipientNode.account.address, amount }], broadcastNodeId);
            } catch (error) {
                console.error(`Failed to distribute funds to ${recipientNode.account.address}: ${error.message}`);
                // Optionally, you might want to implement a retry mechanism here
            }
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    async function periodicConsensusCheck(nodeIds) {
        while (continueSendingTransactions) {
            await verifyConsensus(nodeIds);
            await new Promise(resolve => setTimeout(resolve, CONSENSUS_CHECK_INTERVAL));
        }
    }

    async function periodicBalanceCheck(nodeIds) {
        while (continueSendingTransactions) {
            await verifyBalances(nodeIds);
            await new Promise(resolve => setTimeout(resolve, BALANCE_CHECK_INTERVAL));
        }
    }

    async function verifyConsensus(nodeIds) {
        const heights = nodeIds.map(nId => {
            const node = factory.getNode(nId);
            return node.getStatus().currentBlockHeight;
        });
        const consensusHeight = Math.max(...heights);
        for (const nodeId of nodeIds) {
            const node = factory.getNode(nodeId);
            //expect(node.getStatus().currentBlockHeight).to.be.at.least(consensusHeight - 1);
        }
    }

    async function verifyBalances(nodeIds) {
        console.info('Verifying balances...');
        const lastNodeId = nodeIds[nodeIds.length - 1];
        const lastNode = factory.getNode(lastNodeId);
        let totalBalance = 0;
        for (const nodeId of nodeIds) {
            const node = factory.getNode(nodeId);
            const balance = await lastNode.utxoCache.getAddressUtxos(node.account.address).balance;
            console.info(`Balance check - Address ${node.account.address}: ${balance}`);
            // expect(balance).to.be.at.least(0);
            totalBalance += balance;
        }
        console.info(`Total balance across all nodes: ${totalBalance}`);
    }

    async function refreshAllBalances(broadcastNodeId, accounts) {
        const broadcastNode = factory.getNode(broadcastNodeId);
        for (const account of accounts) {
            const { balance, UTXOs } = await broadcastNode.getAddressUtxos(account.address);
            account.setBalanceAndUTXOs(balance, UTXOs);
        }
    }

    async function waitForP2PNetworkReady(nodeIds, maxAttempts = 3000, interval = 6000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodeIds.every(nodeId => {
                const node = factory.getNode(nodeId);
                const peerCount = node.p2pNetwork.getConnectedPeers().length;
                console.debug(`Node ${node.id} has ${peerCount} peers`);
                return peerCount >= Math.min(NUM_NODES - 1, node.p2pNetwork.options.maxPeers);
            });

            if (allNodesConnected) {
                console.info('P2P network is ready');
                return;
            }
            console.info(`Waiting for P2P network to initialize. Attempt ${attempt + 1}/${maxAttempts}`);

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('P2P network failed to initialize within the expected time');
    }

    async function waitForMinerWithBalance(nodeIds, minBalance, maxAttempts = 60, interval = 5000) {
        const minersIds = nodeIds.filter(nodeId => {
            const node = factory.getNode(nodeId);
            return node.roles.includes('miner');
        });
        const randomValidatorId = nodeIds.find(nodeId => {
            const node = factory.getNode(nodeId);
            return node.roles.includes('validator');
        });
        const randomValidator = factory.getNode(randomValidatorId);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            for (const minerId of minersIds) {
                const miner = factory.getNode(minerId);
                console.debug(`Checking balance for miner ${miner.id}`);
                const balance = randomValidator.utxoCache.getBalanceAndUTXOs(miner.account.address).balance;
                console.debug(`Miner ${miner.id} balance: ${balance}`);
                if (balance >= minBalance) {
                    console.info(`Miner ${miner.id} has accumulated sufficient balance`);
                    return minerId;
                }
            }

            console.info(`Waiting for a miner to accumulate balance. Attempt ${attempt + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        return null;
    }
});
