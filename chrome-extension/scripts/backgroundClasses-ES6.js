class Sanitizer {
	constructor() {
		this.validTypeToReturn = ['number', 'boolean'];
	}

	sanitize(data) {
		if (!data || this.validTypeToReturn.includes(typeof data)) {return data};
		if (typeof data !== 'string' && typeof data !== 'object') {return 'Invalid data type'};
	
		if (typeof data === 'string') {
			return data.replace(/[^a-zA-Z0-9+/=$,]/g, '');
		} else if (typeof data === 'object') {
			const sanitized = {};
			for (const key in data) {
				const sanitazedValue = this.sanitize(data[key]);
				sanitized[this.sanitize(key)] = sanitazedValue;
			}
			return sanitized;
		}
		return data;
	}
}

/**
* @typedef {import("../contrast/src/block-classes.mjs").BlockData} BlockData
*/

class Pow {
    constructor(argon2) {
        this.timeOffset = 0;
        this.argon2 = argon2;
        this.rewardAddress = 'CpkQiTemFSZH1zyGUKsM';
        this.argon2Params = { time: 1, mem: 2**20, hashLen: 32, parallelism: 1, type: 2 };
        this.miningIntensity = 0; // 0 = off, 1 = low, 10 = high
        this.state = { miningActive: false, updateHashActive: false };
        
        /** @type {BlockData} */
        this.bestCandidate = null;
        this.#miningLoop();

        this.targetBlockTime = 120_000, // 2 min
        this.nonceLength = 4,
        this.blocksBeforeAdjustment = 30, // ~120sec * 30 = ~3600 sec = ~1 hour
        this.thresholdPerDiffIncrement = 3.2, // meaning 3.4% threshold for 1 diff point
        this.maxDiffIncrementPerAdjustment = 32, // 32 diff points = 100% of diff
        this.diffAdjustPerLegitimacy = 16, // 16 diff points = 50% of diff
        this.maxTimeDifferenceAdjustment = 128;
    }
    getTime() { return Date.now() + this.timeOffset; }
    async #miningLoop() {
        console.info('[MINER] LOOP STARTED');

        if (this.state.miningActive) { console.info('[MINER] Mining already active !'); return; }
        this.state.miningActive = true;

        let hashRate = 0;
        const hashRateCalculInterval = 5000;
        const chrono = { updateStart: Date.now(), iterations: 0, powStart: 0, waiting: false };

        function updateHashRate() {
            const needUpdate = hashRateCalculInterval < (Date.now() - chrono.updateStart)
            if (needUpdate) {
                hashRate = chrono.iterations / ((Date.now() - chrono.updateStart) / 1000);
                chrome.storage.local.set({hashRate: hashRate});
    
                chrono.updateStart = Date.now();
                chrono.iterations = 0;
            }
        }

        chrono.waiting = false;
        while (true) {
            while(this.miningIntensity === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!chrono.waiting) { continue; }
                
                chrome.storage.local.set({hashRate: 0});
                console.info(`[MINER] WAITING FOR MINING INTENSITY: ${this.miningIntensity}`);
                waiting = true;
            }
            while (!this.bestCandidate) {
                console.info('[MINER] Waiting for block candidate');
                await new Promise(resolve => setTimeout(resolve, 1000));
                chrono.waiting = true;
            }
            while (!this.rewardAddress) {
                console.info('[MINER] Waiting for reward address');
                await new Promise(resolve => setTimeout(resolve, 1000));
                chrono.waiting = true;
            }

            if (chrono.waiting) {
                chrono.updateStart = 0;
                chrono.iterations = 0;
                chrono.waiting = false; console.info(`[MINER] RESUMING MINING`);
            }

            const { signatureHex, nonce, clonedCandidate } = await this.#prepareBlockCandidateBeforeMining(this.bestCandidate);
            //console.log(clonedCandidate);

            chrono.powStart = Date.now();
            const { encoded, hash, hashHex, bitsArray } = await this.#minePow(signatureHex, nonce);
            if (!bitsArray) { console.info('[MINER] Error while mining POW'); }

