import { expect } from 'chai';
import sinon from 'sinon';
import { TimeSynchronizer } from '../src/time.mjs';
import ntpClient from 'ntp-client';

describe('TimeSynchronizer', function () {
    let timeSynchronizer;
    let clock;

    beforeEach(function () {
        timeSynchronizer = new TimeSynchronizer({
            syncInterval: 1000,
            epochInterval: 5000,
            roundInterval: 1000,
            retryAttempts: 3,
            retryDelay: 100
        });

        clock = sinon.useFakeTimers({
            now: new Date(),
            shouldAdvanceTime: true
        });
    });

    afterEach(function () {
        clock.restore();
        sinon.restore();
    });

    describe('constructor', function () {
        it('should initialize with default NTP servers', function () {
            expect(timeSynchronizer.ntpServers).to.deep.equal([
                '0.pool.ntp.org',
                '1.pool.ntp.org',
                '2.pool.ntp.org',
                '3.pool.ntp.org'
            ]);
        });

        it('should allow custom NTP servers', function () {
            const customServers = ['custom1.ntp.org', 'custom2.ntp.org'];
            const customTimeSynchronizer = new TimeSynchronizer({ ntpServers: customServers });
            expect(customTimeSynchronizer.ntpServers).to.deep.equal(customServers);
        });
    });

    describe('getCurrentNtpServer', function () {
        it('should return the current NTP server', function () {
            expect(timeSynchronizer.getCurrentNtpServer()).to.equal('0.pool.ntp.org');
        });
    });

    describe('rotateNtpServer', function () {
        it('should rotate to the next NTP server', function () {
            timeSynchronizer.rotateNtpServer();
            expect(timeSynchronizer.getCurrentNtpServer()).to.equal('1.pool.ntp.org');
        });

        it('should wrap around to the first server after the last one', function () {
            for (let i = 0; i < timeSynchronizer.ntpServers.length; i++) {
                timeSynchronizer.rotateNtpServer();
            }
            expect(timeSynchronizer.getCurrentNtpServer()).to.equal('0.pool.ntp.org');
        });
    });

    describe('syncTimeWithNTP', function () {
        it('should update offset and lastSyncedTime on successful sync', function (done) {
            const fakeNtpTime = new Date('2023-01-01T00:00:00Z');
            const ntpStub = sinon.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
                callback(null, fakeNtpTime);
            });

            timeSynchronizer.syncTimeWithNTP().then(() => {
                expect(timeSynchronizer.lastSyncedTime).to.deep.equal(fakeNtpTime);
                expect(timeSynchronizer.offset).to.equal(fakeNtpTime.getTime() - Date.now());
                expect(ntpStub.calledWith('0.pool.ntp.org')).to.be.true;
                done();
            }).catch(done);
        });

        it('should throw an error on NTP sync failure', function (done) {
            sinon.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
                callback(new Error('NTP sync failed'), null);
            });

            timeSynchronizer.syncTimeWithNTP().then(() => {
                done(new Error('Expected syncTimeWithNTP to throw an error'));
            }).catch((error) => {
                expect(error.message).to.equal('NTP sync failed');
                done();
            });
        });
    });

    describe('syncTimeWithRetry', function () {
        it('should retry on failure and succeed eventually', function (done) {
            this.timeout(10000);
            const ntpStub = sinon.stub(ntpClient, 'getNetworkTime');
            ntpStub.onCall(0).callsFake((server, port, callback) => {
                callback(new Error('NTP sync failed'), null);
            });
            ntpStub.onCall(1).callsFake((server, port, callback) => {
                callback(null, new Date('2023-01-01T00:00:00Z'));
            });

            timeSynchronizer.syncTimeWithRetry().then(() => {
                clock.runAll();
                expect(ntpStub.callCount).to.equal(2);
                expect(timeSynchronizer.lastSyncedTime).to.not.be.null;
                expect(timeSynchronizer.getCurrentNtpServer()).to.equal('1.pool.ntp.org');
                done();
            }).catch(done);
        });

        it('should give up after maximum retry attempts', function (done) {
            this.timeout(10000);
            sinon.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
                callback(new Error('NTP sync failed'), null);
            });

            const consoleErrorStub = sinon.stub(console, 'error');

            timeSynchronizer.syncTimeWithRetry().then(() => {
                clock.runAll();
                expect(consoleErrorStub.calledWith('Failed to sync with NTP after 3 attempts')).to.be.true;
                expect(timeSynchronizer.getCurrentNtpServer()).to.equal('2.pool.ntp.org');
                done();
            }).catch(done);
        });
    });

    describe('getCurrentTime', function () {
        it('should return the current time adjusted by the offset', function () {
            const realNow = Date.now();
            const timeSynchronizer = new TimeSynchronizer();
            timeSynchronizer.offset = 5000;

            const result = timeSynchronizer.getCurrentTime();

            expect(result).to.be.closeTo(realNow + 5000, 100); // Allow 100ms tolerance
        });
    });

    describe('scheduleNextEpoch and scheduleNextRound', function () {
        let timeSynchronizer;

        beforeEach(function () {
            timeSynchronizer = new TimeSynchronizer({
                epochInterval: 100, // 100ms for faster testing
                roundInterval: 50 // 50ms for faster testing
            });
        });

        it('should schedule callbacks at the correct intervals', async function () {
            this.timeout(1000); // Increase timeout to 1 second

            const epochTimes = [];
            const roundTimes = [];

            const epochCallback = () => epochTimes.push(Date.now());
            const roundCallback = () => roundTimes.push(Date.now());

            timeSynchronizer.scheduleNextEpoch(epochCallback);
            timeSynchronizer.scheduleNextRound(roundCallback);

            // Wait for callbacks to be called
            await new Promise(resolve => setTimeout(resolve, 250));

            expect(epochTimes.length).to.be.at.least(2);
            expect(roundTimes.length).to.be.at.least(4);

            // Check that callbacks are called with increasing intervals
            for (let i = 1; i < epochTimes.length; i++) {
                const diff = epochTimes[i] - epochTimes[i - 1];
                expect(diff).to.be.closeTo(100, 20);
            }

            for (let i = 1; i < roundTimes.length; i++) {
                const diff = roundTimes[i] - roundTimes[i - 1];
                expect(diff).to.be.closeTo(50, 20);
            }
        });
    });

    describe('startSyncLoop', function () {
        it('should start periodic synchronization', function (done) {
            const syncStub = sinon.stub(timeSynchronizer, 'syncTimeWithRetry').resolves();

            timeSynchronizer.startSyncLoop();

            expect(syncStub.calledOnce).to.be.true;

            clock.tick(timeSynchronizer.syncInterval + 100);

            // Use setImmediate to allow the scheduled callbacks to execute
            setImmediate(() => {
                expect(syncStub.calledTwice).to.be.true;
                done();
            });
        });
    });
});