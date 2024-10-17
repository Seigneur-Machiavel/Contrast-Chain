import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} PeerInfo
 * @property {string} [peerId] - The unique identifier of the peer.
 * @property {string} [ip] - The IP address of the peer.
 * @property {string} [address] - The crypto wallet address of the peer.
 */

class ReputationManager extends EventEmitter {
    constructor(options = {}) {
        super();
        const defaultOptions = {
            banThreshold: -10, // Default ban threshold
            banPermanentScore: -100,
            scoreFilePath: path.resolve('peer-reputation.json'),
            defaultScore: 0,
            tempBanDuration: 24 * 60 * 60 * 1000, // 24 hours
            cleanupInterval: 60 * 60 * 1000, // 1 hour
            offenseScoreMap: {},
        };
        this.options = { ...defaultOptions, ...options };

        /** @type {Map<string, number>} */
        this.identifierScores = new Map(); // Map of identifier (peerId, ip, address) -> score

        /** @type {Map<string, { permanent: boolean, expiresAt?: number }>} */
        this.identifierBans = new Map(); // Map of identifier -> ban info

        /** @type {Map<string, Set<string>>} */
        this.identifierAssociations = new Map(); // Map of identifier -> Set of associated identifiers

        // Define score decrements for each offense
        this.offenseScoreMap = {
            // Major Faults
            [ReputationManager.OFFENSE_TYPES.INVALID_BLOCK_SUBMISSION]: 10,
            [ReputationManager.OFFENSE_TYPES.LOW_LEGITIMACY_BLOCK_SUBMISSION]: 7,
            [ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING]: 5,
            [ReputationManager.OFFENSE_TYPES.DOUBLE_SIGNING]: 20,
            [ReputationManager.OFFENSE_TYPES.SYBIL_ATTACK]: 15,
            [ReputationManager.OFFENSE_TYPES.INVALID_TRANSACTION_PROPAGATION]: 8,
            [ReputationManager.OFFENSE_TYPES.CONSENSUS_MANIPULATION]: 25,
            [ReputationManager.OFFENSE_TYPES.DOS_ATTACK]: 30,

            // Minor Faults
            [ReputationManager.OFFENSE_TYPES.FREQUENT_RESYNC_REQUESTS]: 3,
            [ReputationManager.OFFENSE_TYPES.EXCESSIVE_BLOCK_INDEXING]: 2,
            [ReputationManager.OFFENSE_TYPES.MINOR_PROTOCOL_VIOLATIONS]: 1,
            [ReputationManager.OFFENSE_TYPES.LOW_RESOURCE_UTILIZATION]: 1,
            [ReputationManager.OFFENSE_TYPES.TRANSIENT_CONNECTIVITY_ISSUES]: 2,
        };

        // Allow overriding offense scores via options
        if (this.options.offenseScoreMap) {
            this.offenseScoreMap = { ...this.offenseScoreMap, ...this.options.offenseScoreMap };
        }

        this.loadScoresFromDisk();

        // Periodically clean up expired temporary bans
        this.banCleanupInterval = setInterval(() => this.cleanupExpiredBans(), this.options.cleanupInterval);
    }

    static OFFENSE_TYPES = {
        // Major Faults
        INVALID_BLOCK_SUBMISSION: 'Invalid Block Submission',
        LOW_LEGITIMACY_BLOCK_SUBMISSION: 'Low Legitimacy Block Submission',
        MESSAGE_SPAMMING: 'Message Spamming',
        DOUBLE_SIGNING: 'Double-Signing / Equivocation',
        SYBIL_ATTACK: 'Sybil Attack',
        INVALID_TRANSACTION_PROPAGATION: 'Invalid Transaction Propagation',
        CONSENSUS_MANIPULATION: 'Consensus Manipulation',
        DOS_ATTACK: 'DoS Attack',

        // Minor Faults
        FREQUENT_RESYNC_REQUESTS: 'Frequent Resync Requests',
        EXCESSIVE_BLOCK_INDEXING: 'Excessive Block Indexing',
        MINOR_PROTOCOL_VIOLATIONS: 'Minor Protocol Violations',
        LOW_RESOURCE_UTILIZATION: 'Low Resource Utilization',
        TRANSIENT_CONNECTIVITY_ISSUES: 'Transient Connectivity Issues',
    };