            clonedCandidate.hash = hashHex;
            const result = this.verifyPow(bitsArray, clonedCandidate);
            //if (!result.conform) { console.info('[MINER] Invalid POW found'); }
            if (result.conform) {
                console.log(`[MINER] LUCKY!! VALID POW FOUND!`);
                console.log(`conform: ${result.conform}`);
                console.log(clonedCandidate);
                chrome.storage.local.set({blockFinalized: clonedCandidate});
            }

            //const pauseDuration = this.#calculatePauseDuration(Date.now() - chrono.powStart);
            const pauseDuration = 100;
            console.log(`[MINER] Mining duration: ${Date.now() - chrono.powStart}ms - Pause duration: ${pauseDuration}ms`);
            if (pauseDuration > 0) { await new Promise(resolve => setTimeout(resolve, pauseDuration)); }

            chrono.iterations++;
            updateHashRate();

            //hashRateCalculInterval = 10000 / this.miningIntensity > 5000 ? 5000 : 10000 / this.miningIntensity;
            //console.log(`[MINER] Mining intensity updated: ${this.miningIntensity}`);
        }
    }
    /** @param {BlockData} blockCandidate */
    async #prepareBlockCandidateBeforeMining(blockCandidate) {
        /** @type {BlockData} */
        const clonedCandidate = JSON.parse(JSON.stringify(blockCandidate));

        const headerNonce = this.#generateNonce().Hex;
        const coinbaseNonce = this.#generateNonce().Hex;
        clonedCandidate.nonce = headerNonce;
        clonedCandidate.timestamp = this.getTime();

        const powReward = blockCandidate.powReward;
        delete clonedCandidate.powReward;
        const coinbaseTx = await Pow.createCoinbase(coinbaseNonce, this.rewardAddress, powReward);
        Pow.setCoinbaseTransaction(clonedCandidate, coinbaseTx);

        const signatureHex = await Pow.getBlockSignature(clonedCandidate);
        const nonce = `${headerNonce}${coinbaseNonce}`;

        return { signatureHex, nonce, clonedCandidate };
    }
    /** @param {string} nonceHex @param {string} address @param {number} amount */
    static async createCoinbase(nonceHex, address, amount) {
        const coinbaseOutput = {
            amount,
            rule: 'sig',
            address
        };

        const inputs = [nonceHex];
        const outputs = [coinbaseOutput];

        const transaction = {
            id: '',
            witnesses: [],
            version: 1,
            inputs,
            outputs
        };
        
        const inputsStr = JSON.stringify(transaction.inputs);
        const outputsStr = JSON.stringify(transaction.outputs);
        const versionStr = JSON.stringify(transaction.version);
        transaction.id = Pow.hashId(`${inputsStr}${outputsStr}${versionStr}`);

        return transaction;
    }
    /** @param {BlockData} blockData @param {Transaction} coinbaseTx */
    static setCoinbaseTransaction(blockData, coinbaseTx) {
        Pow.removeExistingCoinbaseTransaction(blockData);
        blockData.Txs.unshift(coinbaseTx);
    }
    /** @param {BlockData} blockData */
    static removeExistingCoinbaseTransaction(blockData) {
        if (blockData.Txs.length === 0) { return; }

        const secondTx = blockData.Txs[1]; // if second tx isn't fee Tx : there is no coinbase
        if (!secondTx || !Pow.isMinerOrValidatorTx(secondTx)) { return; }

        const firstTx = blockData.Txs[0];
        if (firstTx && Pow.isMinerOrValidatorTx(firstTx)) { blockData.Txs.shift(); }
    }
    /** @param {Transaction} transaction */
    static isMinerOrValidatorTx(transaction) {
        if (transaction.inputs.length !== 1) { return false; }
        if (transaction.inputs[0].length === 8) { return 'miner'; } // nonce length is 8
        if (transaction.inputs[0].length === 20 + 1 + 64) { return 'validator'; } // address length 20 + : + posHash length is 64

        return false;
    }
    /** @param {BlockData} blockData @param {boolean} excludeCoinbaseAndPos */
    static async getBlockTxsHash(blockData, excludeCoinbaseAndPos = false) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);

        let firstTxIsCoinbase = blockData.Txs[0] ? Pow.isMinerOrValidatorTx(blockData.Txs[0]) : false;
        if (excludeCoinbaseAndPos && firstTxIsCoinbase) { txsIDStrArray.shift(); }
        firstTxIsCoinbase = blockData.Txs[0] ? Pow.isMinerOrValidatorTx(blockData.Txs[0]) : false;
        if (excludeCoinbaseAndPos && firstTxIsCoinbase) { txsIDStrArray.shift(); }

        const txsIDStr = txsIDStrArray.join('');
        return await Pow.SHA256(txsIDStr);
    };
    /** @param {BlockData} blockData @param {boolean} isPosHash @returns {Promise<string>} signature Hex */
    static async getBlockSignature(blockData, isPosHash = false) {
        const txsHash = await Pow.getBlockTxsHash(blockData, isPosHash);
        const { index, supply, coinBase, difficulty, legitimacy, prevHash, posTimestamp } = blockData;
        let signatureStr = `${index}${supply}${coinBase}${difficulty}${legitimacy}${prevHash}${posTimestamp}${txsHash}`;
        if (!isPosHash) { signatureStr += blockData.timestamp; }

        return await Pow.SHA256(signatureStr);
    }
    static hashId(input = 'toto', hashHexLength = 8) {
        /* XXHASH32 */
        /*const hashNumber = xxHash32(input);
        const hashHex = hashNumber.toString(16);
        const padding = '0'.repeat(minLength - hashHex.length);
        return `${padding}${hashHex}`;*/

        /* HASHID
        const inputsStr = JSON.stringify(transaction.inputs);
        const outputsStr = JSON.stringify(transaction.outputs);
        const versionStr = JSON.stringify(transaction.version);

        const hashHex = HashFunctions.xxHash32(`${inputsStr}${outputsStr}${versionStr}`);
        return hashHex.slice(0, hashHexLength);*/

        const hashNumber = xxHash32(input);
        const hashHex = hashNumber.toString(16);
        const padding = '0'.repeat(hashHexLength - hashHex.length);
        const finalHashHex = `${padding}${hashHex}`;

        return finalHashHex.slice(0, hashHexLength);
    }
    static async SHA256(message) {
        const messageUint8 = Pow.stringToUint8Array(message);
        const arrayBuffer = await crypto.subtle.digest('SHA-256', messageUint8);
        const uint8Array = new Uint8Array(arrayBuffer);
        const hashHex = Pow.uint8ArrayToHex(uint8Array);
        return hashHex;
    }
    /** @param {string} str - string to convert to Uint8Array */
    static stringToUint8Array(str) {
        return new TextEncoder().encode(str);
    }
    /** @param {Uint8Array} uint8Array @param {number} minLength */
    static uint8ArrayToHex(uint8Array, minLength = 0) {
        let hexStr = '';
        uint8Array.forEach(byte => hexStr += byte.toString(16).padStart(2, '0'));
        if (minLength > 0) { hexStr = hexStr.padStart(minLength, '0'); }
        return hexStr;
    }
    #calculatePauseDuration(powDuration) {
        if (this.miningIntensity === 10) { return 0; }
        if (this.miningIntensity === 1) { return 1000 - powDuration < 0 ? 0 : 1000 - powDuration; }
        
        const minHashRate = 1;
        const factor = .5;

        let pauseDuration = 0;
        let expectedTotalPowDuration = powDuration;
        for (let i = 10; i > this.miningIntensity; i--) {
            const pauseBasis = expectedTotalPowDuration * factor;
            pauseDuration += pauseBasis;
            expectedTotalPowDuration = powDuration + pauseDuration;
        }

        // correct the pause duration to reach the expected min hash rate (1 hash/s)
        //const expectedHashRate = 1000 / expectedTotalPowDuration;
        //if (expectedHashRate < minHashRate) { pauseDuration = 1000 - powDuration; }
        // NO ??

        return pauseDuration;
    }
    /** @param {string} blockSignature @param {string} nonce */
    async #minePow(blockSignature = '', nonce = '') {
        const { encoded, hash, hashHex } = await this.hashBlockSignature(this.argon2.hash, blockSignature, nonce);
        if (!hash) { return false; }

        // uint8Array to bitsArray (0 or 1)
        const bitsArray = Pow.uint8ArrayToBitsArray(hash);

        return { encoded, hash, hashHex, bitsArray };
    }
    /** @param {Uint8Array} hash */
    static uint8ArrayToBitsArray(hash) {
        const bitsArray = [];
        hash.forEach(byte => {
            for (let i = 0; i < 8; i++) {
                bitsArray.push((byte >> i) & 1);
            }
        });

        return bitsArray;
    }
    /** @param {Uint8Array} bitsArray @param {BlockData} finalizedBlock */
    verifyPow(bitsArray, finalizedBlock) {
        const response = { conform: false };

        const bitsArrayAsString = bitsArray.join('');
        const { conform } = this.verifyBlockHashConformToDifficulty(bitsArrayAsString, finalizedBlock);
        if (!conform) { return response; }
    
        response.conform = conform;
        response.bitsArrayAsString = bitsArrayAsString;
    
        return response;
    }
    /**
     * This function uses an Argon2 hash function to perform a hashing operation.
     * The Argon2 hash function must follow the following signature:
     * - argon2HashFunction(pass, salt, time, mem, parallelism, type, hashLen)
     *
     *@param {function(string, string, number=, number=, number=, number=, number=): Promise<false | { encoded: string, hash: Uint8Array, hex: string, bitsArray: number[] }>} argon2HashFunction
     *@param {string} blockSignature - Block signature to hash
     *@param {string} nonce - Nonce to hash
    */
    async hashBlockSignature(argon2Fnc, blockSignature = '', nonce = '') {
        const { time, mem, parallelism, type, hashLen } = this.argon2Params;
        const argon2Param = {
            pass: blockSignature,
            salt: nonce,
            time,
            mem,
            hashLen,
            parallelism,
            type,
        };
        
        const { encoded, hash, hashHex } = await argon2Fnc(argon2Param);

        return { encoded, hash, hashHex };
    }
    #generateNonce(length = 4) {
        const Uint8 = new Uint8Array(length);
        crypto.getRandomValues(Uint8);
    
        const Hex = Array.from(Uint8).map(b => b.toString(16).padStart(2, '0')).join('');
    
        return { Uint8, Hex };
    }
    /** @param {string} HashBitsAsString @param {BlockData} blockData */
    verifyBlockHashConformToDifficulty(HashBitsAsString = '', blockData) {
        const { difficulty, timeDiffAdjustment, legitimacy, finalDifficulty } = this.getBlockFinalDifficulty(blockData);
        const { zeros, adjust } = Pow.decomposeDifficulty(finalDifficulty);

        const result = { conform: false, message: 'na', difficulty, timeDiffAdjustment, legitimacy, finalDifficulty, zeros, adjust };

        const condition1 = this.binaryStringStartsWithZeros(HashBitsAsString, zeros);
        if (!condition1) { result.message = `unlucky--(condition 1)=> hash does not start with ${zeros} zeros` };

        const next5Bits = HashBitsAsString.substring(zeros, zeros + 5);
        const condition2 = this.binaryStringSupOrEqual(next5Bits, adjust);
        if (!condition2) { result.message = `unlucky--(condition 2)=> hash does not meet the condition: ${next5Bits} >= ${adjust}` };

        if (result.message === 'na') { result.conform = true; result.message = 'lucky'; }

        //console.info(`[MINER] POW VERIFICATION - HashBitsAsString: ${HashBitsAsString}`);
        //console.info(`[MINER] POW VERIFICATION - condition1: ${condition1}, condition2: ${condition2}`);
        return result;
    }
    getBlockFinalDifficulty(blockData) {
        const { difficulty, legitimacy, posTimestamp, timestamp } = blockData;

        const differenceRatio = (timestamp - posTimestamp) / this.targetBlockTime;
        const timeDiffAdjustment = this.maxTimeDifferenceAdjustment - Math.round(differenceRatio * this.maxTimeDifferenceAdjustment);
        
        const legitimacyAdjustment = legitimacy * this.diffAdjustPerLegitimacy;
        const finalDifficulty = Math.max(difficulty + timeDiffAdjustment + legitimacyAdjustment, 1); // cap at 1 minimum

        return { difficulty, timeDiffAdjustment, legitimacy, finalDifficulty };
    }
    static decomposeDifficulty(difficulty = 1) {
        const zeros = Math.floor(difficulty / 16);
        const adjust = difficulty % 16;
        return { zeros, adjust };
    }
    /**Check if the string starts with a certain amount of zeros
     * @param {string} string
     * @param {number} zeros */
    binaryStringStartsWithZeros(string, zeros) {
        if (typeof string !== 'string') { return false; }
        if (typeof zeros !== 'number') { return false; }
        if (zeros < 0) { return false; }

        const target = '0'.repeat(zeros);
        return string.startsWith(target);
    }
    /** Check if the string as binary is superior or equal to the target
     * @param {string} string
     * @param {number} minValue */
    binaryStringSupOrEqual(string = '', minValue = 0) {
        if (typeof string !== 'string') { return false; }
        if (typeof minValue !== 'number') { return false; }
        if (minValue < 0) { return false; }

        const intValue = parseInt(string, 2);
        return intValue >= minValue;
    }
}

