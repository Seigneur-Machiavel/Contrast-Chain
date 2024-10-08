import utils from '../src/utils.mjs';

// CLASS FOR EASY USAGE OF THE WORKER
export class ValidationWorker {
    constructor (id = 0) {
        this.id = id;
        this.isValid = null;
        this.discoveredPubKeysAddresses = {};
        this.state = 'idle';

        /** @type {Worker} worker */
        this.worker = utils.newWorker('../workers/validation-worker-nodejs.mjs');
        
        this.worker.on('message', (message) => {
            console.log(`ValidationWorker ${this.id} message: ${JSON.stringify(message)}`);
            if (message.id !== this.id) { return; }
            if (message.error) { console.error(message.error); }
            
            this.discoveredPubKeysAddresses = message.discoveredPubKeysAddresses;
            this.isValid = message.isValid;
            this.state = 'idle';
        });
        this.worker.on('exit', (code) => { console.log(`ValidationWorker stopped with exit code ${code}`); });
        this.worker.on('close', () => { console.log('ValidationWorker closed'); });
    }

    reset() { // DEPRECATED
        this.isValid = null;
        this.state = 'idle';
    }
    addressOwnershipConfirmation(involvedUTXOs, transaction, impliedKnownPubkeysAddresses, useDevArgon2, specialTx) {
        this.worker.postMessage({
            id: this.id,
            type: 'addressOwnershipConfirmation',
            involvedUTXOs,
            transaction,
            impliedKnownPubkeysAddresses,
            useDevArgon2,
            specialTx
        });
    }
    terminate() {
        this.worker.postMessage({ type: 'terminate' });
        console.info(`ValidationWorker ${this.id} terminated`);
    }
}

export class ValidationWorker_v2 {
    constructor (id = 0) {
        this.id = id;
        this.state = 'idle';

        /** @type {Worker} worker */
        this.worker = utils.newWorker('../workers/validation-worker-nodejs.mjs');
        this.worker.on('exit', (code) => { console.log(`ValidationWorker ${this.id} stopped with exit code ${code}`); });
        this.worker.on('close', () => { console.log('ValidationWorker ${this.id} closed'); });
    }
    addressOwnershipConfirmation(involvedUTXOs, transactions, impliedKnownPubkeysAddresses, useDevArgon2) {
        /** @type {Promise<{ discoveredPubKeysAddresses: {}, isValid: boolean }>} */
        const promise = new Promise((resolve, reject) => {
            this.worker.postMessage({
                id: this.id,
                type: 'addressOwnershipConfirmation',
                involvedUTXOs,
                transactions,
                impliedKnownPubkeysAddresses,
                useDevArgon2,
            });
            this.worker.on('message', (message) => {
                if (message.id !== this.id) { return; }
                if (message.error) { reject({ isValid: message.isValid, error: message.error }); }
                    //reject(message.error); }

                const result = {
                    discoveredPubKeysAddresses: message.discoveredPubKeysAddresses,
                    isValid: message.isValid
                };
                //console.info(`ValidationWorker ${this.id} addressOwnershipConfirmation result: ${JSON.stringify(result)}`);
                resolve(result);
            });
        });
        return promise;
    }
    terminateAsync() {
        //console.info(`ValidationWorker ${this.id} terminating...`);
        this.worker.postMessage({ type: 'terminate', id: this.id });
        return new Promise((resolve, reject) => {
            this.worker.on('message', (message) => {
                if (message.id !== this.id) { return; }
                if (message.error) { reject(message.error); }
                resolve();
            });
            this.worker.on('exit', (code) => {
                console.log(`ValidationWorker ${this.id} stopped with exit code ${code}`);
                resolve();
            });
        });
    }
}