    /**
     * Load scores and bans from disk when the node starts.
     */
    loadScoresFromDisk() {
        if (fs.existsSync(this.options.scoreFilePath)) {
            const data = JSON.parse(fs.readFileSync(this.options.scoreFilePath, 'utf8'));
            this.identifierScores = new Map(data.identifierScores);
            this.identifierBans = new Map(data.identifierBans);
            this.identifierAssociations = new Map();
            const associations = data.identifierAssociations || [];
            for (const [key, value] of associations) {
                this.identifierAssociations.set(key, new Set(value));
            }
        } else {
            // Initialize empty maps if the file doesn't exist
            this.identifierScores = new Map();
            this.identifierBans = new Map();
            this.identifierAssociations = new Map();
        }
    }
    /**
     * Save scores and bans to disk on shutdown.
     */
    saveScoresToDisk() {
        const data = {
            identifierScores: Array.from(this.identifierScores.entries()),
            identifierBans: Array.from(this.identifierBans.entries()),
            identifierAssociations: Array.from(this.identifierAssociations.entries()).map(([key, set]) => [key, Array.from(set)]),
        };
        fs.writeFileSync(this.options.scoreFilePath, JSON.stringify(data, null, 2));
    }

    /**
     * Apply an offense to a peer.
     * Based on offense type, score is decremented and temporary/permanent ban may apply.
     * @param {PeerInfo} peer - An object that can contain peerId, ip, address (any or all).
     * @param {string} offenseType 
     */
    applyOffense(peer, offenseType) {
        const identifiers = this.getAssociatedIdentifiers(peer);

        // log current score
        //console.log(`Current score: ${this.identifierScores.get(identifiers) || this.options.defaultScore}`);
        if (identifiers.size === 0) {
            throw new Error(`At least one of peerId, ip, or address must be provided.`);
        }

        if (!this.offenseScoreMap[offenseType]) {
            throw new Error(`Unknown offense type: ${offenseType}`);
        }

        const scoreDecrement = this.offenseScoreMap[offenseType];

        // Decrement scores and check for bans
        for (const identifier of identifiers) {
            this.decrementScore(identifier, scoreDecrement);
            this.checkIdentifierScore(identifier, offenseType);
        }
        // log new score
        //console.log(`New score: ${this.identifierScores.get(identifiers) || this.options.defaultScore}`);
        // Update associations
        this.updateAssociations(peer);
    }

    /**
     * Decrement the score of an identifier (negative actions).
     * @param {string} identifier 
     * @param {number} decrement 
     */
    decrementScore(identifier, decrement = 1) {
        //console.log(`Decrementing score for identifier ${identifier} by ${decrement}`);
        //console.log(`Current score: ${this.identifierScores.get(identifier) || this.options.defaultScore}`);
        const newScore = (this.identifierScores.get(identifier) || this.options.defaultScore) - decrement;
        //console.log(`New score: ${newScore}`);
        this.identifierScores.set(identifier, newScore);
    }

    /**
     * Check the score of an identifier and ban if below the threshold.
     * @param {string} identifier 
     * @param {string} offenseType
     */
    checkIdentifierScore(identifier, offenseType) {
        const score = this.identifierScores.get(identifier);

        // Check for permanent offenses
        const permanentOffenses = [
            ReputationManager.OFFENSE_TYPES.DOUBLE_SIGNING,
            ReputationManager.OFFENSE_TYPES.DOS_ATTACK,
            ReputationManager.OFFENSE_TYPES.CONSENSUS_MANIPULATION,
            ReputationManager.OFFENSE_TYPES.SYBIL_ATTACK,
        ];

        if (permanentOffenses.includes(offenseType) || score <= this.options.banPermanentScore) {
            this.banIdentifier(identifier, true);
        } else if (score <= this.options.banThreshold) {
            this.banIdentifier(identifier, false);
        }
    }

