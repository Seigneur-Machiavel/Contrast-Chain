import utils from './contrast/src/utils.mjs';
window.utils = utils;

import { Wallet } from './contrast/src/wallet.mjs';
window.Wallet = Wallet;

import { Transaction, Transaction_Builder } from './contrast/src/transaction.mjs';
window.Transaction = Transaction;
window.Transaction_Builder = Transaction_Builder;

import { cryptoLight } from './cryptoLight.js';
window.cryptoLight = cryptoLight;

async function loadScriptAsText(url) {
    const response = await fetch(url);
    const text = await response.text();
    return text;
}

const accountWorkerCode = await loadScriptAsText('../scripts/contrast/workers/account-worker-front.js');
window.accountWorkerCode = accountWorkerCode;

/*console.log('Modules loaded!');

console.log('Loading Wallet...');
console.log('Wallet:', Wallet);

window.twallet = new Wallet('fffffffffffffffffffffffffffffffff00fffffffffffffffffffffffffffff');
const taccount = await window.twallet.deriveAccounts(1, 'W');
console.log('taccount:', taccount);*/