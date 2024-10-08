import express from 'express';

const app = express();
const PORT = 3001;

// Hardcoded version - update this manually for each run
const latestVersion = '1.2.0'; // Example hardcoded version

// Endpoint to get the latest version
app.get('/latest-version', (req, res) => {
    res.json({ latestVersion });
});

// Function to start the lighthouse server
export function startLighthouseNode() {
    const server = app.listen(PORT, () => {
        console.log(`Lighthouse node is running on port ${PORT}`);
        console.log(`Latest version available: ${latestVersion}`);
    });

    // Handle 'error' event on the server
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Please use a different port.`);
        } else {
            console.error('An unexpected error occurred:', error);
        }
    });
}
