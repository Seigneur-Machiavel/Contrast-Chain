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
            maxScore: 100,
             // Spam Detection Configurations
             spamMaxActions: 200, // Maximum allowed actions within the time window
             spamTimeWindow: 60 * 1000, // Time window in milliseconds (e.g., 1 minute)
             spamCleanupInterval: 5 * 60 * 1000, // Interval to clean up old actions (e.g., 5 minutes)
        };

        this.options = { ...defaultOptions, ...options };

        /** @type {Map<string, number>} */
        this.identifierScores = new Map(); // Map of identifier (peerId, ip, address) -> score

        /** @type {Map<string, { permanent: boolean, expiresAt?: number }>} */
        this.identifierBans = new Map(); // Map of identifier -> ban info

        /** @type {Map<string, Set<string>>} */
        this.identifierAssociations = new Map(); // Map of identifier -> Set of associated identifiers

        this.identifierLastSeen = new Map(); // Map to track the last seen timestamp of identifiers

        // Define score decrements for each offense
        this.offenseScoreMap = {
            // Major Faults
            [ReputationManager.OFFENSE_TYPES.INVALID_BLOCK_SUBMISSION]: 15,
            [ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING]: 15,
            [ReputationManager.OFFENSE_TYPES.LOW_LEGITIMACY_BLOCK_SUBMISSION]: 7,
            [ReputationManager.OFFENSE_TYPES.INVALID_TRANSACTION_PROPAGATION]: 8,
            // Minor Faults
            [ReputationManager.OFFENSE_TYPES.MINOR_PROTOCOL_VIOLATIONS]: 1,
        };

        // Define score increments for each positive action
        this.positiveScoreMap = {
            // Positive Actions
            [ReputationManager.POSITIVE_ACTIONS.VALID_BLOCK_SUBMISSION]: 10,
            [ReputationManager.POSITIVE_ACTIONS.NO_OFFENSES]: 2,
        };

        // Allow overriding offense scores via options
        if (this.options.offenseScoreMap) {
            this.offenseScoreMap = { ...this.offenseScoreMap, ...this.options.offenseScoreMap };
        }

        this.loadScoresFromDisk();

        this.associationCleanupInterval = setInterval(
            () => this.cleanupOldAssociations(),
            this.options.cleanupInterval
        );
        // Periodically clean up expired temporary bans
        this.banCleanupInterval = setInterval(() => this.cleanupExpiredBans(), this.options.cleanupInterval);
        
        // Initialize action tracking for spam detection
        /** @type {Map<string, Array<number>>} */
        this.actionTimestamps = new Map(); // Map of identifier -> array of action timestamps

        this.spamCleanupInterval = setInterval(
            () => this.cleanupOldActions(),
            this.options.spamCleanupInterval
        );
   
    }

    static OFFENSE_TYPES = {
        // Major Faults
        INVALID_BLOCK_SUBMISSION: 'Invalid Block Submission',
        LOW_LEGITIMACY_BLOCK_SUBMISSION: 'Low Legitimacy Block Submission',
        MESSAGE_SPAMMING: 'Message Spamming',
        INVALID_TRANSACTION_PROPAGATION: 'Invalid Transaction Propagation',
        // Minor Faults
        MINOR_PROTOCOL_VIOLATIONS: 'Minor Protocol Violations',
    };

    static POSITIVE_ACTIONS = {
        VALID_BLOCK_SUBMISSION: 'Valid Block Submission',
        NO_OFFENSES: 'No Offenses',
    };

    static GENERAL_ACTIONS = {
        CONNECTION_ESTABLISHED: 'Connection Established',
        CONNECTION_TERMINATED: 'Connection Terminated',
        PUBSUB_RECEIVED: 'PubSub Received: ',
        DATA_SENT: 'Data Sent',
        CUSTOM_EVENT: 'Custom Event',
        SYNC_INCOMING_STREAM: 'Sync Incoming Stream',
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
        // Update associations
        this.updateAssociations(peer);

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
        this.emit('offenseApplied', { peer, offenseType, scoreDecrement });
    }

    /**
     * Apply a positive action to a peer.
     * Based on positive action type, score is incremented.
     * @param {PeerInfo} peer - An object that can contain peerId, ip, address (any or all).
     * @param {string} positiveActionType 
     */
    applyPositive(peer, positiveActionType) {
        
        // Update associations
        this.updateAssociations(peer);

        const identifiers = this.getAssociatedIdentifiers(peer);

        if (identifiers.size === 0) {
            throw new Error(`At least one of peerId, ip, or address must be provided.`);
        }

        if (!this.positiveScoreMap[positiveActionType]) {
            throw new Error(`Unknown positive action type: ${positiveActionType}`);
        }

        const scoreIncrement = this.positiveScoreMap[positiveActionType];

        // Increment scores
        for (const identifier of identifiers) {
            this.incrementScore(identifier, scoreIncrement);
            // Optionally, emit an event for positive actions
            this.emit('positiveActionApplied', { identifier, positiveActionType, scoreIncrement });
        }

    }
    /**
     * Decrement the score of an identifier (negative actions).
     * @param {string} identifier 
     * @param {number} decrement 
     */
    decrementScore(identifier, decrement = 1) {
        const currentScore = this.identifierScores.has(identifier)
            ? this.identifierScores.get(identifier)
            : this.options.defaultScore;
        const newScore = currentScore - decrement;
        this.identifierScores.set(identifier, newScore);
    }
    

    /**
     * Increment the score of an identifier (positive actions).
     * @param {string} identifier 
     * @param {number} increment 
     */
    incrementScore(identifier, increment = 1) {
        if (!this.identifierScores.has(identifier)) {
            this.identifierScores.set(identifier, this.options.defaultScore);
        }
        const currentScore = this.identifierScores.get(identifier);
        let newScore = currentScore + increment;
        if (newScore > this.options.maxScore) {
            newScore = this.options.maxScore;
        }
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
        console.log(`Banning identifier ${identifier} ${permanent ? 'permanently' : 'temporarily'}`);
        //log score 
        console.log(`Score: ${this.identifierScores.get(identifier)}`);
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

        const now = Date.now();

        for (const id of identifiers) {
            this.identifierLastSeen.set(id, now);
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
        return this.identifierScores.has(identifier)
            ? this.identifierScores.get(identifier)
            : this.options.defaultScore;
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
                console.log(`Identifier ${identifier} has been unbanned.`);
            }
        }
    }
    cleanupOldAssociations() {
        const now = Date.now();
        const maxInactivity = 30 * 24 * 60 * 60 * 1000; // 30 days
        for (const [identifier, lastSeen] of this.identifierLastSeen.entries()) {
            if (now - lastSeen > maxInactivity) {
                this.identifierAssociations.delete(identifier);
                this.identifierLastSeen.delete(identifier);
            }
        }
    }
    /**
     * Gracefully shutdown - save the scores to disk and clear intervals.
     */
    async shutdown() {
        clearInterval(this.banCleanupInterval);
        clearInterval(this.associationCleanupInterval);
        clearInterval(this.spamCleanupInterval);
        this.saveScoresToDisk();
        this.emit('shutdown');
    }
    /**
     * Get a clean list of identifiers and their scores for the dashboard.
     * Each entry includes the identifier, its score, and ban status.
     * @returns {Array<{ identifier: string, score: number, banned: boolean }>}
     */
    getScores() {
        const scoresList = [];

        for (const identifier of this.identifierScores.keys()) {
            const score = this.getIdentifierScore(identifier);
            const banned = this.isIdentifierBanned(identifier);
            scoresList.push({ identifier, score, banned });
        }

        return scoresList;
    }
    /**
     * Record an action performed by a peer for spam detection.
     * If the peer exceeds the maximum number of allowed actions within the time window,
     * apply a MESSAGE_SPAMMING offense.
     * @param {PeerInfo} peer - An object that can contain peerId, ip, address (any or all).
     */
    recordAction(peer, action) {
        // Update associations
        console.log({ component: 'ReputationManager', peer, action }, 'Recording action');
        this.updateAssociations(peer);

        const identifiers = this.getAssociatedIdentifiers(peer);

        if (identifiers.size === 0) {
            throw new Error(`At least one of peerId, ip, or address must be provided.`);
        }

        const now = Date.now();
        const windowStart = now - this.options.spamTimeWindow;

        for (const identifier of identifiers) {
            if (!this.actionTimestamps.has(identifier)) {
                this.actionTimestamps.set(identifier, []);
            }

            const timestamps = this.actionTimestamps.get(identifier);

            // Add current timestamp
            timestamps.push(now);

            // Remove timestamps outside the current window
            while (timestamps.length > 0 && timestamps[0] < windowStart) {
                timestamps.shift();
            }

            // Check if the number of actions exceeds the maximum allowed
            if (timestamps.length > this.options.spamMaxActions) {
                // Apply MESSAGE_SPAMMING offense
                this.applyOffense(peer, ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING);

                // Optionally, you can clear the timestamps to avoid repeated offenses
                // timestamps.length = 0;

                // Emit an event for spam detection
                this.emit('spamDetected', { peer, identifier, actionCount: timestamps.length });
            }
        }
    }

    /**
     * Periodically clean up old action timestamps to prevent memory leaks.
     */
    cleanupOldActions() {
        const now = Date.now();
        const windowStart = now - this.options.spamTimeWindow;

        for (const [identifier, timestamps] of this.actionTimestamps.entries()) {
            // Remove timestamps outside the current window
            while (timestamps.length > 0 && timestamps[0] < windowStart) {
                timestamps.shift();
            }

            // If no timestamps remain, remove the identifier from the map
            if (timestamps.length === 0) {
                this.actionTimestamps.delete(identifier);
            }
        }
    }
}
export default ReputationManager;
