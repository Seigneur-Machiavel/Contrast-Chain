// Logger.js

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import util from 'util';
import { createStream } from 'rotating-file-stream'; // Corrected named import
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';


const colors = {
    reset: '\x1b[0m',
    
    // Base colors (more muted, like Neovim defaults)
    red: '\x1b[38;2;234;105;98m',      // Soft red
    green: '\x1b[38;2;152;187;108m',   // Sage green
    yellow: '\x1b[38;2;215;153;33m',   // Warm yellow
    blue: '\x1b[38;2;69;133;136m',     // Muted blue
    magenta: '\x1b[38;2;177;98;134m',  // Soft purple
    cyan: '\x1b[38;2;104;157;106m',    // Forest cyan
    
    // Bright variants
    brightRed: '\x1b[38;2;251;73;52m',    // Vibrant red
    brightGreen: '\x1b[38;2;184;187;38m',  // Lime green
    brightYellow: '\x1b[38;2;250;189;47m', // Bright yellow
    brightBlue: '\x1b[38;2;131;165;152m',  // Sky blue
    brightMagenta: '\x1b[38;2;88;24;69m', // Bright purple
    brightCyan: '\x1b[38;2;142;192;124m',    // Bright cyan
};

class Logger {
    /**
     * Creates an instance of Logger.
     * @param {number} idLength - Number of characters to extract as log ID.
     * @param {Object} options - Configuration options.
     * @param {string} [options.logDirectory] - Directory where log files will be stored.
     * @param {string} [options.logFileName] - Base name of the log file.
     * @param {string} [options.rotationInterval] - Log rotation interval (e.g., '1d' for daily).
     * @param {number} [options.maxFiles] - Maximum number of rotated log files to keep.
     * @param {string} [options.compress] - Compression method for rotated files (e.g., 'gzip').
     * @param {string} [options.projectRoot] - Root directory of the project.
     */
    constructor(idLength = 8, options = {}) {
        this.lastLogId = 0;
        this.logCalls = [];
        this.logConfig = {};
        this.idLength = idLength;

        // Project root detection
        this.projectRoot = options.projectRoot || this.findProjectRoot();

        // Logging options with defaults
        const {
            logDirectory = path.join(this.projectRoot, 'logs'),
            logFileName = 'app.log',
            rotationInterval = '1d',
            maxFiles = 30,
            compress = 'gzip',
        } = options;

        this.logDirectory = logDirectory;
        this.logFileName = logFileName;
        this.rotationInterval = rotationInterval;
        this.maxFiles = maxFiles;
        this.compress = compress;

        // Ensure log directory exists
        this.ensureLogDirectory();

        // Initialize rotating write stream
        this.initializeLogStream();

        // Handle process exit for graceful shutdown
        this.handleProcessExit();
    }

    /**
     * Get color for log type
     * @param {string} type - The type of log
     * @returns {string} - ANSI color code
     */
    getColorForType(type) {
        const colorMap = {
            debug: colors.cyan,
            info: colors.white,
            warn: colors.yellow,
            error: colors.red,
            trace: colors.magenta,
            log: colors.blue,
            important: colors.brightMagenta,
        };
        return colorMap[type] || '';
    }

    /**
     * Initializes the logger by synchronizing configurations.
     */
    async initializeLogger() {
        await this.syncConfig('storage/logConfig.json');
    }
    /**
     * Initializes the logger by loading configuration from a specified JSON file.
     * @param {string} configFilePath - Path to the configuration file.
     */
    async initializeLoggerFromFile(configFilePath = 'storage/logConfig.json') {
        try {
            const resolvedPath = path.isAbsolute(configFilePath)
                ? configFilePath
                : path.resolve(this.projectRoot, configFilePath);

            if (!existsSync(resolvedPath)) {
                console.warn(`Configuration file not found at ${resolvedPath}. Proceeding with empty configuration.`);
                this.logConfig = {};
                return;
            }

            const configContent = await fsPromises.readFile(resolvedPath, 'utf-8');
            this.logConfig = JSON.parse(configContent);
            console.log(`Log configuration loaded from ${resolvedPath}`);
        } catch (error) {
            console.error(`Failed to load log configuration from ${configFilePath}:`, error);
            throw error;
        }
    }
    /**
     * Finds the project root by locating the nearest package.json
     * Starts searching from the current working directory upwards
     * @returns {string} - Path to the project root
     */
    findProjectRoot() {
        let currentDir = process.cwd();
        while (currentDir !== path.parse(currentDir).root) {
            const packageJsonPath = path.join(currentDir, 'package.json');
            if (existsSync(packageJsonPath)) {
                return currentDir;
            }
            currentDir = path.dirname(currentDir);
        }
        console.warn("Could not find project root. Using current working directory.");
        return process.cwd();
    }

