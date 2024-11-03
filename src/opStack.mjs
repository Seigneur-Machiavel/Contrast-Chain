import utils from './utils.mjs';
/**
* @typedef {import("./syncHandler.mjs").SyncHandler} SyncHandler
* @typedef {import("./node.mjs").Node} Node
* @typedef {import("./block.mjs").BlockData} BlockData
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
    paused = false;
    txBatchSize = 10; // will treat transactions in batches of 10
    /** @type {NodeJS.Timeout} */
    lastConfirmedBlockTimeout = null;
    delayWithoutConfirmationBeforeSync = utils.SETTINGS.targetBlockTime * 2;
    lastExecutedTask = null;

    // will replace the timeout with a simple loop
    healthInfo = {
        lastDigestTime: null,
        lastSyncTime: null,
        lastReorgCheckTime: null,
        delayBeforeReorgCheck: 1000 * 60, // 1 minutes
        delayBeforeSyncCheck: 1000 * 60 * 5 // 5 minutes
    }

    /** @param {Node} node */
    static buildNewStack(node) {
        const newCallStack = new OpStack();
        newCallStack.node = node;
        newCallStack.#stackLoop();
        newCallStack.#healthCheckLoop();
        return newCallStack;
    }
    async #healthCheckLoop() {
        const delayBetweenChecks = 1000; // 1 second
        while (!this.terminated) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenChecks));
            const now = Date.now();
            
            if (this.healthInfo.lastDigestTime === null && this.healthInfo.lastSyncTime === null) { continue; }
            const lastDigestOrSyncTime = Math.max(this.healthInfo.lastDigestTime, this.healthInfo.lastSyncTime);

            if (now - lastDigestOrSyncTime > this.healthInfo.delayBeforeSyncCheck) {
                this.healthInfo.lastSyncTime = Date.now();
                this.pushFirst('syncWithKnownPeers', null);
                console.warn(`[OpStack] SyncWithKnownPeers requested by healthCheck, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                continue;
            }

            const lastReorgCheckTime = this.healthInfo.lastReorgCheckTime;
            const timeSinceLastReorgCheck = lastReorgCheckTime ? now - lastReorgCheckTime : now - lastDigestOrSyncTime;

            if (timeSinceLastReorgCheck > this.healthInfo.delayBeforeReorgCheck) {
                this.healthInfo.lastReorgCheckTime = Date.now();
                const reorgInitiated = await this.node.reorganizator.reorgIfMostLegitimateChain();
            }
        }
    }
    terminate() {
        clearTimeout(this.lastConfirmedBlockTimeout);
        this.lastConfirmedBlockTimeout = null;
        this.terminated = true;
        this.syncRequested = false;
    }
    /** @param {number} delayMS */
    async #stackLoop(delayMS = 10) {
        while (true) {
            if (this.terminated) { break; }

            if (this.tasks.length === 0 || this.paused) {
                await new Promise(resolve => setTimeout(resolve, delayMS));
                if (this.node.miner) { this.node.miner.canProceedMining = true; }
                continue;
            }

            await new Promise(resolve => setImmediate(resolve));

            for (let i = 0; i < this.txBatchSize; i++) {
                const task = this.tasks.shift();
                if (!task) { break; }
                
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

        try {
            const options = task.options ? task.options : {};
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
                    try { 
                        await this.node.digestFinalizedBlock(content, options, byteLength);
                    } catch (error) {
                        if (error.message.includes('Anchor not found')) {
                            console.error(`\n#${content.index} **CRITICAL ERROR** Validation of the finalized doesn't spot missing anchor! `); }
                        if (error.message.includes('invalid prevHash')) {
                            console.error(`\n#${content.index} **SOFT FORK** Finalized block prevHash doesn't match the last block hash! `); }
                        if (error.message.includes('!ban!')) {
                            // avoid using the block in future reorgs
                            this.node.reorganizator.banFinalizedBlock(content);
                            if (task.data.from === undefined) { return }
                            this.node.p2pNetwork.reputationManager.applyOffense(
                                {peerId : task.data.from},
                                ReputationManager.OFFENSE_TYPES.INVALID_BLOCK_SUBMISSION
                            );
                            return;
                        }

                        if (error.message.includes('!store!')) {
                            console.info(`[OpStack] Storing finalized block in cache: ${content.index}`);
                            this.node.reorganizator.storeFinalizedBlockInCache(content);
                        }

                        if (error.message.includes('!reorg!')) {
                            const reorgInitiated = this.node.reorganizator.reorgIfMostLegitimateChain();
                            if (reorgInitiated) { return; }
                        }

                        if (error.message.includes('!store!') || error.message.includes('!reorg!')) { return; }
                        
                        if (error.message.includes('!sync!')) {
                            console.error(error.stack);
                            this.pushFirst('syncWithKnownPeers', null);
                            console.log(`restartRequested: ${this.node.restartRequested}`);
                            return;
                        }

                        console.error(error.stack);
                    }
                    
                    // prune the reog cache
                    this.node.reorganizator.pruneCache();

                    // if: isValidatorOfBlock -> return
                    // don't clear timeout. If many blocks are self validated, we are probably in a fork
                    const blockValidatorAddress = content.Txs[1].inputs[0].split(':')[0];
                    const isValidatorOfBlock = this.node.account.address === blockValidatorAddress;
                    if (isValidatorOfBlock) { return; }
                    
                    this.healthInfo.lastDigestTime = Date.now();
                    // reset the timeout for the sync
                    /*clearTimeout(this.lastConfirmedBlockTimeout);
                    this.lastConfirmedBlockTimeout = setTimeout(() => {
                        this.pushFirst('syncWithKnownPeers', null);
                        console.warn(`[OPSTACK-${this.node.id.slice(0, 6)}] SyncWithKnownPeers requested after TIMEOUT, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    }, this.delayWithoutConfirmationBeforeSync);*/
                    break;
                case 'syncWithKnownPeers':
                    if (this.node.miner) { this.node.miner.canProceedMining = false; }

                    console.warn(`[NODE-${this.node.id.slice(0, 6)} - OPSTACK] SyncWithKnownPeers started, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    const syncSuccessful = await this.node.syncHandler.syncWithKnownPeers();
                    if (!syncSuccessful) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.warn(`[NODE-${this.node.id.slice(0, 6)}] SyncWithKnownPeers failed, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                        //this.tasks.unshift(task);
                        this.terminate();
                        console.log(`restartRequested: ${this.node.restartRequested}`);
                        if (!this.node.restartRequested) { this.node.requestRestart('OpStack.syncWithKnownPeers() -> force!'); }
                        break;
                    }

                    this.healthInfo.lastSyncTime = Date.now();
                    // reset the timeout for the sync
                    /*clearTimeout(this.lastConfirmedBlockTimeout);
                    this.lastConfirmedBlockTimeout = setTimeout(() => {
                        this.pushFirst('syncWithKnownPeers', null);
                        console.warn(`[NODE-${this.node.id.slice(0, 6)}] SyncWithKnownPeers requested after TIMEOUT, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    }, this.delayWithoutConfirmationBeforeSync);*/

                    console.warn(`[NODE-${this.node.id.slice(0, 6)}] SyncWithKnownPeers finished, lastBlockData.index: ${this.node.blockchain.lastBlock === null ? 0 : this.node.blockchain.lastBlock.index}`);
                    this.syncRequested = false;
                    break;
                case 'createBlockCandidateAndBroadcast':
                    await this.node.createBlockCandidateAndBroadcast();
                    break;
                case 'rollBackTo':
                    await this.node.loadSnapshot(content, false);
                    break;
                default:
                    console.error(`[OpStack] Unknown task type: ${task.type}`);
            }
        } catch (error) { console.error(error.stack); }
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

    securelyPushFirst(tasks) {
        this.paused = true;
        for (const task of tasks) {
            //console.info(`[OpStack] securelyPushFirst: ${JSON.stringify(task)}`);
            if (task.type === 'rollBackTo') { console.info(`[OpStack] --- rollBackTo -> #${task.data}`); }
            if (task.type === 'digestPowProposal') { console.info(`[OpStack] --- digestPowProposal -> #${task.data.index}`); }
            this.tasks.unshift(task); 
        }
        this.paused = false;
    }
}