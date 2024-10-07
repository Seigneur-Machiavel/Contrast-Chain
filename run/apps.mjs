import { exec } from 'child_process';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import localStorage_v1 from '../storage/local-storage-management.mjs';
import contrast from '../src/contrast.mjs'; //? Not all libs needed

import { CallBackManager } from '../src/websocketCallback.mjs';
import utils from '../src/utils.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node-factory.mjs").NodeFactory} NodeFactory
* @typedef {import("../src/node.mjs").Node} Node
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("../src/block.mjs").BlockUtils} BlockUtils
*/

function loadAddressesFromStorage() {
    const privateKeysFolder = localStorage_v1.getItem('privateKeysFolder');
    const addresses = localStorage_v1.getItem('addresses');
    return addresses ? JSON.parse(addresses) : [];
}

const APPS_VARS = {
    __filename: fileURLToPath(import.meta.url),
    __dirname: path.dirname( fileURLToPath(import.meta.url) ),
    __parentDirname: path.dirname( path.dirname( fileURLToPath(import.meta.url) ) ),
};

class AppStaticFncs {
    /** @param {Node} node */
    static async extractPrivateNodeInfo(node) {
        const result = {
            roles: node.roles,
        };

        if (node.roles.includes('validator')) {
            const { balance, UTXOs, spendableBalance } = await node.getAddressUtxos(node.account.address);
            node.account.setBalanceAndUTXOs(balance, UTXOs, spendableBalance);
            result.nodeId = node.id;
            result.validatorAddress = node.account.address;
            result.validatorBalance = balance;
            result.validatorUTXOs = UTXOs;
            result.validatorSpendableBalance = spendableBalance;
            result.validatorStakes = node.vss.getAddressStakesInfo(node.account.address);
            result.validatorUtxos = node.account.UTXOs;
            result.currentHeight = node.blockchain.currentHeight;
        }

        if (node.roles.includes('miner')) {
            const { balance, UTXOs, spendableBalance } = await node.getAddressUtxos(node.miner.address);
            result.nodeId = node.id;
            result.minerAddress = node.miner.address;
            result.minerBalance = balance;
            result.minerUTXOs = UTXOs;
            result.minerSpendableBalance = spendableBalance;
            result.highestBlockIndex = node.miner.highestBlockIndex;
            result.minerThreads = node.miner.nbOfWorkers;
        }
        
        return result;
    }
    /** @param {Node} node */
    extractPublicNodeInfo(node) {
        const result = {
            roles: node.roles,
        };

        if (node.roles.includes('validator')) {
            result.validatorAddress = node.account.address;
            result.currentHeight = node.blockchain.currentHeight;
        }

        return result;
    }
}

