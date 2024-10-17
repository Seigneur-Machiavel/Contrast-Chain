import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} PeerInfo
 * @property {string} peerId - The unique identifier of the peer.
 * @property {string} ip - The IP address of the peer.
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

        // log the options
        console.log(this.options);

        /** @type {Map<string, number>} */
        this.scores = new Map(); // Map of peerId -> score

        /** @type {Set<string>} */
        this.permanentBans = new Set(); // Set of permanently banned peerIds

        /** @type {Set<string>} */
        this.bannedIPs = new Set(); // Set of banned IP addresses

        /** @type {Map<string, number>} */
        this.tempBans = new Map(); // Temporary bans with expiry timestamps, keyed by peerId
        
        /** @type {Map<string, PeerInfo>} */
        this.peerInfoMap = new Map(); // Map of peerId -> PeerInfo.

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
            this.scores = new Map(data.scores);
            this.permanentBans = new Set(data.permanentBans);
            this.bannedIPs = new Set(data.bannedIPs);
            this.tempBans = new Map(data.tempBans);
            this.peerInfoMap = new Map(data.peerInfoMap || []);
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
            peerInfoMap: Array.from(this.peerInfoMap.entries()), // Save peerInfoMap
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
     * Apply an offense to a peer.
     * Based on offense type, score is decremented and temporary/permanent ban may apply.
     * @param {PeerInfo} peer - An object that can contain either peerId, ip (IP), or both.
     * @param {string} offenseType 
     */
    applyOffense(peer, offenseType) {
        const peerId = peer.peerId || this.getPeerIdByIP(peer.ip);
        const ip = peer.ip || this.getIPByPeerId(peer.peerId);
    
        if (!peerId && !ip) {
            throw new Error(`Either peerId or ip must be provided.`);
        }
    
        if (!this.offenseScoreMap[offenseType]) {
            throw new Error(`Unknown offense type: ${offenseType}`);
        }
    
        const scoreDecrement = this.offenseScoreMap[offenseType];
    
        if (peerId) {
            this.decrementScore(peerId, scoreDecrement);
            this.checkForPermanentOffense(peerId, offenseType);
        }
    
        if (ip && !peerId) {
            this.banPeerByIP(ip);  // If no peerId but IP exists, ban by IP
            this.emit('peerBanned', { ip });  // Emit an event for IP ban
            console.log(`Peer with IP ${ip} has been banned.`);
        }
        // Associate the peerId with IP in peerInfoMap if both are provided
        if (peerId && ip) {
            this.peerInfoMap.set(peerId, { peerId, ip });
        }
    }
    

    /**
     * Helper method to check and apply permanent ban based on offense type.
     * @param {string} peerId 
     * @param {string} offenseType 
     */
    checkForPermanentOffense(peerId, offenseType) {
        const permanentOffenses = [
            ReputationManager.OFFENSE_TYPES.DOUBLE_SIGNING,
            ReputationManager.OFFENSE_TYPES.DOS_ATTACK,
            ReputationManager.OFFENSE_TYPES.CONSENSUS_MANIPULATION,
            ReputationManager.OFFENSE_TYPES.SYBIL_ATTACK,
        ];

        if (permanentOffenses.includes(offenseType)) {
            this.permanentlyBanPeer(peerId);
        }
    }

    /**
     * Get the IP address associated with a peerId.
     * @param {string} peerId - The peerId.
     * @returns {string | undefined} - The IP address if found, or undefined.
     */
    getIPByPeerId(peerId) {
        const peer = this.peerInfoMap.get(peerId);
        return peer ? peer.ip : undefined;
    }

    /**
     * Get peer info by peerId.
     * @param {string} peerId - The peerId.
     * @returns {PeerInfo | null}
     */
    getPeerById(peerId) {
        return this.peerInfoMap.get(peerId) || null;
    }

    /**
     * Example placeholder method for matching peerId to an IP address.
     * @param {string} peerId 
     * @param {string} ip 
     * @returns {boolean}
     */
    isPeerAddressMatch(peerId, ip) {
        const peer = this.getPeerById(peerId);
        return peer && peer.ip === ip;
    }

    /**
     * Example placeholder for fetching peer data.
     * Customize this to your system's actual implementation.
     * @param {string} peerId
     * @returns {PeerInfo | null}
     */
    getPeerById(peerId) {
        // Implement fetching of peer data based on peerId
        return null;
    }

    /**
    * Helper method to get peerId by IP address.
    * @param {string} ip - The IP address of the peer.
    * @returns {string | undefined} - The peerId if found, or undefined.
    */
    getPeerIdByIP(ip) {
        for (const [peerId, peerInfo] of this.peerInfoMap.entries()) {
            if (peerInfo.ip === ip) {
                return peerId;
            }
        }
        return undefined;
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
        return this.isPeerBanned(peer.peerId) || this.isIPBanned(peer.ip);
    }

    /**
     * Check if a peer is banned by their peerId (temporary or permanent).
     * If temporarily banned, check if the ban has expired.
     * @param {string} peerId 
     * @returns {boolean}
     */
    isPeerBanned(peerId) {
        if (this.isPeerPermanentlyBanned(peerId)) {
            return true;
        }

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
                this.scores.set(peerId, this.options.defaultScore); // Reset peer score on unban
                this.emit('peerUnbanned', { peerId });
                console.log(`Peer ${peerId} has been unbanned.`);
            }
        }
    
        // Add IP unbanning logic if necessary
        for (const ip of this.bannedIPs) {
            // Assuming IP bans are also temporary, add an expiration mechanism here
            // Example logic: if IP ban is based on a time threshold
            this.bannedIPs.delete(ip);
            this.emit('ipUnbanned', { ip });
            console.log(`IP ${ip} has been unbanned.`);
        }
    }
    
}

export default ReputationManager;
