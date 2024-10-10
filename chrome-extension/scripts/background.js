// import argon2 from './argon2-ES6.min.js'; // DEPRECATED
import argon2 from './argon2-ES6.min.mjs';
import { Communication, Sanitizer, Pow } from './backgroundClasses-ES6.js';

let pow = new Pow(argon2, "http://localhost:4340");
const sanitizer = new Sanitizer();

(async () => { 
    await pingServerAndSetMode();

    console.log('Background script started!');
    await chrome.storage.local.set({miningState: 'disabled'}); // initialize mining state

    internalPageClosedControlLoop();
})();
async function internalPageClosedControlLoop() {
    while(true) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const result = await chrome.storage.local.get(['vaultUnlocked', 'internalPageTabId']);
        if (!result) { continue; }

        if (result.vaultUnlocked === false) { continue; }

        // So unlocked but no internal page, we should lock the vault
        // (probably the user closed the internal page)
        if (!result.internalPageTabId) {
            chrome.storage.local.set({vaultUnlocked: false});
            continue;
        }

        chrome.tabs.get(result.internalPageTabId, function(tab) {
            //console.log(tab.active);
            if (!chrome.runtime.lastError) { return; }
            chrome.storage.local.remove('internalPageTabId');
            chrome.storage.local.set({vaultUnlocked: false});
        });
    }
}
async function pingServerAndSetMode() {
    const communication = new Communication();
	const localServerIsRunning = await communication.pingServer("http://localhost:4340");
	const webServerIsRunning = await communication.pingServer("https://www.linkvault.app");
	if (!localServerIsRunning && webServerIsRunning) {
		console.info('Running as production mode...');
        pow = new Pow(argon2, "https://www.linkvault.app");
        return;
	} else if (localServerIsRunning) {
		console.info('Running as development mode...');
        return;
	}

    console.info('Cannot connect to any server!');
}
function openInternalPage(url = 'views/index.html') {
    const internalPageURL = chrome.runtime.getURL(url);
    chrome.tabs.create({url: internalPageURL}, function(tab) {
        chrome.storage.local.set({internalPageTabId: tab.id});
    });
}
async function openOrFocusInternalPage() {
    // const internalPageURL = chrome.runtime.getURL('views/index.html');

    const internalPageTabId = await chrome.storage.local.get("internalPageTabId");
    if (!internalPageTabId || !internalPageTabId.internalPageTabId) {
        openInternalPage();
        return;
    }

    chrome.tabs.get(internalPageTabId.internalPageTabId, function(tab) {
        if (chrome.runtime.lastError) {
            openInternalPage();
            return;
        } else {
            chrome.tabs.update(tab.id, {active: true});
            chrome.windows.update(tab.windowId, {focused: true});
        }
    });
}

chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
    if (typeof request.action !== "string") { return; }
    if (!sanitizer.sanitize(request)) { console.info('data possibly corrupted!'); return; }
    
    switch (request.action) {
        case "openPage":
            openOrFocusInternalPage();
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