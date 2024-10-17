// p2p.test.js
import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import P2PNetwork from '../src/p2p.mjs'; // Adjust the path as necessary
import ReputationManager from '../src/reputation.mjs'; // Adjust the path as necessary
import { multiaddr } from '@multiformats/multiaddr';

/**
 * Simple TimeSynchronizer implementation for testing.
 */
class TimeSynchronizer {
    getCurrentTime() {
        return Date.now();
    }
}

describe('P2PNetwork with ReputationManager Integration', function () {
    // Increase timeout for asynchronous operations
    this.timeout(60000); // 60 seconds

    let nodeA, nodeB, nodeC;

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const getFirstAddress = (node) => {
        const addresses = node.p2pNode.getMultiaddrs();
        expect(addresses.length).to.be.greaterThan(0, 'Node should have at least one multiaddr');
        return addresses[0].toString();
    };

    before(async () => {
        // Initialize three P2PNetwork nodes with custom reputation options
        nodeA = new P2PNetwork({
            listenAddress: '/ip4/0.0.0.0/tcp/0', // Dynamic port assignment
            reputationOptions: {
                banThreshold: -5, // Lower threshold for testing
                banPermanentScore: -10,
                tempBanDuration: 3000, // 3 seconds for quick testing
                cleanupInterval: 1000, // 1 second
            },
            bootstrapNodes: [], // No bootstrap nodes initially
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

        // Start all nodes
        await Promise.all([nodeA.start(), nodeB.start(), nodeC.start()]);

        // Retrieve nodeA's multiaddress for bootstrap purposes
        const nodeAAddr = getFirstAddress(nodeA);

        // Configure nodeB and nodeC to use nodeA as a bootstrap node
        nodeB.options.bootstrapNodes = [nodeAAddr];
        nodeC.options.bootstrapNodes = [nodeAAddr];

        // Connect nodeB and nodeC to nodeA
        await Promise.all([nodeB.connectToBootstrapNodes(), nodeC.connectToBootstrapNodes()]);

        // Wait for connections to establish
        await wait(2000);
    });

    after(async () => {
        // Gracefully shutdown all nodes
        await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]);
    });

    it('should ban a peer after offenses and unban after temporary duration', async () => {
        const peerAId = nodeA.p2pNode.peerId.toString();
        const peerBId = nodeB.p2pNode.peerId.toString();
        const peerCId = nodeC.p2pNode.peerId.toString();
        const peerCAddr = getFirstAddress(nodeC); // Fetch actual address of NodeC
    
        // Verify initial connections
        expect(nodeA.getConnectedPeers()).to.include.members([peerBId, peerCId], 'NodeA should be connected to NodeB and NodeC');
    
        // Listen for 'peer:disconnect' event to confirm disconnection
        const disconnectPromise = new Promise(resolve => {
            nodeA.once('peer:disconnect', (disconnectedPeerId) => {
                if (disconnectedPeerId === peerCId) resolve();
            });
        });
    
        // Apply an offense to NodeC from NodeA's perspective
        nodeA.reputationManager.applyOffense(
            { peerId: peerCId, address: peerCAddr },
            nodeA.reputationManager.offenseTypes.INVALID_TRANSACTION_PROPAGATION
        );
    
        // Allow some time for processing
        await wait(2000);  // Increased wait time to ensure disconnection happens
    
        // Verify NodeC is banned
        expect(nodeA.reputationManager.getPeerScore(peerCId)).to.be.below(nodeA.options.reputationOptions.banThreshold);
        expect(nodeA.reputationManager.isPeerBanned(peerCId)).to.be.true;
    
        // Wait for disconnection
        await disconnectPromise;
    
        // Add a short wait after the event is emitted
        await wait(1000); // Additional wait to ensure full disconnection processing
    
        // Verify NodeA has disconnected from NodeC
        expect(nodeA.getConnectedPeers()).to.not.include(peerCId);
        expect(nodeC.getConnectedPeers()).to.not.include(peerAId);
    
        // Try reconnecting NodeC (should fail)
        try {
            await nodeC.connectToBootstrapNodes();
            await wait(1000);  // Give time for connection attempt
        } catch (error) {
            // Expected to fail
        }
    
        expect(nodeA.getConnectedPeers()).to.not.include(peerCId);
    
        // Wait for temporary ban to expire
        await wait(nodeA.options.reputationOptions.tempBanDuration + 2000);  // Ensure enough time for tempBanDuration to expire
        await wait(nodeA.options.reputationOptions.cleanupInterval + 1000);  // Ensure cleanup happens after temp ban expiration
    
        // Verify NodeC is unbanned
        expect(nodeA.reputationManager.isPeerBanned(peerCId)).to.be.false;
    
        // Try reconnecting NodeC (should succeed)
        await nodeC.connectToBootstrapNodes();
        await wait(2000);  // Allow time for reconnection
    
        // Verify NodeA and NodeC are connected again
        expect(nodeA.getConnectedPeers()).to.include(peerCId);
        expect(nodeC.getConnectedPeers()).to.include(peerAId);
    });
    
    it('should permanently ban a peer after multiple severe offenses', async () => {
        const peerAId = nodeA.p2pNode.peerId.toString();
        const peerBId = nodeB.p2pNode.peerId.toString();
        const peerBAddr = getFirstAddress(nodeB); // Fetch actual address of NodeB
    
        // Listen for 'peer:disconnect' event to confirm disconnection
        const disconnectPromise = new Promise(resolve => {
            nodeA.once('peer:disconnect', (disconnectedPeerId) => {
                if (disconnectedPeerId === peerBId) resolve();
            });
        });
    
        // Apply multiple severe offenses to NodeB
        const severeOffenses = [
            nodeA.reputationManager.offenseTypes.DOUBLE_SIGNING,
            nodeA.reputationManager.offenseTypes.DOS_ATTACK,
            nodeA.reputationManager.offenseTypes.CONSENSUS_MANIPULATION,
            nodeA.reputationManager.offenseTypes.SYBIL_ATTACK,
        ];
    
        severeOffenses.forEach(offense => {
            nodeA.reputationManager.applyOffense({ peerId: peerBId, address: peerBAddr }, offense);
        });
    
        // Allow processing
        await wait(2000);  // Increased wait to allow processing
    
        // Verify NodeB is permanently banned
        expect(nodeA.reputationManager.isPeerPermanentlyBanned(peerBId)).to.be.true;
    
        // Wait for disconnection
        await disconnectPromise;
    
        // Add a short wait after the event is emitted
        await wait(1000); // Additional wait to ensure full disconnection processing
    
        // Verify NodeA has disconnected from NodeB
        expect(nodeA.getConnectedPeers()).to.not.include(peerBId);
        expect(nodeB.getConnectedPeers()).to.not.include(peerAId);
    
        // Try reconnecting NodeB (should fail due to permanent ban)
        try {
            await nodeB.connectToBootstrapNodes();
            await wait(1000);
        } catch (error) {
            // Expected to fail
        }
    
        expect(nodeA.getConnectedPeers()).to.not.include(peerBId);
    });
});    