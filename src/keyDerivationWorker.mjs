// keyDerivationWorker.mjs
import { parentPort, workerData } from 'worker_threads';
import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';

/**
 * Derives a key pair from the masterHex and seedModifierHex.
 * @param {string} masterHex - The master hex string.
 * @param {string} seedModifierHex - Seed modifier in hex format.
 * @returns {Promise<Object>} - Derived key pair.
 */
async function deriveKeyPair(masterHex, seedModifierHex) {
    const seedHex = await HashFunctions.SHA256(masterHex + seedModifierHex);
    const keyPair = await AsymetricFunctions.generateKeyPairFromHash(seedHex);
    if (!keyPair) {
        throw new Error('Failed to generate key pair');
    }
    return keyPair;
}

// Listen for messages from the main thread
parentPort.on('message', async (task) => {
    const { masterHex, seedModifierHex } = task;
    try {
        const keyPair = await deriveKeyPair(masterHex, seedModifierHex);
        parentPort.postMessage({ success: true, result: keyPair });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
});
