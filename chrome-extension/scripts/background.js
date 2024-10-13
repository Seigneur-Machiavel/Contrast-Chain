import argon2 from './argon2-ES6.min.mjs';
import { Sanitizer, Pow } from './backgroundClasses-ES6.js';
import { cryptoLight } from './cryptoLight.js';

cryptoLight.argon2 = argon2;

let pow = new Pow(argon2, "http://localhost:4340");
const sanitizer = new Sanitizer();
const SETTINGS = {
    HTTP_PROTOCOL: "http", // http or https
    WS_PROTOCOL: "ws", // ws or wss
    DOMAIN: 'pinkparrot.observer',
    PORT: false, // 27270 (not used with domain)
    LOCAL_DOMAIN: "localhost",
    LOCAL_PORT: "27279",

    LOCAL: true,
    RECONNECT_INTERVAL: 5000,
    GET_CURRENT_HEIGHT_INTERVAL: 10000
}

/** @type {WebSocket} */
let ws;
let currentHeightInterval;
function connectWS() {
    //ws = new WebSocket(`ws://${SETTINGS.DOMAIN}`);
    const wsLocalUrl = `${SETTINGS.WS_PROTOCOL}://${SETTINGS.LOCAL_DOMAIN}:${SETTINGS.LOCAL_PORT}`;
    const wsUrl = `${SETTINGS.WS_PROTOCOL}://${SETTINGS.DOMAIN}${SETTINGS.PORT ? ':' + SETTINGS.PORT : ''}`;
    ws = new WebSocket(SETTINGS.LOCAL ? wsLocalUrl : wsUrl);
    console.log(`Connecting to ${SETTINGS.LOCAL ? wsLocalUrl : wsUrl}...`);

    ws.onopen = function() {
        console.log('Connection opened');
    };
    ws.onclose = function() {
        console.info('Connection closed');
        setTimeout( () => {
            console.info('--- reseting blockExplorerWidget >>>');

            /*const clonedData = blockExplorerWidget.getCloneBeforeReset();
            blockExplorerWidget = new BlockExplorerWidget('cbe-contrastBlocksWidget', clonedData.blocksDataByHash, clonedData.blocksDataByIndex, clonedData.blocksInfo);

            if (!clonedData.modalContainer) { return; }

            blockExplorerWidget.cbeHTML.containerDiv.appendChild(clonedData.modalContainer);*/
        }, SETTINGS.RECONNECT_INTERVAL);
    };
    ws.onmessage = async function(event) {
        const message = JSON.parse(event.data);
        const trigger = message.trigger;
        const data = message.data;
        let remainingAttempts = 10;
        switch (message.type) {
            case 'address_exhaustive_data_requested':
                //console.log('[BACKGROUND] sending address_exhaustive_data_requested to popup...');
                //console.log('data:', data);
                chrome.runtime.sendMessage({
                    action: 'address_exhaustive_data_requested',
                    address: data.address,
                    UTXOs: data.addressUTXOs.UTXOs,
                    balance: data.addressUTXOs.balance,
                    spendableBalance: data.addressUTXOs.spendableBalance,
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
                // { transaction, balanceChange, txReference }
                const transactionWithBalanceChange = data.transaction;
                transactionWithBalanceChange.balanceChange = data.balanceChange;
                chrome.runtime.sendMessage({action: 'transaction_requested', transaction: transactionWithBalanceChange});
                //blockExplorerWidget.transactionsByReference[data.txReference] = transactionWithBalanceChange;
                // set html
                //blockExplorerWidget.fillAddressTxRow(data.txReference, data.balanceChange);
                break;
            case 'transaction_broadcast_result':
                console.log('[BACKGROUND] transaction_broadcast_result:', data);
                chrome.runtime.sendMessage({action: 'transaction_broadcast_result', txId: data.txId, consumedAnchors: data.consumedAnchors, senderAddress: data.senderAddress, error: data.error, success: data.success});
                /*if (!blockExplorerWidget) { return; }
                if (data.success) {
                    blockExplorerWidget.fillTransactionRow(data.txReference, 'success');
                } else {
                    blockExplorerWidget.fillTransactionRow(data.txReference, 'error');
                }*/
                break;
            case 'subscribed_balance_update':
                console.log(`[BACKGROUND] subscribed_balance_update: ${data}`);
                break;
            case 'balance_updated':
                console.log(`[BACKGROUND] balance_updated: ${trigger}`);
                ws.send(JSON.stringify({ type: 'get_address_exhaustive_data', data: trigger }));
                break;
            default:
                break;
        }
    }

    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };

    if (currentHeightInterval) { clearInterval(currentHeightInterval); }
    currentHeightInterval = setInterval(() => {
        if (ws.readyState !== 1) {
            console.info('WebSocket not ready!, stopping interval...');
            clearInterval(currentHeightInterval);
            return;
        }
        try { ws.send(JSON.stringify({ type: 'get_height' })) } catch (error) {};
    }, SETTINGS.GET_CURRENT_HEIGHT_INTERVAL);
} connectWS();
async function readyWS() {
    return new Promise((resolve, reject) => {
        if (ws.readyState === 1) { resolve(); return; }
        let interval = setInterval(() => {
            if (ws.readyState === 1) {
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
        case 'get_address_exhaustive_data':
            console.log(`[BACKGROUND] get_address_exhaustive_data: ${request.address}`);
            await readyWS();
            ws.send(JSON.stringify({ type: 'get_address_exhaustive_data', data: request.address }));
            break;
        case 'subscribe_balance_update':
            console.log(`[BACKGROUND] subscribing balance update: ${request.address}`);
            //return;
            await readyWS();
            ws.send(JSON.stringify({ type: 'subscribe_balance_update', data: request.address }));
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
        case "startMining":
            //console.log('Starting mining 1...');
            pow.startMining();
            break;
        case "stopMining":
            //console.log('Stopping mining 1...');
            pow.stopMining();
            break;
        default:
            break;
    }
});

chrome.storage.onChanged.addListener(function(changes, namespace) {
    for (let key in changes) {
        if (key === 'miningIntensity') {
            console.log(`Mining intensity changed to ${changes[key].newValue}`);
            pow.intensity = changes[key].newValue;
        }
    }
});

(async () => { // INIT FUNCTION
    console.log('Background script starting...');
    
    // if not initialized, initialize mining state
    const miningState = await chrome.storage.local.get('miningState');
    if (!miningState || !miningState.miningState) {
        await chrome.storage.local.set({miningState: 'disabled'});
    }
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