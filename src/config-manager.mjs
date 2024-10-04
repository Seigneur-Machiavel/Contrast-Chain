import { promises as fs } from 'fs';
import path from 'path';

export class ConfigManager {
    /** @param {string} configPath - The path to the configuration file.*/
    constructor(configPath) {
        if (!configPath) throw new Error('Configuration file path must be provided.');
        this.configPath = path.resolve(configPath);
        this.config = {
            bootstrapNodes: ['/dns4/pinkparrot.science/tcp/27260', '/ip4/82.126.155.210/tcp/7777'], // '/dns4/pariah.monster/tcp/27260'
            isInitNode: false,
        };
    }

    async init() {
        try {
            await fs.access(this.configPath);
            await this.loadConfig();
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.warn(`Config file not found at ${this.configPath}. Creating a default config.`);
                await this.saveConfig();
            } else throw err;
        }
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configPath, 'utf-8');
            const parsed = JSON.parse(data);

            if (!Array.isArray(parsed.bootstrapNodes) || !parsed.bootstrapNodes.every(node => typeof node === 'string'))
                throw new Error('Invalid format for "bootstrapNodes". It should be an array of strings.');
            if (typeof parsed.isInitNode !== 'boolean')
                throw new Error('Invalid format for "isInitNode". It should be a boolean.');

            this.config = parsed;
            console.log('Configuration loaded successfully.');
        } catch (err) {
            throw new Error(`Failed to load config: ${err.message}`);
        }
    }

    async saveConfig() {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
            console.log('Configuration saved successfully.');
        } catch (err) { throw new Error(`Failed to save config: ${err.message}`); }
    }

    /** @returns {string[]} Array of bootstrap node strings.*/
    getBootstrapNodes = () => this.config.bootstrapNodes;

    /** @returns {boolean} The isInitNode value.*/
    getIsInitNode = () => this.config.isInitNode;
}

export default ConfigManager;
