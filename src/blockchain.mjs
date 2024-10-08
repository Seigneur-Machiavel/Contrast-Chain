import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import pino from 'pino';
import { BlockUtils } from './block.mjs';
import { BlockMiningData } from './block.mjs';
import utils from './utils.mjs';
import { Transaction_Builder } from './transaction.mjs';
import fs from 'fs';
import path from 'path';
const url = await import('url');

/**
* @typedef {import("../src/block-tree.mjs").TreeNode} TreeNode
* @typedef {import("../src/block.mjs").BlockInfo} BlockInfo
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("../src/vss.mjs").Vss} Vss
* @typedef {import("../src/utxoCache.mjs").UtxoCache} UtxoCache
*/

/**
 * Represents the blockchain and manages its operations.
 */
export class Blockchain {
    __parentFolderPath = path.dirname(url.fileURLToPath(import.meta.url));
    __parentPath = path.join(this.__parentFolderPath, '..');
    /**
     * Creates a new Blockchain instance.
     * @param {string} dbPath - The path to the LevelDB database.
     * @param {Object} [options] - Configuration options for the blockchain.
     * @param {number} [options.maxInMemoryBlocks=1000] - Maximum number of blocks to keep in memory.
     * @param {string} [options.logLevel='info'] - The logging level for Pino.
     * @param {number} [options.snapshotInterval=100] - Interval at which to take full snapshots.
     */
    constructor(nodeId, options = {}) {
        this.nodeId = nodeId;
        const {
            maxInMemoryBlocks = 1000,
            logLevel = 'silent', // 'silent',
            snapshotInterval = 100,
        } = options;
        this.dbPath = path.join(this.__parentPath, 'nodes-data', nodeId, 'blockchain');
        // ensure folder exists
        if (!fs.existsSync(this.dbPath)) { fs.mkdirSync(this.dbPath, { recursive: true }); }
        this.db = LevelUp(LevelDown(this.dbPath));
        /** @type {Map<string, BlockData>} */
        this.inMemoryBlocks = new Map();
        /** @type {Map<number, string>} */
        this.blocksByHeight = new Map();
        /** @type {Map<string, number>} */
        this.blockHeightByHash = new Map();
        /** @type {number} */
        this.maxInMemoryBlocks = maxInMemoryBlocks;
        /** @type {number} */
        this.currentHeight = -1;
        /** @type {BlockData|null} */
        this.lastBlock = null;
        /** @type {number} */
        this.snapshotInterval = snapshotInterval;
        /** @type {BlockMiningData[]} */
        this.blockMiningData = []; // .csv mining datas research
        /** @type {pino.Logger} */
        this.logger = pino({
            level: logLevel,
            transport: {
                target: 'pino-pretty',
                options: { colorize: true }
            }
        });

        this.logger.info({ dbPath: './databases/blockchainDB-' + nodeId, maxInMemoryBlocks, snapshotInterval }, 'Blockchain instance created');
    }

