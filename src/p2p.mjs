// p2p.mjs
import { EventEmitter } from 'events';
import pino from 'pino';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import * as filters from '@libp2p/websockets/filters';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { lpStream } from 'it-length-prefixed-stream';
import utils from './utils.mjs';
import { yamux } from '@chainsafe/libp2p-yamux';
import { mplex } from '@libp2p/mplex';
import { multiaddr } from '@multiformats/multiaddr';
import ReputationManager from './reputation.mjs'; // Import the ReputationManager

/**
 * @typedef {import("./time.mjs").TimeSynchronizer} TimeSynchronizer
 */

class P2PNetwork extends EventEmitter {
    /** @param {Object} [options={}] */
    constructor(options = {}, timeSynchronizer) {
        super();
        /** @type {TimeSynchronizer} */
        this.timeSynchronizer = timeSynchronizer;
        const defaultOptions = {
            bootstrapNodes: [],
            maxPeers: 12,
            logLevel: 'info',
            logging: true,
            listenAddress: '/ip4/0.0.0.0/tcp/27260',
            dialTimeout: 30000,
            reputationOptions: {}, // Options for ReputationManager
        };
        this.options = { ...defaultOptions, ...options };

        this.p2pNode = null;
        this.peers = new Map();
        this.subscriptions = new Set();

        if (!P2PNetwork.logger) {
            P2PNetwork.logger = this.#initLogger();
        }
        this.logger = P2PNetwork.logger;

        this.reputationManager = new ReputationManager(this.options.reputationOptions);

        // Event listener for when a peer is banned
        this.reputationManager.on('peerBanned', ({ peerId, ip, permanent }) => {
            this.logger.warn(
                { peerId, ip, permanent },
                `Peer ${peerId} (${ip || 'unknown ip'}) has been ${permanent ? 'permanently' : 'temporarily'} banned`
            );

            if (this.p2pNode) {
                // Close connections to the banned peer
                this.p2pNode.components.connectionManager.closeConnections(peerId);
            }
        });

        // Event listener for when a peer is unbanned
        this.reputationManager.on('peerUnbanned', ({ peerId, ip }) => {
            this.logger.info(
                { peerId, ip },
                `Peer ${peerId} (${ip || 'unknown ip'}) has been unbanned`
            );
        });

        // Event listener for when an IP is banned
        this.reputationManager.on('ipBanned', ({ ip, permanent }) => {
            this.logger.warn(
                { ip, permanent },
                `IP ${ip} has been ${permanent ? 'permanently' : 'temporarily'} banned`
            );

            if (this.p2pNode) {
                let peerId = this.reputationManager.getPeerIdByIP(ip);
            
                if (!peerId) {
                    // try to find in peers a corresponding address
                    for (let [id, peer] of this.peers) {
                        if (peer.address.includes(ip)) {
                            peerId = id;
                            this.logger.warn({ ip, peerId }, 'Found peerId by ip');
                            break;
                        }
                    }
                }
                if (!peerId) { return; }
                this.logger.info({ ip, peerId }, 'Closing connections to banned IP');
                this.p2pNode.components.connectionManager.closeConnections(peerId);
            }
        });

        // Event listener for when an IP is unbanned
        this.reputationManager.on('ipUnbanned', ({ ip }) => {
            this.logger.info(
                { ip },
                `IP ${ip} has been unbanned`
            );
        });

    }

    /** @type {string} */
    static SYNC_PROTOCOL = '/blockchain-sync/1.0.0';
    /** @type {pino.Logger} */
    static logger = null;
    /** @returns {pino.Logger} */

