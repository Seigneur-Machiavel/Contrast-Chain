import { BlockData, BlockUtils } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./account.mjs").Account} Account
 * @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
 * @typedef {import("./opStack.mjs").OpStack} OpStack
 * @typedef {import("./websocketCallback.mjs").WebSocketCallBack} WebSocketCallBack
 */

export class Miner {
    /**
     * @param {Account} address
     * @param {P2PNetwork} p2pNetwork
     */
    constructor(address, p2pNetwork, roles = ['miner'], opStack = null) {
        this.terminated = false;
        this.version = 1;
        this.useBetTimestamp = true;

        /** @type {string} */
        this.address = address;
        /** @type {BlockData[]} */
        this.candidates = [];
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
        this.hashTimings = [];
        this.hashRate = 0; // hash rate in H/s
        /** @type {OpStack} */
        this.opStack = opStack; // only for multiNode (validator + miner)

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
    }

    /** @param {BlockData} blockCandidate */
    pushCandidate(blockCandidate) {
        const validatorAddress = blockCandidate.Txs[0].inputs[0].split(':')[0];

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
            this.bets[blockCandidate.index] = this.useBetTimestamp ? this.#betOnTimeToPow(blockCandidate.index) : 0; // bet on time to pow
            this.highestBlockIndex = blockCandidate.index;
            this.#cleanupCandidates();
            this.addressOfCandidatesBroadcasted = [];
        }

        //console.info(`[MINER] New block candidate pushed (Height: ${blockCandidate.index}) | Diff = ${blockCandidate.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidate.coinBase)}`);
        console.info(`[MINER] New block candidate pushed (Height: ${blockCandidate.index} | validator: ${validatorAddress.slice(0,6)})`);
        this.candidates.push(blockCandidate);

