import { Node } from './node.mjs';
import { Account } from './account.mjs';
import { Wallet } from './wallet.mjs';

export class NodeFactory {
    constructor() {
        /** @type {Map<string, Node>} */
        this.nodes = new Map();
        this.nodesCreationSettings = {};
        this.#controlLoop();
    }
    async #restartNodesWhoRequestedIt() {
        for (const node of this.nodes.values()) {
            if (!node.restartRequested || node.restarting) { continue; }
            await this.forceRestartNode(node.id);
        }
    }
    async #controlLoop() {
        while (true) {
            await this.#restartNodesWhoRequestedIt();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    /**
     * @param {Account} account
     * @param {string[]} roles
     * @param {Object<string, string>}
     * @param {string} minerAddress - if not specified, the miner address will be the same as the validator address
     */
    async createNode(account, roles = ['validator'], p2pOptions = {}, minerAddress) {
        const rolesArray = Array.isArray(roles) ? roles : [roles];
        const node = new Node(account, rolesArray, p2pOptions);
        if (minerAddress) { node.minerAddress = minerAddress; }
        this.nodes.set(node.id, node);
        console.log(`Node ${node.id} created`);
        return node;
    }
    /** @param {string} nodeId */
    async startNode(nodeId) {
        const node = this.getNode(nodeId);
        if (!node) { console.error(`Node ${nodeId} not found`); return; }
        await node.start();
    }
    /** @param {string} nodeId */
    async stopNode(nodeId) {
        const node = this.getNode(nodeId);
        if (!node) { console.error(`Node ${nodeId} not found`); return; }
        await node.stop();
    }
    /**
     * @param {string} nodeId 
     * @param {boolean} skipBlocksValidation - if true, the node will not validate the blocks loaded from the database
     * @param {boolean} startFromScratch - if true, the node will start from the genesis block
     */
    async forceRestartNode(nodeId, startFromScratch = false) {
        /** @type {Node} */
        const targetNode = this.getNode(nodeId);
        if (!targetNode) { console.error(`Node ${nodeId} not found`); return; }
        targetNode.restarting = true;
        if (!targetNode.restartRequested) {
            targetNode.restartRequested = true;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        this.nodesCreationSettings[nodeId] = {
            account: targetNode.account,
            minerAddress: targetNode.minerAddress,
            roles: targetNode.roles,
            p2pOptions: targetNode.p2pOptions
        };
        
        targetNode.opStack.terminate();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        targetNode.miner.terminate();
        for (const worker of targetNode.workers) { await worker.terminateAsync(); }
        await new Promise(resolve => setTimeout(resolve, 1000));

        
        // stop level db
        await targetNode.blockchain.db.close();
        await targetNode.p2pNetwork.stop();
        await new Promise(resolve => setTimeout(resolve, 2000));

        const newNode = await this.createNode(
            targetNode.account,
            targetNode.roles,
            targetNode.p2pOptions,
            targetNode.minerAddress
        );
        await newNode.start(startFromScratch);

        this.nodes.set(nodeId, newNode);
    }
    getFirstNode() {
        return this.nodes.values().next().value;
    }
    /** @param {string} nodeId */
    getNode(nodeId) {
        try {
            const node = this.nodes.get(nodeId);
            if (!node) { throw new Error(`Node with ID ${nodeId} not found`); }
            return node;
        } catch (error) {
            console.error(error.message);
            return undefined;
        }
    }
    getAllNodes() {
        return Array.from(this.nodes.values());
    }
    /** @param {Account[]} accounts */
    refreshAllBalances(accounts) {
        for (const node of this.nodes.values()) {
            for (const account of accounts) {
                const { spendableBalance, balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(account.address);
                account.setBalanceAndUTXOs(balance, UTXOs);
            }
        }
    }
}