    /**
     * Ban an identifier (peerId, ip, or address).
     * @param {string} identifier 
     * @param {boolean} permanent 
     */
    banIdentifier(identifier, permanent = false) {
        //console.log(`Banning identifier ${identifier} ${permanent ? 'permanently' : 'temporarily'}`);
        //log score 
        //console.log(`Score: ${this.identifierScores.get(identifier)}`);
        const existingBan = this.identifierBans.get(identifier);
        if (!existingBan || (!existingBan.permanent && permanent)) {
            if (permanent) {
                this.identifierBans.set(identifier, { permanent: true });
            } else {
                const expiresAt = Date.now() + this.options.tempBanDuration;
                this.identifierBans.set(identifier, { permanent: false, expiresAt });
            }
            this.emit('identifierBanned', { identifier, permanent });
        }
    }

    /**
     * Get all identifiers associated with a peer.
     * @param {PeerInfo} peer 
     * @returns {Set<string>}
     */
    getAssociatedIdentifiers(peer) {
        const identifiers = new Set();

        if (peer.peerId) identifiers.add(peer.peerId);
        if (peer.ip) identifiers.add(peer.ip);
        if (peer.address) identifiers.add(peer.address);

        const queue = Array.from(identifiers);
        const visited = new Set(identifiers);

        while (queue.length > 0) {
            const id = queue.shift();
            const associated = this.identifierAssociations.get(id);
            if (associated) {
                for (const assocId of associated) {
                    if (!visited.has(assocId)) {
                        visited.add(assocId);
                        queue.push(assocId);
                    }
                }
            }
        }

        return visited;
    }

    /**
     * Update identifier associations based on a new or existing peer.
     * @param {PeerInfo} peer 
     */
    updateAssociations(peer) {
        const identifiers = [];

        if (peer.peerId) identifiers.push(peer.peerId);
        if (peer.ip) identifiers.push(peer.ip);
        if (peer.address) identifiers.push(peer.address);

        for (const id of identifiers) {
            let associated = this.identifierAssociations.get(id);
            if (!associated) {
                associated = new Set();
                this.identifierAssociations.set(id, associated);
            }
            for (const otherId of identifiers) {
                if (otherId !== id) {
                    associated.add(otherId);
                }
            }
        }
    }

    /**
     * Check if an identifier is banned.
     * @param {string} identifier 
     * @returns {boolean}
     */
    isIdentifierBanned(identifier) {
        const banInfo = this.identifierBans.get(identifier);
        if (banInfo) {
            if (banInfo.permanent) {
                return true;
            } else if (Date.now() > banInfo.expiresAt) {
                this.identifierBans.delete(identifier);
                this.identifierScores.set(identifier, this.options.defaultScore);
                this.emit('identifierUnbanned', { identifier });
                return false;
            } else {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if a peer is banned based on their identifiers.
     * @param {PeerInfo} peer 
     * @returns {boolean}
     */
    isPeerBanned(peer) {
        const identifiers = this.getAssociatedIdentifiers(peer);

        for (const identifier of identifiers) {
            if (this.isIdentifierBanned(identifier)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Unban an identifier, resetting its score.
     * @param {string} identifier 
     */
    unbanIdentifier(identifier) {
        //console.log(`Unbanning identifier ${identifier}`);
        if (this.identifierBans.delete(identifier)) {
            this.identifierScores.set(identifier, this.options.defaultScore);
            this.emit('identifierUnbanned', { identifier });
        }
    }

    /**
     * Get the score of an identifier.
     * @param {string} identifier 
     * @returns {number}
     */
    getIdentifierScore(identifier) {
        return this.identifierScores.get(identifier) || this.options.defaultScore;
    }

    /**
     * Periodically clean up expired temporary bans.
     */
    cleanupExpiredBans() {
        const now = Date.now();
        for (const [identifier, banInfo] of this.identifierBans.entries()) {
            if (!banInfo.permanent && banInfo.expiresAt <= now) {
                this.identifierBans.delete(identifier);
                this.identifierScores.set(identifier, this.options.defaultScore);
                this.emit('identifierUnbanned', { identifier });
                //console.log(`Identifier ${identifier} has been unbanned.`);
            }
        }
    }

    /**
     * Gracefully shutdown - save the scores to disk and clear intervals.
     */
    async shutdown() {
        clearInterval(this.banCleanupInterval);
        this.saveScoresToDisk();
        this.emit('shutdown');
    }
}

export default ReputationManager;
