import { BlockData, BlockUtils } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./account.mjs").Account} Account
 * @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
 * @typedef {import("./opStack.mjs").OpStack} OpStack
 * @typedef {import("./websocketCallback.mjs").WebSocketCallBack} WebSocketCallBack
 * @typedef {import("./time.mjs").TimeSynchronizer} TimeSynchronizer
 */

export class Miner {
    /** @param {Account} address @param {P2PNetwork} p2pNetwork */
    constructor(address, p2pNetwork, roles = ['miner'], opStack = null, timeSynchronizer = null) {
        this.terminated = false;
        this.address = address;
        this.p2pNetwork = p2pNetwork;
        this.roles = roles;
        this.opStack = opStack;
        this.timeSynchronizer = timeSynchronizer;

        // Mining state
        this.candidates = [];
        this.bestCandidate = null;
        this.bestCandidateChanged = false;
        this.highestBlockIndex = -1;
        this.preshotedPowBlock = null;
        this.addressOfCandidatesBroadcasted = new Set();

        // Worker management
        this.workers = new Map(); // Map<number, Worker>
        this.nbOfWorkers = 1;

        // Performance tracking
        this.hashRate = 0;
        this.hashStats = {
            count: 0,
            periodStart: Date.now(),
            rates: [],
            maxRateHistory: 10
        };

        // Betting configuration
        this.bets = new Map();
        this.betRange = { min: 0.4, max: 0.8 };

        // Broadcast control
        this.powBroadcastState = {
            foundHeight: -1,
            sentTryCount: 0,
            maxTryCount: 3
        };

        // Callbacks
        this.wsCallbacks = {};
    }

