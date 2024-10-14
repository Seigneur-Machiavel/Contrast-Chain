import { HashFunctions } from "./conCrypto.mjs";
import { UTXO } from "./transaction.mjs";

/**
 * @typedef {Object} StakeReference
 * @property {string} address - Example: "WCHMD65Q7qR2uH9XF5dJ"
 * @property {string} anchor - Example: "0:bdadb7ab:0"
 * @property {number} amount - Example: 100
 */

/**
 * Creates a StakeReference object.
 * @param {string} address - The address of the staker.
 * @param {string} anchor - The anchor of the UTXO.
 * @param {number} amount - The amount staked.
 * @returns {StakeReference}
 */
export const StakeReference = (address, anchor, amount) => {
    return {
        address,
        anchor,
        amount,
    };
};

export class spectrumFunctions {
    /**
     * Returns the highest upper bound in the spectrum.
     * Since spectrum is now an object, we'll need to calculate bounds based on stake amounts.
     * @param {Object<string, StakeReference | null>} spectrum
     * @param {number} maxSupply
     */
    static getHighestUpperBound(spectrum, maxSupply) {
        let total = 0;
        for (const key in spectrum) {
            if (spectrum[key]) { // Check if the stake is not null
                total += spectrum[key].amount;
            }
        }
        return total;
    }

    /**
     * Gets the StakeReference corresponding to a given index.
     * Since spectrum is an object, we'll iterate and accumulate to find the correct stake.
     * @param {Object<string, StakeReference | null>} spectrum
     * @param {number} index - The index to search for.
     * @param {number} maxSupply
     */
    static getStakeReferenceFromIndex(spectrum, index, maxSupply) {
        let accumulated = 0;
        for (const key in spectrum) {
            const stake = spectrum[key];
            if (stake) { // Ensure stake is not null
                accumulated += stake.amount;
                if (index < accumulated) {
                    return stake;
                }
            }
        }
        return undefined;
    }

    // LOTTERY FUNCTIONS
    /**
     * Will return a number between 0 and maxRange from a blockHash - ensures the result is unbiased.
     * @param {string} blockHash
     * @param {number} lotteryRound
     * @param {number} maxRange
     * @param {number} maxAttempts
     * @returns {Promise<number>}
     */
    static async hashToIntWithRejection(
        blockHash,
        lotteryRound = 0,
        maxRange = 1000000,
        maxAttempts = 1000
    ) {
        let nonce = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Generate a hash including the nonce to get different results if needed
            const hash = await HashFunctions.SHA256(`${lotteryRound}${blockHash}${nonce}`);
            const hashInt = BigInt('0x' + hash);

            // Calculate the maximum acceptable range to avoid bias
            const maxAcceptableValue = (BigInt(2) ** BigInt(256) / BigInt(maxRange)) * BigInt(maxRange);

            if (hashInt < maxAcceptableValue) {
                return Number(hashInt % BigInt(maxRange));
            } else {
                nonce++; // Increment the nonce to try a new hash
            }
        }

        throw new Error("Max attempts reached. Consider increasing maxAttempts or revising the method.");
    }
}

export class Vss {
    /**
     * @param {number} maxSupply - The maximum supply value to be used in the VSS.
     * @param {number} totalSlots - Total number of slots available.
     */
    constructor(maxSupply, totalSlots) {
        /** Validator Selection Spectrum (VSS)
         * An object where each key is the slot ID, and the value is the StakeReference or null if empty.
         * @type {Object<number, StakeReference | null>}
         */
        this.spectrum = {};
        for (let i = 0; i < totalSlots; i++) {
            this.spectrum[i] = null; // Initialize all slots as empty
        }

        /** @type {StakeReference[]} */
        this.legitimacies = []; // The order of the stakes in the array is the order of legitimacy
        this.currentRoundHash = '';

        /** @type {number} */
        this.maxSupply = maxSupply; // Store the maxSupply passed in the constructor

        /** @type {Set<number>} */
        this.availableSlots = new Set([...Array(totalSlots).keys()]); // Set of available slot IDs
    }

    /**
     * Finds an available slot.
     * @returns {number} - The slot ID or -1 if no slots are available.
     */
    findAvailableSlot() {
        if (this.availableSlots.size === 0) return -1;
        return this.availableSlots.values().next().value;
    }

    /**
     * Finds an available slot specifically for reusing an empty slot.
     * @returns {number} - The slot ID or -1 if no slots are available.
     */
    findReusableSlot() {
        return this.findAvailableSlot();
    }

    /**
     * Checks if adding a stake would exceed the max supply.
     * @param {number} amount
     * @returns {boolean}
     */
    canAccommodate(amount) {
        const totalStaked = this.getTotalStaked();
        return (totalStaked + amount) <= this.maxSupply;
    }

    /**
     * Calculates the total amount staked in the spectrum.
     * @returns {number}
     */
    getTotalStaked() {
        let total = 0;
        for (const key in this.spectrum) {
            if (this.spectrum[key]) {
                total += this.spectrum[key].amount;
            }
        }
        return total;
    }

