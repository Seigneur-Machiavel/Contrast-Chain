// keyDerivationWorker.mjs
import { parentPort } from 'worker_threads';
import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';

/**
 * Derives a key pair from the masterHex and seedModifierHex using Argon2.
 * @param {string} masterHex - The master hex string.
 * @param {string} seedModifierHex - Seed modifier in hex format.
 * @param {boolean} useDevArgon2 - Flag to use development Argon2 settings.
 * @returns {Promise<Object>} - Derived key pair.
 */
async function deriveKeyPair(masterHex, seedModifierHex, useDevArgon2) {
    // Concatenate masterHex and seedModifierHex
    const combinedHex = masterHex + seedModifierHex;

    // Choose the appropriate Argon2 function
    const argon2Fnc = useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;

    // Perform Argon2 hashing
    const argon2Result = await argon2Fnc(
        combinedHex,
        "Contrast's Salt Isn't Pepper But It Is Tasty",
        27,     // Time cost
        1024,   // Memory cost
        1,      // Parallelism
        2,      // Argon2 version
        32      // Output length set to 32 bytes
    );

    // Process argon2Result to get seedHex as a hex string
    let seedHex;
    if (Buffer.isBuffer(argon2Result)) {
        // If argon2Result is a Buffer, convert it to hex string
        seedHex = argon2Result.toString('hex');
    } else if (typeof argon2Result === 'object' && argon2Result.hash) {
        // If argon2Result is an object with a 'hash' property
        seedHex = argon2Result.hash.toString('hex');
    } else if (typeof argon2Result === 'string') {
        // If argon2Result is already a string, use it directly
        seedHex = argon2Result;
    } else {
        throw new Error('Invalid argon2Result format');
    }
    // Verify the length of seedHex
    if (typeof seedHex !== 'string' || seedHex.length !== 64) {
        throw new Error(`Invalid seedHex: expected a hex string of length 64, got ${typeof seedHex} with length ${seedHex.length}`);
    }

    // Generate key pair from the hashed seed
    const keyPair = await AsymetricFunctions.generateKeyPairFromHash(seedHex);
    if (!keyPair) {
        throw new Error('Failed to generate key pair');
    }
    return keyPair;
}

// Listen for messages from the main thread
parentPort.on('message', async (task) => {
    const { masterHex, seedModifierHex, useDevArgon2 } = task;
    try {
        const keyPair = await deriveKeyPair(masterHex, seedModifierHex, useDevArgon2);
        parentPort.postMessage({ success: true, result: keyPair });
    } catch (error) {
        console.error('Error in key derivation worker:', error);
        parentPort.postMessage({ success: false, error: error.message });
    }
});
