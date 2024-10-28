import argon2 from './argon2-ES6.min.mjs';
import { Sanitizer, Pow } from './backgroundClasses-ES6.js';
import { cryptoLight } from './cryptoLight.js';

/**
* @typedef {import("../contrast/src/transaction.mjs").Transaction} Transaction
* @typedef {import("../contrast/src/transaction.mjs").TransactionWithDetails} TransactionWithDetails
*/

cryptoLight.argon2 = argon2;

let pow = new Pow(argon2);
const sanitizer = new Sanitizer();
const SETTINGS = {
    HTTP_PROTOCOL: "http", // http or https
    WS_PROTOCOL: "ws", // ws or wss
    DOMAIN: 'pinkparrot.science', // 'pinkparrot.observer',
    PORT: 27270, // "27270", no port using domain
    LOCAL_DOMAIN: "localhost",
    LOCAL_PORT: "27270",

    LOCAL: false,
    RECONNECT_INTERVAL: 5000,
    GET_CURRENT_HEIGHT_INTERVAL: 10000
}
const subscriptions = {
    /** @type {Object<string, boolean>} */
    balanceUpdates: {}
}

/** @type {Object<string, TransactionWithDetails>} */
const transactionsByReference = {};
/** @param {string} txReference @param {string} address - optional */
async function getTransactionFromMemoryOrSendRequest(txReference, address = undefined) {
    let comply = true;
    const fromMemory = transactionsByReference[txReference];
    if (fromMemory === 'request sent') { return 'request sent'; }
    if (fromMemory && address) { comply = fromMemory.balanceChange !== undefined; }
    if (fromMemory && comply) { return fromMemory; }

    await readyWS();
    //console.log(`requesting tx data: ${txReference}`);
    if (address) {
        ws.send(JSON.stringify({ type: 'get_transaction_with_balanceChange_by_reference', data: { txReference, address } }));
    } else {
        ws.send(JSON.stringify({ type: 'get_transaction_by_reference', data: txReference }));
    }
    
    transactionsByReference[txReference] = 'request sent';
    return 'request sent';
}

