import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import P2PNetwork from '../src/p2p.mjs';
import { multiaddr } from '@multiformats/multiaddr';
import ReputationManager from '../src/reputation.mjs';

class TimeSynchronizer {
    getCurrentTime() {
        return Date.now();
    }
}

describe('P2PNetwork with ReputationManager Integration', function () {
    this.timeout(60000); // Increase timeout for async operations

    let nodeA, nodeB, nodeC;

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const getFirstAddress = (node) => {
        const addresses = node.p2pNode.getMultiaddrs();
        expect(addresses.length).to.be.greaterThan(0, 'Node should have at least one multiaddr');
        return addresses[0].toString();
    };

    before(async () => {
        console.log('Starting P2P nodes...');

        nodeA = new P2PNetwork({
            listenAddress: '/ip4/0.0.0.0/tcp/0',
            reputationOptions: {
                banThreshold: -5,
                banPermanentScore: -10,
                tempBanDuration: 3000, // 3 seconds
                cleanupInterval: 1000, // 1 second
            },
            bootstrapNodes: [],
        }, new TimeSynchronizer());

        nodeB = new P2PNetwork({
            listenAddress: '/ip4/0.0.0.0/tcp/0',
            reputationOptions: {
                banThreshold: -5,
                banPermanentScore: -10,
                tempBanDuration: 3000,
                cleanupInterval: 1000,
            },
            bootstrapNodes: [],
        }, new TimeSynchronizer());

        nodeC = new P2PNetwork({
            listenAddress: '/ip4/0.0.0.0/tcp/0',
            reputationOptions: {
                banThreshold: -5,
                banPermanentScore: -10,
                tempBanDuration: 3000,
                cleanupInterval: 1000,
            },
            bootstrapNodes: [],
        }, new TimeSynchronizer());

        await Promise.all([nodeA.start(), nodeB.start(), nodeC.start()]);

        const nodeAAddr = getFirstAddress(nodeA);
        console.log(`Node A started at: ${nodeAAddr}`);

        nodeB.options.bootstrapNodes = [nodeAAddr];
        nodeC.options.bootstrapNodes = [nodeAAddr];

        await Promise.all([nodeB.connectToBootstrapNodes(), nodeC.connectToBootstrapNodes()]);
        await wait(2000); // Wait for nodes to establish connections
    });

    after(async () => {
        console.log('Stopping P2P nodes...');
        await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]);
        console.log('All nodes stopped.');
    });

    it('should apply offense by only ip and ban correctly', async () => {
        const peerCAddr = getFirstAddress(nodeC);
        const addr = multiaddr(peerCAddr);
        const ip = addr.nodeAddress().address; // Extracts IP address

        console.log(`Applying offense to Node C using only ip (${ip})...`);

        nodeA.reputationManager.applyOffense(
            { ip },
            ReputationManager.OFFENSE_TYPES.SYBIL_ATTACK
        );

        await wait(500); // Give time for the ban to apply

        // Check if IP is temporarily banned
        expect(nodeA.reputationManager.isIPBanned(ip)).to.be.true;

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000); // Extra wait time

        // Ensure IP is unbanned
        expect(nodeA.reputationManager.isIPBanned(ip)).to.be.false;
    });

    it('should ban a peer after offenses and unban after temporary duration', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();
        const peerCAddr = getFirstAddress(nodeC);
        const addr = multiaddr(peerCAddr);
        const ip = addr.nodeAddress().address;

        console.log(`Applying offense to Node C (${peerCId})...`);
        nodeA.reputationManager.applyOffense(
            { peerId: peerCId, ip },
            ReputationManager.OFFENSE_TYPES.INVALID_TRANSACTION_PROPAGATION
        );

        await wait(500); // Ensure offense is processed and ban is applied

        console.log(`Node C score: ${nodeA.reputationManager.getPeerScore(peerCId)}`);
        expect(nodeA.reputationManager.isPeerBanned(peerCId)).to.be.true;

        // Wait for the temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000);

        // Ensure peer is unbanned
        expect(nodeA.reputationManager.isPeerBanned(peerCId)).to.be.false;

        await wait(2000); // Allow time for reconnection
        console.log('Attempting to reconnect Node C...');
        await nodeC.connectToBootstrapNodes();
        await wait(2000);

        expect(nodeA.getConnectedPeers()).to.include(peerCId);
    });

    it('should permanently ban a peer after multiple severe offenses', async () => {
        const peerBId = nodeB.p2pNode.peerId.toString();
        const peerBAddr = getFirstAddress(nodeB);
        const addr = multiaddr(peerBAddr);
        const ip = addr.nodeAddress().address;

        console.log('Applying severe offenses to Node B...');
        const severeOffenses = [
            ReputationManager.OFFENSE_TYPES.DOUBLE_SIGNING,
            ReputationManager.OFFENSE_TYPES.DOS_ATTACK,
            ReputationManager.OFFENSE_TYPES.CONSENSUS_MANIPULATION,
            ReputationManager.OFFENSE_TYPES.SYBIL_ATTACK,
        ];

        severeOffenses.forEach(offense => {
            nodeA.reputationManager.applyOffense(
                { peerId: peerBId, ip },
                offense
            );
        });

        await wait(1000); // Ensure disconnection happens

        // Check if peer is permanently banned
        expect(nodeA.reputationManager.isPeerPermanentlyBanned(peerBId)).to.be.true;
        expect(nodeA.getConnectedPeers()).to.not.include(peerBId);
    });

    it('should apply offense by only peerId and ban correctly', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();
        console.log(`Applying offense to Node C using only peerId (${peerCId})...`);

        nodeA.reputationManager.applyOffense(
            { peerId: peerCId },
            ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING
        );

        await wait(500);

        // Check if peer is temporarily banned
        expect(nodeA.reputationManager.isPeerBanned(peerCId)).to.be.true;

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000);

        // Ensure peer is unbanned
        expect(nodeA.reputationManager.isPeerBanned(peerCId)).to.be.false;
    });

    it('should throw error for unsupported offense types', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();
        const unsupportedOffense = 'UNSUPPORTED_OFFENSE';

        console.log(`Applying unsupported offense to Node C (${peerCId})...`);

        expect(() => {
            nodeA.reputationManager.applyOffense({ peerId: peerCId }, unsupportedOffense);
        }).to.throw(`Unknown offense type: ${unsupportedOffense}`);
    });
});
