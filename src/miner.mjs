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
        this.version = 1;
        this.useBetTimestamp = true;

        /** @type {string} */
        this.address = address;
        /** @type {BlockData[]} */
        this.candidates = [];
        /** @type {BlockData | null} */
        this.bestCandidate = null;
        this.bestCandidateChanged = false;
        this.addressOfCandidatesBroadcasted = [];
        /** @type {P2PNetwork} */
        this.p2pNetwork = p2pNetwork;

        this.highestBlockIndex = -1;
        this.useDevArgon2 = false;
        /** @type {Worker[]} */
        this.workers = [];
        /** @type {Worker[]} */
        this.idleWorkers = []; // used in v2 only
        this.nbOfWorkers = 1;

        /** @type {Object<string, number>} */
        this.bets = {};
        /** @type {{min: number, max: number}} */
        this.betRange = { min: .4, max: .8 }; // will bet between 40% and 80% of the expected blockTime
        /** @type {BlockData | null} */
        this.preshotedPowBlock = null;
        this.powBroadcastState = { foundHeight: -1, sentTryCount: 0, maxTryCount: 3 };

        this.roles = roles;
        this.canProceedMining = true;
        this.hashPeriodStart = 0;
        this.hashCount = 0;
        this.hashTimings = [];
        this.hashRates = [];
        this.hashRate = 0; // hash rate in H/s
        /** @type {OpStack} */
        this.opStack = opStack; // only for multiNode (validator + miner)
        /** @type {TimeSynchronizer} */
        this.timeSynchronizer = timeSynchronizer;

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
    }

    /** @param {BlockData} blockCandidate */
    pushCandidate(blockCandidate) {
        const validatorAddress = blockCandidate.Txs[0].inputs[0].split(':')[0];
        /*if (this.highestBlockIndex !== -1 && blockCandidate.index > this.highestBlockIndex + 1) {
            console.info(`[MINER] Invalid block candidate pushed (Height: ${blockCandidate.index}) | blockCandidate.index > lastBlockIndex + 1`);
            return;
        }*/

        // check if block is already in the candidates
        const index = this.candidates.findIndex(candidate => candidate.index === blockCandidate.index && candidate.Txs[0].inputs[0].split(':')[0] === validatorAddress);
        if (index !== -1) { return; }

        // check if powReward is coherent
        const posReward = blockCandidate.Txs[0].outputs[0].amount;
        const powReward = blockCandidate.powReward;
        if (!posReward || !powReward) { console.info(`[MINER] Invalid block candidate pushed (Height: ${blockCandidate.index}) | posReward = ${posReward} | powReward = ${powReward}`); return; }
        if (Math.abs(posReward - powReward) > 1) { console.info(`[MINER] Invalid block candidate pushed (Height: ${blockCandidate.index}) | posReward = ${posReward} | powReward = ${powReward} | Math.abs(posReward - powReward) > 1`); return; }

        // check if block is higher than the highest block
        if (blockCandidate.index > this.highestBlockIndex) {
            this.preshotedPowBlock = null; // reset preshoted block
            this.bets[blockCandidate.index] = this.useBetTimestamp ? this.#betOnTimeToPow() : 0; // bet on time to pow
            this.highestBlockIndex = blockCandidate.index;
            this.#cleanupCandidates();
            this.addressOfCandidatesBroadcasted = [];
        }

        console.info(`[MINER] New block candidate pushed (Height: ${blockCandidate.index} | validator: ${validatorAddress.slice(0,6)})`);
        this.candidates.push(blockCandidate);

        const mostLegBlockCandidate = this.#getMostLegitimateBlockCandidate();
        if (!mostLegBlockCandidate) { return console.info(`[MINER] No legitimate block candidate found`); }

        const changed = this.#setBestCandidateIfChanged(mostLegBlockCandidate);
        if (!changed) { return; }

        if (this.wsCallbacks.onBestBlockCandidateChange) {
            this.wsCallbacks.onBestBlockCandidateChange.execute(mostLegBlockCandidate);
        }
    }
    /** @param {BlockData} blockCandidate */
    async #prepareBlockCandidateBeforeMining(blockCandidate) {
        //let time = performance.now();
        const clonedCandidate = BlockUtils.cloneBlockData(blockCandidate);
        //console.log(`prepareNextBlock: ${performance.now() - time}ms`); time = performance.now();

        const headerNonce = utils.mining.generateRandomNonce().Hex;
        const coinbaseNonce = utils.mining.generateRandomNonce().Hex;
        clonedCandidate.nonce = headerNonce;
        clonedCandidate.timestamp = Math.max(clonedCandidate.posTimestamp + 1 + this.bets[clonedCandidate.index], this.timeSynchronizer.getCurrentTime());
        //console.log(`generateRandomNonce: ${performance.now() - time}ms`); time = performance.now();

        const powReward = blockCandidate.powReward;
        delete clonedCandidate.powReward;
        const coinbaseTx = await Transaction_Builder.createCoinbase(coinbaseNonce, this.address, powReward);
        //console.log(`createCoinbase: ${performance.now() - time}ms`); time = performance.now();
        BlockUtils.setCoinbaseTransaction(clonedCandidate, coinbaseTx);
        //console.log(`setCoinbaseTransaction: ${performance.now() - time}ms`); time = performance.now();

        const signatureHex = await BlockUtils.getBlockSignature(clonedCandidate);
        const nonce = `${headerNonce}${coinbaseNonce}`;
        //console.log(`getBlockSignature: ${performance.now() - time}ms`); time = performance.now();

        return { signatureHex, nonce, clonedCandidate };
    }
    #betOnTimeToPow() {
        const targetBlockTime = utils.SETTINGS.targetBlockTime;
        const betBasis = targetBlockTime * this.betRange.min;
        const betRandom = Math.random() * (this.betRange.max - this.betRange.min) * targetBlockTime;
        const bet = betBasis + betRandom;

        return Math.floor(bet);
    }
    #cleanupCandidates(heightTolerance = 6) {
        // remove candidates with height tolerance, to avoid memory leak
        const minimumHeight = this.highestBlockIndex - heightTolerance;
        const cleanedCandidates = this.candidates.filter(candidate => candidate.index >= minimumHeight);
        this.candidates = cleanedCandidates;
    }
    #getMostLegitimateBlockCandidate() {
        if (this.candidates.length === 0) { return null; }

        const filteredCandidates = this.candidates.filter(candidate => candidate.index === this.highestBlockIndex);
        // the lower the legitimacy, the more legitimate the block is, 0 is the most legitimate
        const sortedCandidates = filteredCandidates.sort((a, b) => a.legitimacy - b.legitimacy);
        return sortedCandidates[0];
    }
    #setBestCandidateIfChanged(bestCandidate) {
        if (this.bestCandidate !== null) {
            const candidateValidatorAddress = bestCandidate.Txs[0].inputs[0].split(':')[0];
            const bestCandidateValidatorAddress = this.bestCandidate.Txs[0].inputs[0].split(':')[0];

            const bestCandidateIndexChanged = this.bestCandidate.index !== bestCandidate.index;
            const bestCandidateValidatorAddressChanged = bestCandidateValidatorAddress !== candidateValidatorAddress;
            if (!bestCandidateIndexChanged && !bestCandidateValidatorAddressChanged) { return false; }
        }

        console.info(`[MINER] Best block candidate changed:
from #${this.bestCandidate ? this.bestCandidate.index : null} | leg: ${this.bestCandidate ? this.bestCandidate.legitimacy : null}
to #${bestCandidate.index} | leg: ${bestCandidate.legitimacy}`);

        this.bestCandidate = bestCandidate;
        this.bestCandidateChanged = true;

        return true;
    }
    /** @param {number} hashTime - ms */
    #hashRateNew(hashTime = 50, hashBeforeAveraging = 20) { // DEPRECATED
        this.hashTimings.push(hashTime);
        if (this.hashTimings.length < hashBeforeAveraging) { return; } // wait for 10 hash timings to be collected

        const hashRate = this.hashTimings.length > 0
        ? 1000 / (this.hashTimings.reduce((acc, timing) => acc + timing, 0) / this.hashTimings.length)
        : 0; // convert to seconds
        this.hashRate = hashRate;
        this.hashTimings = [];
        if (this.wsCallbacks.onHashRateUpdated) { this.wsCallbacks.onHashRateUpdated.execute(hashRate); }
    }
    #hashRateNewHash(hashBeforeAveraging = 10, nbOfHashrateToKeepForAverage = 1) {//this.nbOfWorkers) {
        this.hashCount++;
        //console.log(`count: ${this.hashCount} | nbOfWorkers: ${this.workers.length}`);
        if (this.hashCount < hashBeforeAveraging) { return; }

        const timeSpent = (Date.now() - this.hashPeriodStart) / 1000;
        const hashRate = this.hashCount / timeSpent;

        this.hashRates.push(hashRate);
        this.hashRate = this.hashRates.reduce((acc, rate) => acc + rate, 0) / this.hashRates.length;

        if (this.hashRates.length > nbOfHashrateToKeepForAverage) { this.hashRates.shift(); }
        this.hashCount = 0;
        this.hashPeriodStart = Date.now();
    }
    /** @param {BlockData} finalizedBlock */
    async broadcastBlockCandidate(finalizedBlock) {
        // Avoid sending the block pow if a higher block candidate is available to be mined
        if (this.highestBlockIndex > finalizedBlock.index) { return; }
        const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0];
        if (this.addressOfCandidatesBroadcasted.includes(validatorAddress)) { return; }

        // Avoid sending the same block multiple times
        const isNewHeight = finalizedBlock.index > this.powBroadcastState.foundHeight;
        const maxTryReached = this.powBroadcastState.sentTryCount >= this.powBroadcastState.maxTryCount;
        if (maxTryReached && !isNewHeight) { console.warn(`[MINER-${this.address.slice(0, 6)}] Max try reached for block (Height: ${finalizedBlock.index})`); return; }
        
        if (isNewHeight) { this.powBroadcastState.sentTryCount = 0; }
        this.powBroadcastState.foundHeight = finalizedBlock.index;
        this.powBroadcastState.sentTryCount++;

        console.info(`[MINER-${this.address.slice(0, 6)}] SENDING: Block finalized (Height: ${finalizedBlock.index}) | Diff = ${finalizedBlock.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(finalizedBlock.coinBase)} | validatorAddress: ${validatorAddress}`);
        
        this.addressOfCandidatesBroadcasted.push(validatorAddress);
        await this.p2pNetwork.broadcast('new_block_finalized', finalizedBlock);

        if (this.roles.includes('validator')) { this.opStack.pushFirst('digestPowProposal', finalizedBlock); };
        if (this.wsCallbacks.onBroadcastFinalizedBlock) { this.wsCallbacks.onBroadcastFinalizedBlock.execute(BlockUtils.getBlockHeader(finalizedBlock)); }
    }
    async #createMissingWorkers(workersStatus = []) {
        const missingWorkers = this.nbOfWorkers - this.workers.length;

        for (let i = 0; i < missingWorkers; i++) {
            const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
            worker.on('message', (message) => {
                try {
                    if (message.error) { throw new Error(message.error); }
                    this.#hashRateNewHash();
                    if (message.type === 'hash') { return; }

                    /** @type {BlockData} */
                    const finalizedBlock = message.blockCandidate;
                    const { conform } = utils.mining.verifyBlockHashConformToDifficulty(message.bitsArrayAsString, finalizedBlock);
                    if (!conform) { workersStatus[message.id] = 'free'; return; }

                    // remove the block from the candidates
                    const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0];
                    const index = this.candidates.findIndex(candidate => candidate.index === finalizedBlock.index && candidate.Txs[0].inputs[0].split(':')[0] === validatorAddress);
                    if (index !== -1) {
                        this.candidates.splice(index, 1);
                    } else {
                        console.info(`[MINER] POW found for block (Height: ${finalizedBlock.index}, validator: ${validatorAddress}) but already found one, aborting...`);
                        workersStatus[message.id] = 'free';
                        return;
                    }

                    if (finalizedBlock.timestamp <= this.timeSynchronizer.getCurrentTime()) { // if block is ready to be broadcasted
                        this.broadcastBlockCandidate(finalizedBlock);
                    } else { // if block is not ready to be broadcasted (pre-shoted)
                        this.preshotedPowBlock = finalizedBlock;
                        this.bets[finalizedBlock.index] = 1; // avoid betting on the same block
                    }
                } catch (err) {
                    console.error(err);
                }
                workersStatus[message.id] = 'free';
            });
            worker.on('exit', (code) => { console.log(`[MINER] Worker stopped with exit code ${code}`); });
            worker.on('close', () => { console.log('[MINER] Worker closed'); });

            this.workers.push(worker);
            workersStatus.push('free');
            console.log(`[MINER] Worker ${this.workers.length} started`);
        }
    }
    async #stopWorkersIfNotNeeded(workersStatus = []) {
        const nbOfWorkers = this.nbOfWorkers;
        const workersLength = this.workers.length;
        if (workersLength <= nbOfWorkers) { return; }

        for (let i = nbOfWorkers; i < workersLength; i++) {
            const worker = this.workers[i];
            worker.postMessage({ type: 'terminate' });
            this.workers.splice(i, 1);
            workersStatus.splice(i, 1);
            console.log(`Worker ${i} terminated`);
        }
    }
    /** DON'T AWAIT THIS FUNCTION */
    async startWithWorker() { // DEPRECATED
        const workersStatus = [];
        //let loopIteration = 0;
        while (!this.terminated) {
            //loopIteration++;
            // if modulo 100
            //if (loopIteration % 100 === 0) { console.info(`[MINER-${this.address.slice(0, 6)}] Loop iteration: ${loopIteration}`); }
            const startTimestamp = Date.now();
            const delayBetweenMining = this.roles.includes('validator') ? 20 : 10;
            await new Promise((resolve) => setTimeout(resolve, delayBetweenMining));

            const preshotedPowReadyToSend = this.preshotedPowBlock ? this.preshotedPowBlock.timestamp <= this.timeSynchronizer.getCurrentTime() : false;
            if (preshotedPowReadyToSend) {
                this.broadcastBlockCandidate(this.preshotedPowBlock);
                this.preshotedPowBlock = null;
            }

            if (!this.canProceedMining) { continue; }

            await this.#createMissingWorkers(workersStatus);

            const id = workersStatus.slice(0, this.nbOfWorkers).indexOf('free');
            if (id === -1) { continue; }

            //const blockCandidate = this.#getMostLegitimateBlockCandidate();
            const blockCandidate = this.bestCandidate;
            if (!blockCandidate) { continue; }

            //this.#setBestCandidateIfChanged(blockCandidate);
            workersStatus[id] = 'busy';
            
            const { signatureHex, nonce, clonedCandidate } = await this.#prepareBlockCandidateBeforeMining(blockCandidate);
            this.workers[id].postMessage({ type: 'mine', blockCandidate: clonedCandidate, signatureHex, nonce, id, useDevArgon2: this.useDevArgon2 });
            
            const endTimestamp = Date.now();
            const timeSpent = endTimestamp - startTimestamp;
            //console.info(`[MINER-${this.address.slice(0, 6)}] timeSpent: ${timeSpent}ms`);
        }

        console.info(`[MINER-${this.address.slice(0, 6)}] Stopped`);
    }
    async startWithAutoWorker() {
        const workersStatus = [];
        let pausedWorkers = [];
        let workersPaused = false;
        while (!this.terminated) {
            const delayBetweenMining = this.roles.includes('validator') ? 20 : 10;
            await new Promise((resolve) => setTimeout(resolve, delayBetweenMining));

            const preshotedPowReadyToSend = this.preshotedPowBlock ? this.preshotedPowBlock.timestamp <= this.timeSynchronizer.getCurrentTime() : false;
            if (preshotedPowReadyToSend) {
                this.broadcastBlockCandidate(this.preshotedPowBlock);
                this.preshotedPowBlock = null;
            }

            if (!this.bestCandidate) { continue; }

            /*if (!this.canProceedMining) {
                if (pausedWorkers.length !== 0) { continue; }
                for (let i = 0; i < this.workers.length; i++) {
                    const worker = this.workers[i];
                    worker.postMessage({ type: 'pause' });
                    pausedWorkers.push(i);
                }
                continue;
            }

            for (let i = 0; i < pausedWorkers.length; i++) {
                const worker = this.workers[pausedWorkers[i]];
                worker.postMessage({ type: 'resume' });
            }

            pausedWorkers = [];*/
            await this.#createMissingWorkers(workersStatus);
            await this.#stopWorkersIfNotNeeded(workersStatus);
            
            if (this.bestCandidateChanged) {
                for (let i = 0; i < this.workers.length; i++) {
                    this.workers[i].postMessage({ id: i, type: 'newCandidate', blockCandidate: this.bestCandidate });
                }
                this.bestCandidateChanged = false;
            }

            while(true) {
                const id = workersStatus.slice(0, this.nbOfWorkers).indexOf('free');
                if (id === -1) { break; }

                workersStatus[id] = 'busy';
                this.workers[id].postMessage({
                    id,
                    type: 'mineUntilValid',
                    rewardAddress: this.address,
                    bet: this.bets[this.bestCandidate.index],
                    timeOffset: this.timeSynchronizer.offset,
                    blockCandidate: this.bestCandidate
                });
            }
        }

        console.info(`[MINER-${this.address.slice(0, 6)}] Stopped`);
    }

    terminate() {
        this.terminated = true;
        for (let i = 0; i < this.workers.length; i++) {
            this.workers[i].postMessage({ type: 'terminate' });
            //console.log(`Worker ${i} terminated`);
        }
    }
}