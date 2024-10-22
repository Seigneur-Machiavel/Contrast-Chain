import pino from 'pino';
import utils from './utils.mjs';
import P2PNetwork from './p2p.mjs';
import * as lp from 'it-length-prefixed';
import { multiaddr } from '@multiformats/multiaddr';
/**
 * @typedef {import("./node.mjs").Node} Node
 * @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
 * @typedef {import("./blockchain.mjs").Blockchain} Blockchain
 */
const MAX_BLOCKS_PER_REQUEST = 4;
const DELAY_BETWEEN_PEERS = 1000; // 2 seconds

// Define a custom error class for sync restarts
class SyncRestartError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SyncRestartError';
    }
}

export class SyncHandler {
    constructor(getNodeReference) {
        this.getNodeReference = getNodeReference;
        this.p2pNetworkMaxMessageSize = 0;
        this.syncFailureCount = 0;
        this.maxBlocksToRemove = 100; // Set a maximum limit to prevent removing too many blocks
        this.logger = pino({
            level: process.env.LOG_LEVEL || 'debug',
            transport: {
                target: 'pino-pretty',
            },
        });
        this.isSyncing = false;
    }
    /** @type {Node} */
    get node() {
        return this.getNodeReference();
    }
    get myPeerId() {
        return this.node.p2pNetwork.p2pNode.peerId.toString();
    }
    /** Starts the sync handler.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance */
    async start(p2pNetwork) {
        try {
            p2pNetwork.p2pNode.handle(P2PNetwork.SYNC_PROTOCOL, this.handleIncomingStream.bind(this));
            this.logger.info({ protocol: P2PNetwork.SYNC_PROTOCOL }, 'Sync node started');
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to start sync node');
            throw error;
        }
    }

    /** Handles incoming streams from peers.
     * @param {Object} param0 - The stream object.
     * @param {import('libp2p').Stream} param0.stream - The libp2p stream. */
    async handleIncomingStream({ stream }) {
        try {
            // Decode the stream using lp.decode()
            const source = lp.decode(stream.source);

            for await (const msg of source) {
                const serializedMsg = msg.subarray();
                const message = utils.serializer.rawData.fromBinary_v1(serializedMsg);

                if (!message || typeof message.type !== 'string') {
                    throw new Error('Invalid message format');
                }

                const response = await this.#handleMessage(message);
                // Encode the response and write it to the stream
                const encodedResponse = lp.encode.single(utils.serializer.rawData.toBinary_v1(response));
                await stream.sink(encodedResponse);
            }
        } catch (err) {
            this.logger.error({ error: err.message }, 'Stream error occurred');
        } finally {
            if (stream) {
                try {
                    stream.close();
                } catch (closeErr) {
                    this.logger.error({ error: closeErr.message }, 'Failed to close stream');
                }
            } else {
                this.logger.warn('Stream is undefined; cannot close stream');
            }
        }
    }

