// test/loggerSyncConfig.test.mjs

import { expect } from 'chai';
import path from 'path';
import { promises as fs } from 'fs'; // Import fs.promises as fs
import os from 'os';

import Logger from '../../src/logger.mjs'; // Adjust the path to your Logger.js file

describe('Logger Sync Configuration Tests', function () {
    this.timeout(20000); // Increase timeout if necessary

    let logger;
    let tempDir;
    let srcDir;
    let configDir;
    const configFileName = 'defaultLogConfig.json';
    let configFilePath;

    before(async function () {
        // Create a temporary directory for the test
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));
        console.log(`Temporary directory created at: ${tempDir}`);

        // Create 'src' and 'config' directories inside tempDir
        srcDir = path.join(tempDir, 'src');
        await fs.mkdir(srcDir);
        console.log(`Source directory created at: ${srcDir}`);

        configDir = path.join(tempDir, 'config');
        await fs.mkdir(configDir);
        console.log(`Config directory created at: ${configDir}`);

        // Set the path for the configuration file
        configFilePath = path.join(configDir, configFileName);

        // Create sample source files in srcDir

        // File 1: Contains a logger call without an ID
        const file1Path = path.join(srcDir, 'file1.js');
        const file1Content = `
            class TestClass1 {
                constructor() {
                    this.logger = new Logger();
                }
                testMethod() {
                    this.logger.info('luid-26a3359e This is a test log message without ID');
                }
            }
            export default TestClass1;
        `;
        await fs.writeFile(file1Path, file1Content, 'utf-8');
        console.log(`Created file1.js at: ${file1Path}`);

        // File 2: Contains a logger call with an existing ID
        const file2Path = path.join(srcDir, 'file2.js');
        const file2Content = `
            class TestClass2 {
                constructor() {
                    this.logger = new Logger();
                }
                testMethod() {
                    this.logger.error('luid-12345678 This is a test error message with ID');
                }
            }
            export default TestClass2;
        `;
        await fs.writeFile(file2Path, file2Content, 'utf-8');
        console.log(`Created file2.js at: ${file2Path}`);

        // Initialize the Logger with the temporary directory as the project root
        logger = new Logger(8, {
            projectRoot: tempDir, // Set projectRoot to tempDir
            logDirectory: configDir, // Use configDir for log files
            logFileName: 'application.log',
            rotationInterval: '1d', // Rotate daily
            maxFiles: 7,
            compress: 'gzip',
        });
    });

    after(async function () {
        // Shutdown the logger to ensure all logs are flushed
        await logger.shutdown();

        // Clean up the temporary directory and its contents
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
            console.log(`Temporary directory ${tempDir} removed.`);
        } catch (err) {
            console.error(`Error cleaning up temporary directory: ${err.message}`);
        }
    });

    it('should synchronize log configuration and update source files with missing IDs', async function () {
        // Wait for files to be fully written
        await fs.access(path.join(srcDir, 'file1.js'));
        await fs.access(path.join(srcDir, 'file2.js'));
        console.log('Confirmed that sample files exist.');

        // Call scanning methods
        await logger.scanFilesAndSetMissingLogIDs();
        await logger.syncConfig(configFilePath);

        // Verify that file1.js has been updated with an ID
        const file1Path = path.join(srcDir, 'file1.js');
        const updatedFile1Content = await fs.readFile(file1Path, 'utf-8');

        // Check that the logger call in file1.js now includes a generated ID
        const idPattern = /this\.logger\.info\(['"`](luid-[0-9a-fA-F]{8}) (.*?)['"`]\)/;
        const match = updatedFile1Content.match(idPattern);

        expect(match, 'ID was not added to file1.js').to.not.be.null;

        const generatedId = match[1];
        const logMessage = match[2];

        expect(generatedId, 'Generated ID format is incorrect').to.match(/luid-[0-9a-fA-F]{8}/);
        expect(logMessage, 'Log message content is incorrect').to.equal('This is a test log message without ID');

        // Read and parse the log configuration file
        const configContent = await fs.readFile(configFilePath, 'utf-8');
        const config = JSON.parse(configContent);
        console.log('Configuration file contents:', config);
        // The configuration should contain entries for both log calls
        const logIds = Object.keys(config);
        expect(logIds.length, 'Configuration should contain two log IDs').to.equal(2);

        // Verify that both IDs are present in the configuration
        expect(config).to.have.property(generatedId);
        expect(config).to.have.property('luid-12345678');

        // Modify file2.js to remove the logger call
        const file2Path = path.join(srcDir, 'file2.js');
        const modifiedFile2Content = `
            class TestClass2 {
                constructor() {
                    this.logger = new Logger();
                }
                testMethod() {
                    // Logger call has been removed
                }
            }
            export default TestClass2;
        `;
        await fs.writeFile(file2Path, modifiedFile2Content, 'utf-8');

        // Call syncConfig again to update the configuration
        await logger.syncConfig(configFilePath);

        // Read and parse the updated configuration file
        const updatedConfigContent = await fs.readFile(configFilePath, 'utf-8');
        const updatedConfig = JSON.parse(updatedConfigContent);

        // The configuration should now only contain one entry
        const updatedLogIds = Object.keys(updatedConfig);
        expect(updatedLogIds.length, 'Configuration should contain one log ID after removal').to.equal(1);

        // Verify that the configuration only contains the ID from file1.js
        expect(updatedConfig).to.have.property(generatedId);
        expect(updatedConfig, 'Configuration should not contain the removed ID').to.not.have.property('luid-12345678');

        // Activate the log and test logging
        logger.activateLog(generatedId);
        logger.info(`${generatedId} This is a test log message without ID`);

        // Verify that the log message was written to the log file
        const logFilePath = path.join(configDir, 'application.log');
        const logFileContent = await fs.readFile(logFilePath, 'utf-8');

        expect(logFileContent, 'Log file should contain the logged message').to.include('This is a test log message without ID');
    });
});
