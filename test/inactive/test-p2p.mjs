// test-p2p.mjs
import { pipe } from 'it-pipe';
import { encode, decode } from 'it-length-prefixed';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { multiaddr } from 'multiaddr';
import * as lp from 'it-length-prefixed';

async function createNode(peerName) {
    const node = await createLibp2p({
        addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] }, // Listen on loopback with dynamic port
        transports: [tcp()],
        streamMuxers: [yamux()],
        connectionEncryption: [noise()],
    });

    node.peerName = peerName; // Assign a name for easier identification
    return node;
}

async function main() {
    // Create Node A (Server)
    const nodeA = await createNode('Node A');

    // Handle the '/test/1.0.0' protocol on Node A
    nodeA.handle('/test/1.0.0', async ({ stream, connection }) => {
        console.log(`[${nodeA.peerName}] Received a new stream from ${connection.remotePeer.toString()}`);

        try {
            await pipe(
                stream.source,
                lp.decode(),  // Decode the incoming message
                async (source) => {
                    for await (const msg of source) {
                        const message = msg.toString();
                        console.log(`[${nodeA.peerName}] Received message:`, message);

                        // Prepare and send the response
                        const response = { status: 'ok', received: message };
                        const serializedResponse = Buffer.from(JSON.stringify(response));

                        await pipe(
                            [serializedResponse],  // Message needs to be an async iterable
                            lp.encode(),           // Encode it for transmission
                            stream.sink            // Send it back
                        );

                        console.log(`[${nodeA.peerName}] Sent response:`, response);
                    }
                }
            );
        } catch (error) {
            console.error(`[${nodeA.peerName}] Error handling stream:`, error);
        }
    });

    await nodeA.start();
    console.log(`[${nodeA.peerName}] Started with ID ${nodeA.peerId.toString()}`);

    // Retrieve Node A's listen multiaddresses before encapsulation
    const nodeAListenAddrs = nodeA.getMultiaddrs();
    console.log(`[${nodeA.peerName}] Node A listen addresses (before encapsulation):`);
    nodeAListenAddrs.forEach(ma => {
        console.log(` - ${ma.toString()}`);
    });

    // Encapsulate /p2p/<PeerID> once and store the full multiaddresses
    const nodeAFullAddrs = nodeAListenAddrs.map(ma => {
        const maStr = ma.toString();
        const peerIdStr = nodeA.peerId.toString();
        const p2pComponent = `/p2p/${peerIdStr}`;
        if (maStr.includes(p2pComponent)) {
            // Already has /p2p/<PeerID>, return as is
            return ma;
        } else {
            // Encapsulate /p2p/<PeerID> once
            return ma.encapsulate(p2pComponent);
        }
    });

    console.log(`[${nodeA.peerName}] Node A listen addresses (after encapsulation):`);
    nodeAFullAddrs.forEach(ma => {
        console.log(` - ${ma.toString()}`);
    });

    // Create Node B (Client)
    const nodeB = await createNode('Node B');

    await nodeB.start();
    console.log(`[${nodeB.peerName}] Started with ID ${nodeB.peerId.toString()}`);

    // Wait a moment to ensure Node A is ready to accept connections
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Attempt to dial Node A using all available multiaddresses
    let dialed = false;
    for (const nodeAMultiaddr of nodeAFullAddrs) {
        console.log(`[${nodeB.peerName}] Attempting to dial Node A at ${nodeAMultiaddr.toString()}`);
        try {
            // Dial Node A using the '/test/1.0.0' protocol
            const { stream } = await nodeB.dialProtocol(nodeAMultiaddr, '/test/1.0.0');

            console.log(`[${nodeB.peerName}] Successfully dialed Node A at ${nodeAMultiaddr.toString()}`);

            // Prepare the message to send
            const message = { type: 'test', content: 'Hello, World!' };
            const serializedMessage = Buffer.from(JSON.stringify(message));

            // Send the message
            await pipe(
                [serializedMessage],  // Message needs to be an async iterable
                lp.encode(),          // Encode it
                stream.sink           // Send it
            );
            console.log(`[${nodeB.peerName}] Sent message:`, message);

            // Receive the response
            const response = await pipe(
                stream.source,
                lp.decode(), // Decode the response from Node A
                async (source) => {
                    for await (const msg of source) {
                        return JSON.parse(msg.toString());
                    }
                }
            );

            console.log(`[${nodeB.peerName}] Received response:`, response);
            dialed = true;
            break; // Exit the loop on successful dial
        } catch (err) {
            console.error(`[${nodeB.peerName}] Error dialing Node A at ${nodeAMultiaddr.toString()}:`, err);
            // Continue to the next multiaddress
        }
    }

    if (!dialed) {
        console.error(`[${nodeB.peerName}] Failed to dial Node A on all available multiaddresses.`);
    }

    // Stop both nodes
    await nodeB.stop();
    await nodeA.stop();
    console.log('Both nodes have been stopped.');
}

main().catch(err => {
    console.error('An error occurred:', err);
});
