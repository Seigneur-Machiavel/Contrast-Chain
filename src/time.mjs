import ntpClient from 'ntp-client';

class TimeSynchronizer {
    constructor(options = {}) {
        this.ntpServers = options.ntpServers || [
            '0.pool.ntp.org',
            '1.pool.ntp.org',
            '2.pool.ntp.org',
            '3.pool.ntp.org'
        ];
        this.currentServerIndex = 0;
        this.ntpPort = options.ntpPort || 123;
        this.syncInterval = options.syncInterval || 600_000; // 10 minutes
        this.epochInterval = options.epochInterval || 300_000; // 5 minutes
        this.roundInterval = options.roundInterval || 60_000; // 1 minute
        this.retryAttempts = options.retryAttempts || 5;
        this.retryDelay = options.retryDelay || 5000; // 5 seconds delay between retries

        this.lastSyncedTime = null;
        this.offset = 0; // Time offset between system time and NTP time
        this.#startSyncLoop();
    }

    getCurrentNtpServer() {
        return this.ntpServers[this.currentServerIndex];
    }

    rotateNtpServer() {
        this.currentServerIndex = (this.currentServerIndex + 1) % this.ntpServers.length;
    }

    async syncTimeWithRetry(attempts = this.retryAttempts, delay) {
        console.log(`Attempting NTP sync with ${this.getCurrentNtpServer()}. Attempts left: ${attempts}`);

        for (let i = 0; i < attempts; i++) {
            try {
                await this.syncTimeWithNTP();
                console.log(`Time synchronized after ${i + 1} attempts`);
                return true;
            } catch (err) {
                this.rotateNtpServer();
                await new Promise(resolve => setTimeout(resolve, delay || this.retryDelay));
            }
        }

        console.warn(`Failed to sync with NTP after ${this.retryAttempts} attempts`);
    }
    async #startSyncLoop() {
        while (true) {
            await new Promise(resolve => setTimeout(resolve, this.syncInterval));
            await this.syncTimeWithRetry(); // Re-sync every syncInterval with retry
        }
    }
    async syncTimeWithNTP() {
        console.log(`Syncing time with NTP server: ${this.getCurrentNtpServer()}`);
        return new Promise((resolve, reject) => {
            ntpClient.getNetworkTime(this.getCurrentNtpServer(), this.ntpPort, (err, date) => {
                if (err) {
                    console.error(`Failed to sync time with NTP server: ${err}`);
                    return reject(err);
                }
                const systemTime = Date.now();
                this.offset = date.getTime() - systemTime;
                this.lastSyncedTime = date;
                console.log(`Time synchronized. Offset: ${this.offset} ms`);
                resolve(this.offset);
            });
        });
    }

    // Get the synchronized current time
    getCurrentTime() {
        return Date.now() + this.offset;
    }
}

export { TimeSynchronizer };
export default TimeSynchronizer;
