// test/timeSynchronizer.test.js

import { expect } from 'chai';
import sinon from 'sinon';
import ntpClient from 'ntp-client';
import TimeSynchronizer from '../plugins/time.mjs';

describe('TimeSynchronizer', () => {
    let timeSynchronizer;
    let sandbox;

    beforeEach(() => {
        // Create a Sinon sandbox to manage stubs and mocks
        sandbox = sinon.createSandbox();
        timeSynchronizer = new TimeSynchronizer({
            syncInterval: 1000, // 1 second for faster testing
            retryAttempts: 3,
            retryDelay: 10, // Reduced for faster tests
            autoStart: false, // Disable auto-start during tests
        });
    });

    afterEach(() => {
        // Restore the sandbox to remove stubs and mocks
        sandbox.restore();
    });

    it('should synchronize time successfully', async () => {
        // Arrange
        const fixedSystemTime = 1609459200000; // Fixed timestamp (Jan 1, 2021)
        const ntpTime = new Date(fixedSystemTime + 1000); // NTP time is 1 second ahead

        // Stub Date.now() to return fixedSystemTime
        const dateNowStub = sandbox.stub(Date, 'now').returns(fixedSystemTime);

        // Stub ntpClient.getNetworkTime
        const getNetworkTimeStub = sandbox.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
            callback(null, ntpTime);
        });

        // Act
        await timeSynchronizer.syncTimeWithNTP();

        // Assert
        expect(timeSynchronizer.offset).to.equal(1000);
        expect(timeSynchronizer.lastSyncedTime.getTime()).to.equal(ntpTime.getTime());
        expect(getNetworkTimeStub.calledOnce).to.be.true;

        // Cleanup
        dateNowStub.restore();
    });

    it('should retry synchronization on failure', async () => {
        // Arrange
        const fixedSystemTime = 1609459200000; // Fixed timestamp
        const ntpTime = new Date(fixedSystemTime + 1000); // NTP time is 1 second ahead
        sandbox.stub(Date, 'now').returns(fixedSystemTime);

        const getNetworkTimeStub = sandbox.stub(ntpClient, 'getNetworkTime');

        // Simulate failures on the first two attempts
        getNetworkTimeStub.onCall(0).callsFake((server, port, callback) => {
            callback(new Error('Network error'));
        });
        getNetworkTimeStub.onCall(1).callsFake((server, port, callback) => {
            callback(new Error('Network error'));
        });
        // Simulate success on the third attempt
        getNetworkTimeStub.onCall(2).callsFake((server, port, callback) => {
            callback(null, ntpTime);
        });

        // Act
        await timeSynchronizer.syncTimeWithRetry();

        // Assert
        expect(timeSynchronizer.offset).to.equal(1000);
        expect(getNetworkTimeStub.callCount).to.equal(3);
    });

    it('should fail after maximum retry attempts', async () => {
        // Arrange
        const getNetworkTimeStub = sandbox.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
            callback(new Error('Network error'));
        });

        // Act
        const result = await timeSynchronizer.syncTimeWithRetry();

        // Assert
        expect(result).to.be.undefined;
        expect(getNetworkTimeStub.callCount).to.equal(3); // retryAttempts is set to 3
        expect(timeSynchronizer.offset).to.equal(0);
    });

    it('should rotate NTP servers on failure', async () => {
        // Arrange
        const servers = ['server1', 'server2', 'server3'];
        timeSynchronizer.ntpServers = servers;
        timeSynchronizer.currentServerIndex = 0;
    
        const getNetworkTimeStub = sandbox.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
            callback(new Error('Network error'));
        });
    
        // Act
        try {
            await timeSynchronizer.syncTimeWithRetry(1, 0); // Attempt once, no delay
        } catch (err) {
            // Expected to fail
        }
    
        // Assert
        expect(timeSynchronizer.getCurrentNtpServer()).to.equal('server2');
    });
    

    it('should get current time adjusted by offset', () => {
        // Arrange
        const fixedSystemTime = 1609459200000; // Fixed timestamp
        sandbox.stub(Date, 'now').returns(fixedSystemTime);

        timeSynchronizer.offset = 2000;

        // Act
        const currentTime = timeSynchronizer.getCurrentTime();

        // Assert
        expect(currentTime).to.equal(fixedSystemTime + 2000);
    });
});