/** @type {WebSocket} */
let ws;
function connectWS() {
    //ws = new WebSocket(`ws://${SETTINGS.DOMAIN}`);
    const wsLocalUrl = `${SETTINGS.WS_PROTOCOL}://${SETTINGS.LOCAL_DOMAIN}:${SETTINGS.LOCAL_PORT}`;
    const wsUrl = `${SETTINGS.WS_PROTOCOL}://${SETTINGS.DOMAIN}${SETTINGS.PORT ? ':' + SETTINGS.PORT : ''}`;
    ws = new WebSocket(SETTINGS.LOCAL ? wsLocalUrl : wsUrl);
    console.log(`Connecting to ${SETTINGS.LOCAL ? wsLocalUrl : wsUrl}...`);

    ws.onopen = function() {
        console.log('Connection opened');
        //console.log(ws);
        ws.send(JSON.stringify({ type: 'get_best_block_candidate' }));
        ws.send(JSON.stringify({ type: 'subscribe_best_block_candidate_change' }));
    };
    ws.onclose = function() {
        console.info('Connection closed');
        setTimeout( () => {
            ws = undefined;
            //connectWS();
        }, SETTINGS.RECONNECT_INTERVAL);
    };
    ws.onmessage = async function(event) {
        const message = JSON.parse(event.data);
        const trigger = message.trigger;
        const data = message.data;
        let remainingAttempts = 10;
        switch (message.type) {
            case 'current_time':
                const timeOffset = data - Date.now();
                pow.timeOffset = timeOffset;
                console.log(`[BACKGROUND] set timeOffset: ${timeOffset}`);
                break;
            case 'address_exhaustive_data_requested':
                //console.log('[BACKGROUND] sending address_exhaustive_data_requested to popup...');
                //console.log('data:', data);
                chrome.runtime.sendMessage({
                    action: 'address_exhaustive_data_requested',
                    address: data.address,
                    UTXOs: data.addressUTXOs.UTXOs,
                    balance: data.addressUTXOs.balance,
                    spendableBalance: data.addressUTXOs.spendableBalance,
                    addressTxsReferences: data.addressTxsReferences,
                });
                break;
            case 'address_utxos_requested':
                //console.log('[BACKGROUND] sending address_utxos_requested to popup...');
                chrome.runtime.sendMessage({
                    action: 'address_utxos_requested',
                    address: data.address,
                    UTXOs: data.UTXOs,
                });
                break;
            case 'transaction_requested':
                // { transaction, balanceChange, inAmount, outAmount, fee, txReference }
                /** @type {TransactionWithDetails} */
                const transactionWithDetails = data.transaction;
                transactionWithDetails.balanceChange = data.balanceChange;
                transactionWithDetails.inAmount = data.inAmount;
                transactionWithDetails.outAmount = data.outAmount;
                transactionWithDetails.fee = data.fee;
                transactionWithDetails.txReference = data.txReference;
                transactionsByReference[data.txReference] = transactionWithDetails;

                chrome.runtime.sendMessage({ action: 'transaction_requested', transactionWithDetails });
                break;
            case 'best_block_candidate_requested':
                if (!data) { console.info('[BACKGROUND] Received best_block_candidate_requested with no data!'); return; }
                console.log(`[BACKGROUND] best_block_candidate_requested: ${data.index} - ${data.legitimacy}`);
                pow.bestCandidate = data;
                break;
            case 'transaction_broadcast_result':
                console.log('[BACKGROUND] transaction_broadcast_result:', data);
                chrome.runtime.sendMessage({action: 'transaction_broadcast_result', transaction: data.transaction, txId: data.txId, consumedAnchors: data.consumedAnchors, senderAddress: data.senderAddress, error: data.error, success: data.success});
                break;
            case 'subscribed_balance_update':
                subscriptions.balanceUpdates[data] = true;
                console.log(`[BACKGROUND] subscribed_balance_update: ${data}`);
                break;
            case 'subscribed_best_block_candidate_change':
                console.log(`[BACKGROUND] subscribed_best_block_candidate_change`);
                break;
            case 'balance_updated':
                if (!subscriptions.balanceUpdates[trigger]) { return; }
                //console.log(`[BACKGROUND] balance_updated: ${trigger}`);
                ws.send(JSON.stringify({ type: 'get_address_exhaustive_data', data: trigger }));
                break;
            case 'new_block_confirmed':
                break;
            case 'best_block_candidate_changed':
                if (!data) { console.info('[BACKGROUND] Received best_block_candidate_changed with no data!'); return; }
                console.log(`[BACKGROUND] best_block_candidate_changed: ${data.index} - ${data.legitimacy}`);
                pow.bestCandidate = data;
                break;
            case 'current_height':
                break;
            default:
                console.log(`[BACKGROUND] Unknown message type: ${message.type}`);
                break;
        }
    }

    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };
}
async function connectWSLoop() {
    while (true) {
        await new Promise((resolve) => { setTimeout(() => { resolve(); }, SETTINGS.RECONNECT_INTERVAL); });
        if (ws && ws.readyState === 1) { continue; }
        connectWS();
    }
}; connectWSLoop();
async function getHeightsLoop() {
    while (true) {
        await new Promise((resolve) => { setTimeout(() => { resolve(); }, SETTINGS.GET_CURRENT_HEIGHT_INTERVAL); });
        if (!ws || ws.readyState !== 1) { continue; }
        try { ws.send(JSON.stringify({ type: 'get_height' })) } catch (error) {};
    }
}; getHeightsLoop();
async function getTimeLoop() {
    while (true) {
        await new Promise((resolve) => { setTimeout(() => { resolve(); }, 60_000 * 60); });
        if (!ws || ws.readyState !== 1) { continue; }
        try { ws.send(JSON.stringify({ type: 'get_current_time' })) } catch (error) {};
    }
}; getTimeLoop();
async function readyWS() {
    return new Promise((resolve, reject) => {
        if (ws && ws.readyState === 1) { resolve(); return; }
        let interval = setInterval(() => {
            if (ws && ws.readyState === 1) {
                clearInterval(interval);
                resolve();
            }
        }, 100);
    });
}

chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
    if (typeof request.action !== "string") { return; }
    if (!sanitizer.sanitize(request)) { console.info('data possibly corrupted!'); return; }
    
    switch (request.action) {
        case 'get_transaction_with_balanceChange_by_reference':
            //console.log(`[BACKGROUND] get_transaction_with_balanceChange_by_reference: ${request.txReference}, from: ${request.address}`);
            const transactionWithDetails = await getTransactionFromMemoryOrSendRequest(request.txReference, request.address);
            if (transactionWithDetails === 'request sent') { return; }

            chrome.runtime.sendMessage({ action: 'transaction_requested', transactionWithDetails });
            break;
        case 'get_address_exhaustive_data':
            //console.log(`[BACKGROUND] get_address_exhaustive_data: ${request.address}, from: ${request.from}, to: ${request.to}`);
            const gaedParams = {
                address: request.address,
                from: request.from,
                to: request.to,
            }
            console.log(`[BACKGROUND] get_address_exhaustive_data: ${JSON.stringify(gaedParams)}`);
            await readyWS();
            ws.send(JSON.stringify({ type: 'get_address_exhaustive_data', data: gaedParams }));
            //ws.send(JSON.stringify({ type: 'get_address_exhaustive_data', data: request.address }));
            break;
        case 'subscribe_balance_update':
            console.log(`[BACKGROUND] subscribing balance update: ${request.address}`);
            
            if (subscriptions.balanceUpdates[request.address]) { return; }
            await readyWS();
            ws.send(JSON.stringify({ type: 'subscribe_balance_update', data: request.address }));
            break;
        case 'unsubscribe_balance_update':
            console.log(`[BACKGROUND] unsubscribing balance update: ${request.address}`);
            if (!subscriptions.balanceUpdates[request.address]) { return; }
            //await readyWS();
            //ws.send(JSON.stringify({ type: 'unsubscribe_balance_update', data: request.address }));
            delete subscriptions.balanceUpdates[request.address];
            break;
        case 'unsubscribe_all':
            console.log(`[BACKGROUND] unsubscribing all...`);
            for (let key in subscriptions.balanceUpdates) {
                //await readyWS();
                //ws.send(JSON.stringify({ type: 'unsubscribe_balance_update', data: key }));
                delete subscriptions.balanceUpdates[key];
            }
            console.log(`[BACKGROUND] all unsubscribed!`);
            break;
        case 'authentified':
            console.log(`[BACKGROUND] ${request.action}!`);
            await initCryptoLightFromAuthInfo(request.password);
            break;
        case 'broadcast_transaction':
            console.log(`[BACKGROUND] broadcast_transaction!`);
            await readyWS();
            ws.send(JSON.stringify({ type: 'broadcast_transaction', data: { transaction: request.transaction, senderAddress: request.senderAddress } }));
            break;
        case "requestAuth":
            // open popup for authentication
            chrome.runtime.sendMessage({action: "openPage", data: {password: request.data.password}});
            break;
        default:
            console.log(`[BACKGROUND] Unknown request: ${request}`);
            break;
    }
});
chrome.storage.onChanged.addListener(async function(changes, namespace) {
    for (let key in changes) {
        if (key === 'miningIntensity') {
            console.log(`Mining intensity changed to ${changes[key].newValue}`);
            pow.miningIntensity = changes[key].newValue;
        }
        if (key === 'blockFinalized') {
            if (!changes[key].newValue) { return; }
            console.log(`Block finalized received in background!`);
            const blockFinalized = changes[key].newValue;
            console.log(blockFinalized);
            //chrome.storage.local.set({blockFinalized: undefined});

            await readyWS();
            ws.send(JSON.stringify({ type: 'broadcast_finalized_block', data: blockFinalized }));
        }
    }
});
(async () => { // INIT FUNCTION
    console.log('Background script starting...');

    const miningIntensity = await chrome.storage.local.get('miningIntensity');
    if (!miningIntensity || !miningIntensity.miningIntensity) {
        await chrome.storage.local.set({miningIntensity: 0});
    }
    pow.miningIntensity = miningIntensity.miningIntensity;
    console.log(`Mining intensity set: ${pow.miningIntensity}`);

    console.log('Background script started!');
})();

// FUNCTIONS
async function initCryptoLightFromAuthInfo(passwordReadyUse) {
    const authInfoResult = await chrome.storage.local.get(['authInfo']);
    if (!authInfoResult || !authInfoResult.authInfo) { console.info('No auth info found!'); return; }

    const { authID, authToken, hash, salt1Base64, iv1Base64, serverAuthBoost } = sanitizer.sanitize(authInfoResult.authInfo);
    cryptoLight.cryptoStrength = serverAuthBoost ? 'medium' : 'heavy';

    const res = await cryptoLight.generateKey(passwordReadyUse, salt1Base64, iv1Base64, hash);
    if (!res) { console.info('Error generating key!'); return; }

    console.log('CryptoLight initialized!');
}