// reputation.mjs
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} PeerInfo
 * @property {string} peerId - The unique identifier of the peer.
 * @property {string} address - The IP address of the peer.
 */

class ReputationManager extends EventEmitter {
    constructor(options = {}) {
        super();
        const defaultOptions = {
            banThreshold: -10, // Ban peers when their score drops below this
            banPermanentScore: -100, // Permanently ban peers for extreme fraud
            scoreFilePath: path.resolve('peer-reputation.json'), // Where reputation data is saved
            defaultScore: 0, // Starting score for new peers
            tempBanDuration: 24 * 60 * 60 * 1000, // Temporary bans last 24 hours by default
            cleanupInterval: 60 * 60 * 1000, // Clean up expired bans every hour
            offenseScoreMap: {}, // Customizable offense score map
        };
        this.options = { ...defaultOptions, ...options };
        
        /** @type {Map<string, number>} */
        this.scores = new Map(); // Map of peerId -> score
        
        /** @type {Set<string>} */
        this.permanentBans = new Set(); // Set of permanently banned peerIds
        
        /** @type {Set<string>} */
        this.bannedIPs = new Set(); // Set of banned IP addresses
        
        /** @type {Map<string, number>} */
        this.tempBans = new Map(); // Temporary bans with expiry timestamps, keyed by peerId

        // Define offense types
        this.offenseTypes = {
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

        // Define score decrements for each offense
        this.offenseScoreMap = {
            // Major Faults
            [this.offenseTypes.INVALID_BLOCK_SUBMISSION]: 10,
            [this.offenseTypes.LOW_LEGITIMACY_BLOCK_SUBMISSION]: 7,
            [this.offenseTypes.MESSAGE_SPAMMING]: 5,
            [this.offenseTypes.DOUBLE_SIGNING]: 20,
            [this.offenseTypes.SYBIL_ATTACK]: 15,
            [this.offenseTypes.INVALID_TRANSACTION_PROPAGATION]: 8,
            [this.offenseTypes.CONSENSUS_MANIPULATION]: 25,
            [this.offenseTypes.DOS_ATTACK]: 30,

            // Minor Faults
            [this.offenseTypes.FREQUENT_RESYNC_REQUESTS]: 3,
            [this.offenseTypes.EXCESSIVE_BLOCK_INDEXING]: 2,
            [this.offenseTypes.MINOR_PROTOCOL_VIOLATIONS]: 1,
            [this.offenseTypes.LOW_RESOURCE_UTILIZATION]: 1,
            [this.offenseTypes.TRANSIENT_CONNECTIVITY_ISSUES]: 2,
        };

        // Allow overriding offense scores via options
        if (this.options.offenseScoreMap) {
            this.offenseScoreMap = { ...this.offenseScoreMap, ...this.options.offenseScoreMap };
        }

        this.loadScoresFromDisk();

        // Periodically clean up expired temporary bans
        this.banCleanupInterval = setInterval(() => this.cleanupExpiredBans(), this.options.cleanupInterval);
    }

    /**
     * Load scores and bans from disk when the node starts.
     */
    loadScoresFromDisk() {
        if (fs.existsSync(this.options.scoreFilePath)) {
            const data = JSON.parse(fs.readFileSync(this.options.scoreFilePath, 'utf8'));
            this.scores = new Map(data.scores);
            this.permanentBans = new Set(data.permanentBans);
            this.bannedIPs = new Set(data.bannedIPs);
            this.tempBans = new Map(data.tempBans);
        }
    }

    /**
     * Save scores and bans to disk on shutdown.
     */
    saveScoresToDisk() {
        const data = {
            scores: Array.from(this.scores.entries()),
            permanentBans: Array.from(this.permanentBans),
            bannedIPs: Array.from(this.bannedIPs),
            tempBans: Array.from(this.tempBans.entries()),
        };
        fs.writeFileSync(this.options.scoreFilePath, JSON.stringify(data, null, 2));
    }

    /**
     * Increment the score of a peer (positive actions).
     * @param {string} peerId 
     * @param {number} increment 
     */
    incrementScore(peerId, increment = 1) {
        if (this.isPeerPermanentlyBanned(peerId)) return;
        const newScore = (this.scores.get(peerId) || this.options.defaultScore) + increment;
        this.scores.set(peerId, newScore);
        this.checkPeerScore(peerId);
    }

    /**
     * Decrement the score of a peer (negative actions).
     * @param {string} peerId 
     * @param {number} decrement 
     */
    decrementScore(peerId, decrement = 1) {
        if (this.isPeerPermanentlyBanned(peerId)) return;
        const newScore = (this.scores.get(peerId) || this.options.defaultScore) - decrement;
        this.scores.set(peerId, newScore);
        this.checkPeerScore(peerId);
    }

    /**
     * Permanently ban a peer based on their peerId.
     * @param {string} peerId 
     */
    permanentlyBanPeer(peerId) {
        if (!this.permanentBans.has(peerId)) {
            this.permanentBans.add(peerId);
            this.scores.delete(peerId); // No need to track the score anymore
            this.emit('peerBanned', { peerId, permanent: true });
        }
    }

    /**
     * Ban a peer by IP address.
     * @param {string} ip 
     */
    banPeerByIP(ip) {
        if (!this.bannedIPs.has(ip)) {
            this.bannedIPs.add(ip);
            this.emit('ipBanned', { ip });
        }
    }

    /**
     * Check the score of a peer and ban if below the threshold.
     * @param {string} peerId 
     */
    checkPeerScore(peerId) {
        const score = this.scores.get(peerId);
        if (score <= this.options.banPermanentScore) {
            this.permanentlyBanPeer(peerId);
        } else if (score <= this.options.banThreshold) {
            this.temporarilyBanPeer(peerId);
        }
    }

    /**
     * Temporarily ban a peer based on their peerId.
     * Bans last for `tempBanDuration` milliseconds.
     * @param {string} peerId 
     */
    temporarilyBanPeer(peerId) {
        if (!this.tempBans.has(peerId)) {
            const expirationTime = Date.now() + this.options.tempBanDuration;
            this.tempBans.set(peerId, expirationTime);
            this.emit('peerBanned', { peerId, permanent: false });
        }
    }

    /**
     * Unban a peer, resetting their score.
     * @param {string} peerId 
     */
    unbanPeer(peerId) {
        let unbanned = false;
        if (this.permanentBans.has(peerId)) {
            this.permanentBans.delete(peerId);
            unbanned = true;
        }
        if (this.tempBans.has(peerId)) {
            this.tempBans.delete(peerId);
            unbanned = true;
        }
        if (unbanned) {
            this.scores.set(peerId, this.options.defaultScore);
            this.emit('peerUnbanned', { peerId });
        }
    }

    /**
     * Check if a peer is permanently banned by their peerId.
     * @param {string} peerId 
     * @returns {boolean}
     */
    isPeerPermanentlyBanned(peerId) {
        return this.permanentBans.has(peerId);
    }

    /**
     * Check if a peer is banned by their peerId or IP address.
     * @param {PeerInfo} peer 
     * @returns {boolean}
     */
    isPeerOrIPBanned(peer) {
        return this.isPeerBanned(peer.peerId) || this.isIPBanned(peer.address);
    }

    /**
     * Check if a peer is banned by their peerId (temporary or permanent).
     * If temporarily banned, check if the ban has expired.
     * @param {string} peerId 
     * @returns {boolean}
     */
    isPeerBanned(peerId) {
        if (this.isPeerPermanentlyBanned(peerId)) return true;

        if (this.tempBans.has(peerId)) {
            const expirationTime = this.tempBans.get(peerId);
            if (Date.now() > expirationTime) {
                this.tempBans.delete(peerId);
                this.scores.set(peerId, this.options.defaultScore);
                this.emit('peerUnbanned', { peerId });
                return false;
            }
            return true;
        }

        return false;
    }

    /**
     * Check if a peer is banned by their IP address.
     * @param {string} ip 
     * @returns {boolean}
     */
    isIPBanned(ip) {
        return this.bannedIPs.has(ip);
    }

    /**
     * Get the score of a peer.
     * @param {string} peerId 
     * @returns {number}
     */
    getPeerScore(peerId) {
        return this.scores.get(peerId) || this.options.defaultScore;
    }

    /**
     * Apply an offense to a peer.
     * Based on offense type, score is decremented and temporary/permanent ban may apply.
     * @param {PeerInfo} peer 
     * @param {string} offenseType 
     */
    applyOffense(peer, offenseType) {
        if (!this.offenseScoreMap[offenseType]) {
            throw new Error(`Unknown offense type: ${offenseType}`);
        }

        const scoreDecrement = this.offenseScoreMap[offenseType];
        this.decrementScore(peer.peerId, scoreDecrement);

        // Check for permanent offenses
        const permanentOffenses = [
            this.offenseTypes.DOUBLE_SIGNING,
            this.offenseTypes.DOS_ATTACK,
            this.offenseTypes.CONSENSUS_MANIPULATION,
            this.offenseTypes.SYBIL_ATTACK,
        ];

        if (permanentOffenses.includes(offenseType)) {
            this.permanentlyBanPeer(peer.peerId);
        }
    }

    /**
     * Apply a positive action to a peer.
     * @param {PeerInfo} peer 
     * @param {number} increment 
     */
    applyPositiveAction(peer, increment = 1) {
        this.incrementScore(peer.peerId, increment);
    }

    /**
     * Gracefully shutdown - save the scores to disk and clear intervals.
     */
    async shutdown() {
        clearInterval(this.banCleanupInterval);
        this.saveScoresToDisk();
        this.emit('shutdown');
    }

    /**
     * Periodically clean up expired temporary bans.
     */
    cleanupExpiredBans() {
        const now = Date.now();
        for (const [peerId, expirationTime] of this.tempBans.entries()) {
            if (now > expirationTime) {
                this.tempBans.delete(peerId);
                this.scores.set(peerId, this.options.defaultScore);
                this.emit('peerUnbanned', { peerId });
            }
        }
    }
}

export default ReputationManager;
