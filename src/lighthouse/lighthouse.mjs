import express from 'express';

export class LighthouseServer {
    constructor(port = 3001, logger) {
        this.app = express();
        this.port = port;
        this.latestVersion = '1.2.0';
        this.server = null;
        this.logger = logger;
        
        // Setup routes
        this.setupRoutes();
    }

    setupRoutes() {
        this.app.get('/latest-version', (req, res) => {
            res.json({ latestVersion: this.latestVersion });
        });
        
        // Add basic health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy', uptime: process.uptime() });
        });
    }

    start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    this.logger.important(`luid-a362440e Lighthouse server running on port ${this.port}`);
                    this.logger.important(`luid-f9996990 Latest version available: ${this.latestVersion}`);
                    resolve(this.server);
                });

                this.server.on('error', (error) => {
                    if (error.code === 'EADDRINUSE') {
                        reject(new Error(`Port ${this.port} is already in use`));
                    } else {
                        reject(error);
                    }
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('Lighthouse server stopped');
                    resolve();
                });
            });
        }
    }
}