    /**
     * Adds a new confirmed block to the blockchain.
     * @param {UtxoCache} utxoCache - The UTXO cache to use for the block.
     * @param {BlockData[]} blocks - The blocks to add. ordered by height
     * @param {boolean} [persistToDisk=true] - Whether to persist the block to disk.
     * @param {boolean} [saveBlockInfo=true] - Whether to save the block info.
     * @param {Object<string, string>} [blockPubKeysAddresses] - The block public keys and addresses.
     * @throws {Error} If the block is invalid or cannot be added.
     */
    async addConfirmedBlocks(utxoCache, blocks, persistToDisk = true, saveBlockInfo = true, blockPubKeysAddresses, totalFees) {
        for (const block of blocks) {
            this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Adding new block');
            try {
                this.updateIndices(block);
                this.inMemoryBlocks.set(block.hash, block);

                this.lastBlock = block;
                this.currentHeight = block.index;

                const promises = [];

                /** @type {BlockInfo} */
                if (persistToDisk) {
                    promises.push(this.persistBlockToDisk(block));
                    promises.push(this.db.put('currentHeight', this.currentHeight.toString()));
                    if (blockPubKeysAddresses) { promises.push(this.persistAddressesTransactionsToDisk(block, blockPubKeysAddresses)) }
                }

                const blockInfo = saveBlockInfo ? await BlockUtils.getFinalizedBlockInfo(utxoCache, block, totalFees) : undefined;
                if (saveBlockInfo) { promises.push(this.persistBlockInfoToDisk(blockInfo)) }

                this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Block successfully added');
                return blockInfo;
            } catch (error) {
                this.logger.error({ error, blockHash: block.hash }, 'Failed to add block');
                throw error;
            }
        }
    }
    /**
    * Applies the changes from added blocks to the UTXO cache and VSS.
    * @param {UtxoCache} utxoCache - The UTXO cache to update.
    * @param {Vss} vss - The VSS to update.
    * @param {BlockData[]} blocksData - The blocks to apply.
    * @param {boolean} [storeAddAddressAnchors=false] - Whether to store added address anchors.
    */
    async applyBlocks(utxoCache, vss, blocksData, storeAddAddressAnchors = false) {
        for (const block of blocksData) {
            const blockDataCloneToDigest = BlockUtils.cloneBlockData(block); // clone to avoid modification
            try {
                const newStakesOutputs = await utxoCache.digestFinalizedBlocks([blockDataCloneToDigest], storeAddAddressAnchors);
                this.blockMiningData.push({ index: block.index, difficulty: block.difficulty, timestamp: block.timestamp, posTimestamp: block.posTimestamp });
                vss.newStakes(newStakesOutputs);
            } catch (error) {
                this.logger.error({ error, blockHash: block.hash }, 'Failed to apply block');
                throw error;
            }
        }
    }

    /**
     * Persists a block to disk.
     * @param {BlockData} finalizedBlock - The block to persist.
     * @returns {Promise<void>}
     * @private
     */
    async persistBlockToDisk(finalizedBlock) { // now using serializer v3
        this.logger.debug({ blockHash: finalizedBlock.hash }, 'Persisting block to disk');
        try {
            // TRYING THE BEST PRACTICE: full batch write
            const txsIds = [];
            const batch = this.db.batch();
            for (let i = 0; i < finalizedBlock.Txs.length; i++) {
                const tx = finalizedBlock.Txs[i];
                const specialTx = i < 2 ? Transaction_Builder.isMinerOrValidatorTx(tx) : false;
                const serializedTx = specialTx ? utils.serializer.transaction.toBinary_v2(tx) : utils.serializerFast.serialize.transaction(tx);
                txsIds.push(tx.id);
                batch.put(`${finalizedBlock.index}:${tx.id}`, Buffer.from(serializedTx));
            }

            const serializedTxsIds = utils.serializer.array_of_tx_ids.toBinary_v3(txsIds);
            batch.put(`height-${finalizedBlock.index}-txIds`, Buffer.from(serializedTxsIds));

            const serializedHeader = utils.serializer.blockHeader_finalized.toBinary_v3(finalizedBlock);
            batch.put(finalizedBlock.hash, Buffer.from(serializedHeader));

            const serializedHash = utils.convert.hex.toUint8Array(finalizedBlock.hash);
            batch.put(`height-${finalizedBlock.index}`, Buffer.from(serializedHash));

            await batch.write();

            this.logger.debug({ blockHash: finalizedBlock.hash }, 'Block persisted to disk');
        } catch (error) {
            this.logger.error({ error, blockHash: finalizedBlock.hash }, 'Failed to persist block to disk');
            throw error;
        }
    }
    /** @param {BlockInfo} blockInfo */
    async persistBlockInfoToDisk(blockInfo) {
        this.logger.debug({ blockHash: blockInfo.header.hash }, 'Persisting block info to disk');
        try {
            const serializedBlockInfo = utils.serializer.rawData.toBinary_v1(blockInfo);
            const buffer = Buffer.from(serializedBlockInfo);
            await this.db.put(`info-${blockInfo.header.hash}`, buffer);

            this.logger.debug({ blockHash: blockInfo.header.hash }, 'Block info persisted to disk');
        } catch (error) {
            this.logger.error({ error, blockHash: blockInfo.header.hash }, 'Failed to persist block info to disk');
            throw error;
        }
    }
    /** @param {BlockData} finalizedBlock @param {Object<string, string>} blockPubKeysAddresses */
    async persistAddressesTransactionsToDisk(finalizedBlock, blockPubKeysAddresses) {
        const transactionsReferencesSortedByAddress = BlockUtils.getFinalizedBlockTransactionsReferencesSortedByAddress(finalizedBlock, blockPubKeysAddresses);

        Object.entries(transactionsReferencesSortedByAddress).forEach(async ([address, newTxReference]) => {
            const addressTransactions = await this.getTxsRefencesFromDiskByAddress(address);
            //TODO: can be optimized by serializing the array of txsIds and the txsIds themselves
            const actualizedAddressTransactions = addressTransactions.concat(newTxReference);
            await this.db.put(`${address}-txs`, actualizedAddressTransactions.join(','));
        });

        this.logger.debug({ blockHash: finalizedBlock.hash }, 'Addresses transactions persisted to disk');
    }
    updateIndices(block) {
        this.blocksByHeight.set(block.index, block.hash);
        this.blockHeightByHash.set(block.hash, block.index);
    }

