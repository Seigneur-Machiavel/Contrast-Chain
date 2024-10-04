import { parentPort } from 'worker_threads';
import utils from '../src/utils.mjs';
import { HashFunctions } from '../src/conCrypto.mjs';

/**
 * @typedef {import("../src/block.mjs").BlockData} BlockData
 */

// just testing ES6 browser worker:

// The miner worker is able to:
// mine POW of candidate blocks
/**
 * @param {BlockData} blockCandidate 
 * @param {string} signatureHex 
 * @param {string} nonce 
 * @param {boolean} useDevArgon2 
 */
async function mineBlock(blockCandidate, signatureHex, nonce, useDevArgon2) {
	try {
		const argon2Fnc = useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;
		const blockHash = await utils.mining.hashBlockSignature(argon2Fnc, signatureHex, nonce);
		if (!blockHash) { throw new Error('Invalid block hash'); }

		blockCandidate.hash = blockHash.hex;
		return { finalizedBlock: blockCandidate, bitsArrayAsString: blockHash.bitsArray.join('') };
	} catch (err) {
		throw err;
	}
}

let working = false;
parentPort.on('message', async (task) => {
	if (working) { return; } else { working = true; }

	const id = task.id;
	const response = { id };
	let mined;
    switch (task.type) {
        case 'mine':
			mined = await mineBlock(task.blockCandidate, task.signatureHex, task.nonce, task.useDevArgon2);
			response.blockCandidate = mined.finalizedBlock;
			response.bitsArrayAsString = mined.bitsArrayAsString;
            break;
		case 'mine&verify':
			mined = await mineBlock(task.blockCandidate, task.signatureHex, task.nonce, task.useDevArgon2);
			const { conform } = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, finalizedBlock);
			if (!conform) { response.conform = false; break; }
		
			response.finalizedBlock = mined.finalizedBlock;
			response.bitsArrayAsString = mined.bitsArrayAsString;
		case 'terminate':
			parentPort.close(); // close the worker
			break;
        default:
			response.error = 'Invalid task type';
            break;
    }

	working = false;
	parentPort.postMessage(response);
});
