// Wallet.mjs
import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import { Account } from './account.mjs';
import utils from './utils.mjs';
import localStorage_v1 from "../storage/local-storage-management.mjs";
import WorkerPool from './workerPool.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Represents information about an address type.
 */
export class AddressTypeInfo {
    name = '';
    description = '';
    zeroBits = 0;
    nbOfSigners = 1;
}

/**
 * Represents a generated account with an address and seed modifier.
 */
class GeneratedAccount {
    address = '';
    seedModifierHex = '';
}

/**
 * Wallet class responsible for managing accounts, deriving new accounts,
 * and handling storage operations.
 */
export class Wallet {
    /**
     * Constructs a new Wallet instance.
     * @param {string} masterHex - The master hex string.
     * @param {boolean} useDevArgon2 - Flag to use development Argon2 settings.
     * @param {number} poolSize - Number of worker threads in the pool.
     */
    constructor(masterHex, useDevArgon2 = false, poolSize = 16) {
        /** @type {string} */
        this.masterHex = masterHex; // 30 bytes - 60 chars

        /** @type {Object<string, Account[]>} */
        this.accounts = { // max accounts per type = 65,536
            W: [],
            C: [],
            S: [],
            P: [],
            U: []
        };

        /** @type {Object<string, GeneratedAccount[]>} */
        this.accountsGenerated = {
            W: [],
            C: [],
            S: [],
            P: [],
            U: []
        };

        this.useDevArgon2 = useDevArgon2;

        // Initialize worker pool
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const workerPath = path.resolve(__dirname, 'keyDerivationWorker.mjs');
        this.workerPool = new WorkerPool(workerPath, poolSize);
    }

    /**
     * Restores the wallet using a mnemonic hex string.
     * @param {string} mnemonicHex - The mnemonic hex string.
     * @returns {Promise<string>} - The Argon2 hash result.
     */
    async restore(mnemonicHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") {
        const argon2HashResult = await HashFunctions.Argon2(
            mnemonicHex,
            "Contrast's Salt Isn't Pepper But It Is Tasty",
            27,
            1024,
            1,
            2,
            26
        );
        return argon2HashResult;
    }

    /**
     * Saves generated accounts to local storage.
     */
    saveAccounts() {
        const id = this.masterHex.slice(0, 6);
        const folder = this.useDevArgon2 ? `accounts(dev)/${id}_accounts` : `accounts/${id}_accounts`;
        localStorage_v1.saveJSON(folder, this.accountsGenerated);
    }

    /**
     * Loads generated accounts from local storage.
     * @returns {boolean} - True if accounts were loaded successfully, else false.
     */
    loadAccounts() {
        const id = this.masterHex.slice(0, 6);
        const folder = this.useDevArgon2 ? `accounts(dev)/${id}_accounts` : `accounts/${id}_accounts`;
        const accountsGenerated = localStorage_v1.loadJSON(folder);
        if (!accountsGenerated) { return false; }

        this.accountsGenerated = accountsGenerated;
        return true;
    }

    /**
     * Derives multiple accounts in parallel, leveraging the worker pool for concurrency.
     * @param {number} nbOfAccounts - Number of accounts to derive.
     * @param {string} addressPrefix - Desired address prefix.
     * @returns {Promise<Object>} - Derived accounts and average iterations.
     */
    async deriveAccounts(nbOfAccounts = 1, addressPrefix = "C") {
        const nbOfExistingAccounts = this.accounts[addressPrefix].length;
        const accountToGenerate = nbOfAccounts - nbOfExistingAccounts;

        const progressLogger = new utils.ProgressLogger(accountToGenerate, '[WALLET] deriving accounts');
        const iterationsPerAccount = [];

        const accountIndices = [];
        for (let i = nbOfExistingAccounts; i < nbOfAccounts; i++) {
            accountIndices.push(i);
        }

        // Map over accountIndices to create an array of promises
        const derivationPromises = accountIndices.map(async (i) => {
            if (this.accountsGenerated[addressPrefix][i]) { // From saved account
                const { address, seedModifierHex } = this.accountsGenerated[addressPrefix][i];
                const keyPair = await this.#deriveKeyPair(seedModifierHex);
                const account = new Account(keyPair.pubKeyHex, keyPair.privKeyHex, address);

                iterationsPerAccount.push(1);
                this.accounts[addressPrefix].push(account);
                progressLogger.logProgress(this.accounts[addressPrefix].length - nbOfExistingAccounts);
                return;
            }

            const derivationResult = await this.tryDerivationUntilValidAccount(i, addressPrefix);
            if (!derivationResult.account) {
                console.error('deriveAccounts interrupted!');
                return;
            }

            const { account, iterations } = derivationResult;
            iterationsPerAccount.push(iterations);
            this.accounts[addressPrefix].push(account);
            progressLogger.logProgress(this.accounts[addressPrefix].length - nbOfExistingAccounts);
        });

        // Await all derivation promises
        await Promise.all(derivationPromises);

        const derivedAccounts = this.accounts[addressPrefix].slice(nbOfExistingAccounts);
        if (derivedAccounts.length !== nbOfAccounts) {
            console.error('Failed to derive all accounts');
            return {};
        }
        return {
            derivedAccounts,
            avgIterations: (iterationsPerAccount.reduce((a, b) => a + b, 0) / nbOfAccounts).toFixed(2)
        };
    }