    async getRangeOfBlocksFromDiskByHeight(fromHeight, toHeight = 999_999_999, deserialize = true) {
        if (typeof fromHeight !== 'number' || typeof toHeight !== 'number') { throw new Error('Invalid block range: not numbers'); }
        if (fromHeight > toHeight) { throw new Error(`Invalid range: ${fromHeight} > ${toHeight}`); }

        const blocksData = [];
        for (let i = fromHeight; i <= toHeight; i++) {
            const blockData = await this.getBlockFromDiskByHeight(i, deserialize);
            if (!blockData) { break; }
            blocksData.push(blockData);
        }
        return blocksData;
    }
    /** Retrieves a block from disk by its height.
     * @param {number} height - The height of the block to retrieve. */
    async getBlockFromDiskByHeight(height, deserialize = true) {
        try {
            const serializedHash = await this.db.get(`height-${height}`);
            if (!serializedHash) { return null; }
            const blockHash = utils.convert.uint8Array.toHex(serializedHash);

            const serializedHeader = this.db.get(blockHash);
            const serializedTxsIds = this.db.get(`height-${height}-txIds`);

            const txsIds = utils.serializer.array_of_tx_ids.fromBinary_v3(await serializedTxsIds);
            const txsPromises = txsIds.map(txId => this.db.get(`${height}:${txId}`));

            if (!deserialize) { return { header: await serializedHeader, txs: await Promise.all(txsPromises) }; }

            return this.blockDataFromSerializedHeaderAndTxs(await serializedHeader, await Promise.all(txsPromises));
            //return utils.serializer.block_finalized.toBinary_v4(await serializedHeader, await Promise.all(txsPromises));
        } catch (error) {
            if (error.type === 'NotFoundError') { return null; }
            throw error;
        }
    }
    /** @param {Uint8Array} serializedHeader @param {Uint8Array[]} serializedTxs */
    blockDataFromSerializedHeaderAndTxs(serializedHeader, serializedTxs) { // Better in utils serializer ?
        /** @type {BlockData} */
        const blockData = utils.serializer.blockHeader_finalized.fromBinary_v3(serializedHeader);
        blockData.Txs = [];
        for (let i = 0; i < serializedTxs.length; i++) {
            const serializedTx = serializedTxs[i];
            const specialTx = i < 2 ? true : false;
            const tx = specialTx ? utils.serializer.transaction.fromBinary_v2(serializedTx) : utils.serializerFast.deserialize.transaction(serializedTx);
            blockData.Txs.push(tx);
        }

        return blockData;
    }
    async getBlockInfoFromDiskByHeight(height = 0) {
        try {
            const serializedHash = await this.db.get(`height-${height}`);
            if (!serializedHash) { return null; }
            const blockHash = utils.convert.uint8Array.toHex(serializedHash);

            const blockInfoUint8Array = await this.db.get(`info-${blockHash}`);
            /** @type {BlockInfo} */
            const blockInfo = utils.serializer.rawData.fromBinary_v1(blockInfoUint8Array);

            return blockInfo;
        } catch (error) {
            if (error.type === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }
    /** @param {string} address */
    async getTxsRefencesFromDiskByAddress(address) {
        try {
            const txsIdsUint8Array = await this.db.get(`${address}-txs`);
            const txsRefs = new TextDecoder().decode(txsIdsUint8Array).split(',');
            return txsRefs;
        } catch (error) {
            return [];
        }
    }

    /**
     * Retrieves a block by its hash.
     * @param {string} hash - The hash of the block to retrieve.
     * @returns {Promise<BlockData>} The retrieved block.
     * @throws {Error} If the block is not found.
     */
    async getBlockByHash(hash, deserialize = true) {
        this.logger.debug({ blockHash: hash }, 'Retrieving block');

        if (this.inMemoryBlocks.has(hash)) {
            return this.inMemoryBlocks.get(hash);
        }

        const height = this.blockHeightByHash.get(hash);
        if (height !== undefined) {
            return this.getBlockFromDiskByHeight(height, deserialize);
        }

        this.logger.error({ blockHash: hash }, 'Block not found');
        throw new Error(`Block not found: ${hash}`);
    }
    /**
     * Gets the hash of the latest block.
     * @returns {string} The hash of the latest block.
     */
    getLatestBlockHash() {
        return this.lastBlock ? this.lastBlock.hash : "0000000000000000000000000000000000000000000000000000000000000000";
    }
    /** 
     * Retrieves a transaction by its reference (height:txId format).
     * @param {string} txReference - The transaction reference in the format "height:txId".
     * @returns {Promise<Object|null>} - The deserialized transaction or null if not found.
     */
    async getTransactionByReference(txReference) {
        const [height, txId] = txReference.split(':');

        try {
            // Try to fetch the serialized transaction from the database.
            const serializedTx = await this.db.get(`${height}:${txId}`);

            // Try deserializing the transaction with different methods.
            return this.deserializeTransaction(serializedTx);
        } catch (error) {
            // If the transaction is not found or deserialization fails, return null.
            this.logger.error({ txReference }, 'Transaction not found or failed to deserialize');
            return null;
        }
    }

    /**
     * Deserializes a transaction using the available strategies.
     * @param {Uint8Array} serializedTx - The serialized transaction data.
     * @returns {Object|null} - The deserialized transaction or null if deserialization fails.
     */
    deserializeTransaction(serializedTx) {
        // Try fast deserialization first.
        try {
            return utils.serializerFast.deserialize.transaction(serializedTx);
        } catch (error) {
            this.logger.debug({ error }, 'Failed to fast deserialize transaction');
        }

        // Try the special transaction deserialization if fast deserialization fails.
        try {
            return utils.serializer.transaction.fromBinary_v2(serializedTx);
        } catch (error) {
            this.logger.debug({ error }, 'Failed to deserialize special transaction');
        }

        // Return null if deserialization fails for all strategies.
        this.logger.error('Unable to deserialize transaction using available strategies');
        return null;
    }

    async getLastKnownHeight() {
        const storedHeight = await this.db.get('currentHeight').catch(() => '-1');
        const storedHeightInt = parseInt(storedHeight, 10);
        return storedHeightInt;
    }
}