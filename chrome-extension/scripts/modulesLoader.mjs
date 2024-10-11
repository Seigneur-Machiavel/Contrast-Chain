import { Wallet } from '../scripts/contrast/wallet.mjs';
window.Wallet = Wallet;

import { cryptoLight } from './cryptoLight.js';
window.cryptoLight = cryptoLight;

/*console.log('Modules loaded!');

console.log('Loading Wallet...');
console.log('Wallet:', Wallet);

const twallet = new Wallet('ff');
const taccount = await twallet.deriveAccounts(1, 'W');
console.log('taccount:', taccount);*/