// p2p.mjs
import { EventEmitter } from 'events';
import pino from 'pino';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { lpStream } from 'it-length-prefixed-stream';
import utils from './utils.mjs';
import { multiaddr } from '@multiformats/multiaddr';
import ReputationManager from './reputation.mjs'; // Import the ReputationManager
import { yamux } from '@chainsafe/libp2p-yamux';
import { Logger } from './logger.mjs';
/**
 * @typedef {import("./time.mjs").TimeSynchronizer} TimeSynchronizer
 */

class P2PNetwork extends EventEmitter {
    /** @param {Object} [options={}] */
    constructor(options = {}, timeSynchronizer, logger) {
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
        this.logger =  logger;

        // Initialize ReputationManager
        this.reputationManager = new ReputationManager(this.options.reputationOptions);

        // Event listener for when an identifier is banned
        this.reputationManager.on('identifierBanned', ({ identifier, permanent }) => {
            this.logger.debug(
                { identifier, permanent },
                `Identifier ${identifier} has been ${permanent ? 'permanently' : 'temporarily'} banned`
            );

            if (this.p2pNode) {
                // Attempt to find peerId associated with the identifier
                let peerId = null;

                if (this.peers.has(identifier)) {
                    // Identifier is a peerId
                    peerId = identifier;
                } else {
                    // Try to find peerId associated with the identifier
                    for (let [id, peer] of this.peers) {
                        if (peer.address && peer.address.includes(identifier)) {
                            peerId = id;
                            break;
                        } else if (peer.address.includes(identifier)) {
                            peerId = id;
                            break;
                        }
                    }
                }

                if (peerId) {
                    this.logger.debug({ identifier, peerId }, 'Closing connections to banned identifier');
                    this.p2pNode.components.connectionManager.closeConnections(peerId);
                }
            }
        });

        // Event listener for when an identifier is unbanned
        this.reputationManager.on('identifierUnbanned', ({ identifier }) => {
            this.logger.info(`luid-04ed05eb Identifier ${identifier} has been unbanned`, { identifier });
        });
    }

    /** @type {string} */
    static SYNC_PROTOCOL = '/blockchain-sync/1.0.0';
    /** @type {pino.Logger} */
    static logger = null;
    /** @returns {pino.Logger} */

    async start() {
        try {
            this.p2pNode = await this.#createLibp2pNode();
            await this.p2pNode.start();
            this.logger.info('luid-b4d2ba42 P2P network started',{ peerId: this.p2pNode.peerId, listenAddress: this.options.listenAddress });

            this.#setupEventListeners();
            await this.connectToBootstrapNodes();
        } catch (error) {
            this.logger.error('luid-c2967a8b Failed to start P2P network', { component: 'P2PNetwork', error: error.message });
            throw error;
        }
    }
    async stop() {
        if (this.p2pNode) {
            await this.p2pNode.stop();
            this.logger.info('luid-44ec7003 P2P network stopped',{ component: 'P2PNetwork', peerId: this.p2pNode.peerId.toString() });
        }
        // Gracefully shutdown ReputationManager
        await this.reputationManager.shutdown();
    }

    /** @returns {Promise<Libp2p>} */
    async #createLibp2pNode() {
        const peerDiscovery = [mdns()];

        if (this.options.bootstrapNodes.length > 0) {
            peerDiscovery.push(bootstrap({ list: this.options.bootstrapNodes }));
        }

