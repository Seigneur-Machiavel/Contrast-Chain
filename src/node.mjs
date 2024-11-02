import localStorage_v1 from '../storage/local-storage-management.mjs';
import { BlockValidation } from './validation.mjs';
import { OpStack } from './opStack.mjs';
import { Vss } from './vss.mjs';
import { MemPool } from './memPool.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { BlockData, BlockUtils } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { Miner } from './miner.mjs';
import P2PNetwork from './p2p.mjs';
import utils from './utils.mjs';
import { Blockchain } from './blockchain.mjs';
import { SyncHandler } from './sync.mjs';
import SnapshotSystemDoc from './snapshot-system.mjs';
import { performance, PerformanceObserver } from 'perf_hooks';
import { ValidationWorker } from '../workers/workers-classes.mjs';
import { ConfigManager } from './config-manager.mjs';
import { TimeSynchronizer } from './time.mjs';
import { Logger } from './logger.mjs';
/**
* @typedef {import("./account.mjs").Account} Account
* @typedef {import("./transaction.mjs").Transaction} Transaction
* @typedef {import("./websocketCallback.mjs").WebSocketCallBack} WebSocketCallBack
* @typedef {import("./block.mjs").BlockHeader} BlockHeader
* @typedef {import("./block.mjs").BlockInfo} BlockInfo
*/

const obs = new PerformanceObserver((items) => { // TODO: disable in production
    items.getEntries().forEach((entry) => { console.log(`${entry.name}: ${entry.duration.toFixed(3)}ms`); });
});
obs.observe({ entryTypes: ['measure'] });

export class Node {
    /** @param {Account} account */
    constructor(account, roles = ['validator'], p2pOptions = {}, version = 1) {
        this.logger = new Logger();
        this.timeSynchronizer = new TimeSynchronizer();
        this.restartRequested = false;
        /** @type {string} */
        this.id = account.address;
        /** @type {SnapshotSystemDoc} */
        this.snapshotSystemDoc = new SnapshotSystemDoc(this.id);
        /** @type {string[]} */
        this.roles = roles; // 'miner', 'validator', ...
        /** @type {OpStack} */
        this.opStack = null;
        /** @type {P2PNetwork} */
        this.p2pNetwork = new P2PNetwork({
            role: this.roles.join('_'),
            ...p2pOptions
        }, this.timeSynchronizer, this.logger);
        this.p2pOptions = p2pOptions;

        /** @type {Account} */
        this.account = account;
        this.validatorRewardAddress = account.address;
        /** @type {BlockData} */
        this.blockCandidate = null;
        /** @type {Object<string, Object<string, BlockData>>} */
        this.finalizedBlocksCache = {};

        /** @type {Vss} */
        this.vss = new Vss(utils.SETTINGS.maxSupply);
        /** @type {MemPool} */
        this.memPool = new MemPool();
        /** @type {number} */
        this.version = version;

        /** @type {Miner} */
        this.miner = null;
        /** @type {string} */
        this.minerAddress = null;
        this.useDevArgon2 = false;
        /** @type {Blockchain} */
        this.blockchain = new Blockchain(this.id);
        /** @type {SyncHandler} */
        this.syncHandler = new SyncHandler(() => this, this.logger);

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
        /** @type {UtxoCache} */
        this.utxoCache = new UtxoCache(this.id, this.version, this.blockchain);

        /** @type {ValidationWorker[]} */
        this.workers = [];
        this.nbOfWorkers = 4;
        this.configManager = new ConfigManager("config/config.json");

        this.blockchainStats = {};
        this.delayBeforeSendingCandidate = 10000;
    }

    async start(startFromScratch = false) {
        await this.logger.initializeLogger();
        this.blockchainStats.state = "starting";
        await this.configManager.init();
        await this.timeSynchronizer.syncTimeWithRetry(5, 500);
        console.log(`Node ${this.id} (${this.roles.join('_')}) => started at time: ${this.getCurrentTime()}`);

        for (let i = 0; i < this.nbOfWorkers; i++) { this.workers.push(new ValidationWorker(i)); }
        this.opStack = OpStack.buildNewStack(this);
        //this.miner = new Miner(this.minerAddress || this.account.address, this, this.roles, this.opStack, this.timeSynchronizer);
        this.miner = new Miner(this.minerAddress || this.account.address, this);
        this.miner.useDevArgon2 = this.useDevArgon2;

        if (!startFromScratch) { await this.#loadBlockchain(); }

        // actually useless in ram, but good for DB usage
        // await this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache);
        const bootstrapNodes = this.configManager.getBootstrapNodes();
        this.p2pNetwork.options.bootstrapNodes = bootstrapNodes;

        const uniqueHash = await this.account.getUniqueHash(64);
        await this.p2pNetwork.start(uniqueHash);
        await this.syncHandler.start(this.p2pNetwork);
        if (this.roles.includes('miner')) { this.miner.startWithWorker(); }

        const nbOfPeers = await this.#waitSomePeers();
        if (!nbOfPeers || nbOfPeers < 1) { console.error('Failed to connect to peers, stopping the node'); return; }
        console.log('P2P network is ready - we are connected baby!');

        if (!this.roles.includes('validator')) { return; }

        this.opStack.pushFirst('createBlockCandidateAndBroadcast', null);
        this.opStack.pushFirst('syncWithKnownPeers', null);
    }
    async stop() {
        console.log(`Node ${this.id} (${this.roles.join('_')}) => stopped`);
    }
    requestRestart(from = 'unknown') {
        this.restartRequested = from;
    }

    getCurrentTime() {
        return this.timeSynchronizer.getCurrentTime();
    }

    getTopicsToSubscribeRelatedToRoles() {
        const rolesTopics = {
            validator: ['new_transaction', 'new_block_finalized'],
            miner: ['new_block_candidate'],
            observer: ['new_transaction', 'new_block_finalized', 'new_block_candidate']
        }
        const topicsToSubscribe = [];
        for (const role of this.roles) { topicsToSubscribe.push(...rolesTopics[role]); }
        return [...new Set(topicsToSubscribe)];
    }
    async #waitSomePeers(nbOfPeers = 1, maxAttempts = 60, timeOut = 30000) {
        const checkPeerCount = () => {
            const peersIds = this.p2pNetwork.getConnectedPeers();
            const myPeerId = this.p2pNetwork.p2pNode.peerId.toString();
            return peersIds.length - (peersIds.includes(myPeerId) ? 1 : 0);
        };
    
        const attemptConnection = async () => {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1000));
                