    /**
     * Initializes a new worker with proper event handling
     * @returns {Promise<{worker: Worker, id: number}>}
     */
    async initializeWorker() {
        return new Promise((resolve, reject) => {
            try {
                const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
                const id = this.workers.size;

                worker.on('message', (message) => this.handleWorkerMessage(id, message));
                //worker.on('error', (error) => this.handleWorkerError(id, error));
                //worker.on('exit', (code) => this.handleWorkerExit(id, code));

                this.workers.set(id, {
                    instance: worker,
                    status: 'free'
                });

                console.log(`[MINER] Worker ${id} initialized`);
                resolve({ worker, id });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handles messages received from workers
     * @param {number} workerId 
     * @param {any} message 
     */
    async handleWorkerMessage(workerId, message) {
        try {
            if (message.error) {
                throw new Error(message.error);
            }

            this.updateHashRate();
            if (message.type === 'hash') {
                return;
            }

            const finalizedBlock = message.blockCandidate;
            const { conform } = utils.mining.verifyBlockHashConformToDifficulty(
                message.bitsArrayAsString,
                finalizedBlock
            );

            if (!conform) {
                this.setWorkerStatus(workerId, 'free');
                return;
            }

            await this.handleValidBlock(finalizedBlock, workerId);
        } catch (error) {
            console.error(`[MINER] Worker ${workerId} message handling error:`, error);
            this.setWorkerStatus(workerId, 'free');
        }
    }

    /**
     * Updates worker status
     * @param {number} workerId 
     * @param {'free' | 'busy'} status 
     */
    setWorkerStatus(workerId, status) {
        const workerData = this.workers.get(workerId);
        if (workerData) {
            workerData.status = status;
        }
    }

    /**
     * Handles a valid block found by a worker
     * @param {BlockData} finalizedBlock 
     * @param {number} workerId 
     */
    async handleValidBlock(finalizedBlock, workerId) {
        const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0];

        // Remove block from candidates if it exists
        const candidateIndex = this.candidates.findIndex(candidate =>
            candidate.index === finalizedBlock.index &&
            candidate.Txs[0].inputs[0].split(':')[0] === validatorAddress
        );

        if (candidateIndex === -1) {
            console.info(`[MINER] POW found for block (Height: ${finalizedBlock.index}, validator: ${validatorAddress}) but already found one, aborting...`);
            this.setWorkerStatus(workerId, 'free');
            return;
        }

        this.candidates.splice(candidateIndex, 1);

        if (finalizedBlock.timestamp <= this.timeSynchronizer.getCurrentTime()) {
            await this.broadcastBlockCandidate(finalizedBlock);
        } else {
            this.preshotedPowBlock = finalizedBlock;
            this.bets.set(finalizedBlock.index, 1); // Prevent betting on same block
        }

        this.setWorkerStatus(workerId, 'free');
    }

    /**
     * Updates the hash rate statistics
     */
    updateHashRate() {
        this.hashStats.count++;
        const hashesBeforeUpdate = 25;

        if (this.hashStats.count < hashesBeforeUpdate) {
            return;
        }

        const timeSpent = (Date.now() - this.hashStats.periodStart) / 1000;
        const currentRate = this.hashStats.count / timeSpent;

        this.hashStats.rates.push(currentRate);
        if (this.hashStats.rates.length > this.hashStats.maxRateHistory) {
            this.hashStats.rates.shift();
        }

        this.hashRate = this.hashStats.rates.reduce((acc, rate) => acc + rate, 0) /
            this.hashStats.rates.length;

        this.hashStats.count = 0;
        this.hashStats.periodStart = Date.now();

        if (this.wsCallbacks.onHashRateUpdated) {
            this.wsCallbacks.onHashRateUpdated.execute(this.hashRate);
        }
    }

    /**
     * Manages worker lifecycle
     */
    async manageWorkers() {
        const currentWorkerCount = this.workers.size;

        if (currentWorkerCount < this.nbOfWorkers) {
            const workersToAdd = this.nbOfWorkers - currentWorkerCount;
            for (let i = 0; i < workersToAdd; i++) {
                await this.initializeWorker();
            }
        } else if (currentWorkerCount > this.nbOfWorkers) {
            const workersToRemove = currentWorkerCount - this.nbOfWorkers;
            const workerIds = Array.from(this.workers.keys()).slice(-workersToRemove);

            for (const id of workerIds) {
                await this.terminateWorker(id);
            }
        }
    }

    /**
     * Terminates a specific worker
     * @param {number} workerId 
     */
    async terminateWorker(workerId) {
        const workerData = this.workers.get(workerId);
        if (!workerData) return;

        workerData.instance.postMessage({ type: 'terminate' });
        this.workers.delete(workerId);
        console.log(`[MINER] Worker ${workerId} terminated`);
    }

    /**
     * Starts the mining process
     */
    async start() {
        while (!this.terminated) {
            try {
                await this.miningCycle();
            } catch (error) {
                console.error('[MINER] Mining cycle error:', error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.info(`[MINER-${this.address.slice(0, 6)}] Stopped`);
    }

    /**
     * Executes a single mining cycle
     */
    async miningCycle() {
        const delayBetweenMining = this.roles.includes('validator') ? 20 : 10;
        await new Promise(resolve => setTimeout(resolve, delayBetweenMining));

        await this.checkPreshotedBlock();
        await this.manageWorkers();

        if (!this.bestCandidate) return;

        if (this.bestCandidateChanged) {
            await this.notifyWorkersOfNewCandidate();
            this.bestCandidateChanged = false;
        }

        await this.assignWorkToIdleWorkers();
    }

    /**
     * Checks and processes preshoted blocks
     */
    async checkPreshotedBlock() {
        if (!this.preshotedPowBlock) return;

        const readyToSend = this.preshotedPowBlock.timestamp <=
            this.timeSynchronizer.getCurrentTime();

        if (readyToSend) {
            await this.broadcastBlockCandidate(this.preshotedPowBlock);
            this.preshotedPowBlock = null;
        }
    }

    /**
     * Notifies all workers of a new candidate
     */
    async notifyWorkersOfNewCandidate() {
        for (const [id, workerData] of this.workers) {
            workerData.instance.postMessage({
                id,
                type: 'newCandidate',
                blockCandidate: this.bestCandidate
            });
        }
    }

    /**
     * Assigns work to idle workers
     */
    async assignWorkToIdleWorkers() {
        for (const [id, workerData] of this.workers) {
            if (workerData.status !== 'free') continue;

            workerData.status = 'busy';
            workerData.instance.postMessage({
                id,
                type: 'mineUntilValid',
                rewardAddress: this.address,
                bet: this.bets.get(this.bestCandidate.index),
                timeOffset: this.timeSynchronizer.offset,
                blockCandidate: this.bestCandidate
            });
        }
    }

    /**
     * Terminates all mining operations
     */
    async terminate() {
        this.terminated = true;
        for (const [id] of this.workers) {
            await this.terminateWorker(id);
        }
    }

    /**
     * Pushes a new block candidate for mining consideration
     * @param {BlockData} blockCandidate 
     */
    async pushCandidate(blockCandidate) {
        try {
            const validatorAddress = this.getValidatorAddress(blockCandidate);

            if (!this.isValidBlockHeight(blockCandidate)) {
                return;
            }

            if (this.isDuplicateCandidate(blockCandidate, validatorAddress)) {
                return;
            }

            if (!this.validateRewards(blockCandidate)) {
                return;
            }

            await this.handleNewCandidate(blockCandidate, validatorAddress);
        } catch (error) {
            console.error('[MINER] Error pushing candidate:', error);
        }
    }

    /**
     * Gets the validator address from a block candidate
     * @param {BlockData} blockCandidate 
     * @returns {string}
     */
    getValidatorAddress(blockCandidate) {
        return blockCandidate.Txs[0].inputs[0].split(':')[0];
    }

    /**
     * Validates block height against current state
     * @param {BlockData} blockCandidate 
     * @returns {boolean}
     */
    isValidBlockHeight(blockCandidate) {
        if (blockCandidate.index > this.highestBlockIndex + 1) {
            console.info(`[MINER] Invalid block candidate pushed (Height: ${blockCandidate.index}) | blockCandidate.index > lastBlockIndex + 1`);
            return true;
        }
        return true;
    }

    /**
     * Checks if candidate is already being processed
     * @param {BlockData} blockCandidate 
     * @param {string} validatorAddress 
     * @returns {boolean}
     */
    isDuplicateCandidate(blockCandidate, validatorAddress) {
        return this.candidates.some(candidate =>
            candidate.index === blockCandidate.index &&
            this.getValidatorAddress(candidate) === validatorAddress
        );
    }

    /**
     * Validates POS and POW rewards
     * @param {BlockData} blockCandidate 
     * @returns {boolean}
     */
    validateRewards(blockCandidate) {
        const posReward = blockCandidate.Txs[0].outputs[0].amount;
        const powReward = blockCandidate.powReward;

        if (!posReward || !powReward) {
            console.info(`[MINER] Invalid block candidate rewards (Height: ${blockCandidate.index}) | posReward = ${posReward} | powReward = ${powReward}`);
            return false;
        }

        if (Math.abs(posReward - powReward) > 1) {
            console.info(`[MINER] Invalid reward difference (Height: ${blockCandidate.index}) | posReward = ${posReward} | powReward = ${powReward}`);
            return false;
        }

        return true;
    }

    /**
     * Handles processing of a new valid candidate
     * @param {BlockData} blockCandidate 
     * @param {string} validatorAddress 
     */
    async handleNewCandidate(blockCandidate, validatorAddress) {
        if (blockCandidate.index > this.highestBlockIndex) {
            await this.handleNewHeight(blockCandidate);
        }

        console.info(`[MINER] New block candidate pushed (Height: ${blockCandidate.index} | validator: ${validatorAddress.slice(0, 6)})`);
        this.candidates.push(blockCandidate);

        const mostLegitimateCandidate = this.getMostLegitimateBlockCandidate();
        if (!mostLegitimateCandidate) {
            return console.info(`[MINER] No legitimate block candidate found`);
        }

        const changed = this.setBestCandidateIfChanged(mostLegitimateCandidate);
        if (changed && this.wsCallbacks.onBestBlockCandidateChange) {
            this.wsCallbacks.onBestBlockCandidateChange.execute(mostLegitimateCandidate);
        }
    }

    /**
     * Handles logic when a new block height is encountered
     * @param {BlockData} blockCandidate 
     */
    async handleNewHeight(blockCandidate) {
        this.preshotedPowBlock = null;
        this.bets.set(
            blockCandidate.index,
            this.calculateBetTime(blockCandidate.index)
        );
        this.highestBlockIndex = blockCandidate.index;
        this.cleanupCandidates();
        this.addressOfCandidatesBroadcasted.clear();
    }

    /**
     * Calculates betting time for block mining
     * @param {number} blockIndex 
     * @returns {number}
     */
    calculateBetTime(blockIndex) {
        const targetBlockTime = utils.SETTINGS.targetBlockTime;
        const betBasis = targetBlockTime * this.betRange.min;
        const betRandom = Math.random() * (this.betRange.max - this.betRange.min) * targetBlockTime;
        return Math.floor(betBasis + betRandom);
    }

    /**
     * Cleans up old candidates to prevent memory bloat
     * @param {number} heightTolerance 
     */
    cleanupCandidates(heightTolerance = 6) {
        this.candidates = this.candidates.filter(
            candidate => this.highestBlockIndex - candidate.index <= heightTolerance
        );
    }

    /**
     * Gets the most legitimate block candidate
     * @returns {BlockData | null}
     */
    getMostLegitimateBlockCandidate() {
        if (this.candidates.length === 0) {
            return null;
        }

        const currentHeightCandidates = this.candidates.filter(
            candidate => candidate.index === this.highestBlockIndex
        );

        return currentHeightCandidates.sort(
            (a, b) => a.legitimacy - b.legitimacy
        )[0];
    }

    /**
     * Updates the best candidate if changed
     * @param {BlockData} candidate 
     * @returns {boolean}
     */
    setBestCandidateIfChanged(candidate) {
        if (!this.bestCandidate) {
            this.bestCandidate = candidate;
            this.bestCandidateChanged = true;
            return true;
        }

        const candidateValidator = this.getValidatorAddress(candidate);
        const bestCandidateValidator = this.getValidatorAddress(this.bestCandidate);

        const heightChanged = this.bestCandidate.index !== candidate.index;
        const validatorChanged = bestCandidateValidator !== candidateValidator;

        if (!heightChanged && !validatorChanged) {
            return false;
        }

        console.info(`[MINER] Best block candidate changed:
    from #${this.bestCandidate.index} | leg: ${this.bestCandidate.legitimacy}
    to #${candidate.index} | leg: ${candidate.legitimacy}`);

        this.bestCandidate = candidate;
        this.bestCandidateChanged = true;
        return true;
    }

    /**
     * Prepares a block candidate for mining
     * @param {BlockData} blockCandidate 
     * @returns {Promise<{signatureHex: string, nonce: string, clonedCandidate: BlockData}>}
     */
    async prepareBlockCandidateForMining(blockCandidate) {
        const clonedCandidate = BlockUtils.cloneBlockData(blockCandidate);

        const headerNonce = utils.mining.generateRandomNonce().Hex;
        const coinbaseNonce = utils.mining.generateRandomNonce().Hex;

        clonedCandidate.nonce = headerNonce;
        clonedCandidate.timestamp = Math.max(
            clonedCandidate.posTimestamp + 1 + this.bets.get(clonedCandidate.index),
            this.timeSynchronizer.getCurrentTime()
        );

        const powReward = blockCandidate.powReward;
        delete clonedCandidate.powReward;

        const coinbaseTx = await Transaction_Builder.createCoinbase(
            coinbaseNonce,
            this.address,
            powReward
        );

        BlockUtils.setCoinbaseTransaction(clonedCandidate, coinbaseTx);
        const signatureHex = await BlockUtils.getBlockSignature(clonedCandidate);
        const nonce = `${headerNonce}${coinbaseNonce}`;

        return { signatureHex, nonce, clonedCandidate };
    }

    /**
     * Broadcasts a finalized block to the network
     * @param {BlockData} finalizedBlock 
     */
    async broadcastBlockCandidate(finalizedBlock) {
        try {
            if (this.highestBlockIndex > finalizedBlock.index) {
                return;
            }

            const validatorAddress = this.getValidatorAddress(finalizedBlock);
            if (this.addressOfCandidatesBroadcasted.has(validatorAddress)) {
                return;
            }

            if (!this.shouldBroadcastBlock(finalizedBlock)) {
                return;
            }

            await this.performBlockBroadcast(finalizedBlock, validatorAddress);
        } catch (error) {
            console.error('[MINER] Error broadcasting block candidate:', error);
        }
    }

    /**
     * Determines if block should be broadcast
     * @param {BlockData} finalizedBlock 
     * @returns {boolean}
     */
    shouldBroadcastBlock(finalizedBlock) {
        const isNewHeight = finalizedBlock.index > this.powBroadcastState.foundHeight;
        const maxTryReached = this.powBroadcastState.sentTryCount >= this.powBroadcastState.maxTryCount;

        if (maxTryReached && !isNewHeight) {
            console.warn(`[MINER-${this.address.slice(0, 6)}] Max try reached for block (Height: ${finalizedBlock.index})`);
            return false;
        }

        if (isNewHeight) {
            this.powBroadcastState.sentTryCount = 0;
        }

        this.powBroadcastState.foundHeight = finalizedBlock.index;
        this.powBroadcastState.sentTryCount++;

        return true;
    }

    /**
     * Performs the actual block broadcast
     * @param {BlockData} finalizedBlock 
     * @param {string} validatorAddress 
     */
    async performBlockBroadcast(finalizedBlock, validatorAddress) {
        console.info(`[MINER-${this.address.slice(0, 6)}] SENDING: Block finalized (Height: ${finalizedBlock.index}) | Diff = ${finalizedBlock.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(finalizedBlock.coinBase)} | validatorAddress: ${validatorAddress}`);

        this.addressOfCandidatesBroadcasted.add(validatorAddress);
        await this.p2pNetwork.broadcast('new_block_finalized', finalizedBlock);

        if (this.roles.includes('validator')) {
            this.opStack.pushFirst('digestPowProposal', finalizedBlock);
        }

        if (this.wsCallbacks.onBroadcastFinalizedBlock) {
            this.wsCallbacks.onBroadcastFinalizedBlock.execute(
                BlockUtils.getBlockHeader(finalizedBlock)
            );
        }
    }
}
