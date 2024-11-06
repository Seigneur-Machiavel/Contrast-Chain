import { expect } from 'chai';
import sinon from 'sinon';
import { TxValidation, BlockValidation } from '../../src/validations-classes.mjs';
import { Transaction, UTXO, TxOutput, Transaction_Builder } from '../../src/transaction.mjs';
import { BlockData, BlockUtils } from '../../src/block-classes.mjs';
import utils from '../../src/utils.mjs';

describe('Validation Tests', () => {
    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    // Updated mock data
    const mockUtxosByAnchor = {
        '0:abc123:0': { amount: 100, rule: 'sig', address: 'WCHMD65Q7qR2uH9XF5dJ' },
        '1:def456:0': { amount: 200, rule: 'sig', address: 'WCHMD65Q7qR2uH9XF5dK' }
    };

    const mockTransaction = {
        id: 'abc123def456',
        version: 1,
        inputs: ['0:abc123:0'],
        outputs: [{ amount: 50, rule: 'sig', address: 'WCHMD65Q7qR2uH9XF5dL' }],
        witnesses: ['1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef']
    };

    const mockBlockData = {
        index: 1,
        supply: 1000,
        coinBase: 50,
        difficulty: 100,
        legitimacy: 0,
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
        Txs: [
            { id: 'coinbase', inputs: ['0000000000000000'], outputs: [{ amount: 50, address: 'WCHMD65Q7qR2uH9XF5dJ', rule: 'sig' }] },
            mockTransaction
        ],
        posTimestamp: 1000000,
        timestamp: 1000100,
        hash: 'blockhash123',
        nonce: 'nonce123'
    };

    describe('TxValidation', () => {
        describe('isConformTransaction', () => {
            it('should validate a conform transaction', () => {
                expect(async () => await TxValidation.isConformTransaction(mockUtxosByAnchor, mockTransaction, false)).to.not.throw();
            });

            it('should throw for non-conform transaction', () => {
                const invalidTx = { ...mockTransaction, id: 123 }; // Invalid ID type
                expect(async () => await TxValidation.isConformTransaction(mockUtxosByAnchor, invalidTx, false)).to.throw();
            });
        });

        describe('isConformOutput', () => {
            it('should validate a conform output', () => {
                const output = { amount: 50, rule: 'sig', address: 'WCHMD65Q7qR2uH9XF5dJ' };
                expect(() => TxValidation.isConformOutput(output)).to.not.throw();
            });

            it('should throw for non-conform output', () => {
                const invalidOutput = { amount: '50', rule: 'sig', address: 'WCHMD65Q7qR2uH9XF5dJ' }; // Invalid amount type
                expect(() => TxValidation.isConformOutput(invalidOutput)).to.throw();
            });
        });

        describe('calculateRemainingAmount', () => {
            it('should calculate the correct remaining amount', async () => {
                const fee = await TxValidation.calculateRemainingAmount(mockUtxosByAnchor, mockTransaction);
                expect(fee).to.equal(50); // 100 (input) - 50 (output) = 50 (fee)
            });

            it('should throw for invalid remaining amount', () => {
                const invalidTx = {
                    ...mockTransaction,
                    outputs: [{ amount: 150, rule: 'sig', address: 'WCHMD65Q7qR2uH9XF5dJ' }] // More than input
                };
                expect(async () => await TxValidation.calculateRemainingAmount(mockUtxosByAnchor, invalidTx)).to.throw();
            });
        });

        describe('controlTransactionOutputsRulesConditions', () => {
            it('should not throw for valid output rules', async () => {
                await TxValidation.controlTransactionOutputsRulesConditions(mockTransaction);
            });
        });

        describe('controlAllWitnessesSignatures', () => {
            beforeEach(() => {
                sandbox.stub(Transaction_Builder, 'hashId').resolves('abc123def456');
            });

            it('should validate correct signatures', async () => {
                sandbox.stub(utils.ed25519, 'verifyAsync').resolves(true);
                await TxValidation.controlAllWitnessesSignatures(mockTransaction);
            });

            it('should throw for invalid signatures', async () => {
                sandbox.stub(utils.ed25519, 'verifyAsync').resolves(false);
                await expect(TxValidation.controlAllWitnessesSignatures(mockTransaction)).to.eventually.be.rejected;
            });
        });

        describe('addressOwnershipConfirmation', () => {
            beforeEach(() => {
                // If parseWitnesses is a static method of TxValidation
                sandbox.stub(TxValidation, 'parseWitnesses').returns([{ pubKeyHex: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' }]);
            });

            it('should confirm address ownership', async () => {
                sandbox.stub(utils.addressUtils, 'deriveAddress').resolves('WCHMD65Q7qR2uH9XF5dJ');
                await TxValidation.addressOwnershipConfirmation(mockUtxosByAnchor, mockTransaction, {}, true);
            });

            it('should throw for mismatched addresses', async () => {
                sandbox.stub(utils.addressUtils, 'deriveAddress').resolves('WCHMD65Q7qR2uH9XF5dK');
                await expect(TxValidation.addressOwnershipConfirmation(mockUtxosByAnchor, mockTransaction, {}, true)).to.eventually.be.rejected;
            });
        });

        describe('fullTransactionValidation', () => {
            beforeEach(() => {
                sandbox.stub(Transaction_Builder, 'hashId').resolves('abc123def456');
                sandbox.stub(utils.ed25519, 'verifyAsync').resolves(true);
                sandbox.stub(utils.addressUtils, 'deriveAddress').resolves('WCHMD65Q7qR2uH9XF5dJ');
                sandbox.stub(TxValidation, 'parseWitnesses').returns([{ pubKeyHex: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' }]);
            });

            it('should fully validate a correct transaction', async () => {
                const result = await TxValidation.fullTransactionValidation(mockUtxosByAnchor, {}, mockTransaction, false, true);
                expect(result.success).to.be.true;
                expect(result.fee).to.equal(50);
            });
        });
    });

    describe('BlockValidation', () => {
        describe('isTimestampsValid', () => {
            it('should validate correct timestamps', () => {
                const prevBlock = { ...mockBlockData, timestamp: 999999 };
                expect(() => BlockValidation.isTimestampsValid(mockBlockData, prevBlock)).to.not.throw();
            });

            it('should throw for invalid timestamps', () => {
                const prevBlock = { ...mockBlockData, timestamp: 2000000 };
                expect(() => BlockValidation.isTimestampsValid(mockBlockData, prevBlock)).to.throw();
            });
        });

        describe('areExpectedRewards', () => {
            beforeEach(() => {
                sandbox.stub(BlockUtils, 'calculateBlockReward').returns({ powReward: 50, posReward: 50 });
            });

            it('should validate correct rewards', () => {
                const validBlockData = {
                    ...mockBlockData,
                    Txs: [
                        { id: 'powReward', inputs: ['0000000000000000'], outputs: [{ amount: 50, address: 'WCHMD65Q7qR2uH9XF5dJ', rule: 'sig' }] },
                        { id: 'posReward', inputs: ['WCHMD65Q7qR2uH9XF5dJ:hash'], outputs: [{ amount: 50, address: 'WCHMD65Q7qR2uH9XF5dK', rule: 'sig' }] },
                        mockTransaction
                    ]
                };
                expect(async () => await BlockValidation.areExpectedRewards(mockUtxosByAnchor, validBlockData)).to.not.throw();
            });

            it('should throw for incorrect rewards', () => {
                const invalidBlockData = {
                    ...mockBlockData,
                    Txs: [
                        { id: 'powReward', inputs: ['0000000000000000'], outputs: [{ amount: 100, address: 'WCHMD65Q7qR2uH9XF5dJ', rule: 'sig' }] },
                        mockTransaction
                    ]
                };
                expect(async () => await BlockValidation.areExpectedRewards(invalidBlockData)).to.throw();
            });
        });

        describe('isFinalizedBlockDoubleSpending', () => {
            it('should detect no double spending', () => {
                expect(() => BlockValidation.isFinalizedBlockDoubleSpending(mockBlockData)).to.not.throw();
            });

            it('should throw for double spending', () => {
                const doubleSpendBlock = {
                    ...mockBlockData,
                    Txs: [
                        mockBlockData.Txs[0],
                        mockTransaction,
                        { ...mockTransaction, id: 'tx456' } // Using the same input as mockTransaction
                    ]
                };
                expect(() => BlockValidation.isFinalizedBlockDoubleSpending(mockUtxosByAnchor, doubleSpendBlock)).to.throw();
            });
        });
    });
});