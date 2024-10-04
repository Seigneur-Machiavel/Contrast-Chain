import { TxValidation } from './validation.mjs';
import { Transaction_Builder, Transaction } from './transaction.mjs';
import utils from './utils.mjs';
import { UtxoCache } from './utxoCache.mjs';

/**
 * @typedef {{ [feePerByte: string]: Transaction[] }} TransactionsByFeePerByte
 * @typedef {import('./block.mjs').BlockData} BlockData
 * @typedef {import("./websocketCallback.mjs").WebSocketCallBack} WebSocketCallBack
 * @typedef {import("./transaction.mjs").UTXO} UTXO
 */

export class MemPool { // Store transactions that are not yet included in a block
    constructor() {
        /** @type {Object<string, Transaction>} */
        this.transactionsByID = {};
        /** @type {TransactionsByFeePerByte} */
        this.transactionsByFeePerByte = {};
        /** @type {Object<string, Transaction>} */
        this.transactionByAnchor = {};

        this.maxPubKeysToRemember = 1_000_000; // ~45MB
        this.knownPubKeysAddresses = {}; // used to avoid excessive address ownership confirmation
        this.useDevArgon2 = false;

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
    }

    /**
     * @param {Transaction} transaction
     * @param {Transaction} collidingTx
     */
    #addMempoolTransaction(transaction, collidingTx = false) {
        if (collidingTx) { this.#removeMempoolTransaction(collidingTx); }
        // AT THIS STAGE WE HAVE ENSURED THAT THE TRANSACTION IS CONFORM

        // sorted by feePerByte
        const feePerByte = transaction.feePerByte;
        this.transactionsByFeePerByte[feePerByte] = this.transactionsByFeePerByte[feePerByte] || [];
        this.transactionsByFeePerByte[feePerByte].push(transaction);

        // sorted by anchor
        for (const input of transaction.inputs) { this.transactionByAnchor[input] = transaction; }

        // sorted by transaction ID
        this.transactionsByID[transaction.id] = transaction;

        //console.log(`[MEMPOOL] transaction: ${transaction.id} added`);
    }
    /** @param {Transaction} transaction */
    #removeMempoolTransaction(transaction) {
        // AT THIS STAGE WE HAVE ENSURED THAT THE TRANSACTION IS CONFORM

        // remove from: sorted by feePerByte
        const txFeePerByte = transaction.feePerByte;
        if (!this.transactionsByFeePerByte[txFeePerByte]) { throw new Error('Transaction not found in mempool'); }

        const txIndex = this.transactionsByFeePerByte[txFeePerByte].findIndex(tx => tx.id === transaction.id);
        if (txIndex === -1) { throw new Error('Transaction not found in mempool'); }

        this.transactionsByFeePerByte[txFeePerByte].splice(txIndex, 1);
        if (this.transactionsByFeePerByte[txFeePerByte].length === 0) { delete this.transactionsByFeePerByte[txFeePerByte]; }

        // remove from: sorted by anchor
        const colliding = this.#caughtTransactionsAnchorsCollision(transaction);
        for (const input of colliding.tx.inputs) {
            if (!this.transactionByAnchor[input]) { throw new Error(`Transaction not found in mempool: ${input}`); }
            delete this.transactionByAnchor[input];
        }

        // remove from: sorted by transaction ID
        delete this.transactionsByID[transaction.id];

