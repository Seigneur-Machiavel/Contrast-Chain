import fetch from 'node-fetch';

export class LightHouseClient {
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.currentVersion = '1.1.0'; // The current version of the node
        this.lighthouseUrl = 'http://localhost:3001/latest-version';
        this.logs = [];
    }

    async checkVersion() {
        try {
            const response = await fetch(this.lighthouseUrl);
            const data = await response.json();

            if (data.latestVersion && data.latestVersion !== this.currentVersion) {
                console.warn(`Node version outdated. Latest version: ${data.latestVersion}, Current version: ${this.currentVersion}`);
                this.logs.push(`Node version outdated. Latest version: ${data.latestVersion}, Current version: ${this.currentVersion}`);
                // Take action if necessary (e.g., log, notify user, etc.)
            } else {
                console.info('Node version is up-to-date.');
                this.logs.push('Node version is up-to-date.');
            }
        } catch (error) {
            console.error('Failed to check version with lighthouse node.', error);
            this.logs.push('Failed to check version with lighthouse node.');
        }
    }

    async start() {
        // Step 1: Check version before starting the node
        await this.checkVersion();

        // Step 2: Continue with regular node startup logic
        console.info('Starting node...');
        // Add node startup logic here (e.g., connecting to peers, syncing, etc.)
    }
}
