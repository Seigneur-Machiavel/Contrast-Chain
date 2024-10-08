import { UtxoCache } from "../../src/utxoCache.mjs";
import { Blockchain } from "../../src/blockchain.mjs";
const utxoCache = new UtxoCache();
utxoCache.blockchain = new Blockchain('nodeid');

try {
    const tutu = await totoA();
} catch (error) {
    console.error('caucht:' + error);
}

async function totoA() {
    setTimeout(() => {
        throw new Error('toto');
    }, 1000);
    return true;
}