    #initLogger() {
        return pino({
            level: this.options.logLevel,
            enabled: this.options.logging,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    messageFormat: '{component} - {msg}',
                },
            },
        });
    }

    async start() {
        try {
            this.p2pNode = await this.#createLibp2pNode();
            await this.p2pNode.start();
            this.logger.info({ peerId: this.p2pNode.peerId, listenAddress: this.options.listenAddress }, 'P2P network started');

            this.#setupEventListeners();
            await this.connectToBootstrapNodes();
        } catch (error) {
            this.logger.error(
                { component: 'P2PNetwork', error: error.message }, 'Failed to start P2P network');
            throw error;
        }
    }
    async stop() {
        if (this.p2pNode) {
            await this.p2pNode.stop();
            this.logger.info({ component: 'P2PNetwork', peerId: this.p2pNode.peerId.toString() }, 'P2P network stopped');
        }
        // Gracefully shutdown ReputationManager
        await this.reputationManager.shutdown();
    }

    /** @returns {Promise<Libp2p>} */
    async #createLibp2pNode() {
        const peerDiscovery = [];

        if (this.options.bootstrapNodes.length > 0) {
            peerDiscovery.push(bootstrap({ list: this.options.bootstrapNodes }));
        }

        return createLibp2p({
            addresses: { listen: [this.options.listenAddress] },
            transports: [tcp()],
            streamMuxer: [mplex],
            connectionEncryption: [noise()],
            services: {
                identify: identify(),
                pubsub: gossipsub({
                    emitSelf: false,
                    gossipIncoming: false,
                    fallbackToFloodsub: false,
                    floodPublish: false,
                    allowPublishToZeroPeers: true,
                }),
                dht: kadDHT(),
            },
            peerDiscovery,
            connectionManager: {
                autoDial: false,
            },
        });
    }

    async connectToBootstrapNodes() {
 
        await Promise.all(this.options.bootstrapNodes.map(async (addr) => {
            try {
                // check if banned before dialing
                if (this.reputationManager.isIPBanned(addr)) {
                    this.logger.warn({ component: 'P2PNetwork', bootstrapNode : addr }, 'Node is banned. Skipping connection...');
                    return;
                }

                const ma = multiaddr(addr);
                await this.dial(ma);
                await this.p2pNode.components.connectionManager.openConnection(ma);
                this.logger.info({ component: 'P2PNetwork', bootstrapNode: addr }, 'Connected to bootstrap node');
            } catch (err) {
                this.logger.error({ component: 'P2PNetwork', bootstrapNode: addr, error: err.message }, 'Failed to connect to bootstrap node');
            }
        }));
    }


    #setupEventListeners() {
        this.p2pNode.addEventListener('peer:connect', this.#handlePeerConnect);
        this.p2pNode.addEventListener('peer:disconnect', this.#handlePeerDisconnect);
        this.p2pNode.addEventListener('peer:discovery', (event) => {
            const peerId = event.detail.id + " " + event.detail.multiaddrs.toString();
            this.logger.debug({ peerId }, 'Peer discovered');
        });
        this.p2pNode.services.pubsub.addEventListener('message', this.#handlePubsubMessage);
    }

    /** @param {CustomEvent} event */
    #handlePeerConnect = (event) => {
        const peerId = event.detail.toString();
        this.logger.info({ peerId }, 'Peer connecting');

        // Retrieve multiaddrs of the connected peer
        const connections = this.p2pNode.getConnections(peerId);
        let peerInfo = { peerId, address: null };
        if (connections.length > 0) {
            const multiaddr = connections[0].remoteAddr;
            peerInfo.address = multiaddr.toString();
        }

        // Check if the peer or its IP is banned
        if (this.reputationManager.isPeerOrIPBanned(peerInfo)) {
            this.logger.warn({ peerId, address: peerInfo.address }, 'Connected peer is banned. Disconnecting...');
            this.p2pNode.components.connectionManager.closeConnections(peerId);
            this.peers.delete(peerId);
            return;
        }

        this.updatePeer(peerId, { status: 'connected', address: peerInfo.address });
        this.emit('peer:connect', peerId);
    };
    /** @param {CustomEvent} event */
    #handlePeerDisconnect = (event) => {
        const peerId = event.detail.toString();
        this.logger.info({ peerId }, 'Peer disconnected');
        this.peers.delete(peerId);
        this.emit('peer:disconnect', peerId);
    };

    async dial(peerId) {
        try {
            const con = await this.p2pNode.dial(peerId);
            this.logger.info({ component: 'P2PNetwork', peerId, address: con.remoteAddr.toString() }, 'Dialed peer');
            this.updatePeer(peerId.toString(), { status: 'dialed', address: con.remoteAddr.toString() });
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', peerId, error: error.message }, 'Failed to dial peer');
            throw error;
        }
    }

    async createStream(peerId, protocol) {
        try {
            const stream = await this.p2pNode.dialProtocol(peerId, protocol);
            this.logger.debug({ component: 'P2PNetwork', peerId, protocol }, 'Stream created');
            this.updatePeer(peerId.toString(), { stream });
            return stream;
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', peerId, protocol, error: error.message }, 'Failed to create stream');
            throw error;
        }
    }


    /** @param {CustomEvent} event */
    #handlePubsubMessage = async (event) => {
        const { topic, data, from } = event.detail;
        // check if binary
        if (!(data instanceof Uint8Array)) { console.error(`Received non-binary data from ${from} dataset: ${data} topic: ${topic}`); return; }
        const byteLength = data.byteLength;
        try {
            let parsedMessage;
            switch (topic) {
                case 'new_transaction':
                    // check the size of the tx before parsing it
                    if (data.byteLength > utils.SETTINGS.maxTransactionSize * 1.02) { this.logger.error({ component: 'P2PNetwork', topic, from }, 'Transaction size exceeds the maximum allowed size'); return; }
                    parsedMessage = utils.serializerFast.deserialize.transaction(data);
                    break;
                case 'new_block_candidate':
                    if (data.byteLength > utils.SETTINGS.maxBlockSize * 1.02) { this.logger.error({ component: 'P2PNetwork', topic, from }, 'Block candidate size exceeds the maximum allowed size'); return; }
                    parsedMessage = utils.serializer.block_candidate.fromBinary_v4(data);
                    break;
                case 'new_block_finalized':
                    if (data.byteLength > utils.SETTINGS.maxBlockSize * 1.02) { this.logger.error({ component: 'P2PNetwork', topic, from }, 'Block finalized size exceeds the maximum allowed size'); return; }
                    parsedMessage = utils.serializer.block_finalized.fromBinary_v4(data);
                    break;
                default:
                    parsedMessage = utils.serializer.rawData.fromBinary_v1(data);
                    break;
            }

            const message = { content: parsedMessage, from, byteLength };
            this.emit(topic, message);

        } catch (error) {
            console.error('Failed to parse pubsub message:', error);
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to parse pubsub message');
        }
    }

    /** @param {string} topic @param {any} message - Can be any JavaScript object */
    async broadcast(topic, message) {
        //this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcasting message');
        if (this.peers.size === 0) {
            return new Error("No peers to broadcast to");
        }
        try {
            let serialized;
            switch (topic) {
                case 'new_transaction':
                    serialized = utils.serializerFast.serialize.transaction(message);
                    break;
                case 'new_block_candidate':
                    serialized = utils.serializer.block_candidate.toBinary_v4(message);
                    break;
                case 'new_block_finalized':
                    serialized = utils.serializer.block_finalized.toBinary_v4(message);
                    break;
                default:
                    serialized = utils.serializer.rawData.toBinary_v1(message);
                    break;
            }

            await this.p2pNode.services.pubsub.publish(topic, serialized);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcast complete');
            return 'success';
        } catch (error) {
            if (error.message === "PublishError.NoPeersSubscribedToTopic") {
                return error;
            }
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Broadcast error');
            return error;
        }
    }
    /**
      * @param {string} peerMultiaddr - The multiaddress of the peer.
      * @param {Object} message - The message to send.
      * @returns {Promise<Object>} The response from the peer.
      */
    async sendMessage(peerMultiaddr, message) {
        // Extract peerId using libp2p's multiaddr parsing for reliability
        let peerId;
        try {
            const ma = multiaddr(peerMultiaddr);
            const peerIdComponent = ma.getPeerId();
            if (!peerIdComponent) {
                throw new Error('Invalid multiaddr: Peer ID not found');
            }
            peerId = peerIdComponent.toString();
        } catch (err) {
            this.logger.error({ component: 'P2PNetwork', peerMultiaddr, error: err.message }, 'Failed to parse multiaddr');
            throw err;
        }

        try {
            // Acquire a valid stream (reuse or create new)
            const stream = await this.acquireStream(peerId, peerMultiaddr);

            // Send the message over the acquired stream
            const response = await this.sendOverStream(stream, message);
            return response;
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', peerMultiaddr, peerId, error: error.message }, 'Failed to send message');

            // Attempt to close the faulty stream if it exists
            const peer = this.peers.get(peerId);
            if (peer && peer.stream && !peer.stream.closed) {
                try {
                    await peer.stream.close();
                    await peer.stream.reset();
                    this.updatePeer(peerId, { stream: null });
                    this.logger.debug({ component: 'P2PNetwork', peerId }, 'Closed faulty stream after error');
                } catch (closeErr) {
                    this.logger.error({ component: 'P2PNetwork', peerId, error: closeErr.message }, 'Failed to close stream after error');
                }
            }
            throw error;
        }
    }

    /**
     * Acquires a valid stream for the given peer. Reuses existing streams if available and open,
     * otherwise creates a new stream.
     * @param {string} peerId - The ID of the peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @returns {Promise<Stream>} - The libp2p stream to use for communication.
     */
    async acquireStream(peerId, peerMultiaddr) {
        const peer = this.peers.get(peerId);

        // Reuse existing stream if available and open
        // if (peer && peer.stream != null && peer.stream.status) {
        //     this.logger.info({ component: 'P2PNetwork', peerId }, 'Reusing existing stream');
        //     return peer.stream;
        // }

        // Create a new stream
        let stream;
        try {
            const abortController = new AbortController();
            const timeout = setTimeout(() => {
                abortController.abort();
            }, 300_000); // 5 minutes

            stream = await this.p2pNode.dialProtocol(peerMultiaddr, P2PNetwork.SYNC_PROTOCOL, { signal: abortController.signal });
            clearTimeout(timeout);

            this.updatePeer(peerId, { stream });
            this.logger.debug({ component: 'P2PNetwork', peerId }, 'Created new stream');
            return stream;
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', peerId, error: error.message }, 'Failed to acquire stream');
            throw error;
        }
    }
    /**
     * Sends a serialized message over the provided stream and handles the response.
     * @param {Stream} stream - The libp2p stream to use for communication.
     * @param {Object} message - The message object to send.
     * @returns {Promise<Object>} - The response from the peer.
     */
    async sendOverStream(stream, message) {
        try {
            const lp = lpStream(stream);
            const serialized = utils.serializer.rawData.toBinary_v1(message);
            await lp.write(serialized);
            this.logger.info({ component: 'P2PNetwork', length: message.length }, 'Message written to stream');

            const res = await lp.read();
            if (!res) {
                throw new Error('No response received (unexpected end of input)');
            }
            this.logger.info({ component: 'P2PNetwork', response_bytes: res.length }, 'Response read from stream');

            const response = utils.serializer.rawData.fromBinary_v1(res.subarray());

            if (response.status !== 'error') {
                return response;
            }

            throw new Error(response.message);
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Error during sendOverStream');
            throw error;
        }
    }
    /** @param {string} topic @param {Function} [callback] */
    async subscribe(topic, callback) {
        if (this.subscriptions.has(topic)) { return; }

        this.logger.debug({ component: 'P2PNetwork', topic }, 'Subscribing to topic');
        try {
            await this.p2pNode.services.pubsub.subscribe(topic);
            this.subscriptions.add(topic);
            if (callback) {
                this.on(topic, (message) => callback(topic, message));
            }
            this.logger.debug({ component: 'P2PNetwork', topic, subscriptions: Array.from(this.subscriptions) }, 'Subscribed to topic'
            );
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to subscribe to topic'
            );
            throw error;
        }
    }
    /** @param {string[]} topics @param {Function} [callback] */
    async subscribeMultipleTopics(topics, callback) {
        await Promise.all(topics.map((topic) => this.subscribe(topic, callback)));
    }
    /** @param {string} topic */
    async unsubscribe(topic) {
        if (!this.subscriptions.has(topic)) {
            this.logger.error(
                { component: 'P2PNetwork', topic },
                'Attempting to unsubscribe from a topic that was not subscribed to'
            );
            return;
        }

        try {
            await this.p2pNode.services.pubsub.unsubscribe(topic);
            this.p2pNode.services.pubsub.topics.delete(topic);
            this.subscriptions.delete(topic);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Unsubscribed from topic');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Error unsubscribing from topic');
            throw error;
        }
    }

    /** @param {string} peerId @param {Object} data */
    updatePeer(peerId, data) {
        const existingPeer = this.peers.get(peerId) || {};
        const updatedPeer = {
            ...existingPeer,    // Preserve existing data
            ...data,            // Overwrite with new data
            lastSeen: this.timeSynchronizer.getCurrentTime(),
        };

        // Optionally, ensure that `address` and `stream` are preserved if not provided in `data`
        if (data.address === undefined) {
            updatedPeer.address = existingPeer.address || null;
        }
        if (data.stream === undefined) {
            updatedPeer.stream = existingPeer.stream || null;
        }

        this.peers.set(peerId, updatedPeer);
        this.logger.debug({ component: 'P2PNetwork', peerId }, 'Peer updated');
        this.emit('peer:updated', peerId, data);
    }

    /** @returns {string[]} */
    getConnectedPeers() {
        return Array.from(this.peers.keys());
    }
    /** @returns {string[]} */
    getSubscribedTopics() {
        return Array.from(this.subscriptions);
    }
    /** @returns {boolean} */
    isStarted() {
        return this.p2pNode && this.p2pNode.status === 'started';
    }
}

export default P2PNetwork;
export { P2PNetwork };
