// test/vss.test.js
import { strict as assert } from 'assert';
import { Vss, spectrumFunctions, StakeReference } from '../src/vss.mjs';
import crypto from 'crypto';

// Mock UTXO class
class UTXO {
    constructor(address, anchor, amount) {
        this.address = address;
        this.anchor = anchor;
        this.amount = amount;
    }
}

// Define the maxSupply to be used in tests
const maxSupply = 1_000_000;

describe('Vss Class', () => {
    let vss;

    beforeEach(() => {
        vss = new Vss(maxSupply);
    });

    describe('constructor', () => {
        it('should initialize spectrum and legitimacies', () => {
            assert.deepEqual(vss.spectrum, {});
            assert.deepEqual(vss.legitimacies, []);
            assert.equal(vss.currentRoundHash, '');
            assert.equal(vss.maxSupply, maxSupply);
        });
    });

    describe('newStake', () => {
        it('should add a new stake to the spectrum without upperBound', () => {
            const utxo = new UTXO('address1', '0:anchor1', 100);
            vss.newStake(utxo);

            const expectedUpperBound = 100; // Since the spectrum was empty, lastUpperBound is 0
            assert.equal(Object.keys(vss.spectrum).length, 1);
            assert.deepEqual(
                vss.spectrum[expectedUpperBound],
                StakeReference('address1', '0:anchor1', 100)
            );
        });

        it('should add multiple stakes correctly without upperBounds', () => {
            const utxo1 = new UTXO('address1', '0:anchor1', 100);
            const utxo2 = new UTXO('address2', '0:anchor2', 200);

            vss.newStake(utxo1);
            vss.newStake(utxo2);

            assert.equal(Object.keys(vss.spectrum).length, 2);
            assert.deepEqual(
                vss.spectrum[100],
                StakeReference('address1', '0:anchor1', 100)
            );
            assert.deepEqual(
                vss.spectrum[300],
                StakeReference('address2', '0:anchor2', 200)
            );
        });

        it('should add a new stake with upperBound specified', () => {
            const utxo = new UTXO('address1', '0:anchor1', 100);
            vss.newStake(utxo, 200);

            assert.equal(Object.keys(vss.spectrum).length, 1);
            assert.deepEqual(
                vss.spectrum[200],
                StakeReference('address1', '0:anchor1', 100)
            );
        });

        it('should throw error when adding overlapping stakes', () => {
            const utxo1 = new UTXO('address1', '0:anchor1', 100);
            const utxo2 = new UTXO('address2', '0:anchor2', 50);

            vss.newStake(utxo1, 150);

            assert.throws(() => {
                vss.newStake(utxo2, 160);
            }, /VSS: Overlapping stake ranges/);
        });

        it('should throw error when max supply is exceeded', () => {
            const utxo = new UTXO('address1', '0:anchor1', maxSupply + 1);

            assert.throws(() => {
                vss.newStake(utxo);
            }, /VSS: Max supply reached/);
        });
    });

    describe('newStakes', () => {
        it('should add multiple stakes using newStakes method', () => {
            const utxos = [
                new UTXO('address1', '0:anchor1', 100),
                new UTXO('address2', '0:anchor2', 200),
            ];

            vss.newStakes(utxos);

            assert.equal(Object.keys(vss.spectrum).length, 2);
            assert.deepEqual(
                vss.spectrum[100],
                StakeReference('address1', '0:anchor1', 100)
            );
            assert.deepEqual(
                vss.spectrum[300],
                StakeReference('address2', '0:anchor2', 200)
            );
        });
    });

    describe('calculateRoundLegitimacies', () => {
        it('should calculate legitimacies correctly', async () => {
            const utxos = [
                new UTXO('address1', '0:anchor1', 300000),
                new UTXO('address2', '0:anchor2', 400000),
                new UTXO('address3', '0:anchor3', 300000),
            ];
            vss.newStakes(utxos);

            const blockHash = 'blockhash1';

            await vss.calculateRoundLegitimacies(blockHash);

            assert.equal(vss.legitimacies.length, 3);

            // Verify that all addresses are present in legitimacies
            const expectedAddresses = ['address1', 'address2', 'address3'];
            const legitimacyAddresses = vss.legitimacies.map(
                (legitimacy) => legitimacy.address
            );

            expectedAddresses.forEach((address) => {
                assert(
                    legitimacyAddresses.includes(address),
                    `Address ${address} is not in legitimacies`
                );
            });
        });

        it('should not recalculate legitimacies if the blockHash is the same', async () => {
            const utxos = [
                new UTXO('address1', '0:anchor1', 300000),
                new UTXO('address2', '0:anchor2', 400000),
                new UTXO('address3', '0:anchor3', 300000),
            ];
            vss.newStakes(utxos);

            const blockHash = 'blockhash1';

            await vss.calculateRoundLegitimacies(blockHash);

            const legitimaciesFirstCall = [...vss.legitimacies];

            await vss.calculateRoundLegitimacies(blockHash);

            const legitimaciesSecondCall = vss.legitimacies;

            assert.deepEqual(legitimaciesFirstCall, legitimaciesSecondCall);
        });
    });

    describe('getAddressLegitimacy', () => {
        beforeEach(async () => {
            const utxos = [
                new UTXO('address1', '0:anchor1', 300000),
                new UTXO('address2', '0:anchor2', 400000),
                new UTXO('address3', '0:anchor3', 300000),
            ];
            vss.newStakes(utxos);

            await vss.calculateRoundLegitimacies('blockhash1');
        });

        it('should return a valid legitimacy index for an address', () => {
            const legitimacyIndex = vss.getAddressLegitimacy('address1');
            assert(
                legitimacyIndex >= 0 && legitimacyIndex < vss.legitimacies.length,
                'Legitimacy index is out of bounds'
            );
        });

        it('should return length of legitimacies if address is not found', () => {
            const legitimacyIndex = vss.getAddressLegitimacy('address4');
            assert.equal(legitimacyIndex, vss.legitimacies.length);
        });
    });

    describe('getAddressStakesInfo', () => {
        beforeEach(async () => {
            const utxos = [
                new UTXO('address1', '0:anchor1', 300000),
                new UTXO('address1', '0:anchor2', 100000),
                new UTXO('address2', '0:anchor3', 600000),
            ];
            vss.newStakes(utxos);

            await vss.calculateRoundLegitimacies('blockhash1');
        });

        it('should return all stakes info for an address', () => {
            const stakesInfo = vss.getAddressStakesInfo('address1');
            assert.equal(stakesInfo.length, 2); // Expecting 2 stakes for 'address1'
            stakesInfo.forEach((stake) => {
                assert.equal(stake.address, 'address1');
            });
        });
    });
});