        //console.log(`[MEMPOOL] transaction: ${transaction.id} removed`);
    }
    /** -> Use when a new block is accepted
     * - Remove transactions that are using UTXOs that are already spent
     * @param {UtxoCache} utxoCache - from utxoCache
     */
    async clearTransactionsWhoUTXOsAreSpent(utxoCache) {
        /*for (const anchor of Object.keys(this.transactionByAnchor)) {
            if (!this.transactionByAnchor[anchor]) { continue; } // already removed

            const utxo = await utxoCache.getUTXO(anchor);
            if (utxo && !utxo.spent) { continue; } // not spent

            const transaction = this.transactionByAnchor[anchor];
            this.#removeMempoolTransaction(transaction);
        }*/

        const anchors = [];
        for (const anchor of Object.keys(this.transactionByAnchor)) {
            if (!this.transactionByAnchor[anchor]) { continue; } // already removed
            anchors.push(anchor);
        }

        const utxos = await utxoCache.getUTXOs(anchors);
        for (const anchor of Object.keys(utxos)) {
            if (!utxos[anchor].spent) { continue; } // not spent

            const transaction = this.transactionByAnchor[anchor];
            this.#removeMempoolTransaction(transaction);
        }
    }
    addNewKnownPubKeysAddresses(discoveredPubKeysAddresses) {
        for (let [pubKeyHex, address] of Object.entries(discoveredPubKeysAddresses)) {
            this.knownPubKeysAddresses[pubKeyHex] = address;
        }
    }
    /**
     * - Remove the transactions included in the block from the mempool
     * @param {BlockData[]} blocksData
     */
    digestFinalizedBlocksTransactions(blocksData) {
        for (const blockData of blocksData) {
            const Txs = blockData.Txs;
            if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }

            // remove the transactions included in the block that collide with the mempool
            for (const tx of Txs) {
                if (Transaction_Builder.isMinerOrValidatorTx(tx)) { continue; }

                const colliding = this.#caughtTransactionsAnchorsCollision(tx);
                if (!colliding) { continue; }

                //if (tx.id === collidingTx.id) { console.info(`[MEMPOOL] transaction: ${tx.id} confirmed!`); }
                this.#removeMempoolTransaction(colliding.tx);
            }
        }
    }
    /** @param {Transaction} transaction */
    #caughtTransactionsAnchorsCollision(transaction) {
        // AT THIS STAGE WE ENSURED THAT THE TRANSACTION IS CONFORM
        for (const input of transaction.inputs) {
            if (!this.transactionByAnchor[input]) { continue; } // no collision
            return { tx: this.transactionByAnchor[input], anchor: input };
        }

        return false;
    }
    /**
     * @param {UtxoCache} utxoCache
     * @param {Transaction} transaction
     * @param {number} byteLength
     */
    async pushTransaction(utxoCache, transaction) { // TODO : REFACTO using fullTxValidtion
        const involvedUTXOs = await utxoCache.extractInvolvedUTXOsOfTx(transaction);
        if (!involvedUTXOs) { throw new Error('At least one UTXO not found in utxoCache'); }

        const timings = { start: Date.now(), first: 0, second: 0 };
        const serialized = utils.serializerFast.serialize.transaction(transaction);
        const byteLength = serialized.byteLength;
        //console.log(`[MEMPOOL] transaction: ${transaction.id} received`);
        // First control format of : amount, address, rule, version, TxID, available UTXOs
        try { await TxValidation.controlTransactionHash(transaction); } catch (error) { throw new Error(`Transaction hash not valid - ${error.message}`); }
        
        try { await TxValidation.isConformTransaction(involvedUTXOs, transaction, false, true, utxoCache.nodeVersion); }
        catch (error) { throw new Error(`Transaction not conform - ${error.message}`); }

        const identicalIDTransaction = this.transactionsByID[transaction.id];
        if (identicalIDTransaction) { throw new Error(`Transaction already in mempool: ${transaction.id}`); }

        const colliding = this.#caughtTransactionsAnchorsCollision(transaction);
        const collidingTx = colliding ? colliding.tx : false;
        if (collidingTx) { // reject the transaction if it collides with the mempool
            throw new Error(`Conflicting UTXOs with: ${collidingTx.id} | anchor: ${colliding.anchor}`);
            // TODO: replace the transaction if the new one has a higher fee
            //if (transaction.feePerByte <= collidingTx.feePerByte) { throw new Error('New transaction fee is not higher than the existing one'); }
        }

        // Second control : input > output
        const fee = await TxValidation.calculateRemainingAmount(involvedUTXOs, transaction);

        // Calculate fee per byte
        transaction.byteWeight = byteLength;
        transaction.feePerByte = (fee / transaction.byteWeight).toFixed(6);

        timings.first = Date.now() - timings.start;

        // Fourth validation: low computation cost.
        await TxValidation.controlTransactionOutputsRulesConditions(transaction);

        // Fifth validation: medium computation cost.
        const impliedKnownPubkeysAddresses = await TxValidation.controlAllWitnessesSignatures(this, transaction);

        // Sixth validation: high computation cost.
        await TxValidation.addressOwnershipConfirmation(involvedUTXOs, transaction, impliedKnownPubkeysAddresses, this.useDevArgon2);
        timings.second = Date.now() - timings.start;
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${timings.second}ms (first: ${timings.first}ms)`);

        this.#addMempoolTransaction(transaction, collidingTx);
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${Date.now() - startTime}ms`);
    }
    /** @param {UtxoCache} utxoCache */
    async getMostLucrativeTransactionsBatch(utxoCache) {
        const totalBytesTrigger = utils.SETTINGS.maxBlockSize * 0.98;
        const transactions = [];
        let totalBytes = 0;

        const feePerBytes = Object.keys(this.transactionsByFeePerByte).sort((a, b) => b - a);
        for (let i = 0; i < feePerBytes.length; i++) {
            const feePerByte = feePerBytes[i];
            const txs = this.transactionsByFeePerByte[feePerByte];
            for (let j = 0; j < txs.length; j++) {
                const tx = txs[j];
                let txCanBeAdded = true;
                for (const anchor of tx.inputs) {
                    const utxo = await utxoCache.getUTXO(anchor);
                    if (!utxo || utxo.spent) { txCanBeAdded = false; break; } // spent
                }
                if (!txCanBeAdded) { continue; }

                const txWeight = tx.byteWeight;
                if (totalBytes + txWeight > utils.SETTINGS.maxBlockSize) { continue; }

                const clone = Transaction_Builder.clone(tx);
                delete clone.feePerByte;
                delete clone.byteWeight;

                transactions.push(clone);
                totalBytes += txWeight;
            }

            if (totalBytes > totalBytesTrigger) { break; }
        }

        return transactions;
    }
}