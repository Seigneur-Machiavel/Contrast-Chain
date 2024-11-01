import { BlockData, BlockUtils } from './block.mjs';
import { MinerWorker } from '../workers/workers-classes.mjs';
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
        /** @type {MinerWorker[]} */
        this.workers = [];
        this.nbOfWorkers = 1;

        /** @type {Object<string, number[]>} */
        this.bets = {};
        /** @type {{min: number, max: number}} */
        this.betRange = { min: .4, max: .8 }; // will bet between 40% and 80% of the expected blockTime
        this.powBroadcastState = { foundHeight: -1, sentTryCount: 0, maxTryCount: 3 };

        this.roles = roles;
        this.canProceedMining = true;
        this.hashPeriodStart = 0;
        this.hashCount = 0;
        this.hashRate = 0; // hash rate in H/s

        /** @type {OpStack} */
        this.opStack = opStack; // only for multiNode (validator + miner)
        /** @type {TimeSynchronizer} */
        this.timeSynchronizer = timeSynchronizer;

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
    }

    /** @param {BlockData} blockCandidate */
    /*pushCandidate(blockCandidate) {
        const validatorAddress = blockCandidate.Txs[0].inputs[0].split(':')[0];
        if (this.highestBlockIndex !== -1 && blockCandidate.index > this.highestBlockIndex + 1) {
            console.info(`[MINER] Invalid block candidate pushed (#${blockCandidate.index} | v:${validatorAddress.slice(0,6 )}) | blockCandidate.index > lastBlockIndex + 1`);
            return;
        }

        // check if block is already in the candidates
        const index = this.candidates.findIndex(candidate => candidate.index === blockCandidate.index && candidate.Txs[0].inputs[0].split(':')[0] === validatorAddress);
        if (index !== -1) { return; }

        // check if powReward is coherent
        const posReward = blockCandidate.Txs[0].outputs[0].amount;
        const powReward = blockCandidate.powReward;
        if (!posReward || !powReward) { console.info(`[MINER] Invalid block candidate pushed (#${blockCandidate.index} | v:${validatorAddress.slice(0,6 )}) | posReward = ${posReward} | powReward = ${powReward}`); return; }
        if (Math.abs(posReward - powReward) > 1) { console.info(`[MINER] Invalid block candidate pushed (#${blockCandidate.index} | v:${validatorAddress.slice(0,6 )}) | posReward = ${posReward} | powReward = ${powReward} | Math.abs(posReward - powReward) > 1`); return; }

        // check if block is higher than the highest block
        if (blockCandidate.index > this.highestBlockIndex) {
            this.bets[blockCandidate.index] = this.#betPowTime();
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
    }*/
    /** @param {BlockData} blockCandidate */
    updateBestCandidate(blockCandidate) {
        // check if powReward is coherent
        const posReward = blockCandidate.Txs[0].outputs[0].amount;
        const powReward = blockCandidate.powReward;
        if (!posReward || !powReward) { console.info(`[MINER] Invalid block candidate pushed (#${blockCandidate.index} | v:${validatorAddress.slice(0,6 )}) | posReward = ${posReward} | powReward = ${powReward}`); return; }
        if (Math.abs(posReward - powReward) > 1) { console.info(`[MINER] Invalid block candidate pushed (#${blockCandidate.index} | v:${validatorAddress.slice(0,6 )}) | posReward = ${posReward} | powReward = ${powReward} | Math.abs(posReward - powReward) > 1`); return; }

        // compare final diff if height is the same
        if (this.bestCandidate && blockCandidate.index === this.bestCandidate.index) {
            const newCandidateFinalDiff = utils.mining.getBlockFinalDifficulty(blockCandidate);
            const bestCandidateFinalDiff = utils.mining.getBlockFinalDifficulty(this.bestCandidate);
            if (newCandidateFinalDiff > bestCandidateFinalDiff) { return; }
        }

        this.highestBlockIndex = blockCandidate.index;
        const changed = this.#setBestCandidateIfChanged(blockCandidate);
        if (!changed) { return; }

        if (this.wsCallbacks.onBestBlockCandidateChange) {
            this.wsCallbacks.onBestBlockCandidateChange.execute(blockCandidate);
        }
    }
    #betPowTime(nbOfBets = 32) {
        const bets = [];
        for (let i = 0; i < nbOfBets; i++) {
            if (!this.useBetTimestamp) { bets.push(0); continue; }
            const targetBlockTime = utils.SETTINGS.targetBlockTime;
            const betBasis = targetBlockTime * this.betRange.min;
            const betRandom = Math.random() * (this.betRange.max - this.betRange.min) * targetBlockTime;
            const bet = Math.floor(betBasis + betRandom);

            bets.push(bet);
        }

        return bets;
    }
    /** Remove candidates with height tolerance, to avoid memory leak */
    #cleanupCandidates(heightTolerance = 6) {
        const minimumHeight = this.highestBlockIndex - heightTolerance;
        const cleanedCandidates = this.candidates.filter(candidate => candidate.index >= minimumHeight);
        this.candidates = cleanedCandidates;
    }
    /** Return the most legitimate block candidate */
    #getMostLegitimateBlockCandidate() {
        if (this.candidates.length === 0) { return null; }

        const filteredCandidates = this.candidates.filter(candidate => candidate.index === this.highestBlockIndex);
        // the lower the legitimacy, the more legitimate the block is, 0 is the most legitimate
        const sortedCandidates = filteredCandidates.sort((a, b) => a.legitimacy - b.legitimacy);
        return sortedCandidates[0];
    }
    /** @param {BlockData} blockCandidate */
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
    #hashRateNewHash(hashBeforeAveraging = 10) { // DEPRECATED
        this.hashCount++;
        if (this.hashCount < hashBeforeAveraging) { return; }

        const timeSpent = (Date.now() - this.hashPeriodStart) / 1000;
        this.hashRate = this.hashCount / timeSpent;
        this.hashCount = 0;
        this.hashPeriodStart = Date.now();
    }
    #getAverageHashrate() {
        let totalHashRate = 0;
        for (const worker of this.workers) {
            //totalHashRate += worker.getHashRate();
            totalHashRate += worker.hashRate;
        }

        return totalHashRate;
    }
    /** @param {BlockData} finalizedBlock */
    async broadcastFinalizedBlock(finalizedBlock) {
        // Avoid sending the block pow if a higher block candidate is available to be mined
        if (this.highestBlockIndex > finalizedBlock.index) {
            console.info(`[MINER-${this.address.slice(0, 6)}] Block finalized is not the highest block candidate`);
            return;
        }
        
        const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0];
        if (this.addressOfCandidatesBroadcasted.includes(validatorAddress)) {
            console.info(`[MINER-${this.address.slice(0, 6)}] Block finalized already sent (Height: ${finalizedBlock.index})`);
            return;
        }

        // Avoid sending the same block multiple times
        const isNewHeight = finalizedBlock.index > this.powBroadcastState.foundHeight;
        const maxTryReached = this.powBroadcastState.sentTryCount >= this.powBroadcastState.maxTryCount;
        if (maxTryReached && !isNewHeight) { console.warn(`[MINER-${this.address.slice(0, 6)}] Max try reached for block (Height: ${finalizedBlock.index})`); return; }
        
        if (isNewHeight) { this.powBroadcastState.sentTryCount = 0; }
        this.powBroadcastState.foundHeight = finalizedBlock.index;
        this.powBroadcastState.sentTryCount++;

        const validatorId = validatorAddress.slice(0, 6);
        const minerId = this.address.slice(0, 6);
        console.info(`[MINER-${this.address.slice(0, 6)}] SENDING: Block finalized, validator: ${validatorId} | miner: ${minerId}
(Height: ${finalizedBlock.index}) | Diff = ${finalizedBlock.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(finalizedBlock.coinBase)}`);
        
        this.addressOfCandidatesBroadcasted.push(validatorAddress);
        await this.p2pNetwork.broadcast('new_block_finalized', finalizedBlock);

        if (this.roles.includes('validator')) { 
            //console.info(`[MINER-${this.address.slice(0, 6)}] Pushing task to opStack: digestPowProposal`);
            this.opStack.pushFirst('digestPowProposal', finalizedBlock);
        };
        if (this.wsCallbacks.onBroadcastFinalizedBlock) { this.wsCallbacks.onBroadcastFinalizedBlock.execute(BlockUtils.getBlockHeader(finalizedBlock)); }
    }
    async createMissingWorkers() {
        const missingWorkers = this.nbOfWorkers - this.workers.length;
        let readyWorkers = this.workers.length;
        if (missingWorkers <= 0) { return readyWorkers }

        for (let i = 0; i < missingWorkers; i++) {
            const workerIndex = readyWorkers + i;
            const blockBet = this.bets && this.bets[this.highestBlockIndex] ? this.bets[this.highestBlockIndex][workerIndex] : 0;
            this.workers.push(new MinerWorker(
                this.address,
                blockBet,
                this.timeSynchronizer.offset
            ));

            readyWorkers++;
        }

        // let time to start workers
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return readyWorkers;
    }
    async terminateUnusedWorkers() {
        for (let i = this.nbOfWorkers; i < this.workers.length; i++) {
            await this.workers[i].terminateAsync();
        }
        this.workers = this.workers.slice(0, this.nbOfWorkers);
    }
    /** DON'T AWAIT THIS FUNCTION */
    async startWithWorker() {
        const delayBetweenUpdate = this.roles.includes('validator') ? 200 : 100;
        while (!this.terminated) {
            await new Promise((resolve) => setTimeout(resolve, delayBetweenUpdate));
            await this.terminateUnusedWorkers();
            const readyWorkers = await this.createMissingWorkers();
            this.hashRate = this.#getAverageHashrate();
            
            const blockCandidate = this.bestCandidate;
            if (!blockCandidate) { continue; }
            if (blockCandidate.index !== this.highestBlockIndex) {
                console.info(`[MINER-${this.address.slice(0, 6)}] Block candidate is not the highest block candidate`);
                continue;
            }
            
            const timings = {
                start: Date.now(),
                workersUpdate: 0,
                updateInfo: 0
            }

            for (let i = 0; i < readyWorkers; i++) {
                const worker = this.workers[i];
                await worker.updateCandidate(blockCandidate);
            }
            timings.workersUpdate = Date.now();
            
            for (let i = 0; i < readyWorkers; i++) {
                const worker = this.workers[i];
                const blockBet = this.bets && this.bets[this.highestBlockIndex] ? this.bets[this.highestBlockIndex][i] : 0;
                await worker.updateInfo(this.address, blockBet, this.timeSynchronizer.offset);
            }
            timings.updateInfo = Date.now();

            for (let i = 0; i < readyWorkers; i++) {
                const worker = this.workers[i];
                if (worker.isWorking) { continue; }
                if (worker.result !== null) {
                    const finalizedBlock = worker.getResultAndClear();
                    console.info(`[MINER-${this.address.slice(0, 6)}] Worker ${i} pow! #${finalizedBlock.index})`);
                    await this.broadcastFinalizedBlock(finalizedBlock);
                }

                if (!this.canProceedMining) { continue; }
                worker.mineUntilValid();
            }
            
            const endTimestamp = Date.now();
            const timeSpent = endTimestamp - timings.start;
            if (timeSpent < 1000) { continue; }

            console.info(`[MINER-${this.address.slice(0, 6)}] Abnormal time spent: ${timeSpent}ms
            - workersUpdate: ${timings.workersUpdate - timings.start}ms
            - updateInfo: ${timings.updateInfo - timings.workersUpdate}ms`);
        }

        console.info(`[MINER-${this.address.slice(0, 6)}] Stopped`);
    }

    async terminate() {
        //this.workers.forEach(worker => worker.terminateAsync());
        for (const worker of this.workers) {
            await worker.terminateAsync();
        }
        this.terminated = true;
    }
}