                let peerCount = checkPeerCount();
                if (peerCount >= nbOfPeers) {
                    console.info(`luid-60b1e366 Connected to ${peerCount} peer${peerCount !== 1 ? 's' : ''}`);
                    return peerCount;
                }
    
                await this.p2pNetwork.connectToBootstrapNodes();
                peerCount = checkPeerCount();
                
                if (peerCount >= nbOfPeers) {
                    console.info(`luid-ec98dc8a Connected to ${peerCount} peer${peerCount !== 1 ? 's' : ''} after connecting to bootstrap nodes`);
                    this.opStack.pushFirst('syncWithKnownPeers', null);
                    return peerCount;
                }
    
                console.info(`luid-f97443bb Waiting for ${nbOfPeers} peer${nbOfPeers !== 1 ? 's' : ''}, currently connected to ${peerCount} peer${peerCount !== 1 ? 's' : ''}`);
            }
            //throw new Error(`Failed to connect to ${nbOfPeers} peers within ${maxAttempts} attempts`);
            return false;
        };
    
        try {
            return await Promise.race([
                attemptConnection(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`P2P network failed to find peers within ${timeOut / 1000} seconds`)), timeOut)
                )
            ]);
        } catch (error) {
            console.warn(error.message);
            return false;
        }
    }
    async createBlockCandidateAndBroadcast() {
        this.blockchainStats.state = "creating block candidate";
        try {
            if (!this.roles.includes('validator')) { throw new Error('Only validator can create a block candidate'); }

            this.blockCandidate = await this.#createBlockCandidate();
            if (this.roles.includes('miner')) { this.miner.updateBestCandidate(this.blockCandidate); }
            await this.p2pBroadcast('new_block_candidate', this.blockCandidate);
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }

    async #loadBlockchain() {
        this.blockchainStats.state = "loading";
        // OPENNING BLOCKCHAIN DATABASE
        try {
            while (this.blockchain.db.status === 'opening') { await new Promise(resolve => setTimeout(resolve, 100)); }
        } catch (error) {
            console.error('Error while opening the databases:', error);
        }

        // ensure consistency between the blockchain and the snapshot system
        const lastSavedBlockHeight = await this.blockchain.getLastKnownHeight();
        this.snapshotSystemDoc.eraseSnapshotsHigherThan(lastSavedBlockHeight);

        const snapshotsHeights = this.snapshotSystemDoc.getSnapshotsHeights();
        const olderSnapshotHeight = snapshotsHeights[0] ? snapshotsHeights[0] : 0;
        const youngerSnapshotHeight = snapshotsHeights[snapshotsHeights.length - 1];
        const startHeight = isNaN(youngerSnapshotHeight) ? -1 : youngerSnapshotHeight;

        // Cache the blocks from the last snapshot +1 to the last block
        // cacheStart : 0, 11, 21, etc...
        const cacheStart = olderSnapshotHeight > 10 ? olderSnapshotHeight - 9 : 0;
        await this.blockchain.loadBlocksFromStorageToCache(cacheStart, startHeight);
        this.blockchain.currentHeight = startHeight;
        this.blockchain.lastBlock = await this.blockchain.getBlockByHeight(startHeight);

        // cache + db cleanup
        await this.blockchain.eraseBlocksHigherThan(startHeight);
        if (startHeight === -1) { // no snapshot to load
            await this.blockchain.eraseEntireDatabase();
            return true;
        }

        await this.loadSnapshot(startHeight);

        return true;
    }
    async loadSnapshot(snapshotIndex = 0, eraseHigher = true) {
        console.warn(`Last known snapshot index: ${snapshotIndex}`);
        await this.snapshotSystemDoc.rollBackTo(snapshotIndex, this.utxoCache, this.vss, this.memPool);
        if (!eraseHigher) { return; }

        // place snapshot to trash folder, we can restaure it if needed
        this.snapshotSystemDoc.eraseSnapshotsHigherThan(snapshotIndex - 1);
    }
    /** @param {BlockData} finalizedBlock */
    async #saveSnapshot(finalizedBlock) {
        if (finalizedBlock.index === 0) { return; }
        if (finalizedBlock.index % 10 !== 0) { return; }

        // erase the outdated blocks cache and persist the addresses transactions references to disk
        const cacheErasable = this.blockchain.erasableCacheLowerThan(finalizedBlock.index - 99);
        if (cacheErasable !== null && cacheErasable.from < cacheErasable.to) {
            await this.blockchain.persistAddressesTransactionsReferencesToDisk(this.memPool, cacheErasable.from, cacheErasable.to);
            this.blockchain.eraseCacheFromTo(cacheErasable.from, cacheErasable.to);
        }

        await this.snapshotSystemDoc.newSnapshot(this.utxoCache, this.vss, this.memPool);
        this.snapshotSystemDoc.eraseSnapshotsLowerThan(finalizedBlock.index - 100);
        // avoid gap between the loaded snapshot and the new one
        // at this stage we know that the loaded snapshot is consistent with the blockchain
        if (this.snapshotSystemDoc.loadedSnapshotHeight < finalizedBlock.index - 200) {
            this.snapshotSystemDoc.loadedSnapshotHeight = 0;
        }
        this.snapshotSystemDoc.restoreLoadedSnapshot();
    }
    storeFinalizedBlockInCache(finalizedBlock) {
        const index = finalizedBlock.index;
        const hash = finalizedBlock.hash;
        if (!this.finalizedBlocksCache[index]) { this.finalizedBlocksCache[index] = {}; }
        this.finalizedBlocksCache[index][hash] = finalizedBlock;
    }
    pruneStoredFinalizedBlockFromCache() {
        const snapshotsHeights = this.snapshotSystemDoc.getSnapshotsHeights();
        const preLastSnapshot = snapshotsHeights[snapshotsHeights.length - 2];
        if (preLastSnapshot === undefined) { return; }

        const eraseUntil = preLastSnapshot -1;
        const blocksHeight = Object.keys(this.finalizedBlocksCache);
        for (const height of blocksHeight) {
            if (height > eraseUntil) { continue; }
            delete this.finalizedBlocksCache[height];
        }
    }
    pruneBranch(finalizedBlocks) {
        for (const block of finalizedBlocks) {
            const index = block.index;
            if (!this.finalizedBlocksCache[index]) { continue; }
            delete this.finalizedBlocksCache[index][block.hash];
        }
    }
    getLegitimateReorg() {
        const legitimateReorg = {
            lastTimestamp: 0,
            lastHeight: 0,
            tasks: []
        };
        // most legitimate chain is the longest chain
        // if two chains have the same length:
        // the most legitimate chain is the one with the lowest mining final difficulty
        // mining final difficulty affected by: posTimestamp
        const snapshotsHeights = this.snapshotSystemDoc.getSnapshotsHeights();
        const preLastSnapshot = snapshotsHeights[snapshotsHeights.length - 2];
        if (preLastSnapshot === undefined) { return legitimateReorg; }

        const lastBlock = this.blockchain.lastBlock;
        if (!lastBlock) { return legitimateReorg; }

        legitimateReorg.lastTimestamp = lastBlock.timestamp;
        legitimateReorg.lastHeight = lastBlock.index;

        let index = lastBlock.index;
        while (this.finalizedBlocksCache[index]) {
            const blocks = Object.values(this.finalizedBlocksCache[index]);
            for (const block of blocks) {
                if (block.hash === lastBlock.hash) { continue; }
                
                const blockTimestamp = block.timestamp;
                const sameIndex = legitimateReorg.lastHeight === block.index;
                if (sameIndex && blockTimestamp > legitimateReorg.lastTimestamp) { continue; }

                const tasksToReorg = this.buildChainReorgTasksFromHighestToLowest(block, preLastSnapshot);
                if (!tasksToReorg) { continue; }

                legitimateReorg.tasks = tasksToReorg;
                legitimateReorg.lastHeight = block.index;
                legitimateReorg.lastTimestamp = block.timestamp;
            }

            index++;
        }

        return legitimateReorg;
    }
    buildChainReorgTasksFromHighestToLowest(highestBlock, lowestHeightToReach) {
        const blocks = [];
        let block = highestBlock;
        while (block.index > lowestHeightToReach) {
            if (!block) { return false; }
            blocks.push(block);
            if (this.blockchain.lastBlock.hash === block.prevHash) { break; }

            const prevBlocks = this.finalizedBlocksCache[block.index - 1];
            if (!prevBlocks || !prevBlocks[block.prevHash]) { return false; } // missing block

            block = prevBlocks[block.prevHash];
        }

        // ensure we can build the chain
        if (!this.blockchain.cache.blocksByHash.has(block.prevHash)) {
            console.info(`[NODE-${this.id.slice(0, 6)}] Rejected reorg, missing block: #${block.index - 1} -> prune branch`);
            this.pruneBranch(blocks);
            return false;
        }
        
        const tasks = [];
        let broadcastNewCandidate = true; // broadcast candidate for the highest block only
        for (const block_ of blocks) {
            const options = { broadcastNewCandidate };
            tasks.push({ type: 'digestPowProposal', data: block_, options });
            broadcastNewCandidate = false;
        }
        if (this.blockchain.lastBlock.hash === block.prevHash) { return tasks; }

        tasks.push({ type: 'rollBackTo', data: block.index - 1 });
        return tasks;
    }

    /** @param {BlockData} finalizedBlock */
    async #validateBlockProposal(finalizedBlock, blockBytes) {
        const minerAddress = finalizedBlock.Txs[0].outputs[0].address;
        if ('CpkQiTemFSZH1zyGUKsM' === minerAddress) {
            console.log('minerAddress:', minerAddress);
        }
        this.blockchainStats.state = "validating block";

        performance.mark('validation start');
        performance.mark('validation height-timestamp-hash');

        // verify the height
        const lastBlockIndex = this.blockchain.currentHeight;
        if (typeof finalizedBlock.index !== 'number') { throw new Error('Invalid block index'); }
        if (Number.isInteger(finalizedBlock.index) === false) { throw new Error('Invalid block index'); }
        
        const validatorId = finalizedBlock.Txs[1].outputs[0].address.slice(0, 6);
        const minerId = finalizedBlock.Txs[0].outputs[0].address.slice(0, 6);
        if (finalizedBlock.index > lastBlockIndex + 9) {
            console.log(`[NODE-${this.id.slice(0, 6)}] Rejected finalized block, higher index: ${finalizedBlock.index} > ${lastBlockIndex + 10} | validator: ${validatorId} | miner: ${minerId}`);
            throw new Error(`Rejected: #${finalizedBlock.index} > #${lastBlockIndex + 9}(+9)`);
        }
        if (finalizedBlock.index > lastBlockIndex + 1) {
            throw new Error(`!store! #${finalizedBlock.index} > #${lastBlockIndex + 1}(+1)`);
        }
        if (finalizedBlock.index <= lastBlockIndex) {
            console.log(`[NODE-${this.id.slice(0, 6)}] Rejected finalized block, older index: ${finalizedBlock.index} <= ${lastBlockIndex} | validator: ${validatorId} | miner: ${minerId}`);
            throw new Error(`Rejected: #${finalizedBlock.index} <= #${lastBlockIndex}`);
        }
        // The only possible case is: finalizedBlock.index === lastBlockIndex + 1

        // verify the POS timestamp
        if (typeof finalizedBlock.posTimestamp !== 'number') { throw new Error('Invalid block timestamp'); }
        if (Number.isInteger(finalizedBlock.posTimestamp) === false) { throw new Error('Invalid block timestamp'); }
        const timeDiffPos = this.blockchain.lastBlock === null ? 1 : finalizedBlock.posTimestamp - this.blockchain.lastBlock.timestamp;
        if (timeDiffPos <= 0) { throw new Error(`Rejected: #${finalizedBlock.index} -> time difference (${timeDiffPos}) must be greater than 0`); }

        // verify final timestamp
        if (typeof finalizedBlock.timestamp !== 'number') { throw new Error('Invalid block timestamp'); }
        if (Number.isInteger(finalizedBlock.timestamp) === false) { throw new Error('Invalid block timestamp'); }
        const timeDiffFinal = finalizedBlock.timestamp - this.timeSynchronizer.getCurrentTime();
        if (timeDiffFinal > 1000) { throw new Error(`Rejected: #${finalizedBlock.index} -> ${timeDiffFinal} > timestamp_diff_tolerance: 1000`); }

        const lastBlockHash = this.blockchain.lastBlock ? this.blockchain.lastBlock.hash : '0000000000000000000000000000000000000000000000000000000000000000';
        const isEqualPrevHash = lastBlockHash === finalizedBlock.prevHash;

        // verify the hash
        const { hex, bitsArrayAsString } = await BlockUtils.getMinerHash(finalizedBlock, this.useDevArgon2);
        if (finalizedBlock.hash !== hex) { throw new Error(`!ban! Invalid pow hash (not corresponding): ${finalizedBlock.hash} - expected: ${hex}`); }
        const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, finalizedBlock);
        if (!hashConfInfo.conform) {
            throw new Error(`!ban! Invalid pow hash (difficulty): ${finalizedBlock.hash}
${hashConfInfo.message}`);
        }

        // verify prevhash
        if (!isEqualPrevHash) {
            //console.log(`[NODE-${this.id.slice(0, 6)}] Rejected finalized block, invalid prevHash: ${finalizedBlock.prevHash} - expected: ${lastBlockHash} | from: ${finalizedBlock.Txs[0].outputs[0].address.slice(0, 6)}`);
            throw new Error(`!store! !reorg! Rejected: invalid prevHash: ${finalizedBlock.prevHash} - expected: ${lastBlockHash}`);
        }

        performance.mark('validation legitimacy');

        // verify the legitimacy
        await this.vss.calculateRoundLegitimacies(finalizedBlock.prevHash); // stored in cache
        const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0];
        const validatorLegitimacy = this.vss.getAddressLegitimacy(validatorAddress);
        if (validatorLegitimacy !== finalizedBlock.legitimacy) { throw new Error(`Invalid legitimacy: ${finalizedBlock.legitimacy} - expected: ${validatorLegitimacy}`); }

        performance.mark('validation coinbase-rewards');

        // control coinbase amount
        const expectedCoinBase = utils.mining.calculateNextCoinbaseReward(this.blockchain.lastBlock || finalizedBlock);
        if (finalizedBlock.coinBase !== expectedCoinBase) { throw new Error(`!ban! Invalid coinbase: ${finalizedBlock.coinBase} - expected: ${expectedCoinBase}`); }

        // control total rewards
        const { powReward, posReward, totalFees } = await BlockUtils.calculateBlockReward(this.utxoCache, finalizedBlock);
        try { await BlockValidation.areExpectedRewards(powReward, posReward, finalizedBlock); }
        catch (error) { throw new Error('!ban! Invalid rewards'); }

        performance.mark('validation double-spending');
        // control double spending
        try { BlockValidation.isFinalizedBlockDoubleSpending(finalizedBlock); }
        catch (error) { throw new Error('!ban! Double spending detected'); }

        performance.mark('validation fullTxsValidation');
        const allDiscoveredPubKeysAddresses = await BlockValidation.fullBlockTxsValidation(finalizedBlock, this.utxoCache, this.memPool, this.workers, this.useDevArgon2);
        this.memPool.addNewKnownPubKeysAddresses(allDiscoveredPubKeysAddresses);
        performance.mark('validation fullTxsValidation end');
        this.blockchainStats.state = "idle";
        return { hashConfInfo, powReward, posReward, totalFees, allDiscoveredPubKeysAddresses };
    }
    /**
     * @param {BlockData} finalizedBlock
     * @param {Object} [options] - Configuration options for the blockchain.
     * @param {boolean} [options.skipValidation] - default: false
     * @param {boolean} [options.broadcastNewCandidate] - default: true
     * @param {boolean} [options.isSync] - default: false
     * @param {boolean} [options.isLoading] - default: false
     * @param {boolean} [options.persistToDisk] - default: true
     * @param {boolean} [options.storeAsFiles] - default: false
     */
    async digestFinalizedBlock(finalizedBlock, options = {}, byteLength) {
        const minerAddress = finalizedBlock.Txs[0].outputs[0].address;
        if ('CpkQiTemFSZH1zyGUKsM' === minerAddress) {
            console.log('minerAddress:', minerAddress);
        }

        this.blockchainStats.state = "digesting finalized block";
        if (this.restartRequested) { return; }
        const blockBytes = byteLength ? byteLength : utils.serializer.block_finalized.toBinary_v4(finalizedBlock).byteLength;
        const {
            skipValidation = false,
            broadcastNewCandidate = true,
            isSync = false,
            isLoading = false,
            persistToDisk = true,
            storeAsFiles = false
        } = options;

        if (!finalizedBlock) { throw new Error('Invalid block candidate'); }
        if (!this.roles.includes('validator')) { throw new Error('Only validator can process PoW block'); }
        if (this.syncHandler.isSyncing && !isSync) { throw new Error("Node is syncing, can't process block"); }

        const startTime = Date.now();

        let validationResult;
        let hashConfInfo = false;
        let totalFees = undefined; // will be recalculated if undefined by: addConfirmedBlocks()
        if (!skipValidation) {
            const vResult = await this.#validateBlockProposal(finalizedBlock, blockBytes); // Can throw an error
            validationResult = vResult;
            hashConfInfo = vResult.hashConfInfo;

            if (!hashConfInfo || !hashConfInfo.conform) {
                //const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0]; // dangerous
                //console.info(`block validator ${validatorAddress} rejected`); 
                throw new Error('Failed to validate block');
            }
        }

        performance.mark('add-confirmed-block');
        if (!skipValidation && (!hashConfInfo || !hashConfInfo.conform)) { throw new Error('Failed to validate block'); }
        const blockInfo = await this.blockchain.addConfirmedBlocks(this.utxoCache, [finalizedBlock], persistToDisk, this.wsCallbacks.onBlockConfirmed, totalFees);

        performance.mark('apply-blocks');
        await this.blockchain.applyBlocks(this.utxoCache, this.vss, [finalizedBlock], this.roles.includes('observer'));

        performance.mark('digest-finalized-blocks');
        this.memPool.digestFinalizedBlocksTransactions([finalizedBlock]);

        performance.mark('store-confirmed-block');
        if (!skipValidation && this.wsCallbacks.onBlockConfirmed) { this.wsCallbacks.onBlockConfirmed.execute(blockInfo); }
        if (storeAsFiles) { this.#storeConfirmedBlock(finalizedBlock); } // Used by developer to check the block data manually

        performance.mark('end');

        //#region - log
        // > 100Mo -- PERFORMANCE LOGS
        if (blockBytes > 102_400 && !skipValidation) {
            console.log(`#${finalizedBlock.index} blockBytes: ${blockBytes} | Txs: ${finalizedBlock.Txs.length} | digest: ${(Date.now() - startTime)}ms`);

            performance.measure('validation height-timestamp-hash', 'validation height-timestamp-hash', 'validation legitimacy');
            performance.measure('validation legitimacy', 'validation legitimacy', 'validation coinbase-rewards');
            performance.measure('validation coinbase-rewards', 'validation coinbase-rewards', 'validation double-spending');
            performance.measure('validation double-spending', 'validation double-spending', 'validation fullTxsValidation');
            performance.measure('validation fullTxsValidation', 'validation fullTxsValidation', 'validation fullTxsValidation end');

            // total validation
            performance.measure('total-validation', 'validation start', 'add-confirmed-block');

            performance.measure('add-confirmed-block', 'add-confirmed-block', 'apply-blocks');
            performance.measure('apply-blocks', 'apply-blocks', 'digest-finalized-blocks');
            performance.measure('digest-finalized-blocks', 'digest-finalized-blocks', 'store-confirmed-block');
            performance.measure('store-confirmed-block', 'store-confirmed-block', 'end');

            performance.measure('total', 'validation start', 'end');

            performance.clearMarks();
        }
        const timeBetweenPosPow = ((finalizedBlock.timestamp - finalizedBlock.posTimestamp) / 1000).toFixed(2);
        const minerId = finalizedBlock.Txs[0].outputs[0].address.slice(0, 6);
        const validatorId = finalizedBlock.Txs[1].outputs[0].address.slice(0, 6);

        //if (isLoading && skipValidation) { console.info(`[NODE-${this.id.slice(0, 6)}] #${finalizedBlock.index} (loading - skipValidation) -> ( diff: ${finalizedBlock.difficulty} ) | processProposal: ${(Date.now() - startTime)}ms`); }
        //if (isLoading && !skipValidation) { console.info(`[NODE-${this.id.slice(0, 6)}] #${finalizedBlock.index} (loading) -> ( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | processProposal: ${(Date.now() - startTime)}ms`); }

        if (isSync && skipValidation) { console.info(`[NODE-${this.id.slice(0, 6)}-BLOCK] #${finalizedBlock.index} (sync - skipValidation) -> ( diff: ${finalizedBlock.difficulty} ) | processProposal: ${(Date.now() - startTime)}ms`); }
        if (isSync && !skipValidation) { console.info(`[NODE-${this.id.slice(0, 6)}-BLOCK] #${finalizedBlock.index} (sync) -> ( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | processProposal: ${(Date.now() - startTime)}ms`); }

        if (!isLoading && !isSync) {
            console.info(`[NODE-${this.id.slice(0, 6)}-BLOCK] #${finalizedBlock.index} -> validator: ${validatorId} | miner: ${minerId}
( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | gap_PosPow: ${timeBetweenPosPow}s | digest: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        }
        //#endregion

        // SNAPSHOT
        if (!isLoading) { await this.#saveSnapshot(finalizedBlock); }

        const waitStart = Date.now();
        const nbOfPeers = await this.#waitSomePeers();
        if (!nbOfPeers || nbOfPeers < 1) { console.error('Failed to connect to peers, stopping the node'); return; }
        if (!broadcastNewCandidate) { return true; }

        this.blockCandidate = await this.#createBlockCandidate();
        if (this.roles.includes('miner')) { this.miner.updateBestCandidate(this.blockCandidate); }
        try {
            // delay before broadcasting the new block candidate to ensure anyone digested the new block
            const delay = Math.max(0, this.delayBeforeSendingCandidate - (Date.now() - waitStart));
            await new Promise(resolve => setTimeout(resolve, delay));
            await this.p2pBroadcast('new_block_candidate', this.blockCandidate);
            if (this.wsCallbacks.onBroadcastNewCandidate) { this.wsCallbacks.onBroadcastNewCandidate.execute(BlockUtils.getBlockHeader(this.blockCandidate)); }
        } catch (error) {
            this.requestRestart('broadcastNewCandidate - error');
            console.error(`Failed to broadcast new block candidate: ${error}`);
        }

        return true;
    }
    /** Aggregates transactions from mempool, creates a new block candidate, signs it and returns it */
    async #createBlockCandidate() {
        const startTime = Date.now();

        const Txs = await this.memPool.getMostLucrativeTransactionsBatch(this.utxoCache);
        const posTimestamp = this.blockchain.lastBlock ? this.blockchain.lastBlock.timestamp + 1 : this.timeSynchronizer.getCurrentTime();

        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.SETTINGS.blockReward, 27, 0, '0000000000000000000000000000000000000000000000000000000000000000', Txs, posTimestamp);
        if (this.blockchain.lastBlock) {
            await this.vss.calculateRoundLegitimacies(this.blockchain.lastBlock.hash);
            const myLegitimacy = this.vss.getAddressLegitimacy(this.account.address);
            if (myLegitimacy === undefined) { throw new Error(`No legitimacy for ${this.account.address}, can't create a candidate`); }

            const olderBlock = await this.blockchain.getBlockByHeight(this.blockchain.lastBlock.index - utils.MINING_PARAMS.blocksBeforeAdjustment);
            const averageBlockTimeMS = utils.mining.calculateAverageBlockTime(this.blockchain.lastBlock, olderBlock);
            this.blockchainStats.averageBlockTime = averageBlockTimeMS;
            const newDifficulty = utils.mining.difficultyAdjustment(this.blockchain.lastBlock, averageBlockTimeMS);
            const coinBaseReward = utils.mining.calculateNextCoinbaseReward(this.blockchain.lastBlock);
            blockCandidate = BlockData(this.blockchain.lastBlock.index + 1, this.blockchain.lastBlock.supply + this.blockchain.lastBlock.coinBase, coinBaseReward, newDifficulty, myLegitimacy, this.blockchain.lastBlock.hash, Txs, posTimestamp);
        }

        // Sign the block candidate
        const { powReward, posReward } = await BlockUtils.calculateBlockReward(this.utxoCache, blockCandidate);
        const posFeeTx = await Transaction_Builder.createPosReward(posReward, blockCandidate, this.validatorRewardAddress, this.account.address);
        const signedPosFeeTx = await this.account.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);
        blockCandidate.powReward = powReward; // for the miner

        if (blockCandidate.Txs.length > 3) { console.info(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${(Date.now() - startTime)}ms`); }
        this.blockchainStats.lastLegitimacy = blockCandidate.legitimacy;
        return blockCandidate;
    }
    /** @param {BlockData} blockData */
    #storeConfirmedBlock(blockData) {
        if (blockData.index >= 1000) { return; }
        // save the block in local storage definitively
        const clone = BlockUtils.cloneBlockData(blockData); // clone to avoid modification
        localStorage_v1.saveBlockDataLocally(this.id, clone, 'json');
        localStorage_v1.saveBlockDataLocally(this.id, clone, 'bin');
    } // Used by developer to check the block data manually

    /** @param {string} topic @param {object} message */
    async p2pHandler(topic, message) {
        // { content: parsedMessage, from, byteLength }
        if (this.syncHandler.isSyncing || this.opStack.syncRequested) { return; }
        const data = message.content;
        const from = message.from;
        const byteLength = message.byteLength;
        //console.log(`[P2P-HANDLER] ${topic} -> ${from} | ${byteLength} bytes`);
        try {
            switch (topic) {
                case 'new_transaction':
                    if (!this.roles.includes('validator')) { break; }
                    this.opStack.push('pushTransaction', {
                        byteLength,
                        utxoCache: this.utxoCache,
                        transaction: data // signedTransaction
                    });
                    break;
                case 'new_block_candidate':
                    if (!this.roles.includes('miner')) { break; }
                    if (!this.roles.includes('validator')) { break; }
                    if (this.miner.highestBlockIndex > data.index) { return; } // avoid processing old blocks
                    if (this.blockCandidate && this.blockCandidate.index > data.index) { return; } // avoid processing old blocks
                    if (this.blockCandidate && this.blockCandidate.index < data.index) { return; } // avoid processing future blocks

                    await this.vss.calculateRoundLegitimacies(data.hash);
                    const validatorAddress = data.Txs[0].inputs[0].split(':')[0];
                    const validatorLegitimacy = this.vss.getAddressLegitimacy(validatorAddress);
                    if (validatorLegitimacy !== data.legitimacy) { return 'Invalid legitimacy!'; }
                    
                    this.miner.updateBestCandidate(data);
                    break;
                case 'new_block_finalized':
                    if (!this.roles.includes('validator')) { break; }
                    this.opStack.push('digestPowProposal', message);
                    break;
                case 'test':
                    console.warn(`[TEST] heavy msg bytes: ${new Uint8Array(Object.values(data)).length}`);
                    break;
                default:
                    console.error(`[P2P-HANDLER] ${topic} -> Unknown topic`);
            }
        } catch (error) {
            console.error(`[P2P-HANDLER] ${topic} -> Failed! `, error);
        }
    }
    /** @param {string} topic @param {any} message */
    async p2pBroadcast(topic, message) { 
        if (topic === 'new_block_finalized') {
            // re send the block -7 for late nodes
            const finalizedBlockHeight = message.index;
            const minusTenBlock = await this.blockchain.getBlockByHeight(finalizedBlockHeight - 7);
            if (minusTenBlock) { await this.p2pNetwork.broadcast(topic, minusTenBlock); }
        }
        return await this.p2pNetwork.broadcast(topic, message); 
    }

    // API -------------------------------------------------------------------------
    getStatus() {
        return {
            id: this.id,
            role: this.roles.join('_'),
            currentBlockHeight: this.blockchain.currentHeight,
            memPoolSize: Object.keys(this.memPool.transactionsByID).length,
            peerCount: this.p2pNetwork.getConnectedPeers().length,
        };
    }
    /** @param {Transaction} transaction */
    async pushTransaction(transaction) {
        try {
            await this.memPool.pushTransaction(this.utxoCache, transaction);
            await this.p2pBroadcast('new_transaction', transaction);
            //console.log(`Tx ${transaction.id} pushed in mempool`);
            const consumedUTXOs = transaction.inputs;
            return { broadcasted: true, pushedInLocalMempool: true, consumedUTXOs, error: null };
        } catch (error) {
            console.error(`Tx ${transaction.id} rejected: ${error.message}`);
            return { broadcasted: false, pushedInLocalMempool: false, consumedUTXOs: [], error: error.message };
        }
    }
    async getBlocksInfo(fromHeight = 0, toHeight = 10) {
        try {
            if (fromHeight > toHeight) { throw new Error(`Invalid range: ${fromHeight} > ${toHeight}`); }
            //if (toHeight - fromHeight > 10) { throw new Error('Cannot retrieve more than 10 blocks at once'); }

            /** @type {BlockInfo[]} */
            const blocksInfo = [];
            for (let i = fromHeight; i <= toHeight; i++) {
                const blockInfo = await this.blockchain.getBlockInfoFromDiskByHeight(i);
                blocksInfo.push(blockInfo);
            }

            return blocksInfo;
        } catch (error) {
            console.error(error);
            return [];
        }
    }
    async getExhaustiveBlocksDataByHeight(fromHeight = 0, toHeight = null) {
        try {
            toHeight = toHeight || fromHeight;
            if (fromHeight > toHeight) { throw new Error(`Invalid range: ${fromHeight} > ${toHeight}`); }
            //if (toHeight - fromHeight > 10) { throw new Error('Cannot retrieve more than 10 blocks at once'); }

            /** @type {BlockData[]} */
            const blocksData = [];
            for (let i = fromHeight; i <= toHeight; i++) {
                const blockData = await this.blockchain.getBlockByHeight(i);
                const blockInfo = await this.blockchain.getBlockInfoFromDiskByHeight(i);

                blocksData.push(this.#exhaustiveBlockFromBlockDataAndInfo(blockData, blockInfo));
            }

            return blocksData;
        } catch (error) {
            console.error(error);
            return [];
        }
    }
    async getExhaustiveBlockDataByHash(hash) {
        try {
            const blockData = await this.blockchain.getBlockByHash(hash);
            const blockInfo = await this.blockchain.getBlockInfoFromDiskByHeight(blockData.index);

            return this.#exhaustiveBlockFromBlockDataAndInfo(blockData, blockInfo);
        } catch (error) {
            console.error(error);
            return null;
        }
    }
    /** @param {BlockData} blockData @param {BlockInfo} blockInfo */
    #exhaustiveBlockFromBlockDataAndInfo(blockData, blockInfo) {
        blockData.powReward = blockData.Txs[0].outputs[0].amount;
        blockData.posReward = blockData.Txs[1].outputs[0].amount;
        blockData.totalFees = blockInfo.totalFees;
        blockData.lowerFeePerByte = blockInfo.lowerFeePerByte;
        blockData.higherFeePerByte = blockInfo.higherFeePerByte;
        blockData.nbOfTxs = blockInfo.nbOfTxs;
        blockData.blockBytes = blockInfo.blockBytes;

        blockData.minerAddress = blockData.Txs[0].outputs[0].address;
        blockData.validatorAddress = blockData.Txs[1].inputs[0].split(':')[0];
        return blockData;
    }
    async getAddressExhaustiveData(address, from = 0, to = this.blockchain.currentHeight) {
        const addressTxsReferences = await this.blockchain.getTxsRefencesOfAddress(this.memPool, address, from, to);
        const addressUTXOs = await this.getAddressUtxos(address);
        return { addressUTXOs, addressTxsReferences };
    }
    /**
     * @param {string} txReference - ex: 12:0f0f0f
     * @param {string} address - optional: also return balanceChange for this address
     */
    async getTransactionByReference(txReference, address = undefined) {
        try {
            if (address) { utils.addressUtils.conformityCheck(address); }
            const result = { transaction: undefined, balanceChange: 0, inAmount: 0, outAmount: 0, fee: 0 };
            const transaction = await this.blockchain.getTransactionByReference(txReference);
            result.transaction = transaction;
            if (address === undefined) { return result; }

            //const addressTxsReferences = await this.blockchain.getTxsRefencesOfAddress(this.memPool, address, 0, untilHeight);
            //if (!addressTxsReferences.includes(txReference)) { return result; }

            for (const output of transaction.outputs) {
                result.outAmount += output.amount;
                if (output.address === address) { result.balanceChange += output.amount; }
            }

            for (const anchor of transaction.inputs) {
                if (!utils.types.anchor.isConform(anchor)) { continue; }
                const txRef = `${anchor.split(":")[0]}:${anchor.split(":")[1]}`;
                const utxoRelatedTx = await this.blockchain.getTransactionByReference(txRef);
                const outputIndex = parseInt(anchor.split(":")[2]);
                const output = utxoRelatedTx.outputs[outputIndex];
                result.inAmount += output.amount;

                //if (!addressTxsReferences.includes(txRef)) { continue; }
                if (output.address !== address) { continue; }

                result.balanceChange -= output.amount;
            }

            result.fee = result.inAmount === 0 ? 0 : result.inAmount - result.outAmount;

            return result;
        } catch (error) {
            console.error(error);
            return { transaction: undefined, balanceChange: undefined };
        }
    }
    async getAddressUtxos(address) {
        const addressAnchors = this.utxoCache.getAddressAnchorsArray(address);
        let spendableBalance = 0;
        let balance = 0;
        const UTXOs = [];
        for (const anchor of addressAnchors) {
            const associatedMemPoolTx = this.memPool.transactionByAnchor[anchor];
            if (associatedMemPoolTx) { continue; } // pending spent UTXO

            const utxo = await this.utxoCache.getUTXO(anchor);
            if (!utxo) { console.error(`UTXO not removed from AddressAnchors: ${anchor}`); continue; } // should not happen
            if (utxo.spent) { console.error(`UTXO spent but not removed from AddressAnchors: ${anchor}`); continue; } // should not happen

            balance += utxo.amount;
            UTXOs.push(utxo);

            if (utxo.rule === "sigOrSlash") { continue; }
            spendableBalance += utxo.amount;
        }

        return { spendableBalance, balance, UTXOs };
    }
    async getAddressUtxosOnly(address) {
        const addressAnchors = this.utxoCache.getAddressAnchorsArray(address);
        const UTXOs = [];
        for (const anchor of addressAnchors) {
            const associatedMemPoolTx = this.memPool.transactionByAnchor[anchor];
            if (associatedMemPoolTx) { continue; } // pending spent UTXO

            const utxo = await this.utxoCache.getUTXO(anchor);
            if (!utxo) { console.error(`UTXO not removed from AddressAnchors: ${anchor}`); continue; } // should not happen
            if (utxo.spent) { console.error(`UTXO spent but not removed from AddressAnchors: ${anchor}`); continue; } // should not happen

            UTXOs.push(utxo);
        }
        return UTXOs;
    }
}