    /**
     * Ensures that the log directory exists; if not, creates it.
     */
    ensureLogDirectory() {
        if (!existsSync(this.logDirectory)) {
            try {
                mkdirSync(this.logDirectory, { recursive: true });
                console.log(`Created log directory at ${this.logDirectory}`);
            } catch (error) {
                console.error(`Failed to create log directory at ${this.logDirectory}:`, error);
                throw error;
            }
        }
    }

    /**
     * Initializes the rotating write stream for logging
     */
    initializeLogStream() {
        try {
            this.logStream = createStream(this.logFileName, {
                interval: this.rotationInterval, // e.g., '1d' for daily rotation
                path: this.logDirectory,
                maxFiles: this.maxFiles,
                compress: this.compress, // 'gzip' to compress rotated files
                // size: '10M', // Optional: Rotate based on size
                // initialRotation: true, // Optional: Rotate on startup
            });

            this.logStream.on('error', (err) => {
                console.error(`Error writing to log file ${this.logFileName}:`, err);
            });

            console.log(`Logging to file: ${path.join(this.logDirectory, this.logFileName)}`);
        } catch (error) {
            console.error(`Failed to initialize log stream:`, error);
            throw error;
        }
    }

    /**
     * Closes the write stream gracefully
     */
    closeLogStream() {
        if (this.logStream) {
            this.logStream.end(() => {
                console.log(`Closed log stream for ${this.logFileName}`);
            });
        }
    }

