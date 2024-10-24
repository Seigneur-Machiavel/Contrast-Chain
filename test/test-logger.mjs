// Logger.test.js

import { expect } from 'chai';
import sinon from 'sinon';
import mockFs from 'mock-fs';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { PassThrough } from 'stream';
import Logger from '../src/logger.mjs';
import util from 'util';

describe('Logger Class', function () {
    let logger;
    let consoleStub;
    let clock;
    let tempDir;

    beforeEach(async function () {
        // Create a temporary directory for logs
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));

        // Mock the file system, excluding the temp directory
        mockFs({
            '/project/package.json': '{}',
            '/project/src/app.js': `
                this.logger.info('luid-12345678 Starting application');
                this.logger.error('luid-87654321 An error occurred');
            `,
            '/project/logs': {}, // Initially empty
            [tempDir]: {}, // Logs will be written here
        });

        // Stub console methods
        consoleStub = {
            log: sinon.stub(),
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
            debug: sinon.stub(),
            trace: sinon.stub(),
        };
        sinon.replace(console, 'log', consoleStub.log);
        sinon.replace(console, 'info', consoleStub.info);
        sinon.replace(console, 'warn', consoleStub.warn);
        sinon.replace(console, 'error', consoleStub.error);
        sinon.replace(console, 'debug', consoleStub.debug);
        sinon.replace(console, 'trace', consoleStub.trace);

        // Fake timers
        clock = sinon.useFakeTimers();

        // Initialize Logger with the temporary log directory
        logger = new Logger(8, { projectRoot: '/project', logDirectory: tempDir });
        await logger.initializeLogger();
    });

    afterEach(function () {
        // Restore the original console methods
        sinon.restore();
        // Restore the mocked file system
        mockFs.restore();
        // Restore the fake timers
        clock.restore();
        // Remove the temporary directory
        fs.rmdirSync(tempDir, { recursive: true });
    });

    describe('Initialization', function () {
        it('should initialize with default options', function () {
            expect(logger.idLength).to.equal(8);
            expect(logger.logDirectory).to.equal(tempDir);
            expect(logger.logFileName).to.equal('app.log');
            expect(logger.rotationInterval).to.equal('1d');
            expect(logger.maxFiles).to.equal(30);
            expect(logger.compress).to.equal('gzip');
            expect(logger.logStream).to.exist;
            expect(logger.logStream.path).to.equal(tempDir);
            expect(consoleStub.log.calledWithMatch(/Logging to file:/)).to.be.true;
        });

        it('should create log directory if it does not exist', function () {
            // Remove the log directory and re-initialize
            fs.rmdirSync(tempDir, { recursive: true });
            expect(fs.existsSync(tempDir)).to.be.false;

            // Re-initialize Logger
            logger = new Logger(8, { projectRoot: '/project', logDirectory: tempDir });
            logger.initializeLogger();

            // Check that the log directory is recreated
            expect(fs.existsSync(tempDir)).to.be.true;
            expect(consoleStub.log.calledWithMatch(/Created log directory at/)).to.be.true;
        });

        it('should handle errors during log directory creation', function () {
            // Make mkdirSync throw an error by mocking it
            const mkdirStub = sinon.stub(fs, 'mkdirSync').throws(new Error('Permission denied'));

            expect(() => new Logger(8, { projectRoot: '/project', logDirectory: tempDir })).to.throw('Permission denied');
            expect(consoleStub.error.calledWithMatch(/Failed to create log directory/)).to.be.true;
            mkdirStub.restore();
        });
    });

    describe('Unique ID Generation', function () {
        it('should generate unique IDs with correct format and length', function () {
            const id = logger.generateUniqueId();
            expect(id).to.match(/^luid-[0-9a-f]{8}$/);
            expect(id.length).to.equal(13); // 'luid-' + 8 chars
        });

        it('should generate unique IDs based on idLength', function () {
            const customLogger = new Logger(10, { projectRoot: '/project', logDirectory: tempDir });
            const id = customLogger.generateUniqueId();
            expect(id).to.match(/^luid-[0-9a-f]{10}$/);
            expect(id.length).to.equal(15); // 'luid-' + 10 chars
        });
    });

    describe('Logging Functionality', function () {
        it('should log messages to console and file when active', async function () {
            // Log an info message
            logger.info('luid-12345678 This is an info message');

            // Check console.info was called
            expect(consoleStub.info.calledWith('This is an info message')).to.be.true;

            // Check write to file
            const logFilePath = path.join(tempDir, 'app.log');
            const logContent = await fsPromises.readFile(logFilePath, 'utf-8');
            expect(logContent).to.match(/\[.*\] \[INFO\] This is an info message\n/);
        });

        it('should not log messages to console and file when inactive', async function () {
            // Deactivate a log
            logger.deactivateLog('luid-12345678');

            // Attempt to log
            logger.info('luid-12345678 This message should not be logged');

            // Check console.warn was called
            expect(consoleStub.warn.calledWithMatch(/Log ID luid-12345678 is inactive/)).to.be.true;

            // Ensure nothing was written to the log file
            const logFilePath = path.join(tempDir, 'app.log');
            const logContent = fs.existsSync(logFilePath) ? await fsPromises.readFile(logFilePath, 'utf-8') : '';
            expect(logContent).to.not.include('This message should not be logged');
        });

        it('should handle logging with additional arguments', async function () {
            const additionalData = { user: 'testUser', action: 'testAction' };
            logger.debug('luid-12345678 Debugging application', additionalData);

            // Check console.debug was called with serialized args
            expect(consoleStub.debug.calledWith(`Debugging application ${util.inspect(additionalData, { depth: null, colors: false })}`)).to.be.true;

            // Check write to file
            const logFilePath = path.join(tempDir, 'app.log');
            const logContent = await fsPromises.readFile(logFilePath, 'utf-8');
            expect(logContent).to.match(/\[.*\] \[DEBUG\] Debugging application \{ user: 'testUser', action: 'testAction' \}\n/);
        });

        it('should handle invalid log types gracefully', async function () {
            // Attempt to log with an invalid type
            logger.dolog('invalidType', 'luid-12345678 Invalid log type');

            // Check console.error was called
            expect(consoleStub.error.calledWithMatch(/Invalid log type "invalidType"/)).to.be.true;

            // Check console.log was used as fallback
            expect(consoleStub.log.calledWith('Invalid log type "invalidType". Falling back to console.log. Message: Invalid log type')).to.be.true;

            // Check write to file
            const logFilePath = path.join(tempDir, 'app.log');
            const logContent = await fsPromises.readFile(logFilePath, 'utf-8');
            expect(logContent).to.match(/\[.*\] \[INVALIDTYPE\] Invalid log type\n/);
        });

        it('should handle messages without IDs gracefully', function () {
            // Attempt to log without an ID
            logger.info('This message lacks an ID');

            // Check console.error was called
            expect(consoleStub.error.calledWithMatch(/Log message must start with an ID/)).to.be.true;
        });
    });

    describe('Configuration Management', function () {
        it('should export log configuration to a JSON file', async function () {
            // Deactivate a log
            logger.deactivateLog('luid-12345678');

            await logger.exportLogConfig('exportedConfig.json');

            const exportedPath = path.join(tempDir, 'exportedConfig.json');
            const exportedContent = await fsPromises.readFile(exportedPath, 'utf-8');
            const exportedConfig = JSON.parse(exportedContent);

            expect(exportedConfig['luid-12345678']).to.deep.equal({
                active: false,
                file: 'src/app.js',
                line: 2,
                type: 'info',
                content: 'Starting application',
            });
            expect(exportedConfig['luid-87654321']).to.deep.equal({
                active: true,
                file: 'src/app.js',
                line: 3,
                type: 'error',
                content: 'An error occurred',
            });
        });

        it('should import log configuration from a JSON file', async function () {
            // Prepare an imported config
            const importedConfig = {
                'luid-12345678': { active: false },
                'luid-87654321': { active: false },
            };
            const importPath = path.join(tempDir, 'importConfig.json');
            await fsPromises.writeFile(importPath, JSON.stringify(importedConfig, null, 2), 'utf-8');

            await logger.importLogConfig('importConfig.json');

            expect(logger.logConfig['luid-12345678'].active).to.be.false;
            expect(logger.logConfig['luid-87654321'].active).to.be.false;
        });

        it('should handle invalid JSON during import gracefully', async function () {
            // Write invalid JSON
            const invalidPath = path.join(tempDir, 'invalidConfig.json');
            await fsPromises.writeFile(invalidPath, '{ invalidJson: ', 'utf-8');

            try {
                await logger.importLogConfig('invalidConfig.json');
                // If no error is thrown, fail the test
                expect.fail('Expected importLogConfig to throw an error for invalid JSON');
            } catch (error) {
                expect(error.message).to.match(/Invalid JSON in config file/);
                expect(consoleStub.error.calledWithMatch(/Error importing log config/)).to.be.true;
            }
        });

        it('should handle missing config file during import gracefully', async function () {
            try {
                await logger.importLogConfig('nonExistentConfig.json');
                expect.fail('Expected importLogConfig to throw an error for missing file');
            } catch (error) {
                expect(error.message).to.match(/Config file not found/);
                expect(consoleStub.error.calledWithMatch(/Error importing log config/)).to.be.true;
            }
        });
    });

    describe('File Scanning and Log ID Insertion', function () {
        it('should scan files and insert missing log IDs', async function () {
            // Modify app.js to remove log IDs
            await fsPromises.writeFile(path.join('/project/src/app.js'), `
                this.logger.info('luid-ae497133 Starting application');
                this.logger.error('luid-c5e53bd9 An error occurred');
            `, 'utf-8');

            // Stub generateUniqueId to return predictable IDs
            const generateIdStub = sinon.stub(logger, 'generateUniqueId');
            generateIdStub.onFirstCall().returns('luid-aaaaaaaa');
            generateIdStub.onSecondCall().returns('luid-bbbbbbbb');

            await logger.scanFilesAndSetMissingLogIDs();

            // Read the modified app.js
            const modifiedContent = await fsPromises.readFile(path.join('/project/src/app.js'), 'utf-8');
            expect(modifiedContent).to.include(`this.logger.info('luid-aaaaaaaa Starting application')`);
            expect(modifiedContent).to.include(`this.logger.error('luid-bbbbbbbb An error occurred')`);

            generateIdStub.restore();
        });

        it('should not insert duplicate log IDs if they already exist', async function () {
            await logger.scanFilesAndSetMissingLogIDs();

            // Read the original app.js
            const content = await fsPromises.readFile(path.join('/project/src/app.js'), 'utf-8');
            // Ensure IDs are not duplicated
            const occurrences = (content.match(/luid-12345678/g) || []).length;
            expect(occurrences).to.equal(1);
        });
    });

    describe('Activation and Deactivation of Logs', function () {
        it('should activate a specific log by ID', function () {
            // Initially, logs are active
            logger.deactivateLog('luid-12345678');
            expect(logger.logConfig['luid-12345678'].active).to.be.false;

            // Activate it
            logger.activateLog('luid-12345678');
            expect(logger.logConfig['luid-12345678'].active).to.be.true;
        });

        it('should warn when activating a non-existent log ID', function () {
            logger.activateLog('luid-nonexistent');
            expect(consoleStub.warn.calledWithMatch(/Log ID luid-nonexistent not found/)).to.be.true;
        });

        it('should deactivate a specific log by ID', function () {
            // Initially, logs are active
            logger.deactivateLog('luid-87654321');
            expect(logger.logConfig['luid-87654321'].active).to.be.false;
        });

        it('should warn when deactivating a non-existent log ID', function () {
            logger.deactivateLog('luid-nonexistent');
            expect(consoleStub.warn.calledWithMatch(/Log ID luid-nonexistent not found/)).to.be.true;
        });
    });

    describe('Synchronization of Configurations', function () {
        it('should synchronize configuration by scanning files and updating config', async function () {
            // Modify app.js to add a new log call
            await fsPromises.writeFile(path.join('/project/src/app.js'), `
                this.logger.info('luid-12345678 Starting application');
                this.logger.error('luid-87654321 An error occurred');
                this.logger.warn('luid-abcdef12 A warning message');
            `, 'utf-8');

            // Stub generateUniqueId to return a predictable ID
            const generateIdStub = sinon.stub(logger, 'generateUniqueId').returns('luid-abcdef12');

            await logger.syncConfig('config/defaultLogConfig.json');

            // Check that the new log ID is in the config
            expect(logger.logConfig['luid-abcdef12']).to.deep.include({
                active: true,
                file: 'src/app.js',
                line: 4,
                type: 'warn',
                content: 'A warning message',
            });

            // Check that existing log IDs are retained
            expect(logger.logConfig['luid-12345678']).to.deep.include({
                active: true,
                file: 'src/app.js',
                line: 2,
                type: 'info',
                content: 'Starting application',
            });

            expect(logger.logConfig['luid-87654321']).to.deep.include({
                active: true,
                file: 'src/app.js',
                line: 3,
                type: 'error',
                content: 'An error occurred',
            });

            // Check that the config file is exported
            const exportedPath = path.join(tempDir, 'config/defaultLogConfig.json');
            const exportedConfig = JSON.parse(await fsPromises.readFile(exportedPath, 'utf-8'));
            expect(exportedConfig).to.have.property('luid-abcdef12');
            expect(exportedConfig['luid-abcdef12']).to.include({
                active: true,
                file: 'src/app.js',
                line: 4,
                type: 'warn',
                content: 'A warning message',
            });

            // Check that diffs are written
            const diffsPath = path.join(tempDir, 'log-config-diffs.json');
            const diffsContent = await fsPromises.readFile(diffsPath, 'utf-8');
            const diffs = JSON.parse(diffsContent);
            expect(diffs).to.be.an('array').that.is.not.empty;
            const latestDiff = diffs[diffs.length - 1];
            expect(latestDiff.diffs).to.deep.include({
                id: 'luid-abcdef12',
                action: 'added',
                newValue: {
                    active: true,
                    file: 'src/app.js',
                    line: 4,
                    type: 'warn',
                    content: 'A warning message',
                },
            });

            generateIdStub.restore();
        });

        it('should update config when log content changes', async function () {
            // Modify app.js to change a log message
            await fsPromises.writeFile(path.join('/project/src/app.js'), `
                this.logger.info('luid-12345678 Starting application v2');
                this.logger.error('luid-87654321 An error occurred');
            `, 'utf-8');

            await logger.syncConfig('config/defaultLogConfig.json');

            // Check that the content is updated in the config
            expect(logger.logConfig['luid-12345678'].content).to.equal('Starting application v2');

            // Check that diffs are written
            const diffsPath = path.join(tempDir, 'log-config-diffs.json');
            const diffsContent = await fsPromises.readFile(diffsPath, 'utf-8');
            const diffs = JSON.parse(diffsContent);
            expect(diffs).to.be.an('array').that.is.not.empty;
            const latestDiff = diffs[diffs.length - 1];
            expect(latestDiff.diffs).to.deep.include({
                id: 'luid-12345678',
                action: 'updated',
                changes: {
                    content: {
                        oldValue: 'Starting application',
                        newValue: 'Starting application v2',
                    },
                },
            });
        });
    });

    describe('Shutdown Process', function () {
        it('should close the log stream gracefully on shutdown', async function () {
            const endSpy = sinon.spy(logger.logStream, 'end');

            // Simulate shutdown
            logger.shutdown();

            expect(endSpy.calledOnce).to.be.true;
            expect(consoleStub.log.calledWithMatch(/Closed log stream/)).to.be.true;
        });

        it('should handle process exit signals', function () {
            const shutdownSpy = sinon.spy(logger, 'shutdown');
            const exitStub = sinon.stub(process, 'exit');

            // Emit SIGINT
            process.emit('SIGINT');

            expect(shutdownSpy.calledOnce).to.be.true;

            // Emit SIGTERM
            process.emit('SIGTERM');

            expect(shutdownSpy.calledTwice).to.be.true;

            // Emit exit
            process.emit('exit');

            expect(shutdownSpy.calledThrice).to.be.true;

            exitStub.restore();
        });
    });
});
