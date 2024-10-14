// test/vss.test.mjs

import { expect } from 'chai';
import sinon from 'sinon';
import { Vss, StakeReference, spectrumFunctions } from '../src/vss.mjs'; // Import spectrumFunctions
import { HashFunctions } from '../src/conCrypto.mjs';

// Mock UTXO class
class UTXO {
    /**
     * @param {string} address
     * @param {string} anchor
     * @param {number} amount
     */
    constructor(address, anchor, amount) {
        this.address = address;
        this.anchor = anchor;
        this.amount = amount;
    }
}

describe('Vss Class Test Suite', function () {
    let vss;
    const maxSupply = 1000;
    const totalSlots = 5;

    // Sample UTXOs
    const utxo1 = new UTXO("Address1", "Anchor1", 100);
    const utxo2 = new UTXO("Address2", "Anchor2", 200);
    const utxo3 = new UTXO("Address3", "Anchor3", 300);
    const utxo4 = new UTXO("Address4", "Anchor4", 400);
    const utxo5 = new UTXO("Address5", "Anchor5", 500);

    beforeEach(function () {
        // Initialize Vss instance before each test
        vss = new Vss(maxSupply, totalSlots);
    });

    afterEach(function () {
        // Restore the default sandbox here
        sinon.restore();
    });

    describe('Initialization', function () {
        it('should initialize with correct maxSupply and totalSlots', function () {
            expect(vss.maxSupply).to.equal(maxSupply);
            expect(Object.keys(vss.spectrum)).to.have.lengthOf(totalSlots);
            expect(vss.getOccupiedSlots()).to.be.empty;
            expect(vss.getEmptySlots()).to.have.lengthOf(totalSlots);
        });

        it('should initialize all slots as empty', function () {
            for (let i = 0; i < totalSlots; i++) {
                expect(vss.getStakeBySlot(i)).to.be.null;
            }
        });
    });

    describe('Adding Stakes', function () {
        it('should add a new stake successfully', function () {
            vss.newStake(utxo1);
            const occupiedSlots = vss.getOccupiedSlots();
            expect(occupiedSlots).to.have.lengthOf(1);
            const stake = vss.getStakeBySlot(occupiedSlots[0]);
            expect(stake).to.deep.equal(StakeReference(utxo1.address, utxo1.anchor, utxo1.amount));
            expect(vss.getEmptySlots()).to.have.lengthOf(totalSlots - 1);
        });

        it('should add multiple stakes successfully', function () {
            vss.newStakes([utxo1, utxo2, utxo3]);
            const occupiedSlots = vss.getOccupiedSlots();
            expect(occupiedSlots).to.have.lengthOf(3);
            expect(vss.getEmptySlots()).to.have.lengthOf(totalSlots - 3);

            // Verify each stake
            occupiedSlots.forEach((slot, index) => {
                const utxo = [utxo1, utxo2, utxo3][index];
                const stake = vss.getStakeBySlot(slot);
                expect(stake).to.deep.equal(StakeReference(utxo.address, utxo.anchor, utxo.amount));
            });
        });

        it('should reuse an empty slot when available', function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);
            vss.unstake(utxo1.anchor); // Free up a slot

            vss.newStake(utxo3);
            const occupiedSlots = vss.getOccupiedSlots();
            expect(occupiedSlots).to.have.lengthOf(2);
            const stake = vss.getStakeBySlot(occupiedSlots.find(slot => vss.getStakeBySlot(slot).anchor === utxo3.anchor));
            expect(stake).to.deep.equal(StakeReference(utxo3.address, utxo3.anchor, utxo3.amount));
            expect(vss.getEmptySlots()).to.have.lengthOf(totalSlots - 2);
        });

        it('should throw an error when adding a stake with duplicate anchor', function () {
            vss.newStake(utxo1);
            const duplicateUTXO = new UTXO("AddressDuplicate", utxo1.anchor, 150);
            expect(() => vss.newStake(duplicateUTXO)).to.throw('VSS: Stake with this anchor already exists.');
        });

        it('should throw an error when maxSupply is exceeded', function () {
            const highAmountUTXO = new UTXO("AddressHigh", "AnchorHigh", maxSupply + 1);
            expect(() => vss.newStake(highAmountUTXO)).to.throw('VSS: Max supply reached or insufficient available supply.');
        });

        it('should throw an error when adding a stake with amount <= 0', function () {
            const invalidUTXO = new UTXO("AddressInvalid", "AnchorInvalid", 0);
            expect(() => vss.newStake(invalidUTXO)).to.throw('Invalid stake amount.');
        });

        it('should throw an error when no slots are available', function () {
            // Add stakes to fill all slots
            const utxos = [
                new UTXO("A1", "AN1", 100),
                new UTXO("A2", "AN2", 100),
                new UTXO("A3", "AN3", 100),
                new UTXO("A4", "AN4", 100),
                new UTXO("A5", "AN5", 100),
            ];
            vss.newStakes(utxos);

            // Attempt to add another stake
            const extraUTXO = new UTXO("A6", "AN6", 100);
            expect(() => vss.newStake(extraUTXO)).to.throw('VSS: No available slots.');
        });
    });

    describe('Unstaking', function () {
        it('should unstake successfully and free up the slot', function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);
            vss.unstake(utxo1.anchor);

            const occupiedSlots = vss.getOccupiedSlots();
            expect(occupiedSlots).to.have.lengthOf(1);
            const remainingStake = vss.getStakeBySlot(occupiedSlots[0]);
            expect(remainingStake).to.deep.equal(StakeReference(utxo2.address, utxo2.anchor, utxo2.amount));
            expect(vss.getEmptySlots()).to.have.lengthOf(totalSlots - 1);
        });

        it('should throw an error when trying to unstake a non-existent anchor', function () {
            expect(() => vss.unstake("NonExistentAnchor")).to.throw('VSS: Stake not found.');
        });
    });

    describe('Legitimacy Calculations', function () {
        let sha256Stub;

        beforeEach(function () {
            // Stub HashFunctions.SHA256 to return predictable hashes
            sha256Stub = sinon.stub(HashFunctions, 'SHA256');

            // Define specific return values for each call to simulate different winning numbers
            // This ensures that different stakes are selected during legitimacy calculations

            // Example Mapping:
            // - utxo1: amount = 100 (indices 0-99)
            // - utxo2: amount = 200 (indices 100-299)
            // - utxo3: amount = 300 (indices 300-599)
            // - utxo4: amount = 400 (indices 600-999)
            // - utxo5: amount = 500 (indices 1000-1499) [Note: exceeds maxSupply=1000]

            // To map to different stakes, we'll return winningNumbers that fall into different ranges

            // For the first test, we want to map to utxo1 and utxo2

            // Define the mapping:
            // - First call: winningNumber = 50 (utxo1)
            // - Second call: winningNumber = 150 (utxo2)
            // - Third call: winningNumber = 250 (utxo2)
            // - Fourth call: winningNumber = 350 (utxo3)
            // - etc.

            // Convert these numbers to hex and pad to 64 characters
            const winningNumbers = [50, 150, 250, 350, 450, 550, 650, 750, 850, 950];

            winningNumbers.forEach((num) => {
                const hexString = num.toString(16).padStart(64, '0');
                sha256Stub.onCall(winningNumbers.indexOf(num)).resolves(hexString);
            });
        });

        it('should calculate legitimacies correctly', async function () {
            // Add some stakes
            vss.newStake(utxo1); // 100
            vss.newStake(utxo2); // 200
            vss.newStake(utxo3); // 300

            // Calculate maxRange
            const maxRange = spectrumFunctions.getHighestUpperBound(vss.spectrum, vss.maxSupply);
            expect(maxRange).to.equal(600); // 100 + 200 + 300

            // Define the stub behavior for SHA256 calls
            // As per the beforeEach, the first two calls map to utxo1 and utxo2

            await vss.calculateRoundLegitimacies('BlockHash1', 2);

            expect(vss.legitimacies).to.have.lengthOf(2);
            const anchors = vss.legitimacies.map(stake => stake.anchor);
            expect(anchors).to.include.members([utxo1.anchor, utxo2.anchor]);
        });

        it('should not recalculate legitimacies if blockHash is unchanged', async function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);

            // Initial calculation
            await vss.calculateRoundLegitimacies('BlockHash1', 2);
            expect(vss.legitimacies).to.have.lengthOf(2);

            // Attempt to recalculate with the same blockHash
            await vss.calculateRoundLegitimacies('BlockHash1', 2);
            expect(vss.legitimacies).to.have.lengthOf(2); // Should remain unchanged

            // Verify that SHA256 was called only during the first calculation
            expect(HashFunctions.SHA256.callCount).to.equal(2);
        });

        it('should handle maxRange insufficiency gracefully', async function () {
            // Add stakes summing to 900 (less than maxSupply=1000)
            const utxoOverflow = new UTXO("AddressOverflow", "AnchorOverflow", 900);
            vss.newStake(utxoOverflow);
        
            // Stub getHighestUpperBound to return 1001 (> maxSupply=1000)
            const getHighestUpperBoundStub = sinon.stub(spectrumFunctions, 'getHighestUpperBound').returns(1001);
        
            // Calculate round legitimacies
            await vss.calculateRoundLegitimacies('BlockHash2', 10);
            expect(vss.legitimacies).to.be.empty;
            expect(vss.currentRoundHash).to.equal('BlockHash2');
        
            // Restore the stub
            getHighestUpperBoundStub.restore();
        });
        
    });

    describe('Utility Methods', function () {
        it('should get legitimacy index correctly', async function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);
            vss.newStake(utxo3);
        
            // Stub HashFunctions.SHA256 for legitimacy calculation
            const sha256Stub = sinon.stub(HashFunctions, 'SHA256');
            // Map the first four calls to select utxo1, utxo2, utxo2, utxo3 respectively
            sha256Stub.onCall(0).resolves('0000000000000000000000000000000000000000000000000000000000000032'); // 50
            sha256Stub.onCall(1).resolves('0000000000000000000000000000000000000000000000000000000000000096'); // 150
            sha256Stub.onCall(2).resolves('00000000000000000000000000000000000000000000000000000000000000FA'); // 250
            sha256Stub.onCall(3).resolves('000000000000000000000000000000000000000000000000000000000000015E'); // 350
        
            await vss.calculateRoundLegitimacies('BlockHash3', 3);
        
            const legitimacyIndex1 = vss.getAddressLegitimacy(utxo1.address);
            const legitimacyIndex2 = vss.getAddressLegitimacy(utxo2.address);
            const legitimacyIndex3 = vss.getAddressLegitimacy(utxo3.address);
            const legitimacyIndex4 = vss.getAddressLegitimacy("NonExistentAddress");
        
            expect(legitimacyIndex1).to.equal(0);
            expect(legitimacyIndex2).to.equal(1);
            expect(legitimacyIndex3).to.equal(2);
            expect(legitimacyIndex4).to.equal(vss.legitimacies.length);
        
            // Restore the stub
            sha256Stub.restore();
        });
        

        it('should get all stakes info for an address', function () {
            const utxoDuplicate = new UTXO("Address1", "AnchorDuplicate1", 150);
            vss.newStake(utxo1);
            vss.newStake(utxo2);
            vss.newStake(utxoDuplicate);

            const stakesInfo = vss.getAddressStakesInfo("Address1");
            expect(stakesInfo).to.have.lengthOf(2);
            expect(stakesInfo).to.deep.include.members([
                StakeReference(utxo1.address, utxo1.anchor, utxo1.amount),
                StakeReference(utxoDuplicate.address, utxoDuplicate.anchor, utxoDuplicate.amount),
            ]);

            const noStakesInfo = vss.getAddressStakesInfo("UnknownAddress");
            expect(noStakesInfo).to.be.empty;
        });

        it('should retrieve slot ID by anchor correctly', function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);

            const slotId1 = vss.getSlotByAnchor(utxo1.anchor);
            const slotId2 = vss.getSlotByAnchor(utxo2.anchor);
            const slotIdInvalid = vss.getSlotByAnchor("NonExistentAnchor");

            expect(slotId1).to.be.a('number');
            expect(slotId2).to.be.a('number');
            expect(slotIdInvalid).to.equal(-1);
            expect(slotId1).to.not.equal(slotId2);
        });

        it('should retrieve stake by slot correctly', function () {
            vss.newStake(utxo1);
            const occupiedSlots = vss.getOccupiedSlots();
            const slotId = occupiedSlots[0];

            const stake = vss.getStakeBySlot(slotId);
            expect(stake).to.deep.equal(StakeReference(utxo1.address, utxo1.anchor, utxo1.amount));

            const stakeInvalid = vss.getStakeBySlot(999);
            expect(stakeInvalid).to.be.null;
        });

        it('should retrieve all occupied slots correctly', function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);
            vss.newStake(utxo3);

            const occupiedSlots = vss.getOccupiedSlots();
            expect(occupiedSlots).to.have.lengthOf(3);
            occupiedSlots.forEach(slot => {
                expect(vss.getStakeBySlot(slot)).to.not.be.null;
            });
        });

        it('should retrieve all empty slots correctly', function () {
            vss.newStake(utxo1);
            vss.newStake(utxo2);

            const emptySlots = vss.getEmptySlots();
            expect(emptySlots).to.have.lengthOf(totalSlots - 2);
            emptySlots.forEach(slot => {
                expect(vss.getStakeBySlot(slot)).to.be.null;
            });
        });
    });
});
