import fs from 'fs';
import { HashFunctions } from './conCrypto.mjs';

class LightHouse {


    static async getNodeMjsHash() {
        const fileString = fs.readFileSync('./node.mjs', 'utf8');
        const fileHash = await HashFunctions.SHA256(fileString);
        return fileHash;
    }
}