        return createLibp2p({
            addresses: { listen: [this.options.listenAddress] },
            transports: [tcp()],
            streamMuxers: [yamux()],
            connectionEncrypters: [noise()],
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
            connectionManager: {},
        });
    }

    async connectToBootstrapNodes() {
 
        await Promise.all(this.options.bootstrapNodes.map(async (addr) => {
            try {
                const ma = multiaddr(addr);
                const isBanned = this.reputationManager.isPeerBanned({ip: ma.toString()});
                this.logger.info('luid-9167c650 Connecting to bootstrap node',{ component: 'P2PNetwork bootstrap', bootstrapNode: addr, isBanned });
                await this.p2pNode.dial(ma, { signal: AbortSignal.timeout(this.options.dialTimeout) });
                //await this.p2pNode.components.connectionManager.openConnection(ma);
                this.logger.info('luid-deffa2f2 Connected to bootstrap node', { component: 'P2PNetwork', bootstrapNode: addr });
            } catch (err) {
                this.logger.error('luid-b240757b Failed to connect to bootstrap node',{ component: 'P2PNetwork', bootstrapNode: addr, error: err.message });
            }
        }));
    }


    #setupEventListeners() {
        this.p2pNode.addEventListener('peer:connect', this.#handlePeerConnect);
        this.p2pNode.addEventListener('peer:disconnect', this.#handlePeerDisconnect);
        this.p2pNode.addEventListener('peer:discovery', this.#handlePeerDiscovery);
        this.p2pNode.services.pubsub.addEventListener('message', this.#handlePubsubMessage);
    }

    #handlePeerDiscovery = async (event) => {
        const peerId = event.detail.id + " " + event.detail.multiaddrs.toString();
        const isBanned = this.reputationManager.isPeerBanned({peerId :event.detail.id});
        this.logger.info('luid-dd80c851 Peer discovered', { peerId, isBanned });

        const peerInfo = await this.p2pNode.peerRouting.findPeer(event.detail.id);
        const ma = peerId.multiaddrs ?? peerInfo.multiaddrs;
        if (!ma) {
            this.logger.error('luid-e142f758 Failed to find multiaddrs for peer',{ component: 'P2PNetwork', peerId });
            return;
        }
        try {
            const isBanned = this.reputationManager.isPeerBanned({ip: ma.toString()});
            this.logger.info('luid-2b00a032 Dialing after discovery',{ ma, isBanned });
            await this.p2pNode.dial(ma, { signal: AbortSignal.timeout(this.options.dialTimeout) });
        }
        catch (error) {
            this.logger.error('luid-df1fa9c4 Failed to dial peer',{ component: 'P2PNetwork', peerId, error: error.message });
        }
    };

    /** @param {CustomEvent} event */
    #handlePeerConnect = (event) => {
        const peerId = event.detail.toString();
        this.logger.debug('luid-2878c082 Peer connected',{ peerId });

        const isBanned = this.reputationManager.isPeerBanned({peerId});
        this.reputationManager.recordAction({ peerId }, ReputationManager.GENERAL_ACTIONS.CONNECTION_ESTABLISHED);

        if (isBanned) {
            this.logger.warn('luid-33c7015e Peer is banned, closing connection',{ peerId });
            this.closeConnection(peerId);
            return;
        }
        // Retrieve multiaddrs of the connected peer
        const connections = this.p2pNode.getConnections(peerId);
        let peerInfo = { peerId, address: null };
        if (connections.length > 0) {
            const multiaddr = connections[0].remoteAddr;
            peerInfo.address = multiaddr.toString();
        }
        this.updatePeer(peerId, { status: 'connected', address: peerInfo.address });
        this.dial(event.detail);
        this.emit('peer:connect', peerId);
    };
    /** @param {CustomEvent} event */
    #handlePeerDisconnect = (event) => {
        const peerId = event.detail.toString();
        this.logger.debug('luid-69a1977c Peer disconnected',{ peerId });
        this.peers.delete(peerId);
        this.emit('peer:disconnect', peerId);
    };

    async dial(peerId) {
        try {
            const con = await this.p2pNode.dial(peerId);
            this.logger.debug('luid-e3c31ac5 Dialed peer', { component: 'P2PNetwork', peerId, address: con.remoteAddr.toString() });
            this.updatePeer(peerId.toString(), { status: 'dialed', address: con.remoteAddr.toString() });
            //this.createStream(peerId, P2PNetwork.SYNC_PROTOCOL);
        } catch (error) {
            this.logger.error('luid-05b05850 Failed to dial peer',{ component: 'P2PNetwork', peerId, error: error.message });
            throw error;
        }
    }

    async createStream(peerId, protocol) {
        try {
            const stream = await this.p2pNode.dialProtocol(peerId, protocol);
            this.logger.debug('luid-9fd7aa8f Stream created',{ component: 'P2PNetwork', peerId, protocol });
            this.updatePeer(peerId.toString(), { stream });
            return stream;
        } catch (error) {
            this.logger.error('luid-8dbfb594 Failed to create stream', { component: 'P2PNetwork', peerId, protocol, error: error.message });
            throw error;
        }
    }


    /** @param {CustomEvent} event */
    #handlePubsubMessage = async (event) => {
        const { topic, data, from } = event.detail;
        const isBanned = this.reputationManager.isPeerBanned({peerId: from});
        this.reputationManager.recordAction({ peerId : from}, ReputationManager.GENERAL_ACTIONS.PUBSUB_RECEIVED + topic);

        this.logger.debug('luid-b1180a7e Received pubsub message', { component: 'P2PNetwork', topic, from, isBanned });
        // check if binary
        if (!(data instanceof Uint8Array)) { this.logger.error(`luid-db87846b Received non-binary data from ${from} dataset: ${data} topic: ${topic}`); return; }
        const byteLength = data.byteLength;
        try {
            let parsedMessage;
            switch (topic) {
                case 'new_transaction':
                    // check the size of the tx before parsing it
                    if (data.byteLength > utils.SETTINGS.maxTransactionSize * 1.02) {'Transaction size exceeds the maximum allowed size' , this.logger.error({ component: 'P2PNetwork', topic, from }); return; }
                    parsedMessage = utils.serializerFast.deserialize.transaction(data);
                    break;
                case 'new_block_candidate':
                    if (data.byteLength > utils.SETTINGS.maxBlockSize * 1.02) { this.logger.error('luid-bb4b664c Block candidate size exceeds the maximum allowed size',{ component: 'P2PNetwork', topic, from }); return; }
                    parsedMessage = utils.serializer.block_candidate.fromBinary_v4(data);
                    break;
                case 'new_block_finalized':
                    if (data.byteLength > utils.SETTINGS.maxBlockSize * 1.02) { this.logger.error('luid-d4e9de17 Block finalized size exceeds the maximum allowed size',{ component: 'P2PNetwork', topic, from }); return; }
                    parsedMessage = utils.serializer.block_finalized.fromBinary_v4(data);
                    break;
                default:
                    parsedMessage = utils.serializer.rawData.fromBinary_v1(data);
                    break;
            }

            const message = { content: parsedMessage, from, byteLength };
            this.emit(topic, message);

        } catch (error) {
            this.logger.error('luid-801de822 Failed to parse pubsub message',{ component: 'P2PNetwork', topic, error: error.message});
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
            this.logger.debug('luid-4937c817 Broadcast complete',{ component: 'P2PNetwork', topic });
            return 'success';
        } catch (error) {
            if (error.message === "PublishError.NoPeersSubscribedToTopic") {
                return error;
            }
            this.logger.error('luid-8e340d55 Broadcast error',{ component: 'P2PNetwork', topic, error: error.message });
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
            this.logger.error('luid-f03a471a Failed to parse multiaddr', { component: 'P2PNetwork', peerMultiaddr, error: err.message });
            throw err;
        }

        try {
            // Acquire a valid stream (reuse or create new)
            const stream = await this.acquireStream(peerId, peerMultiaddr);

            // Send the message over the acquired stream
            const response = await this.sendOverStream(stream, message);
            return response;
        } catch (error) {
            this.logger.error('luid-b2d7c0a9 Failed to send message',{ component: 'P2PNetwork', peerMultiaddr, peerId, error: error.message });

            // Attempt to close the faulty stream if it exists
            const peer = this.peers.get(peerId);
            if (peer && peer.stream && !peer.stream.closed) {
                try {
                    await peer.stream.close();
                    await peer.stream.reset();
                    this.updatePeer(peerId, { stream: null });
                    this.logger.debug('luid-c8221f8c Closed faulty stream after error', { component: 'P2PNetwork', peerId });
                } catch (closeErr) {
                    this.logger.error('luid-cb6e42b1 Failed to close stream after error', { component: 'P2PNetwork', peerId, error: closeErr.message });
                }
            }
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
        let stream;
        try {
            const abortController = new AbortController();
            const timeout = setTimeout(() => {
                abortController.abort();
            }, 300_000); // 5 minutes

            stream = await this.p2pNode.dialProtocol(peerMultiaddr, P2PNetwork.SYNC_PROTOCOL, { signal: abortController.signal });
            clearTimeout(timeout);

            this.updatePeer(peerId, { stream });
            this.logger.debug('luid-64097d47 Created new stream',{ component: 'P2PNetwork', peerId });
            return stream;
        } catch (error) {
            this.logger.error('luid-9dee0369 Failed to acquire stream', { component: 'P2PNetwork', peerId, error: error.message });
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
            this.logger.info('luid-e99e2dac Message written to stream',{ component: 'P2PNetwork', length: message.length });

            const res = await lp.read();
            if (!res) { throw new Error('No response received (unexpected end of input)'); }
            this.logger.info('luid-d7de89d1 Response read from stream',{ component: 'P2PNetwork', response_bytes: res.length });

            const response = utils.serializer.rawData.fromBinary_v1(res.subarray());
            if (response.status !== 'error') {
                return response;
            }

            throw new Error(response.message);
        } catch (error) {
            this.logger.error('luid-a0932f5f Error during sendOverStream',{ component: 'P2PNetwork', error: error.message });
            throw error;
        }
        finally {
            if (stream) {
                try {
                    stream.close();
                } catch (closeErr) {
                    this.logger.error('luid-d0cd7dc0 Failed to close stream',{ error: closeErr.message });
                }
            } else {
                this.logger.warn('luid-07277de5 Stream is undefined; cannot close stream');
            }
        }
    }
    /** @param {string} topic @param {Function} [callback] */
    async subscribe(topic, callback) {
        if (this.subscriptions.has(topic)) { return; }

        this.logger.debug('luid-0f2f018d Subscribing to topic',{ component: 'P2PNetwork', topic });
        try {
            await this.p2pNode.services.pubsub.subscribe(topic);
            this.subscriptions.add(topic);
            if (callback) {
                this.on(topic, (message) => callback(topic, message));
            }
            this.logger.debug('luid-6ddfdefb Subscribed to topic', {component: 'P2PNetwork', topic, subscriptions: Array.from(this.subscriptions) });
        } catch (error) {
            this.logger.error('luid-fc18ad60 Failed to subscribe to topic',{ component: 'P2PNetwork', topic, error: error.message });
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
            this.logger.error('luid-7c191bc3 Attempting to unsubscribe from a topic that was not subscribed to', { component: 'P2PNetwork', topic }, );
            return;
        }

        try {
            await this.p2pNode.services.pubsub.unsubscribe(topic);
            this.p2pNode.services.pubsub.topics.delete(topic);
            this.subscriptions.delete(topic);
            this.logger.debug('luid-4d686b67 Unsubscribed from topic',{ component: 'P2PNetwork', topic });
        } catch (error) {
            this.logger.error('luid-fb112b3b Error unsubscribing from topic', { component: 'P2PNetwork', topic, error: error.message });
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
        this.logger.debug('luid-3d55ce46 Peer updated', { component: 'P2PNetwork', peerId });
        this.emit('peer:updated', peerId, data);
    }

    closeConnection(peerId) {
        this.logger.debug(`luid-09602c57 Closing connections to ${peerId}`);
        this.p2pNode.components.connectionManager.closeConnections(peerId);
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