    /**
     * Adds a new stake to the spectrum.
     * Distinguishes between taking a new slot or reusing an empty slot.
     * @param {UTXO} utxo
     * @param {number} [cost] - The cost of staking, may be reduced if using a freed slot.
     */
    newStake(utxo, cost = 0) {
        const address = utxo.address;
        const anchor = utxo.anchor;
        const amount = utxo.amount;

        if (amount <= 0) {
            throw new Error('Invalid stake amount.');
        }

        // Check if the stake already exists by anchor
        for (const slot in this.spectrum) {
            if (this.spectrum[slot] && this.spectrum[slot].anchor === anchor) {
                throw new Error('VSS: Stake with this anchor already exists.');
            }
        }

        if (!this.canAccommodate(amount)) {
            throw new Error('VSS: Max supply reached or insufficient available supply.');
        }

        const slotId = this.findAvailableSlot();
        if (slotId === -1) {
            throw new Error('VSS: No available slots.');
        }

        // Assign the stake to the found slot
        this.spectrum[slotId] = StakeReference(address, anchor, amount);
        this.availableSlots.delete(slotId);
    }

    /**
     * Adds multiple stakes to the spectrum.
     * @param {UTXO[]} utxos
     * @param {number} [cost] - The cost of staking, may be reduced if using freed slots.
     */
    newStakes(utxos, cost = 0) {
        for (const utxo of utxos) {
            this.newStake(utxo, cost);
        }
    }

    /**
     * Unstakes a stake based on the given anchor.
     * Frees up the slot for future use.
     * @param {string} anchor
     */
    unstake(anchor) {
        for (const slot in this.spectrum) {
            if (this.spectrum[slot] && this.spectrum[slot].anchor === anchor) {
                this.spectrum[slot] = null;
                this.availableSlots.add(Number(slot));
                return;
            }
        }
        throw new Error('VSS: Stake not found.');
    }

    /**
     * Calculates the legitimacies for the current round.
     * @param {string} blockHash
     * @param {number} maxResultingArrayLength
     */
    async calculateRoundLegitimacies(blockHash, maxResultingArrayLength = 100) {
        if (blockHash === this.currentRoundHash) {
            return; // already calculated
        }

        /** @type {StakeReference[]} */
        const roundLegitimacies = [];
        const spectrumLength = Object.keys(this.spectrum).filter(key => this.spectrum[key] !== null).length;

        const maxRange = spectrumFunctions.getHighestUpperBound(this.spectrum, this.maxSupply);

        // Early exit if maxRange is insufficient
        if (maxRange > this.maxSupply) {
            this.legitimacies = roundLegitimacies;
            this.currentRoundHash = blockHash;
            console.warn('Insufficient range for max supply.');
            return;
        }

        for (let i = 0; i < maxResultingArrayLength * 4; i++) {
            const winningNumber = await spectrumFunctions.hashToIntWithRejection(
                blockHash,
                i,
                maxRange
            );
            // Can't be existing winner
            const stakeReference = spectrumFunctions.getStakeReferenceFromIndex(
                this.spectrum,
                winningNumber,
                maxRange
            );
            if (!stakeReference) {
                continue;
            }
            if (roundLegitimacies.find((stake) => stake.anchor === stakeReference.anchor)) {
                continue;
            }

            roundLegitimacies.push(stakeReference);

            if (roundLegitimacies.length >= spectrumLength) {
                break; // If all stakes have been selected
            }
            if (roundLegitimacies.length >= maxResultingArrayLength) {
                break; // If the array is full
            }
        }

        this.legitimacies = roundLegitimacies;
        this.currentRoundHash = blockHash;
    }

    /**
     * Gets the legitimacy index of an address.
     * @param {string} address
     * @returns {number} - The legitimacy index or the length of legitimacies if not found.
     */
    getAddressLegitimacy(address) {
        const legitimacy = this.legitimacies.findIndex(
            (stakeReference) => stakeReference.address === address
        );
        return legitimacy !== -1 ? legitimacy : this.legitimacies.length; // if not found, return last index + 1
    }

    /**
     * Gets all stakes info for an address.
     * @param {string} address
     * @returns {StakeReference[]}
     */
    getAddressStakesInfo(address) {
        const references = Object.values(this.spectrum).filter(
            (stakeReference) => stakeReference && stakeReference.address === address
        );
        return references;
    }

    /**
     * Retrieves the slot ID for a given anchor.
     * @param {string} anchor
     * @returns {number} - The slot ID or -1 if not found.
     */
    getSlotByAnchor(anchor) {
        for (const slot in this.spectrum) {
            if (this.spectrum[slot] && this.spectrum[slot].anchor === anchor) {
                return Number(slot);
            }
        }
        return -1;
    }

    /**
     * Retrieves the StakeReference by slot ID.
     * @param {number} slotId
     * @returns {StakeReference | null}
     */
    getStakeBySlot(slotId) {
        if (this.spectrum.hasOwnProperty(slotId)) {
            return this.spectrum[slotId];
        }
        return null;
    }

    /**
     * Retrieves all occupied slots.
     * @returns {number[]}
     */
    getOccupiedSlots() {
        return Object.keys(this.spectrum)
            .filter(slot => this.spectrum[slot] !== null)
            .map(Number);
    }

    /**
     * Retrieves all empty slots.
     * @returns {number[]}
     */
    getEmptySlots() {
        return Array.from(this.availableSlots);
    }
}