export class DashboardWsApp {
    #privateKeys = [];
    /** @param {NodeFactory} factory */
    constructor(factory, port = 27271) {
        /** @type {NodeFactory} */
        this.factory = factory;
        /** @type {CallBackManager} */
        this.callBackManager = null;
        /** @type {express.Application} */
        this.app = null;
        this.port = port;
        /** @type {WebSocketServer} */
        this.wss =  null;

        this.readableNow = () => { return `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}` };
        this.init();
    }
    /** @type {Node} */
    get node() { return this.factory.getFirstNode(); }
    /** @param {string} domain - default 'localhost' @param {number} port - default 27271 */
    init() {
        if (!this.node || this.#privateKeys.length === 0) { console.info("Node active Node & No private keys provided, can't auto init..."); return; }

        this.callBackManager = new CallBackManager(this.node);

        if (this.app === null) {
            this.app = express();
            this.app.use(express.static(APPS_VARS.__parentDirname));
            this.app.get('/', (req, res) => { res.sendFile(APPS_VARS.__parentDirname + '/front/nodeDashboard.html'); });
            const server = this.app.listen(this.port, () => { console.log(`Server running on http://${'???'}:${this.port}`); });
            this.wss = new WebSocketServer({ server });
        }

        this.wss.on('connection', this.#onConnection.bind(this));
        this.wss.on('close', () => { console.log('Server closed'); });
        
        const callbacksModes = []; // we will add the modes related to the callbacks we want to init
        if (this.node.roles.includes('validator')) { callbacksModes.push('validatorDashboard'); }
        if (this.node.roles.includes('miner')) { callbacksModes.push('minerDashboard'); }
        this.callBackManager.initAllCallbacksOfMode(callbacksModes, this.wss.clients);
    }
    #onConnection(ws, req) {
        const clientIp = req.socket.remoteAddress === '::1' ? 'localhost' : req.socket.remoteAddress;
        console.log(`[DASHBOARD] ${this.readableNow()} Client connected: ${clientIp}`);
        ws.on('close', function close() { console.log('Connection closed'); });
        //ws.on('ping', function incoming(data) { console.log('received: %s', data); });
        
        //ws.onmessage = this.onMessage(event);
        const messageHandler = (message) => { this.#onMessage(message, ws); };
        ws.on('message', messageHandler);
    }
    /** @param {Buffer} message @param {WebSocket} ws */
    async #onMessage(message, ws) {
        //console.log(`[onMessage] this.node.account.address: ${this.node.account.address}`);
        const messageAsString = message.toString();
        const parsedMessage = JSON.parse(messageAsString);
        const data = parsedMessage.data;
        switch (parsedMessage.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', data: Date.now() }));
                break;
            case 'force_restart':
                ws.send(JSON.stringify({ type: 'node_restarting', data }));
                console.info(`Closing the websocket server and express server`);
                //this.wss.close(); // close the websocket server
                //this.app.delete('/'); // close the express server
                //await new Promise(resolve => setTimeout(resolve, 1000));

                console.info(`Forcing restart of node ${data}`);
                await this.factory.forceRestartNode(data);
                //await new Promise(resolve => setTimeout(resolve, 1000));

                ws.send(JSON.stringify({ type: 'node_restarted', data }));
                break;
            case 'sync_clock':
                synchronizeClock();
                break;
            case 'get_node_info':
                ws.send(JSON.stringify({ type: 'node_info', data: await AppStaticFncs.extractPrivateNodeInfo(this.node) }));
                break;
            case 'set_miner_threads':
                console.log(`Setting miner threads to ${data}`);
                this.node.miner.nbOfWorkers = data;
                break;
            case 'new_unsigned_transaction':
                console.log(`signing transaction ${data.id}`);
                const tx = await this.node.account.signTransaction(data);
                console.log('Broadcast transaction', data);
                const { broadcasted, pushedInLocalMempool, error } = this.node.pushTransaction(tx);

                if (error) { console.error('Error broadcasting transaction', error); return; }

                ws.send(JSON.stringify({ type: 'transaction_broadcasted', data: { broadcasted, pushedInLocalMempool } }));
                console.log('Transaction sent');
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', data: 'unknown message type' }));
                break;
        }
    }
}

export class ObserverWsApp {
    /** @param {NodeFactory} factory */
    constructor(factory, port = 27270) {
        /** @type {NodeFactory} */
        this.factory = factory;
        /** @type {CallBackManager} */
        this.callBackManager = new CallBackManager(this.node);
        /** @type {express.Application} */
        this.app = express();
        this.port = port;
        /** @type {WebSocketServer} */
        this.wss =  null;
        this.wssClientsIPs = {};
        this.maxConnectionsPerIP = 3;

        this.readableNow = () => { return `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}` };
        this.init();
    }
    /** @type {Node} */
    get node() { return this.factory.getFirstNode(); }
    init() {
        this.app.use(express.static(APPS_VARS.__parentDirname));
        this.app.get('/', (req, res) => { res.sendFile(APPS_VARS.__parentDirname + '/front/explorer.html'); });
        const server = this.app.listen(this.port, () => { console.log(`Server running on http://${'???'}:${this.port}`); });
        this.wss = new WebSocketServer({ server });

        this.wss.on('connection', this.#onConnection.bind(this));
        
        if (!this.node.roles.includes('validator')) { throw new Error('ObserverWsApp must be used with a validator node'); }
        this.callBackManager.initAllCallbacksOfMode('observer', this.wss.clients);
    }
    /** @param {WebSocket} ws @param {http.IncomingMessage} req */
    async #onConnection(ws, req) {
        const clientIp = req.socket.remoteAddress === '::1' ? 'localhost' : req.socket.remoteAddress;
        if (this.wssClientsIPs[clientIp] && this.wssClientsIPs[clientIp] >= this.maxConnectionsPerIP) {
            console.log(`[OBSERVER] ${this.readableNow()} Client already connected: ${clientIp}`);
            ws.close(undefined, 'Max connections per IP reached');
            this.wssClientsIPs[clientIp] -= 1;
            return;
        }

        if (!this.wssClientsIPs[clientIp]) { this.wssClientsIPs[clientIp] = 0; }
        this.wssClientsIPs[clientIp] += 1;
        console.log(`[OBSERVER] ${this.readableNow()} Client connected: ${clientIp} (${this.wssClientsIPs[clientIp]} connections)`);

        ws.on('close', () => {
            console.log(`[OBSERVER] Connection closed by client: ${clientIp}`);
            if (!this.wssClientsIPs[clientIp]) { return; }
            this.wssClientsIPs[clientIp] -= 1;
        });
        //ws.on('ping', function incoming(data) { console.log('received: %s', data); });

        this.#initConnectionMessage(ws);
        
        const messageHandler = (message) => { this.#onMessage(message, ws); };
        ws.on('message', messageHandler);
    }
    async #initConnectionMessage(ws) {
        const nbOfBlocks = 5 - 1; // 5 last blocks
        const toHeight = this.node.blockchain.currentHeight - 1 < 0 ? 0 : this.node.blockchain.currentHeight;
        const startHeight = toHeight - nbOfBlocks < 0 ? 0 : toHeight - nbOfBlocks;
        const last5BlocksInfo = this.node.blockchain.lastBlock ? await this.node.getBlocksInfo(startHeight, toHeight) : [];
        ws.send(JSON.stringify({ type: 'last_confirmed_blocks', data: last5BlocksInfo }));
    }
    /** @param {Buffer} message @param {WebSocket} ws */
    async #onMessage(message, ws) {
        try {
            //console.log(`[onMessage] this.node.account.address: ${this.node.account.address}`);
            const messageAsString = message.toString();
            const parsedMessage = JSON.parse(messageAsString);
            const data = parsedMessage.data;
            let exhaustiveBlockData;
            switch (parsedMessage.type) {
                case 'get_height':
                    ws.send(JSON.stringify({ type: 'current_height', data: this.node.blockchain.currentHeight }));
                    break;
                case 'get_node_info':
                    ws.send(JSON.stringify({ type: 'node_info', data: AppStaticFncs.extractNodeInfo(this.node) }));
                    break;
                case 'reconnect':
                    this.#initConnectionMessage(ws);
                    break;
                case 'get_blocks_data_by_height':
                    // can accept a single "height" number or "fromHeight toHeight" format
                    exhaustiveBlockData = await this.node.getExhaustiveBlocksDataByHeight(data.fromHeight | data, data.toHeight);
                    ws.send(JSON.stringify({ type: 'blocks_data_requested', data: exhaustiveBlockData }));
                    break;
                case 'get_blocks_data_by_hash':
                    exhaustiveBlockData = await this.node.getExhaustiveBlockDataByHash(data);
                    ws.send(JSON.stringify({ type: 'blocks_data_requested', data: exhaustiveBlockData }));
                    break;
                case 'get_address_utxos':
                    const UTXOs = await this.node.getAddressUtxos(data);
                    ws.send(JSON.stringify({ type: 'address_utxos_requested', data: { address: data, UTXOs } }));
                    break;
                case 'get_address_transactions_references':
                    const addTxsRefs = await this.node.blockchain.getTxsRefencesFromDiskByAddress(data);
                    ws.send(JSON.stringify({ type: 'address_transactionsRefs_requested', data: addTxsRefs }));
                    break;
                case 'get_address_exhaustive_data':
                    const { addressUTXOs, addressTxsReferences } = await this.node.getAddressExhaustiveData(data);
                    ws.send(JSON.stringify({ type: 'address_exhaustive_data_requested', data: { address: data, addressUTXOs, addressTxsReferences } }));
                    break;
                case 'get_transaction_by_reference':
                    const resTx = await this.node.getTransactionByReference(data);
                    if (!res) { console.error(`[OBSERVER] Transaction not found: ${data}`); return; }
                    ws.send(JSON.stringify({ type: 'transaction_requested', data: res.transaction }));
                    break;
                case 'get_transaction_with_balanceChange_by_reference':
                    const { transaction, balanceChange } = await this.node.getTransactionByReference(data.txReference, data.address);
                    if (!transaction) { console.error(`[OBSERVER] Transaction not found: ${data.txReference}`); return; }
                    ws.send(JSON.stringify({ type: 'transaction_requested', data: { transaction, balanceChange, txReference: data.txReference } }));
                default:
                    ws.send(JSON.stringify({ type: 'error', data: 'unknown message type' }));
                    break;
            }
        } catch (error) {
            console.error(`[OBSERVER] Error on message: ${error.message}`);
        }
    }
}

// GENERAL FUNCTIONS
function synchronizeClock() { // DEPRECATED
    const platform = process.platform;
  
    let command;

    switch (platform) {
      case 'win32': // Windows
        command = 'w32tm /resync';
        break;
      case 'linux': // Linux
        command = 'sudo ntpdate -u pool.ntp.org';
        break;
      case 'darwin': // macOS
        command = 'sudo sntp -sS time.apple.com';
        break;
      default:
        console.log(`Platform not supported: ${platform}`);
        return;
    }
  
    exec(command, (error, stdout, stderr) => {
        console.log(`Output: ${stdout}`);
        if (error) {
            console.error(`Error: ${error.message}`); // the error message is more explicit
            return;
        }
        if (stderr) { console.error(`Error: ${stderr}`); return; }
        console.log(`Clock synchronized on ${platform}.`);
    });
}