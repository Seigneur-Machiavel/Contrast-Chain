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
        this.syncInterval = options.syncInterval || 3600000; // 1 hour
        this.retryAttempts = options.retryAttempts || 5;
        this.retryDelay = options.retryDelay || 5000; // 5 seconds delay between retries

        this.lastSyncedTime = null;
        this.offset = 0; // Time offset between system time and NTP time
        this.isRunning = false;
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
                await this.delay(this.retryDelay);
                return this.syncTimeWithRetry(attempts - 1);
            } else {
                console.error(`Failed to sync with NTP after ${this.retryAttempts} attempts`);
            }
        }
    }

    syncTimeWithNTP() {
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
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get the synchronized current time
    getCurrentTime() {
        return Date.now() + this.offset;
    }

    // Start the synchronization loop
    async startSyncLoop() {
        if (this.isRunning) {
            console.warn('TimeSynchronizer is already running.');
            return;
        }
        this.isRunning = true;
        console.log('Starting TimeSynchronizer...');

        while (this.isRunning) {
            await this.syncTimeWithRetry();
            await this.delay(this.syncInterval);
        }
    }

}

export { TimeSynchronizer };
export default TimeSynchronizer;
