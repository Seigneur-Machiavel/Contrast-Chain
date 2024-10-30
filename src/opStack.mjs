/**
* @typedef {import("./syncHandler.mjs").SyncHandler} SyncHandler
* @typedef {import("./node.mjs").Node} Node
*/

import ReputationManager from "./reputation.mjs";

// Simple task manager, used to avoid vars overwriting in the callstack
export class OpStack {
    /** @type {Node} */
    node = null;
    /** @type {object[]} */
    tasks = [];
    syncRequested = false;
    terminated = false;
    txBatchSize = 10; // will treat transactions in batches of 10
    /** @type {NodeJS.Timeout} */
    lastConfirmedBlockTimeout = null;
    delayWithoutConfirmationBeforeSync = 300_000; // 5 minutes
    lastExecutedTask = null;

    /** @param {Node} node */
    static buildNewStack(node) {
        const newCallStack = new OpStack();
        newCallStack.node = node;
        newCallStack.#stackLoop();
        return newCallStack;
    }
    terminate() {
        clearTimeout(this.lastConfirmedBlockTimeout);
        this.lastConfirmedBlockTimeout = null;
        this.terminated = true;
    }
    /** @param {number} delayMS */
    async #stackLoop(delayMS = 10) {
        while (true) {
            if (this.terminated) { break; }

            if (this.tasks.length === 0) {
                await new Promise(resolve => setTimeout(resolve, delayMS));
                if (this.node.miner) { this.node.miner.canProceedMining = true; }
                continue;
            }

            await new Promise(resolve => setImmediate(resolve));

            for (let i = 0; i < this.txBatchSize; i++) {
                const task = this.tasks.shift();
                if (!task) { break; }

                const taskRequireMiningPause = task.type === 'syncWithKnownPeers';
                if (taskRequireMiningPause && this.node.miner) { this.node.miner.canProceedMining = false; }
                
                this.lastExecutedTask = task;
                await this.#executeTask(task);

                if (task.type !== 'pushTransaction') { break; }
            }
        }
        console.info('------------------');
        console.info('OpStack terminated');
        console.info('------------------');
    }
    async #executeTask(task) {
        if (!task) { return; }

        //try {
            const content = task.data ? task.data.content ? task.data.content : task.data : undefined;
            const byteLength = task.data ? task.data.byteLength ? task.data.byteLength : undefined : undefined;

            switch (task.type) {
                case 'pushTransaction':
                    try {
                        await this.node.memPool.pushTransaction(content.utxoCache, content.transaction, byteLength); 
                    } catch (error) {
                        if (error.message.includes('Transaction already in mempool')) { break; }
                        if (error.message.includes('Conflicting UTXOs')) { break; }
                        console.error(error.message); 
                    }
                    break;
                case 'digestPowProposal':
                    if (content.Txs[0].inputs[0] === undefined) { console.error('Invalid coinbase nonce'); return; }
                    try { await this.node.digestFinalizedBlock(content, { storeAsFiles: false }, byteLength);
                    } catch (error) {
                        if (error.message.includes('!ban!')) {
                           if (task.data.from !== undefined) {
                            this.node.p2pNetwork.reputationManager.applyOffense(
                                {peerId : task.data.from},
                                ReputationManager.OFFENSE_TYPES.INVALID_BLOCK_SUBMISSION); }
                            return;
                        } //! -> Ban the peer

                        if (error.message.includes('Anchor not found')) {
                            console.error(`\n#${content.index} **CRITICAL ERROR** Validation of the finalized doesn't spot missing anchor! `); }
                        if (error.message.includes('invalid prevHash')) {
                            console.error(`\n#${content.index} **SOFT FORK** Finalized block prevHash doesn't match the last block hash! `); }
                        
                        if (error.message.includes('!sync!')) {
                            console.error(error.stack);
                            this.terminate();
    
                            await this.node.syncHandler.handleSyncFailure();

                            console.log(`restartRequested: ${this.node.restartRequested}`);
                            return;
                        }

                        console.error(error.stack);
                    }
                    
                    // reset the timeout for the sync
                    clearTimeout(this.lastConfirmedBlockTimeout);
                    this.lastConfirmedBlockTimeout = setTimeout(() => {
                        this.pushFirst('syncWithKnownPeers', null);
                        console.warn(`[OPSTACK-${this.node.id.slice(0, 6)}] SyncWithKnownPeers requested after TIMEOUT, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    }, this.delayWithoutConfirmationBeforeSync);
                    break;
                case 'syncWithKnownPeers':
                    console.warn(`[NODE-${this.node.id.slice(0, 6)} - OPSTACK] SyncWithKnownPeers started, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    const syncSuccessful = await this.node.syncHandler.syncWithKnownPeers();
                    if (!syncSuccessful) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.warn(`[NODE-${this.node.id.slice(0, 6)}] SyncWithKnownPeers failed, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                        //this.syncRequested = false;
                        //this.pushFirst( 'syncWithKnownPeers', null );
                        this.tasks.unshift(task);
                        break;
                    }

                    // reset the timeout for the sync
                    clearTimeout(this.lastConfirmedBlockTimeout);
                    this.lastConfirmedBlockTimeout = setTimeout(() => {
                        this.pushFirst('syncWithKnownPeers', null);
                        console.warn(`[NODE-${this.node.id.slice(0, 6)}] SyncWithKnownPeers requested after TIMEOUT, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    }, this.delayWithoutConfirmationBeforeSync);

                    console.warn(`[NODE-${this.node.id.slice(0, 6)}] SyncWithKnownPeers finished, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    this.syncRequested = false;
                    break;
                case 'createBlockCandidateAndBroadcast':
                    await this.node.createBlockCandidateAndBroadcast();
                    break;
                default:
                    console.error(`[OpStack] Unknown task type: ${task.type}`);
            }
        //} catch (error) { console.error(error.stack); }
    }
    /** @param {string} type  @param {object} data */
    push(type, data) {
        if (type === 'syncWithKnownPeers' && this.syncRequested) { return; }
        if (type === 'syncWithKnownPeers') { this.syncRequested = true; }
        this.tasks.push({ type, data });
    }
    /** @param {string} type  @param {object} data */
    pushFirst(type, data) {
        if (type === 'syncWithKnownPeers' && this.syncRequested) { return; }
        if (type === 'syncWithKnownPeers') { this.syncRequested = true; }
        this.tasks.unshift({ type, data });
    }
}