        if (this.version === 1) { return; }
        this.assignTaskToIdleWorkers();
    }
    /** @param {BlockData} blockCandidate */
    async #prepareBlockCandidateBeforeMining(blockCandidate) {
        //let time = performance.now();
        const clonedCandidate = BlockUtils.cloneBlockData(blockCandidate);
        //console.log(`prepareNextBlock: ${performance.now() - time}ms`); time = performance.now();

        const headerNonce = utils.mining.generateRandomNonce().Hex;
        const coinbaseNonce = utils.mining.generateRandomNonce().Hex;
        clonedCandidate.nonce = headerNonce;
        clonedCandidate.timestamp = Math.max(clonedCandidate.posTimestamp + 1 + this.bets[clonedCandidate.index], Date.now());
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
        this.candidates = this.candidates.filter(candidate => this.highestBlockIndex - candidate.index <= heightTolerance);
    }
    #getMostLegitimateBlockCandidate() {
        if (this.candidates.length === 0) { return null; }

        const filteredCandidates = this.candidates.filter(candidate => candidate.index === this.highestBlockIndex);
        // the lower the legitimacy, the more legitimate the block is, 0 is the most legitimate
        const sortedCandidates = filteredCandidates.sort((a, b) => a.legitimacy - b.legitimacy);
        return sortedCandidates[0];
    }
    /** @param {number} hashTime - ms */
    #hashRateNew(hashTime = 50, hashBeforeAveraging = 20) {
        this.hashTimings.push(hashTime);
        if (this.hashTimings.length < hashBeforeAveraging - 1) { return; } // wait for 10 hash timings to be collected

        const hashRate = 1000 / (this.hashTimings.reduce((acc, timing) => acc + timing, 0) / this.hashTimings.length);
        this.hashRate = hashRate;
        this.hashTimings = [];
        if (this.wsCallbacks.onHashRateUpdated) { this.wsCallbacks.onHashRateUpdated.execute(hashRate); }
    }
    /** @param {BlockData} finalizedBlock */
    async #broadcastBlockCandidate(finalizedBlock) {
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
        const broadcastTimeStart = Date.now();
        //console.warn(`broadcasting pow`);
        await this.p2pNetwork.broadcast('new_block_finalized', finalizedBlock);
        //console.warn(`broadcastTime: ${Date.now() - broadcastTimeStart}ms`);
        if (this.roles.includes('validator')) { this.opStack.push('digestPowProposal', finalizedBlock); };
        if (this.wsCallbacks.onBroadcastFinalizedBlock) { this.wsCallbacks.onBroadcastFinalizedBlock.execute(BlockUtils.getBlockHeader(finalizedBlock)); }
    }
    async #createMissingWorkers(workersStatus = []) {
        const missingWorkers = this.nbOfWorkers - this.workers.length;

        for (let i = 0; i < missingWorkers; i++) {
            const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
            worker.on('message', (message) => {
                try {
                    if (message.error) { throw new Error(message.error); }
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

                    if (finalizedBlock.timestamp <= Date.now()) { // if block is ready to be broadcasted
                        this.#broadcastBlockCandidate(finalizedBlock);
                    } else { // if block is not ready to be broadcasted (pre-shoted)
                        this.preshotedPowBlock = finalizedBlock;
                        this.bets[finalizedBlock.index] = 1; // avoid betting on the same block
                    }
                } catch (err) {
                    console.error(err);
                }
                workersStatus[message.id] = 'free';
            });
            worker.on('exit', (code) => { console.log(`Worker stopped with exit code ${code}`); });
            worker.on('close', () => { console.log('Worker closed'); });

            this.workers.push(worker);
            workersStatus.push('free');
            console.log(`Worker ${this.workers.length} started`);
        }
    }
    /** DON'T AWAIT THIS FUNCTION */
    async startWithWorker() {
        const workersStatus = [];
        let lastHashTime = Date.now();
        while (!this.terminated) {
            const delayBetweenMining = this.roles.includes('validator') ? 20 : 10;
            await new Promise((resolve) => setTimeout(resolve, delayBetweenMining));

            const preshotedPowReadyToSend = this.preshotedPowBlock ? this.preshotedPowBlock.timestamp <= Date.now() : false;
            if (preshotedPowReadyToSend) {
                this.#broadcastBlockCandidate(this.preshotedPowBlock);
                this.preshotedPowBlock = null;
            }

            if (!this.canProceedMining) { continue; }

            await this.#createMissingWorkers(workersStatus);
            const usableWorkersStatus = workersStatus.slice(0, this.nbOfWorkers);
            for (let i = 0; i < usableWorkersStatus.length; i++) {
                const id = usableWorkersStatus.indexOf('free');
                if (id === -1) { break; }

                const blockCandidate = this.#getMostLegitimateBlockCandidate();
                if (!blockCandidate) { continue; }

                this.#hashRateNew(Date.now() - lastHashTime);
                lastHashTime = Date.now();
                workersStatus[id] = 'busy';

                const { signatureHex, nonce, clonedCandidate } = await this.#prepareBlockCandidateBeforeMining(blockCandidate);
                this.workers[id].postMessage({ type: 'mine', blockCandidate: clonedCandidate, signatureHex, nonce, id, useDevArgon2: this.useDevArgon2 });
            }
        }

        console.info(`[MINER-${this.address.slice(0, 6)}] Stopped`);
    }

    /** Event based operations */
    start_v2(nbOfWorkers = 1) {
        this.version = 2;
        this.setNbOfThreads(nbOfWorkers);
    }
    async assignTaskToIdleWorkers() {
        if (this.idleWorkers.length === 0) { return; }

        const prepared = await this.#prepareNextBlock();
        if (!prepared) { return; }
        
        while (this.idleWorkers.length > 0) {
            const worker = this.idleWorkers.shift();
            const { signatureHex, nonce, clonedCandidate } = prepared;
            worker.postMessage({ type: 'mine&verify', blockCandidate: clonedCandidate, signatureHex, nonce, useDevArgon2: this.useDevArgon2 });
            //await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    /** @param {BlockData} block */
    #removeBlockFromCandidates(block) {
        const validatorAddress = block.Txs[1].inputs[0].split(':')[0];
        const index = this.candidates.findIndex(
            candidate => candidate.index === finalizedBlock.index &&
            candidate.Txs[0].inputs[0].split(':')[0] === validatorAddress);

        if (index === -1) { return; }
        
        this.candidates.splice(index, 1);
    }
    async #prepareNextBlock() {
        const blockCandidate = this.#getMostLegitimateBlockCandidate();
        if (!blockCandidate) { return false; }

        return this.#prepareBlockCandidateBeforeMining(blockCandidate);
    }
    newWorker() {
        const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
        worker.on('message', async (message) => {
            const conform = message.conform;
            const finalizedBlock = message.finalizedBlock;
            const error = message.error;

            /** @type {BlockData} */
            this.#removeBlockFromCandidates(finalizedBlock);

            setTimeout(async () => {
                const preparedPromise = await this.#prepareNextBlock();
                if (!preparedPromise) { this.idleWorkers.push(worker); return; }

                worker.postMessage({
                    type: 'mine&verify',
                    blockCandidate: preparedPromise.clonedCandidate,
                    signatureHex: preparedPromise.signatureHex,
                    nonce: preparedPromise.nonce,
                    useDevArgon2: this.useDevArgon2
                });
            }, 0);

            if (error) { console.error(error); return; }
            if (!conform) { return; }

            // if block isn't ready to be broadcasted - avoid betting on the same block
            if (finalizedBlock.timestamp > Date.now()) { this.bets[finalizedBlock.index] = 1; }
            setTimeout(() => { this.#broadcastBlockCandidate(finalizedBlock); }, finalizedBlock.timestamp - Date.now());
        });

        worker.on('exit', (code) => { console.log(`MinerWorker stopped with exit code ${code}`); });
        worker.on('close', () => { console.log('MinerWorker closed'); });

        this.workers.push(worker);
        this.idleWorkers.push(worker);
    }
    setNbOfThreads(nbOfWorkers = 1) {
        const existingNbOfWorkers = this.workers.length;
        if (existingNbOfWorkers === nbOfWorkers) { return; }

        if (existingNbOfWorkers < nbOfWorkers) {
            for (let i = existingNbOfWorkers; i < nbOfWorkers; i++) { this.newWorker(); }
        } else {
            // terminate workers from the last to the first
            for (let i = existingNbOfWorkers - 1; i >= nbOfWorkers; i--) {
                this.workers[i].postMessage({ type: 'terminate' });
                this.workers.splice(i, 1);
            }
        }
        console.log(`Worker ${this.workers.length} started, state: idle`);
    }
    terminate() {
        this.terminated = true;
        for (let i = 0; i < this.workers.length; i++) {
            this.workers[i].postMessage({ type: 'terminate' });
            //console.log(`Worker ${i} terminated`);
        }
    }
}