import { parentPort } from 'worker_threads';
import { TxValidation } from '../src/validation.mjs';

// WORKER SIDE
let workerId = undefined;
parentPort.on('message', async (task) => {
    const id = task.id;
    workerId = workerId || id;
	const response = { id, isValid: false, discoveredPubKeysAddresses: {}, error: false };
    switch (task.type) {
        case 'addressOwnershipConfirmation':
            try {
                const allDiscoveredPubKeysAddresses = {};
                const transactions = task.transactions
                for (const tx of transactions) {
                    const discoveredPubKeysAddresses = await TxValidation.addressOwnershipConfirmation(
                        task.involvedUTXOs,
                        tx,
                        task.impliedKnownPubkeysAddresses,
                        task.useDevArgon2,
                        false // specialTx
                    );

                    for (let [pubKeyHex, address] of Object.entries(discoveredPubKeysAddresses)) {
                        allDiscoveredPubKeysAddresses[pubKeyHex] = address;
                    }
                }
                
                response.discoveredPubKeysAddresses = allDiscoveredPubKeysAddresses;
                response.isValid = true;
                //console.log(`[VALIDATION_WORKER ${task.id}] addressOwnershipConfirmation: ${task.transaction.id} ${response.isValid}`);
            } catch (error) {
                console.error(`[VALIDATION_WORKER ${task.id}] addressOwnershipConfirmation: ${task.transaction.id} ${error.message}`);
                response.error = error.message;
                response.isValid = false;
            }
            break
		case 'terminate':
            //console.log(`[VALIDATION_WORKER ${workerId}] Terminating...`);
			parentPort.close(); // close the worker
			break;
        default:
			response.error = 'Invalid task type';
            break;
    }

	parentPort.postMessage(response);
});