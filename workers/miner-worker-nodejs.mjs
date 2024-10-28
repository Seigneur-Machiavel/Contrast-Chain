import { parentPort } from 'worker_threads';
import utils from '../src/utils.mjs';
import { HashFunctions } from '../src/conCrypto.mjs';
import { BlockUtils } from '../src/block.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';

/**
 * @typedef {import("../src/block.mjs").BlockData} BlockData
 */

/**
 * @param {BlockData} blockCandidate 
 * @param {string} signatureHex 
 * @param {string} nonce 
 * @param {boolean} useDevArgon2 
 */
async function mineBlock(blockCandidate, signatureHex, nonce, useDevArgon2) {
	try {
		//console.log('useDevArgon2', useDevArgon2);
		const argon2Fnc = useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;
		const blockHash = await utils.mining.hashBlockSignature(argon2Fnc, signatureHex, nonce);
		if (!blockHash) { throw new Error('Invalid block hash'); }

		blockCandidate.hash = blockHash.hex;
		return { finalizedBlock: blockCandidate, bitsArrayAsString: blockHash.bitsArray.join('') };
	} catch (err) {
		throw err;
	}
}

async function mineBlockUntilValid() {
	while (true) {
		if (minerVars.blockCandidate === null) { await new Promise((resolve) => setTimeout(resolve, 10)); continue; }
		if (minerVars.paused) { await new Promise((resolve) => setTimeout(resolve, 10)); continue; }

		try {
			const { signatureHex, nonce, clonedCandidate } = await prepareBlockCandidateBeforeMining();
			const mined = await mineBlock(clonedCandidate, signatureHex, nonce, false);
			
			parentPort.postMessage({type: 'hash'});
			//console.log('hash');
	
			const { conform } = utils.mining.verifyBlockHashConformToDifficulty(mined.bitsArrayAsString, mined.finalizedBlock);
			if (conform) { return mined; }
		} catch (error) {
			await new Promise((resolve) => setTimeout(resolve, 1));
			console.error(error);
		}
	}
}

/** @param {BlockData} blockCandidate */
async function prepareBlockCandidateBeforeMining(blockCandidate = minerVars.blockCandidate) {
	//let time = performance.now();
	const clonedCandidate = BlockUtils.cloneBlockData(blockCandidate);
	//console.log(`prepareNextBlock: ${performance.now() - time}ms`); time = performance.now();

	const headerNonce = utils.mining.generateRandomNonce().Hex;
	const coinbaseNonce = utils.mining.generateRandomNonce().Hex;
	clonedCandidate.nonce = headerNonce;
	clonedCandidate.timestamp = Math.max(clonedCandidate.posTimestamp + 1 + minerVars.bet, Date.now() + minerVars.timeOffset);
	//console.log(`generateRandomNonce: ${performance.now() - time}ms`); time = performance.now();

	const powReward = blockCandidate.powReward;
	delete clonedCandidate.powReward;
	const coinbaseTx = await Transaction_Builder.createCoinbase(coinbaseNonce, minerVars.rewardAddress, powReward);
	//console.log(`createCoinbase: ${performance.now() - time}ms`); time = performance.now();
	BlockUtils.setCoinbaseTransaction(clonedCandidate, coinbaseTx);
	//console.log(`setCoinbaseTransaction: ${performance.now() - time}ms`); time = performance.now();

	const signatureHex = await BlockUtils.getBlockSignature(clonedCandidate);
	const nonce = `${headerNonce}${coinbaseNonce}`;
	//console.log(`getBlockSignature: ${performance.now() - time}ms`); time = performance.now();

	return { signatureHex, nonce, clonedCandidate };
}

const minerVars = {
	working: false,

	rewardAddress: '',
	blockCandidate: null,
	bet: 0,
	timeOffset: 0,
	paused: false
};
parentPort.on('message', async (task) => {
	console.log('miner-worker-nodejs', task);
	
	const id = task.id;
	const response = { id };
	let mined;
    switch (task.type) {
        case 'newCandidate':
			minerVars.blockCandidate = task.blockCandidate;
			return;
		case 'mineUntilValid':
			if (minerVars.working) { return; } else { minerVars.working = true; }
			minerVars.rewardAddress = task.rewardAddress;
			minerVars.blockCandidate = task.blockCandidate;
			minerVars.bet = task.bet;
			minerVars.timeOffset = task.timeOffset;
			mined = await mineBlockUntilValid();
			response.blockCandidate = mined.finalizedBlock;
			response.bitsArrayAsString = mined.bitsArrayAsString;
			break;
		case 'pause':
			minerVars.paused = true;
			return;
		case 'resume':
			minerVars.paused = false;
			return;
		case 'mine':
			if (minerVars.working) { return; } else { minerVars.working = true; }
			//const startTimestamp = Date.now();
			mined = await mineBlock(task.blockCandidate, task.signatureHex, task.nonce, task.useDevArgon2);
			response.blockCandidate = mined.finalizedBlock;
			response.bitsArrayAsString = mined.bitsArrayAsString;

			//const endTimestamp = Date.now();
			//console.log(`Mining time: ${endTimestamp - startTimestamp}ms`);
            break;
		case 'mine&verify':
			mined = await mineBlock(task.blockCandidate, task.signatureHex, task.nonce, task.useDevArgon2);
			const { conform } = utils.mining.verifyBlockHashConformToDifficulty(mined.bitsArrayAsString, mined.finalizedBlock);
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

	minerVars.working = false;
	parentPort.postMessage(response);
});
