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
class Pow {
    constructor(argon2, serverUrl = 'http://localhost:4340') {
        this.argon2 = argon2;
        this.userId = 'toto';
        this.blockHash = null; // this.#generateRandomHash(16).hashHex;
        this.argon2Params = { time: 1, mem: 2**18, hashLen: 32, parallelism: 1, type: 2 };
        this.miningIntensity = 1;
        this.difficulty = 7;
        this.state = { active: false, miningActive: false, updateHashActive: false, connection: 'disconnected' };
        //this.targetNumberOfWorkers = 1;
        //this.workers = [];
    }

    async startMining() {
        this.miningIntensity = await this.#getIntensity();
        await chrome.storage.local.set({miningIntensity: this.miningIntensity});

        const userId = await this.#getSyncUserId();
        if (!userId) { console.info('Error while getting userId from storage'); return false; }
        this.userId = userId;
        
        this.state.active = true;
        await chrome.storage.local.set({miningState: 'enabled'});

        console.info(`Waiting for server connection to start mining...`);

        this.#updateMiningInfoLoop();
        this.#miningLoop();
    }
    async stopMining() {
        //console.log('Stopping mining 2...');
        this.state.active = false;

        while (this.state.miningActive || this.state.updateHashActive) {
            console.log('Waiting for mining to stop...');
            await new Promise(resolve => setTimeout(resolve, 400));
        }

        await chrome.storage.local.set({miningState: 'disabled'});

        console.log('Mining stopped');
        return true;
    }
    #miningStartLog() {
        console.info(`--- Mining ---`);
        console.info(`{ userId: ${this.userId} | diff: ${this.difficulty} | intensity: ${this.miningIntensity} }`);
        console.info(`Waiting for server connection to start mining...`);
    }
    async #setConnectionState(newState = 'disconnected') {
        if (newState === this.state.connection) { return; }
        
        if (newState === 'disconnected') { console.info('Connection lost !'); }
        if (newState === 'connected') { console.info('Connection established !'); }
        this.state.connection = newState;
        await chrome.storage.local.set({connectionState: newState});
    }
    async #miningLoop() {
        if (this.state.miningActive) { console.info('Mining already active !'); return; }
        this.state.miningActive = true;

        let hashRate = 0;
        let hashRateCalculInterval = 10000 / this.miningIntensity > 5000 ? 5000 : 10000 / this.miningIntensity;
        const chrono = { updateStart: Date.now(), iterations: 0, powStart: 0 };

        function updateHashRate() {
            const needUpdate = hashRateCalculInterval < (Date.now() - chrono.updateStart)
            if (needUpdate) {
                hashRate = chrono.iterations / ((Date.now() - chrono.updateStart) / 1000);
                chrome.storage.local.set({hashRate: hashRate});
    
                chrono.updateStart = Date.now();
                chrono.iterations = 0;
            }
        }

        while (this.state.active) {

            if (this.blockHash === null) {
                await this.#setConnectionState('disconnected');
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue; 
            } else {
                if (this.state.connection === 'disconnected') { this.#miningStartLog(); }
                await this.#setConnectionState('connected');
            }

            while(this.difficulty < 0) { await new Promise(resolve => setTimeout(resolve, 1000)); }

            chrono.powStart = Date.now();
            const difficulty = this.difficulty;
            const argon2Params = this.argon2Params;

            const powProposal = await this.#minePow(argon2Params, difficulty);
            
            if (powProposal && powProposal.isValid) {
                //console.log(`Valid POW found: ${powProposal}`);
                const nonceHex = powProposal.nonce;
                const response = 'toto' // await this.communication.submitPowProposal(nonceHex, this.userId);
                if (!response) { console.info('Error while submitting POW to server'); }
                
                if (response.success) { 
                    //console.log(`POW proposal: ${powProposal.pow.slice(0, 20)}`);
                    //console.log(`POW proposal (bits): ${powProposal.hashBits.join('').slice(0, 20)}`);
                    //console.log('POW accepted by server');
                    this.blockHash = powProposal.nonce;
                }
                else { console.log('POW rejected by server'); }
            }

            const pauseDuration = this.#calculatePauseDuration(Date.now() - chrono.powStart);
            if (pauseDuration > 0) { await new Promise(resolve => setTimeout(resolve, pauseDuration)); }
            
            chrono.iterations++;
            updateHashRate();

            const miningIntensity = await this.#getIntensity();
            if (miningIntensity === this.miningIntensity) { continue; }
            this.miningIntensity = miningIntensity;
            hashRateCalculInterval = 10000 / this.miningIntensity > 5000 ? 5000 : 10000 / this.miningIntensity;
            console.log(`Mining intensity updated: ${this.miningIntensity}`);
        }

        this.state.miningActive = false;
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
        const expectedHashRate = 1000 / expectedTotalPowDuration;
        if (expectedHashRate < minHashRate) { pauseDuration = 1000 - powDuration; }

        return pauseDuration;
    }
    #updateNumberOfWorkers() {
        let targetNumberOfWorkers = 1;
        // Over intensity 7, we double the number of workers for each intensity level
        if (this.miningIntensity > 7) {
            targetNumberOfWorkers = 2 ** (this.miningIntensity - 7);
        }

       while (this.workers.length < targetNumberOfWorkers) {
            const worker = new Worker('scripts/powWorker.js');
            this.workers.push(worker);
        }
    } 
    async #minePow(argon2Params, difficulty) {
        const nonce = this.#generateNonce(argon2Params.hashLen);
        const params = { ...argon2Params };
        const blockSignature = `${this.previousHash}${timestamp}${this.index}${this.difficulty}${TxsStr}${finder}`;
        params.pass = nonce.Hex;
        params.salt = nonce.Hex; // this.blockHash;
    
        if (!params.salt) { console.info('Error while getting block hash from server'); return false; }
        console.log(`params: ${JSON.stringify(params)}`);
    
        const hash = await this.argon2.hash(params);
        const bitsArray = this.#hexToBits(hash.hashHex);
        const isValid = this.#verify(bitsArray, difficulty);
        if (isValid) { console.log(`POW -> BitsArray: ${bitsArray.join('')}`); }

        const result = { nonce: nonce.Hex, hashHex: hash.hashHex, hashBits: bitsArray, isValid: isValid };
    
        return result;
    }
    #generateNonce(length) {
        const Uint8 = new Uint8Array(length);
        crypto.getRandomValues(Uint8);
    
        const Hex = Array.from(Uint8).map(b => b.toString(16).padStart(2, '0')).join('');
    
        return { Uint8, Hex };
    }
    #verify(powBits, difficulty) {
        const powBitsStr = powBits.join('');
        const target = '0'.repeat(difficulty);
        const isValid = powBitsStr.startsWith(target);
    
        return isValid;
    }
    #hexToBits(hex) {
        let bitsArray = [];
        for (let i = 0; i < hex.length; i++) {
            const bits = parseInt(hex[i], 16).toString(2).padStart(4, '0');
            bitsArray = bitsArray.concat(bits.split(''));
        }
    
        const bitsArrayAsNumbers = bitsArray.map(bit => parseInt(bit, 10));
        return bitsArrayAsNumbers;
    }
    async #updateMiningInfoLoop(tickDelay = 1000) {
        if (this.state.updateHashActive) { return; }
        this.state.updateHashActive = true;

        while (this.state.active) {
            await new Promise(resolve => setTimeout(resolve, tickDelay));

            const miningInfo = 'toto' // await this.communication.getMiningInfo();
            if (!miningInfo) { this.blockHash = null; continue; }

            this.blockHash = miningInfo.hash;
            this.difficulty = miningInfo.difficulty;
            console.log(`miningInfo updated: ${JSON.stringify(miningInfo)}`);
        }

        this.state.updateHashActive = false;
    }
    async #getSyncUserId() {
        const result = await chrome.storage.local.get(['id']);
        if (!result || !result.id) { return false; }
        if (typeof result.id !== 'string') { return false; }

        const sanitizer = new Sanitizer();
        result.userId = sanitizer.sanitize(result.id);

        return result.userId;
    }
    async #getIntensity() {
        const result = await chrome.storage.local.get(['miningIntensity']);
        if (!result || !result.miningIntensity) { return 1; }
        if (typeof result.miningIntensity !== 'number') { return 1; }

        return result.miningIntensity;
    }
}

export { Sanitizer, Pow };