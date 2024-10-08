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
        this.syncInterval = options.syncInterval || 60000; // Sync every 60 seconds
        this.epochInterval = options.epochInterval || 300000; // 5 minutes
        this.roundInterval = options.roundInterval || 60000; // 1 minute
        this.retryAttempts = options.retryAttempts || 5;
        this.retryDelay = options.retryDelay || 5000; // 5 seconds delay between retries

        this.lastSyncedTime = null;
        this.offset = 0; // Time offset between system time and NTP time
    }

    getCurrentNtpServer() {
        return this.ntpServers[this.currentServerIndex];
    }

    rotateNtpServer() {
        this.currentServerIndex = (this.currentServerIndex + 1) % this.ntpServers.length;
    }

    async syncTimeWithRetry(attempts = this.retryAttempts) {
        console.log(`Attempting NTP sync with ${this.getCurrentNtpServer()}. Attempts left: ${attempts}`);
        try {
            await this.syncTimeWithNTP();
        } catch (err) {
            if (attempts > 1) {
                console.warn(`Retrying NTP sync. Rotating to next server.`);
                this.rotateNtpServer();
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                return this.syncTimeWithRetry(attempts - 1);
            } else {
                console.error(`Failed to sync with NTP after ${this.retryAttempts} attempts`);
            }
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

    // Schedule the next epoch based on the synchronized time
    scheduleNextEpoch(callback) {
        const currentTime = this.getCurrentTime();
        const timeUntilNextEpoch = this.epochInterval - (currentTime % this.epochInterval);
        setTimeout(async () => {
            callback();
            this.scheduleNextEpoch(callback); // Schedule the next epoch after the current one
        }, timeUntilNextEpoch);
    }

    // Schedule the next round based on the synchronized time
    scheduleNextRound(callback) {
        const currentTime = this.getCurrentTime();
        const timeUntilNextRound = this.roundInterval - (currentTime % this.roundInterval);
        setTimeout(async () => {
            callback();
            this.scheduleNextRound(callback); // Schedule the next round after the current one
        }, timeUntilNextRound);
    }

    // Start the periodic synchronization with the NTP server with retries
    startSyncLoop() {
        this.syncTimeWithRetry(); // Initial sync with retry
        setInterval(() => {
            this.syncTimeWithRetry(); // Re-sync every syncInterval with retry
        }, this.syncInterval);
    }
}

export { TimeSynchronizer };
export default TimeSynchronizer;