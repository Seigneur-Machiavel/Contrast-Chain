import { expect } from 'chai';
import sinon from 'sinon';
import { Blockchain } from '../../src/blockchain.mjs';
import { BlockData, BlockUtils } from '../../src/block-classes.mjs';
import { UtxoCache } from '../../src/utxoCache.mjs';
import utils from '../../src/utils.mjs';
import { Vss } from '../../src/vss.mjs';


describe('Blockchain Save and Load Tests', function () {
    let blockchain;
    let utxoCache;
    let dbPath;
    let vss;
    function generateRandomHex(length) {
        return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16).padStart(2, '0')).join('');
    }


    beforeEach(function () {
        dbPath = './test-db' + Math.random();
        utxoCache = new UtxoCache();
        vss = new Vss();
    });

    afterEach(async function () {
        if (blockchain) {
            await blockchain.closeDB();
        }
        sinon.restore();
    });

    function createGenesisBlock() {
        const timestamp = Date.now();
        const coinbaseTxId = generateRandomHex(8);
        const coinbaseReward = utils.SETTINGS.blockReward;
        const transactions = [
            {
                id: coinbaseTxId,
                inputs: [generateRandomHex(64)],
                outputs: [
                    {
                        amount: coinbaseReward,
                        address: "genesisAddress",
                        rule: "sig",
                        anchor: `${0}:${coinbaseTxId}:${0}`
                    }
                ],
                witnesses: []
            }
        ];

        return BlockData(0, 0, coinbaseReward, 1, 0, "0000000000000000000000000000000000000000000000000000000000000000", transactions, timestamp, timestamp, generateRandomHex(64), "0");
    }

    function createValidBlock(index, prevHash, prevSupply) {
        const timestamp = Date.now();
        const coinbaseTxId = generateRandomHex(8);
        const coinbaseReward = utils.SETTINGS.blockReward / Math.pow(2, Math.floor(index / utils.SETTINGS.halvingInterval));
        const newSupply = prevSupply + coinbaseReward;
        const transactions = [
            {
                id: coinbaseTxId,
                inputs: [generateRandomHex(64)],
                outputs: [
                    {
                        amount: coinbaseReward,
                        address: "testAddress",
                        rule: "sig",
                        anchor: `${index}:${coinbaseTxId}:${0}`
                    }
                ],
                witnesses: []
            }
        ];

        return BlockData(index, newSupply, coinbaseReward, 1, 0, prevHash, transactions, timestamp, timestamp, generateRandomHex(64), index.toString());
    }

    describe('Initialization and Genesis Block', function () {
        it('should initialize with genesis block', async function () {
            const genesisBlock = createGenesisBlock();
            blockchain = new Blockchain('testNodeId');
            await blockchain.init();
            await blockchain.addConfirmedBlocks(utxoCache, [genesisBlock]);

            expect(blockchain.currentHeight).to.equal(0);
            expect(blockchain.lastBlock).to.not.be.null;
            expect(blockchain.lastBlock.index).to.equal(0);
        });
    });

    describe('Save and Load Functionality', function () {
        it('should save blocks to disk', async function () {
            const genesisBlock = createGenesisBlock();
            blockchain = new Blockchain('testNodeId');
            await blockchain.init();
            await blockchain.addConfirmedBlocks(utxoCache, [genesisBlock]);

            const block1 = createValidBlock(1, genesisBlock.hash, genesisBlock.supply);
            const block2 = createValidBlock(2, block1.hash, genesisBlock.supply + block1.coinBase);

            await blockchain.addConfirmedBlocks(utxoCache, [block1, block2]);

            const savedBlock1 = await blockchain.getBlockByHash(block1.hash);
            const savedBlock2 = await blockchain.getBlockByHash(block2.hash);

            expect(savedBlock1.index).to.equal(block1.index);
            expect(savedBlock2.index).to.equal(block2.index);
        });

        it('should load blockchain from disk', async function () {
            // First, create and save some blocks
            const genesisBlock = createGenesisBlock();
            blockchain = new Blockchain('testNodeId');
            await blockchain.init();
            await blockchain.addConfirmedBlocks(utxoCache, [genesisBlock]);

            const block1 = createValidBlock(1, genesisBlock.hash, genesisBlock.supply);
            const block2 = createValidBlock(2, block1.hash, genesisBlock.supply + block1.coinBase);

            await blockchain.addConfirmedBlocks(utxoCache, [block1, block2]);
            const blocks = await blockchain.checkAndHandleReorg(utxoCache);
            await blockchain.applyChainReorg(utxoCache, vss, blocks);
            // Close the first blockchain instance
            await blockchain.closeDB();

            // Now, create a new blockchain instance and load from disk
            const loadedBlockchain = new Blockchain('testNodeId');
            await loadedBlockchain.init();
            const loadedBlocks = await loadedBlockchain.recoverBlocksFromStorage();

            expect(loadedBlocks).to.have.lengthOf(3);
            // Close the loaded blockchain instance
            await loadedBlockchain.closeDB();
        });
    });


});