const PRIME32_1 = 2654435761;
const PRIME32_2 = 2246822519;
const PRIME32_3 = 3266489917;
const PRIME32_4 = 668265263;
const PRIME32_5 = 374761393;
/** @param input - byte array or string @param seed - optional seed (32-bit unsigned); */
function xxHash32(input, seed = 0) {
    let encoder;
    const buffer = typeof input === 'string' ? (encoder ??= new TextEncoder()).encode(input) : input;
    const b = buffer;
    let acc = (seed + PRIME32_5) & 0xffffffff;
    let offset = 0;
    if (b.length >= 16) {
        const accN = [
            (seed + PRIME32_1 + PRIME32_2) & 0xffffffff,
            (seed + PRIME32_2) & 0xffffffff,
            (seed + 0) & 0xffffffff,
            (seed - PRIME32_1) & 0xffffffff,
        ];
        const b = buffer;
        const limit = b.length - 16;
        let lane = 0;
        for (offset = 0; (offset & 0xfffffff0) <= limit; offset += 4) {
            const i = offset;
            const laneN0 = b[i + 0] + (b[i + 1] << 8);
            const laneN1 = b[i + 2] + (b[i + 3] << 8);
            const laneNP = laneN0 * PRIME32_2 + ((laneN1 * PRIME32_2) << 16);
            let acc = (accN[lane] + laneNP) & 0xffffffff;
            acc = (acc << 13) | (acc >>> 19);
            const acc0 = acc & 0xffff;
            const acc1 = acc >>> 16;
            accN[lane] = (acc0 * PRIME32_1 + ((acc1 * PRIME32_1) << 16)) & 0xffffffff;
            lane = (lane + 1) & 0x3;
        }
        acc =
            (((accN[0] << 1) | (accN[0] >>> 31)) +
                ((accN[1] << 7) | (accN[1] >>> 25)) +
                ((accN[2] << 12) | (accN[2] >>> 20)) +
                ((accN[3] << 18) | (accN[3] >>> 14))) &
                0xffffffff;
    }
    acc = (acc + buffer.length) & 0xffffffff;
    const limit = buffer.length - 4;
    for (; offset <= limit; offset += 4) {
        const i = offset;
        const laneN0 = b[i + 0] + (b[i + 1] << 8);
        const laneN1 = b[i + 2] + (b[i + 3] << 8);
        const laneP = laneN0 * PRIME32_3 + ((laneN1 * PRIME32_3) << 16);
        acc = (acc + laneP) & 0xffffffff;
        acc = (acc << 17) | (acc >>> 15);
        acc = ((acc & 0xffff) * PRIME32_4 + (((acc >>> 16) * PRIME32_4) << 16)) & 0xffffffff;
    }
    for (; offset < b.length; ++offset) {
        const lane = b[offset];
        acc = acc + lane * PRIME32_5;
        acc = (acc << 11) | (acc >>> 21);
        acc = ((acc & 0xffff) * PRIME32_1 + (((acc >>> 16) * PRIME32_1) << 16)) & 0xffffffff;
    }
    acc = acc ^ (acc >>> 15);
    acc = (((acc & 0xffff) * PRIME32_2) & 0xffffffff) + (((acc >>> 16) * PRIME32_2) << 16);
    acc = acc ^ (acc >>> 13);
    acc = (((acc & 0xffff) * PRIME32_3) & 0xffffffff) + (((acc >>> 16) * PRIME32_3) << 16);
    acc = acc ^ (acc >>> 16);
    return acc < 0 ? acc + 4294967296 : acc;
}

export { Sanitizer, Pow };