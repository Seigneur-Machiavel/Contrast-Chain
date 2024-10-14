import utils from './contrast/src/utils.mjs';
window.utils = utils;

import { Wallet } from './contrast/src/wallet.mjs';
window.Wallet = Wallet;

import { Transaction, Transaction_Builder } from './contrast/src/transaction.mjs';
window.Transaction = Transaction;
window.Transaction_Builder = Transaction_Builder;

import { cryptoLight } from './cryptoLight.js';
window.cryptoLight = cryptoLight;

/*console.log('Modules loaded!');

console.log('Loading Wallet...');
console.log('Wallet:', Wallet);

const twallet = new Wallet('ff');
const taccount = await twallet.deriveAccounts(1, 'W');
console.log('taccount:', taccount);*/