    /**
     * Handles process exit signals to ensure graceful shutdown of log streams
     */
    handleProcessExit() {
        const shutdown = () => {
            this.shutdown();
            process.exit();
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        process.on('exit', () => {
            this.shutdown();
        });
    }
    /**
      * Formats the log message for console output with colors
      * @param {string} type - Log type (e.g., info, error)
      * @param {string} message - Log message
      * @returns {string} - Formatted colored log string
      */
    formatConsoleLog(type, message) {
        const color = this.getColorForType(type);

        if( type=== 'important') {
            return `${color}["!"]${colors.reset} ${message}`;
        }
        return `${color}[${type.toUpperCase()}]${colors.reset} ${message}`;
    }

    /**
     * Formats the log message for file output (without colors)
     * @param {string} type - Log type (e.g., info, error)
     * @param {string} message - Log message
     * @returns {string} - Formatted log string
     */
    formatFileLog(type, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    }

    /**
     * Writes a log message to the rotating log file
     * @param {string} type - Log type
     * @param {string} message - Log message
     */
    writeToFile(type, message) {
        if (this.logStream && !this.logStream.destroyed) {
            const timestamp = new Date().toISOString();
            const formattedMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
            this.logStream.write(formattedMessage);
        } else {
            console.warn(`Log stream is not writable. Message not logged to file: ${message}`);
        }
    }
        
    /**
     * Logs data based on the type and configuration
     * @param {string} type - The type of log (e.g., info, error)
     * @param {string} message - The message to log (first X characters as ID)
     * @param {...any} args - Optional additional data objects to log
     */
    dolog(type, message, ...args) {
        if (typeof message !== 'string') {
            console.error('Logger expects the second argument to be a string message. but got:', message);
            return;
        }

        const { id, content } = this.extractIdAndContent(message);
        if (!id) {
            console.error(`Log message must start with an ID in the format 'luid-XXXX'.`);
            return;
        }

        if (!this.logConfig[id]) {
            this.logConfig[id] = {
                active: true,
                type,
                content
            };
        }

        if (this.logConfig[id].active) {
            // Base message
            let consoleMessage = content;
            let fileMessage = content;

            // Add serialized arguments if any
            if (args.length > 0) {
                consoleMessage += ' ' + this.serializeArgs(args, true);  // With colors for console
                fileMessage += ' ' + this.serializeArgs(args, false);    // Without colors for file
            }
            let callerLine = '';
            if (this.logConfig[id] && this.logConfig[id].file && this.logConfig[id].line) {
                callerLine = ` (${this.logConfig[id].file}:${this.logConfig[id].line})`;
            }
            // Log to console with colors
            const formattedMessage = this.formatConsoleLog(type, consoleMessage);
            console.log(formattedMessage + callerLine);

            // Write to file without colors
            this.writeToFile(type, fileMessage);
        }
    }
    /**
 * Serializes arguments differently for console and file output
 * @param {Array} args - Arguments to serialize
 * @param {boolean} withColors - Whether to include colors in the output
 * @returns {string} - Serialized arguments
 */
    serializeArgs(args, withColors = false) {
        return args.map(arg => {
            if (typeof arg === 'object') {
                return util.inspect(arg, {
                    depth: null,
                    colors: withColors,
                    compact: true
                });
            }
            return String(arg);
        }).join(' ');
    }
    /**
     * Formats the log message
     * @param {string} type - Log type (e.g., info, error)
     * @param {string} message - Log message
     * @returns {string} - Formatted log string
     */
    formatLog(type, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    }

    /**
     * Formats the log message as a structured JSON object
     * @param {string} type - Log type (e.g., info, error)
     * @param {string} message - Log message
     * @returns {string} - Formatted JSON log string
     */
    formatStructuredJson(type, message) {
        const timestamp = new Date().toISOString();
        const logObject = {
            timestamp,
            type: type.toUpperCase(),
            message,
        };
        return JSON.stringify(logObject) + '\n';
    }

    /**
     * Call this method when your application is shutting down to ensure logs are flushed
     */
    shutdown() {
        this.closeLogStream();
    }

    /**
     * Generates a unique ID of the specified length
     * @returns {string} - The generated ID
     */
    generateUniqueId() {
        return 'luid-' + crypto.randomBytes(Math.ceil(this.idLength / 2)).toString('hex').slice(0, this.idLength);
    }

    /**
     * Scans files and sets missing log IDs by modifying the source files
     * @param {string} directory - The directory to scan
     */
    async scanFilesAndSetMissingLogIDs(directory = this.projectRoot) {
        try {
            const entries = await fsPromises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    // Skip node_modules and hidden directories for efficiency
                    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
                        continue;
                    }
                    await this.scanFilesAndSetMissingLogIDs(fullPath); // Recursive scan
                } else if (entry.isFile() && this.isLoggableFile(entry.name)) {
                    const content = await fsPromises.readFile(fullPath, 'utf-8');
                    let modifiedContent = content;
                    let modified = false;

                    // Regex to match logger method calls
                    const logPattern = /this\.logger\.(log|info|warn|error|debug|trace|important)\(\s*(['"`])([\s\S]*?)\2\s*(,\s*[\s\S]*?)?\)/g;
                    let match;
                    while ((match = logPattern.exec(content)) !== null) {
                        const fullMatch = match[0];
                        const method = match[1];
                        const quote = match[2];
                        const message = match[3];
                        const extraArgs = match[4] || ''; // includes comma if present

                        // Check if message starts with an existing ID
                        const idPattern = new RegExp(`^luid-[0-9a-fA-F]{${this.idLength}}`);
                        const idMatch = message.match(idPattern);

                        if (!idMatch) {
                            // Generate a new ID
                            const newId = this.generateUniqueId();
                            const newMessage = newId + ' ' + message;
                            // Build the new full match
                            const newFullMatch = `this.logger.${method}(${quote}${newMessage}${quote}${extraArgs})`;
                            // Replace in the modifiedContent
                            modifiedContent = modifiedContent.replace(fullMatch, newFullMatch);
                            modified = true;
                        }
                    }

                    if (modified) {
                        // Write back to the file
                        await fsPromises.writeFile(fullPath, modifiedContent, 'utf-8');
                        console.log(`Updated log IDs in file: ${fullPath}`);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to scan files during Logger initialization:', error);
            throw error; // Re-throw the error for better error handling
        }
    }

    /**
     * Recursively scans files in the given directory for log calls
     * @param {string} directory - The directory to scan
     */
    async scanFiles(directory = this.projectRoot) {
        try {
            const entries = await fsPromises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
                        continue;
                    }
                    await this.scanFiles(fullPath); // Recursive scan
                } else if (entry.isFile() && this.isLoggableFile(entry.name)) {
                    //console.log(`Scanning file: ${fullPath}`);
                    const content = await fsPromises.readFile(fullPath, 'utf-8');
                    const relativePath = path.relative(this.projectRoot, fullPath);
                    this.extractLogCalls(content, relativePath);
                }
            }
            this.initializeLogConfig();
        } catch (error) {
            console.error(`Error scanning files in directory ${directory}:`, error);
            throw error;
        }
    }

    /**
     * Determines if a file is loggable based on its extension
     * @param {string} fileName - The name of the file
     * @returns {boolean} - True if the file should be scanned for log calls
     */
    isLoggableFile(fileName) {
        const loggableExtensions = ['.js', '.mjs', '.cjs', '.ts'];
        return loggableExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * Extracts log calls from the file content by scanning each line
     * @param {string} content - The content of the file
     * @param {string} fileName - The name of the file
     */
    extractLogCalls(content, fileName) {
        const lines = content.split('\n');
        // Updated regex to match logger method calls with optional additional arguments
        const logPattern = new RegExp(
            `this\\.logger\\.(log|info|warn|error|debug|trace|important)\\(\\s*(['"\`])(luid-[0-9a-fA-F]{${this.idLength}})\\s([\\s\\S]*?)\\2\\s*(,\\s*[^)]+)?\\)`,
            'g'
        );
        lines.forEach((line, index) => {
            let match;
            while ((match = logPattern.exec(line)) !== null) {
                const type = match[1];
                const id = match[3];
                const messageContent = match[4]; // Preserved without trimming
                // Additional arguments are in match[5] but are not needed for config

                const fullMessage = id + ' ' + messageContent; // Combine ID and message

                // Validate 'type' before adding to logCalls
                if (['log', 'info', 'warn', 'error', 'debug', 'trace', 'important'].includes(type)) {
                    this.logCalls.push({
                        id,
                        file: fileName,
                        line: index + 1,
                        type,
                        content: fullMessage
                    });
                } else {
                    console.warn(`Invalid log type "${type}" found in ${fileName} at line ${index + 1}.`);
                }
            }
        });
    }

    /**
     * Initializes the log configuration with default active logs
     */
    initializeLogConfig() {
        this.logCalls.forEach(log => {
            if (!this.logConfig[log.id]) { // Avoid overwriting existing config
                this.logConfig[log.id] = {
                    active: true,
                    file: log.file,
                    line: log.line,
                    type: log.type,
                    content: log.content
                };
            } else {
                // **Newly Added Code to Handle Content Changes**
                // If the log ID exists but the content has changed, update the content in the config
                if (this.logConfig[log.id].content !== log.content) {
                    //console.log(`Content change detected for Log ID ${log.id}. Updating configuration.`);
                    this.logConfig[log.id].content = log.content;
                }
            }
        });
    }

    /**
     * Retrieves all log calls
     * @returns {Array} - Array of log call objects
     */
    getLogCalls() {
        return this.logCalls;
    }

    /**
     * Groups log calls by their respective files
     * @returns {Object} - An object with file names as keys and arrays of log calls as values
     */
    getLogsByFile() {
        return this.logCalls.reduce((acc, log) => {
            if (!acc[log.file]) {
                acc[log.file] = [];
            }
            acc[log.file].push(log);
            return acc;
        }, {});
    }

    /**
     * Activates a specific log by its ID
     * @param {string} id - The unique ID of the log
     */
    activateLog(id) {
        if (this.logConfig[id]) {
            this.logConfig[id] = { ...this.logConfig[id], active: true };
        } else {
            console.warn(`Log ID ${id} not found.`);
        }
    }

    /**
     * Deactivates a specific log by its ID
     * @param {string} id - The unique ID of the log
     */
    deactivateLog(id) {
        if (this.logConfig[id]) {
            this.logConfig[id] = { ...this.logConfig[id], active: false };
        } else {
            console.warn(`Log ID ${id} not found.`);
        }
    }

    /**
     * Exports the current log configuration to a JSON file
     * @param {string} filePath - The path to the export file
     */
    async exportLogConfig(filePath) {
        try {
            const resolvedPath = path.isAbsolute(filePath)
                ? filePath
                : path.resolve(this.projectRoot, filePath);
            await fsPromises.writeFile(resolvedPath, JSON.stringify(this.logConfig, null, 2), 'utf-8');
            console.log(`Log configuration exported to ${resolvedPath}`);
        } catch (error) {
            console.error(`Failed to export log configuration to ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Imports a log configuration from a JSON file
     * @param {string} filePath - The path to the import file
     */
    async importLogConfig(filePath) {
        try {
            // Resolve the file path relative to project root
            const resolvedPath = path.isAbsolute(filePath)
                ? filePath
                : path.resolve(this.projectRoot, filePath);

            console.warn("Attempting to read config from:", resolvedPath);

            // Check if the file exists
            if (!existsSync(resolvedPath)) {
                throw new Error(`Config file not found at ${resolvedPath}`);
            }

            // Read and parse the config file
            const configContent = await fsPromises.readFile(resolvedPath, 'utf-8');

            try {
                const importedConfig = JSON.parse(configContent);
                // Merge imported config with existing config
                this.logConfig = { ...this.logConfig, ...importedConfig };
                console.log(`Log configuration imported from ${resolvedPath}`);
            } catch (error) {
                throw new Error(`Invalid JSON in config file: ${error.message}`);
            }

        } catch (error) {
            console.error("Error importing log config:", error.message);
            throw error; // Re-throw the error for the caller to handle
        }
    }

    /**
     * Extracts the ID and content from the log message
     * @param {string} message - The log message
     * @returns {Object} - An object containing the ID and the content
     */
    extractIdAndContent(message) {
        const idPattern = new RegExp(`^(luid-[0-9a-fA-F]{${this.idLength}})\\s`);
        const match = message.match(idPattern);
        if (match) {
            const id = match[1];
            const content = message.substring(match[0].length); // Exclude ID and following space
            return { id, content };
        } else {
            return { id: null, content: message };
        }
    }

    /**
     * Synchronizes the log configuration by reading existing config, scanning files,
     * updating log calls, computing diffs, and writing updates and diffs.
     * @param {string} configFilePath - Path to the configuration file
     */
    async syncConfig(configFilePath) {
        try {
            // Resolve the config file path relative to project root if not absolute
            const resolvedConfigPath = path.isAbsolute(configFilePath)
                ? configFilePath
                : path.resolve(this.projectRoot, configFilePath);

            let existingConfig = {};

            // Check if the config file exists
            if (existsSync(resolvedConfigPath)) {
                // Read and parse the existing config file
                const configContent = await fsPromises.readFile(resolvedConfigPath, 'utf-8');
                try {
                    existingConfig = JSON.parse(configContent);
                } catch (parseError) {
                    throw new Error(`Invalid JSON in configuration file: ${parseError.message}`);
                }
            } else {
                console.warn(`Configuration file not found at ${resolvedConfigPath}. Proceeding with empty configuration.`);
            }

            // Ensure log calls are up-to-date by scanning files and adding missing IDs
            await this.scanFilesAndSetMissingLogIDs();

            // Now rescan files to update this.logCalls with the new IDs
            await this.scanFiles();

            const currentLogCalls = this.logCalls;
            const updatedConfig = {};

            // Retain existing configurations for current log calls
            currentLogCalls.forEach(log => {
                if (existingConfig[log.id]) {
                    // **Modified Code to Handle Content Changes**
                    if (existingConfig[log.id].content !== log.content) {
                        // Content has changed; retain ID but update content in config
                        updatedConfig[log.id] = {
                            ...existingConfig[log.id],
                            content: log.content, // Update with new content
                            file: log.file, // Optionally update file reference
                            line: log.line, // Optionally update line number
                            type: log.type, // Optionally update type if necessary
                        };
                        console.log(`Updated content for Log ID ${log.id} in configuration.`);
                    } else {
                        // No change in content; retain existing config
                        updatedConfig[log.id] = existingConfig[log.id];
                    }
                } else {
                    // Add new log call with default configuration
                    updatedConfig[log.id] = {
                        active: true,
                        file: log.file,
                        line: log.line,
                        type: log.type,
                        content: log.content
                    };
                }
            });

            // Identify and remove obsolete log entries (those not in current log calls)
            const obsoleteLogIds = Object.keys(existingConfig).filter(id => !updatedConfig[id]);
            if (obsoleteLogIds.length > 0) {
                console.log(`Removing obsolete log entries: ${obsoleteLogIds.join(', ')}`);
            }

            // Compute diffs between existingConfig and updatedConfig
            const diffs = this.computeDiffs(existingConfig, updatedConfig);

            // Update the internal log configuration
            this.logConfig = updatedConfig;

            // Export the updated configuration back to the config file
            await this.exportLogConfig(resolvedConfigPath);

            // Write diffs to the diffs file
            await this.writeDiffsToFile(diffs);

            console.log('Log configuration synchronized successfully.');
        } catch (error) {
            console.error('Failed to synchronize log configuration:', error.message);
            throw error; // Re-throw the error for the caller to handle if necessary
        }
    }

    /**
     * Computes the differences between two configurations.
     * @param {Object} existingConfig - The existing configuration.
     * @param {Object} updatedConfig - The updated configuration.
     * @returns {Array} - An array of diff objects.
     */
    computeDiffs(existingConfig, updatedConfig) {
        const diffs = [];

        // Check for added and updated logs
        for (const id in updatedConfig) {
            if (!existingConfig.hasOwnProperty(id)) {
                // Added
                diffs.push({
                    id,
                    action: 'added',
                    newValue: updatedConfig[id],
                });
            } else {
                // Possibly updated
                const existingLog = existingConfig[id];
                const updatedLog = updatedConfig[id];

                const changes = {};

                // Compare each property
                for (const key in updatedLog) {
                    if (JSON.stringify(updatedLog[key]) !== JSON.stringify(existingLog[key])) {
                        changes[key] = {
                            oldValue: existingLog[key],
                            newValue: updatedLog[key],
                        };
                    }
                }

                if (Object.keys(changes).length > 0) {
                    diffs.push({
                        id,
                        action: 'updated',
                        changes,
                    });
                }
            }
        }

        // Check for removed logs
        for (const id in existingConfig) {
            if (!updatedConfig.hasOwnProperty(id)) {
                // Removed
                diffs.push({
                    id,
                    action: 'removed',
                    oldValue: existingConfig[id],
                });
            }
        }

        return diffs;
    }

    /**
     * Writes the computed diffs to a diffs file.
     * @param {Array} diffs - The diffs to write.
     */
    async writeDiffsToFile(diffs) {
        try {
            const diffsFilePath = path.join(this.logDirectory, 'log-config-diffs.json');
            let existingDiffs = [];

            // Check if the diffs file exists
            if (existsSync(diffsFilePath)) {
                const diffsContent = await fsPromises.readFile(diffsFilePath, 'utf-8');
                try {
                    existingDiffs = JSON.parse(diffsContent);
                } catch (parseError) {
                    console.warn(`Invalid JSON in diffs file. Overwriting with new diffs.`);
                    existingDiffs = [];
                }
            }

            // Add timestamp to diffs
            const timestamp = new Date().toISOString();
            const diffsWithTimestamp = {
                timestamp,
                diffs,
            };

            existingDiffs.push(diffsWithTimestamp);

            // Write back to file
            await fsPromises.writeFile(diffsFilePath, JSON.stringify(existingDiffs, null, 2), 'utf-8');
            console.log(`Diffs written to ${diffsFilePath}`);
        } catch (error) {
            console.error('Failed to write diffs to file:', error.message);
            throw error;
        }
    }

    // Convenience methods for different log types
    important(message, ...args) { this.dolog('important', message, ...args); }
    debug(message, ...args) { this.dolog('debug', message, ...args); }
    info(message, ...args) { this.dolog('info', message, ...args); }
    warn(message, ...args) { this.dolog('warn', message, ...args); }
    error(message, ...args) { this.dolog('error', message, ...args); }
    trace(message, ...args) { this.dolog('trace', message, ...args); }
    log(message, ...args) { this.dolog('log', message, ...args); }
}

export default Logger;
export { Logger };
