import { Wallet } from "../../src/wallet.mjs";

const nodePrivateKey = "22ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00";
const useDevArgon2 = false;

const wallet = new Wallet(nodePrivateKey, useDevArgon2);

const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(100, "W");
if (!derivedAccounts) { console.error('Failed to derive addresses.'); console.log('Failed to derive addresses.'); }

//