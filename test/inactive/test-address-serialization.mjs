import { HashFunctions } from './conCrypto.mjs';
import utils from '../../src/utils.mjs';

// TEST ADDRESS BASE 58 - UINT8ARRAY SERIALIZATION
const nbOfAddresses = 1000;
const argon2Fnc = HashFunctions.Argon2;
const initMemCost = utils.addressUtils.params.argon2DerivationMemory;
utils.addressUtils.params.argon2DerivationMemory = 2**10; // very fast

function generateRndHex(len = 32) {
    let rndHex = '';
    for (let i = 0; i < len; i++) {
        rndHex += Math.floor(Math.random() * 16).toString(16);
    }
    return rndHex;
}

const addresses = [];
for (let i = 0; i < nbOfAddresses; i++) {
    const addressHex = generateRndHex(32); // 16 bytes
    const addressB58 = await utils.addressUtils.deriveAddress(argon2Fnc, addressHex);
    addresses.push(addressB58);
}

const deserializedAddresses = [];
for (let i = 0; i < nbOfAddresses; i++) {
    const serializedAddress = utils.fastConverter.addressBase58ToUint8Array(addresses[i]);
    const deserializedAddress = utils.fastConverter.addressUint8ArrayToBase58(serializedAddress);
    deserializedAddresses.push(deserializedAddress);
}
// control 
for (let i = 0; i < nbOfAddresses; i++) {
    if (addresses[i] === deserializedAddresses[i]) { continue; }
    console.error(`Address ${i} failed to serialize/deserialize`);
}

utils.addressUtils.params.argon2DerivationMemory = initMemCost;
console.log(`Address serialization/deserialization test passed for ${nbOfAddresses} addresses`);