    /**
     * Attempts to derive a valid account, retrying until successful or max iterations reached.
     * @param {number} accountIndex - Index of the account to derive.
     * @param {string} desiredPrefix - Desired address prefix.
     * @returns {Promise<Object|boolean>} - Derived account and iterations or false on failure.
     */
    async tryDerivationUntilValidAccount(accountIndex = 0, desiredPrefix = "C") {
        /** @type {AddressTypeInfo} */
        const addressTypeInfo = utils.addressUtils.glossary[desiredPrefix];
        if (addressTypeInfo === undefined) { throw new Error(`Invalid desiredPrefix: ${desiredPrefix}`); }

        // Calculate maximum iterations to avoid infinite loops
        const maxIterations = 65_536 * (2 ** addressTypeInfo.zeroBits); // e.g., 4,294,967,296 for zeroBits=16
        const seedModifierStart = accountIndex * maxIterations; // e.g., 281,470,681,743,360 for accountIndex=65,535

        for (let i = 0; i < maxIterations; i++) {
            const seedModifier = seedModifierStart + i;
            const seedModifierHex = seedModifier.toString(16).padStart(12, '0'); // 48 bits (6 bytes)

            try {
                const keyPair = await this.#deriveKeyPair(seedModifierHex);
                const account = await this.#deriveAccount(keyPair, desiredPrefix);
                if (account) {
                    this.accountsGenerated[desiredPrefix].push({ address: account.address, seedModifierHex });
                    return { account, iterations: i };
                }
            } catch (error) {
                const errorSkippingLog = ['Address does not meet the security level'];
                if (!errorSkippingLog.some(msg => error.message.startsWith(msg))) {
                    console.error(error.stack);
                }
            }
        }

        return false;
    }

    /**
     * Derives a key pair using the worker pool.
     * @param {string} seedModifierHex - Seed modifier in hex format.
     * @returns {Promise<Object>} - Derived key pair.
     */
    async #deriveKeyPair(seedModifierHex) {
        try {
            const keyPair = await this.workerPool.runTask({
                masterHex: this.masterHex,
                seedModifierHex,
                useDevArgon2: this.useDevArgon2
            });
            return keyPair;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Derives an account from the given key pair and desired prefix.
     * @param {Object} keyPair - The key pair.
     * @param {string} desiredPrefix - Desired address prefix.
     * @returns {Promise<Account|boolean>} - Derived account or false if prefix doesn't match.
     */
    async #deriveAccount(keyPair, desiredPrefix = "C") {
        const argon2Fnc = this.useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;
        const addressBase58 = await utils.addressUtils.deriveAddress(argon2Fnc, keyPair.pubKeyHex);
        if (!addressBase58) { throw new Error('Failed to derive address'); }

        if (addressBase58.substring(0, 1) !== desiredPrefix) { return false; }

        utils.addressUtils.conformityCheck(addressBase58);
        await utils.addressUtils.securityCheck(addressBase58, keyPair.pubKeyHex);

        return new Account(keyPair.pubKeyHex, keyPair.privKeyHex, addressBase58);
    }

    /**
     * Loads existing accounts or creates new ones based on the provided parameters.
     * @param {Object} params - Parameters for loading or creating accounts.
     * @returns {Promise<Array|Object>} - Array of derived accounts or empty object on failure.
     */
    async loadOrCreateAccounts(params) {
        if (params === undefined) {
            console.warn('No params provided, using default dev params to derive accounts');
            params = utils.devParams;
        }
        // Restore wallet
        this.masterHex = params.masterHex;
        this.useDevArgon2 = params.useDevArgon2;
        await this.restore(params.masterHex);
        // Try to load accounts
        const loaded = await this.loadAccounts();
        if (loaded) {
            const derivedAccounts = this.accounts[params.addressPrefix].slice(0, params.nbOfAccounts);
            if (derivedAccounts.length === params.nbOfAccounts) { return derivedAccounts; }
        }

        // Derive new accounts with desired concurrency
        const { derivedAccounts, avgIterations } = await this.deriveAccounts(params.nbOfAccounts, params.addressPrefix, params.concurrency || 10);
        if (derivedAccounts.length !== params.nbOfAccounts) {
            console.error('Failed to derive all accounts');
            return {};
        }

        // Save generated accounts
        await this.saveAccounts();
        return derivedAccounts;
    }
    /**
     * Clean up the worker pool when done.
     * @returns {Promise<void>}
     */
    async shutdown() {
        await this.workerPool.shutdown();
    }
}
