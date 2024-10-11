//import msgpack from './externalLibs/msgPack.min.js';

//import { encode, decode } from './externalLibs/msgPack.min.js';
/*async function msgPackLib() {
        const m = await import('../externalLibs/msgpack.min.js');
        return m.default;
};*/
//const msgPack = msgPackLib().then((m) => m);
//console.log('msgPack', msgpack);

/*import * as msgpack from './externalLibs/msgPackPort.js';
console.log('toto', msgpack);*/

import argon2 from './argon2-ES6.min.mjs';
import { Sanitizer, Pow } from './backgroundClasses-ES6.js';
import { Wallet } from './contrast/wallet.mjs';
import { cryptoLight } from './cryptoLight.js';

cryptoLight.argon2 = argon2;

/** @type {WebSocket} */
let pow = new Pow(argon2, "http://localhost:4340");
const sanitizer = new Sanitizer();
const SETTINGS = {
    HTTP_PROTOCOL: "http", // http or https
    //PROTOCOL: window.location.protocol === "https:" ? "wss:" : "ws:",
    PROTOCOL: "ws:",
    DOMAIN: 'pinkparrot.observer',
    PORT: false, // 27270 (not used with domain)
    LOCAL_DOMAIN: "localhost",
    LOCAL_PORT: "27270",
    RECONNECT_INTERVAL: 1000,
    GET_CURRENT_HEIGHT_INTERVAL: 5000
}
let ws;
let currentHeightInterval;
function connectWS() {
    //ws = new WebSocket(`ws://${SETTINGS.DOMAIN}`);
    ws = new WebSocket(`${SETTINGS.PROTOCOL}//${SETTINGS.DOMAIN}${SETTINGS.PORT ? ':' + SETTINGS.PORT : ''}`);
    console.log(`Connecting to ${SETTINGS.PROTOCOL}//${SETTINGS.DOMAIN}${SETTINGS.PORT ? ':' + SETTINGS.PORT : ''}`);

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


    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };

    if (currentHeightInterval) { clearInterval(currentHeightInterval); }
    currentHeightInterval = setInterval(() => {
        try { ws.send(JSON.stringify({ type: 'get_height' })) } catch (error) {};
    }, SETTINGS.GET_CURRENT_HEIGHT_INTERVAL);
} connectWS();
(async () => {
    console.log('Background script starting...');

    //await initCryptoLightFromAuthInfo(); // we can't
    
    // if not initialized, initialize mining state
    const miningState = await chrome.storage.local.get('miningState');
    if (!miningState || !miningState.miningState) {
        await chrome.storage.local.set({miningState: 'disabled'});
    }
    console.log('Background script started!');
})();

chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
    if (typeof request.action !== "string") { return; }
    if (!sanitizer.sanitize(request)) { console.info('data possibly corrupted!'); return; }
    
    let privateKeyHex;
    let wallet;
    let walletInfo;
    switch (request.action) {
        case 'authentified':
            console.log(`[BACKGROUND] ${request.action}!`);
            await initCryptoLightFromAuthInfo(request.password);
            break;
        case "requestAuth":
            // open popup for authentication
            chrome.runtime.sendMessage({action: "openPage", data: {password: request.data.password}});
            break;
        case 'deriveAccount':
            privateKeyHex = await getWalletPrivateKey(request.walletIndex)
            wallet = new Wallet(privateKeyHex);
            const derivedAccounts = await wallet.deriveAccounts(request.nb, request.addressPrefix)
            if (!derivedAccounts) {
                chrome.runtime.sendMessage({ action: 'derivedAccountResult', success: false });
                return;
            }
            
            walletInfo = await getWalletInfo(request.walletIndex);
            walletInfo.accountsGenerated = wallet.accountsGenerated;
            await setWalletInfo(request.walletIndex, walletInfo);
            chrome.runtime.sendMessage({ action: 'derivedAccountResult', success: true });
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
async function getWalletInfo(walletIndex = 0) {
    const loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
    if (!loadedWalletsInfo) { console.error('No wallets info'); return; }
    if (loadedWalletsInfo.walletsInfo.length === 0) { console.error('No wallets info [].len === 0'); return; }
    return loadedWalletsInfo.walletsInfo[walletIndex];
}
async function setWalletInfo(walletIndex = 0, walletInfo) {
    const loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
    if (!loadedWalletsInfo) { console.error('No wallets info'); return; }
    
    loadedWalletsInfo.walletsInfo[walletIndex] = walletInfo;
    await chrome.storage.local.set(loadedWalletsInfo);
}
async function getWalletPrivateKey(walletIndex = 0) {
    const loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
    if (!loadedWalletsInfo) { console.error('No wallets info'); return; }
    if (loadedWalletsInfo.walletsInfo.length === 0) { console.error('No wallets info [].len === 0'); return; }
    const walletsInfo = loadedWalletsInfo.walletsInfo;
    const encryptedSeedHex = walletsInfo[walletIndex].encryptedSeedHex;
    return await cryptoLight.decryptText(encryptedSeedHex);
}