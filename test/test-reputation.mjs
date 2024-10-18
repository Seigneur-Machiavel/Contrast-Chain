import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import P2PNetwork from '../src/p2p.mjs';
import { multiaddr } from '@multiformats/multiaddr';
import ReputationManager from '../src/reputation.mjs';

class TimeSynchronizer {
    getCurrentTime() {
        return Date.now();
    }
}

describe('ReputationManager with P2PNetwork Integration (Multiple Nodes)', function () {
    this.timeout(20000); // Adjust as needed

    let nodeA, nodeB, nodeC;
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const getFirstAddress = (node) => {
        const addresses = node.p2pNode.getMultiaddrs();
        expect(addresses.length).to.be.greaterThan(0, 'Node should have at least one multiaddr');
        return addresses[0].toString();
    };

    beforeEach(async () => {
        nodeA = new P2PNetwork({
            listenAddress: '/ip4/0.0.0.0/tcp/0',
            reputationOptions: {
                banThreshold: -5,
                banPermanentScore: -10,
                tempBanDuration: 3000, // 3 seconds
                cleanupInterval: 1000, // 1 second
                defaultScore: 0,
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
                defaultScore: 0,
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
                defaultScore: 0,
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

    afterEach(async () => {
        console.log('Stopping P2P nodes...');
        await Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]);
        console.log('All nodes stopped.');
    });

    it('should apply offense by only ip and ban correctly', async () => {
        console.warn('This test WILL FAIL if you have a peer-reputation.json file in the root directory of the project. Please move or delete the file before running the test again.');

        const peerCAddr = getFirstAddress(nodeC);
        const addr = multiaddr(peerCAddr);
        const ip = addr.nodeAddress().address; // Extracts IP address

        console.log(`Applying offense to IP: ${ip}`);

        nodeA.reputationManager.applyOffense(
            { ip },
            ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING // Non-permanent offense
        );

        await wait(500); // Allow time for the ban to apply

        // Check if IP is banned
        expect(nodeA.reputationManager.isIdentifierBanned(ip)).to.be.true;

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 2000);

        // Check if IP is unbanned
        expect(nodeA.reputationManager.isIdentifierBanned(ip)).to.be.false;
    });

    it('should ban a peer after offenses and unban after temporary duration', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();
        const peerCAddr = getFirstAddress(nodeC);
        const addr = multiaddr(peerCAddr);
        const ip = addr.nodeAddress().address;

        console.log(`Applying offense to Peer ID: ${peerCId}, IP: ${ip}`);

        nodeA.reputationManager.applyOffense(
            { peerId: peerCId, ip },
            ReputationManager.OFFENSE_TYPES.INVALID_TRANSACTION_PROPAGATION
        );

        await wait(500);

        // Check if peerId and IP are banned
        expect(nodeA.reputationManager.isIdentifierBanned(peerCId)).to.be.true;
        expect(nodeA.reputationManager.isIdentifierBanned(ip)).to.be.true;

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000);

        // Check if peerId and IP are unbanned
        expect(nodeA.reputationManager.isIdentifierBanned(peerCId)).to.be.false;
        expect(nodeA.reputationManager.isIdentifierBanned(ip)).to.be.false;
    });

    it('should permanently ban a peer after multiple severe offenses', async () => {
        const peerBId = nodeB.p2pNode.peerId.toString();
        const peerBAddr = getFirstAddress(nodeB);
        const addr = multiaddr(peerBAddr);
        const ip = addr.nodeAddress().address;
        const address = '0x123abc'; // Suppose nodeB has an associated address

        console.log(`Applying severe offenses to Peer ID: ${peerBId}, IP: ${ip}, Address: ${address}`);

        const severeOffenses = [
            ReputationManager.OFFENSE_TYPES.DOUBLE_SIGNING,
            ReputationManager.OFFENSE_TYPES.DOS_ATTACK,
            ReputationManager.OFFENSE_TYPES.CONSENSUS_MANIPULATION,
            ReputationManager.OFFENSE_TYPES.SYBIL_ATTACK,
        ];

        // Apply severe offenses
        severeOffenses.forEach(offense => {
            nodeA.reputationManager.applyOffense(
                { peerId: peerBId, ip, address },
                offense
            );
        });

        await wait(500);

        // Check if all identifiers are permanently banned
        expect(nodeA.reputationManager.isIdentifierBanned(peerBId)).to.be.true;
        expect(nodeA.reputationManager.identifierBans.get(peerBId).permanent).to.be.true;

        expect(nodeA.reputationManager.isIdentifierBanned(ip)).to.be.true;
        expect(nodeA.reputationManager.identifierBans.get(ip).permanent).to.be.true;

        expect(nodeA.reputationManager.isIdentifierBanned(address)).to.be.true;
        expect(nodeA.reputationManager.identifierBans.get(address).permanent).to.be.true;
    });

    it('should apply offense by only peerId and ban correctly', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();

        console.log(`Applying offense to Peer ID: ${peerCId}`);

        nodeA.reputationManager.applyOffense(
            { peerId: peerCId },
            ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING
        );

        await wait(500);

        // Check if peerId is banned
        expect(nodeA.reputationManager.isIdentifierBanned(peerCId)).to.be.true;

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000);

        // Check if peerId is unbanned
        expect(nodeA.reputationManager.isIdentifierBanned(peerCId)).to.be.false;
    });

    it('should throw error for unsupported offense types', () => {
        const peerCId = nodeC.p2pNode.peerId.toString();
        const unsupportedOffense = 'UNSUPPORTED_OFFENSE';

        console.log(`Attempting to apply unsupported offense to Peer ID: ${peerCId}`);

        expect(() => {
            nodeA.reputationManager.applyOffense(
                { peerId: peerCId },
                unsupportedOffense
            );
        }).to.throw(`Unknown offense type: ${unsupportedOffense}`);
    });

    it('should associate identifiers and apply bans uniformly', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();
        const peerCAddr = getFirstAddress(nodeC);
        const addr = multiaddr(peerCAddr);
        const ip = addr.nodeAddress().address;
        const address = '0x456def'; // Suppose nodeC has an associated address

        console.log(`Associating Peer ID: ${peerCId}, IP: ${ip}, Address: ${address}`);

        // Initial offense with peerId and ip
        nodeA.reputationManager.applyOffense(
            { peerId: peerCId, ip },
            ReputationManager.OFFENSE_TYPES.MINOR_PROTOCOL_VIOLATIONS
        );

        // Update associations
        nodeA.reputationManager.updateAssociations({ peerId: peerCId, ip, address });

        // Apply offense with address
        nodeA.reputationManager.applyOffense(
            { address },
            ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING
        );

        await wait(500);

        // Get all associated identifiers
        const associatedIdentifiers = nodeA.reputationManager.getAssociatedIdentifiers({ peerId: peerCId });
        expect(associatedIdentifiers.has(ip)).to.be.true;
        expect(associatedIdentifiers.has(address)).to.be.true;

        // Check if all identifiers are banned
        associatedIdentifiers.forEach(identifier => {
            expect(nodeA.reputationManager.isIdentifierBanned(identifier)).to.be.true;
        });

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000);

        // Check if all identifiers are unbanned
        associatedIdentifiers.forEach(identifier => {
            expect(nodeA.reputationManager.isIdentifierBanned(identifier)).to.be.false;
        });
    });

    it('should reset scores upon unban', async () => {
        const peerCId = nodeC.p2pNode.peerId.toString();

        console.log(`Applying offense to Peer ID: ${peerCId}`);

        nodeA.reputationManager.applyOffense(
            { peerId: peerCId },
            ReputationManager.OFFENSE_TYPES.MESSAGE_SPAMMING
        );

        await wait(500);

        // Check score
        let score = nodeA.reputationManager.getIdentifierScore(peerCId);
        expect(score).to.be.below(0);

        // Wait for temporary ban to expire
        await wait(nodeA.reputationManager.options.tempBanDuration + 1000);

        // Check if score is reset
        score = nodeA.reputationManager.getIdentifierScore(peerCId);
        expect(score).to.equal(nodeA.reputationManager.options.defaultScore);
    });
});