    /** Handles incoming messages based on their type.
     * @param {Object} message - The incoming message.
     * @returns {Promise<Object>} The response to the message. */
    async #handleMessage(msg) {
        switch (msg.type) {
            case 'getBlocks':
                this.logger.debug(msg, 'Received getBlocks request');
                const blocks = await this.node.blockchain.getRangeOfBlocksByHeight(msg.startIndex, msg.endIndex, false);
                this.logger.debug({ count: blocks.length }, 'Sending blocks in response');
                return { status: 'success', blocks };
            case 'getStatus':
                if (!this.node.blockchain.currentHeight) { console.error(`[SYNC] currentHeight is: ${this.node.blockchain.currentHeight}`); }
                return {
                    status: 'success',
                    currentHeight: this.node.blockchain.currentHeight,
                    latestBlockHash: this.node.blockchain.getLatestBlockHash(),
                };
            default:
                this.logger.warn({ type: msg.type }, 'Invalid request type');
                throw new Error('Invalid request type');
        }
    }

    /** Synchronizes with known peers by first fetching their statuses and then syncing with the peer that has the highest block height. */
    async syncWithKnownPeers() {
        this.node.blockchainStats.state = "syncing";
        const uniqueTopics = this.node.getTopicsToSubscribeRelatedToRoles();

        if (this.node.p2pNetwork.subscriptions.size > 0) {
            console.log(`[SYNC] unsubscribing ${this.node.p2pNetwork.subscriptions.size} topics`);
            for (const topic of uniqueTopics) { await this.node.p2pNetwork.unsubscribe(topic); }
        }

        this.isSyncing = true;
        this.logger.info(`[SYNC] Starting syncWithKnownPeers at #${this.node.blockchain.currentHeight}`);
        
        const peerStatuses = await this.#getAllPeersStatus(this.node.p2pNetwork);
        if (peerStatuses === null || peerStatuses.length === 0) { // Restart node if no peers are available
            this.logger.error(`[SYNC] unable to get peersStatus -> handleSyncFailure()`);
            await this.handleSyncFailure();
            return false;
        }

        // Sort peers by currentHeight in descending order
        peerStatuses.sort((a, b) => b.currentHeight - a.currentHeight);
        const highestPeerHeight = peerStatuses[0].currentHeight;

        if (highestPeerHeight === undefined) {
            this.logger.error(`[SYNC] highestPeerHeight is undefined -> handleSyncFailure()`);
            //await this.handleSyncFailure();
            return false;
        }

        if (highestPeerHeight <= this.node.blockchain.currentHeight) {
            this.logger.debug(`[SYNC] Already at the highest height, no need to sync peer height: ${highestPeerHeight}, current height: ${this.node.blockchain.currentHeight}`);
            this.isSyncing = false;
            await this.node.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.node.p2pHandler.bind(this.node));
            return true;
        }

        console.info(`[SYNC] Highest peer height: ${highestPeerHeight}, current height: ${this.node.blockchain.currentHeight}`);

        // Attempt to sync with peers in order
        for (const peerInfo of peerStatuses) {
            const { peerId, address, currentHeight } = peerInfo;
            const ma = multiaddr(address);
            this.logger.info({ peerId, currentHeight }, 'Attempting to sync with peer');
            try {
                const synchronized = await this.#getMissingBlocks(this.node.p2pNetwork, ma, currentHeight);
                this.logger.info({ peerId }, 'Successfully synced with peer');
                this.isSyncing = false;
                
                if (!synchronized) {
                    continue; }
                break; // Sync successful, break out of loop
            } catch (error) {
                //continue;

                await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_PEERS));
                if (error instanceof SyncRestartError) {
                    this.logger.error({ error: error.message }, 'Sync restart error occurred');
                    await this.handleSyncFailure();
                    return false;
                }
                break;
            } 
        }
        
        if (highestPeerHeight > this.node.blockchain.currentHeight) {
            this.logger.debug(`[SYNC] Need to sync more blocks, restarting sync process`);
            return false;
        }

        this.isSyncing = false;
        await this.node.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.node.p2pHandler.bind(this.node));

        console.log(`[SYNC] Sync process finished, current height: ${this.node.blockchain.currentHeight} compared to highestPeerHeight: ${highestPeerHeight}`);
        return true;
    }
    // TODO: unify syncWithPeer and syncWithKnownPeers
    async syncWithPeer(peerId) {
        this.node.blockchainStats.state = "syncing";
        const uniqueTopics = this.node.getTopicsToSubscribeRelatedToRoles();
        if (this.node.p2pNetwork.subscriptions.size > 0) {
            console.log(`[SYNC] unsubscribing ${this.node.p2pNetwork.subscriptions.size} topics`);
            for (const topic of uniqueTopics) { await this.node.p2pNetwork.unsubscribe(topic); }
        }
        this.isSyncing = true;
        this.logger.info(`[SYNC] Starting syncWithPeer at #${this.node.blockchain.currentHeight}`);
        const peerData = this.node.p2pNetwork.peers.get(peerId);
        if (!peerData) { return false; }
        const { address } = peerData;
        const ma = multiaddr(address);
        const peerStatus = await this.#getPeerStatus(this.node.p2pNetwork, ma);
        if (!peerStatus || !peerStatus.currentHeight) { return false; }
        const peerHeight = peerStatus.currentHeight;
        if (peerHeight <= this.node.blockchain.currentHeight) {
            this.logger.debug(`[SYNC] Already at the highest height, no need to sync`);
            this.isSyncing = false;
            await this.node.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.node.p2pHandler.bind(this.node));
            return true;
        }
        console.info(`[SYNC] Peer height: ${peerHeight}, current height: ${this.node.blockchain.currentHeight}`);
        try {
            const synchronized = await this.#getMissingBlocks(this.node.p2pNetwork, ma, peerHeight);
            this.logger.info({ peerId }, 'Successfully synced with peer');
            this.isSyncing = false;
            if (!synchronized) { return false; }
            await this.node.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.node.p2pHandler.bind(this.node));
            return true;
        } catch (error) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_PEERS));
            if (error instanceof SyncRestartError) {
                this.logger.error({ error: error.message }, 'Sync restart error occurred');
                await this.handleSyncFailure();
                return false;
            }
            return false;
        }
    }
    /** Gets the status of a peer.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @returns {Promise<Object>} The peer's status. */
    async #getPeerStatus(p2pNetwork, peerMultiaddr) {
        this.logger.debug({ peerMultiaddr }, 'Getting peer status');
        const peerStatusMessage = { type: 'getStatus' };
        try {
            const response = await p2pNetwork.sendMessage(peerMultiaddr, peerStatusMessage);
            if (response.status !== 'success') { return false; }
            if (typeof response.currentHeight !== 'number') { return false; }
            return response;
        }
        catch (error) {
            this.logger.error({ error: error.message }, 'Failed to get peer status');
            return false;
        }
    }
     /** Retrieves the statuses of all peers in parallel.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @returns {Promise<Array<{ peerId: string, address: string, currentHeight: number }>>} 
     * An array of peer statuses. */
    async #getAllPeersStatus(p2pNetwork) {
        const peersToSync = Array.from(p2pNetwork.peers.entries());
        const allStatus = [];

        const peersRelatedToPromises = [];
        const statusPromises = [];
        for (const [peerId, peerData] of peersToSync) {
            const address = peerData.address;
            if (!address) { reject(new Error('Peer address is missing')); }
            // Attempt to create a multiaddr; skip if invalid
            let ma;
            try {
                ma = multiaddr(address);
            } catch (err) {
                this.logger.error({ address, error: err.message }, 'Invalid multiaddr for peer');
                continue; // Skip this peer
            }
            statusPromises.push(this.#getPeerStatus(p2pNetwork, ma));
            peersRelatedToPromises.push({ peerId, address });
        }

        // Execute all status retrievals in parallel
        const results = await Promise.allSettled(statusPromises);

        // Process the results
       for (let i = 0; i < results.length; i++) {
            const address = peersRelatedToPromises[i].address;
            const peerId = peersRelatedToPromises[i].peerId;
            const result = results[i];
            if (result.status === 'fulfilled' && result.value) {
                allStatus.push({ 
                    peerId,
                    address,
                    currentHeight: result.value.currentHeight,
                    latestBlockHash: result.value.latestBlockHash
                });
            }
        }
        return allStatus;
    }

    /** Handles synchronization failure by rolling back to snapshot and requesting a restart handled by the factory. */
    async handleSyncFailure() {
        this.logger.error(`[SYNC] Sync failure occurred, restarting sync process`);
        if (this.node.restartRequested) { return; }
        if (this.node.blockchain.currentHeight === -1) { this.node.restartRequested = true; return; }
                
        const currentHeight = this.node.blockchain.currentHeight;
        const snapshotHeights = this.node.snapshotSystemDoc.getSnapshotsHeights();
        
        if (snapshotHeights.length === 0) {
            this.node.restartRequested = true;
            return;
        }
        const lastSnapshotHeight = snapshotHeights[snapshotHeights.length - 1];
        let eraseUntilHeight = currentHeight - 10;
        if (!isNaN(lastSnapshotHeight)) {
            eraseUntilHeight = Math.min(currentHeight -10, lastSnapshotHeight - 10);
            this.node.snapshotSystemDoc.eraseSnapshotsHigherThan(eraseUntilHeight);
        }

        this.node.restartRequested = true;
        
        console.log(`[SYNC-${this.node.id.slice(0, 6)}] Snapshot erased until #${eraseUntilHeight}, waiting for restart...`);
        this.logger.info(`[SYNC] Blockchain restored and reloaded. Current height: ${this.node.blockchain.currentHeight}`);
    }
    /**
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer to sync with. */
    async #updatedPeerHeight(p2pNetwork, peerMultiaddr) {
        try {
            const peerStatus = await this.#getPeerStatus(p2pNetwork, peerMultiaddr);
            if (!peerStatus || !peerStatus.currentHeight) { console.log(`[SYNC] Failed to get peer height`); }
            return peerStatus.currentHeight;       
        } catch (error) {
            console.error(`[SYNC] (#updatedPeerHeight) Failed to get peer height: ${error.message}`);
            return false;
        }
    }
    /** Synchronizes missing blocks from a peer efficiently.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer to sync with. */
    async #getMissingBlocks(p2pNetwork, peerMultiaddr, peerCurrentHeight) {
        this.node.blockchainStats.state = `syncing with peer ${peerMultiaddr}`;
        let peerHeight = peerCurrentHeight ? peerCurrentHeight : await this.#updatedPeerHeight(p2pNetwork, peerMultiaddr);
        if (!peerHeight) { console.log(`[SYNC] (#getMissingBlocks) Failed to get peer height`); }
        
        let desiredBlock = this.node.blockchain.currentHeight + 1;
        while(desiredBlock <= peerHeight) {
            const endIndex = Math.min( desiredBlock + MAX_BLOCKS_PER_REQUEST - 1, peerHeight );
            const serializedBlocks = await this.#requestBlocksFromPeer(p2pNetwork, peerMultiaddr, desiredBlock, endIndex);

            // Process blocks
            for (const serializedBlock of serializedBlocks) {
                try {
                    const block = this.node.blockchain.blockDataFromSerializedHeaderAndTxs(
                        serializedBlock.header,
                        serializedBlock.txs
                    );
                    await this.node.digestFinalizedBlock(block, {skipValidation: false, broadcastNewCandidate: false, isSync: true, persistToDisk: true});
                    desiredBlock++;
                } catch (blockError) {
                    this.logger.error(
                        { error: blockError.message, blockIndex: desiredBlock },
                        'Error processing block'
                    );
                    console.error(blockError);
                    this.isSyncing = false;
                    throw new SyncRestartError('Sync failure occurred, restarting sync process');
                }
            }

            this.logger.info({count: serializedBlocks.length, nextBlock: desiredBlock },'Synchronized blocks from peer');
            // Update the peer's height when necessary
            if (peerHeight === this.node.blockchain.currentHeight) {
                peerHeight = await this.#updatedPeerHeight(p2pNetwork, peerMultiaddr);
                if (!peerHeight) { console.log(`[SYNC] (#getMissingBlocks: while()) Failed to get peer height`); }
            }
    
        }

        if (peerHeight === this.node.blockchain.currentHeight) { return true; }
        // No bug, but not fully synchronized
        return false;
    }

    /** Requests blocks from a peer.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks. */
     async #requestBlocksFromPeer(p2pNetwork, peerMultiaddr, startIndex, endIndex) {
        const message = { type: 'getBlocks', startIndex, endIndex };
        this.logger.debug({ startIndex, endIndex }, 'Requesting blocks from peer');

        let response;
        try {
            response = await p2pNetwork.sendMessage(peerMultiaddr, message);
        } catch (error) {
            this.logger.error({ error: error.message }, `Failed to get blocks from peer ${peerMultiaddr}`);
            throw error;
        }

        if (response.status === 'success' && Array.isArray(response.blocks)) {
            return response.blocks;
        } else {
            this.logger.warn({ status: response.status }, 'Failed to get blocks from peer');
            throw new Error('Failed to get blocks from peer');
        }
    }
}