describe('spectrumFunctions Module', () => {
    describe('getHighestUpperBound', () => {
        it('should return 0 for empty spectrum', () => {
            const spectrum = {};
            const result = spectrumFunctions.getHighestUpperBound(spectrum);
            assert.equal(result, 0);
        });

        it('should return the highest upper bound in the spectrum', () => {
            const spectrum = {
                '100': StakeReference('address1', '0:anchor1', 100),
                '300': StakeReference('address2', '0:anchor2', 200),
                '450': StakeReference('address3', '0:anchor3', 150),
            };
            const result = spectrumFunctions.getHighestUpperBound(spectrum);
            assert.equal(result, 450);
        });
    });

    describe('getStakeReferenceFromIndex', () => {
        it('should return undefined for empty spectrum', () => {
            const spectrum = {};
            const result = spectrumFunctions.getStakeReferenceFromIndex(
                spectrum,
                50
            );
            assert.equal(result, undefined);
        });

        it('should return the correct stake reference for a given index', () => {
            const spectrum = {
                '100': StakeReference('address1', '0:anchor1', 100),
                '300': StakeReference('address2', '0:anchor2', 200),
                '450': StakeReference('address3', '0:anchor3', 150),
            };

            let result = spectrumFunctions.getStakeReferenceFromIndex(
                spectrum,
                50
            );
            assert.deepEqual(result, spectrum['100']);

            result = spectrumFunctions.getStakeReferenceFromIndex(spectrum, 250);
            assert.deepEqual(result, spectrum['300']);

            result = spectrumFunctions.getStakeReferenceFromIndex(spectrum, 400);
            assert.deepEqual(result, spectrum['450']);

            result = spectrumFunctions.getStakeReferenceFromIndex(spectrum, 500);
            assert.equal(result, undefined);
        });
    });

    describe('hashToIntWithRejection', () => {
        it('should return a number between minRange and maxRange', async () => {
            const blockHash = 'blockhash1';
            const minRange = 0;
            const maxRange = 1_000_000;

            const result = await spectrumFunctions.hashToIntWithRejection(
                blockHash,
                minRange,
                maxRange
            );

            assert.equal(typeof result, 'number');
            assert(result >= minRange && result < maxRange);
        });

        it('should throw an error if maxAttempts are reached', async () => {
            // Temporarily override HashFunctions.SHA256 to always return a high value
            const originalSHA256 = spectrumFunctions.HashFunctions.SHA256;
            spectrumFunctions.HashFunctions.SHA256 = async () => 'f'.repeat(64); // Max value

            const blockHash = 'blockhash1';
            const minRange = 0;
            const maxRange = 1_000_000;
            const maxAttempts = 3;

            try {
                await spectrumFunctions.hashToIntWithRejection(
                    blockHash,
                    minRange,
                    maxRange,
                    maxAttempts
                );
                assert.fail('Expected error was not thrown');
            } catch (error) {
                assert.match(error.message, /Max attempts reached/);
            } finally {
                // Restore original hash function
                spectrumFunctions.HashFunctions.SHA256 = originalSHA256;
            }
        });
    });
});
