// server.js
const express = require('express');
const LevelUp = require('levelup');
const LevelDown = require('leveldown');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// Adjust the database path as per your setup
const dbPath = path.join(__dirname, '../../databases/utxoDB-WWq1xYfZVC5dzJdULAfa');

// Initialize LevelDB
const db = LevelUp(LevelDown(dbPath));

// Initialize Express app
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

// API endpoint to get all UTXOs
app.get('/api/utxos', async (req, res) => {
    try {
        await db.open();
        console.log('Fetching UTXOs...' + db);
        const utxos = [];
        db.createReadStream()
            .on('data', function (data) {
                console.log('UTXO fetched:', data.key.toString(), data.value.toString());
                // Exclude special keys like 'totalSupply' and 'totalOfBalances'
                if (!['totalSupply', 'totalOfBalances'].includes(data.key.toString())) {
                    utxos.push({ key: data.key.toString(), value: data.value.toString() });
                }
            })
            .on('error', function (err) {
                console.error('Error reading stream:', err);
                res.status(500).send('Error reading from database');
            })
            .on('end', function () {  // Changed 'close' to 'end'
                console.log(`Finished reading UTXOs, total count: ${utxos.length}`);
                res.json(utxos);
            });
    } catch (error) {
        console.error('Error fetching UTXOs:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API endpoint to get UTXO by key (anchor)
app.get('/api/utxo/:anchor', async (req, res) => {
    console.log(`Fetching UTXO with anchor: ${req.params.anchor}`);
    const anchor = req.params.anchor;
    try {
        const value = await db.get(anchor);
        console.log('UTXO fetched:', anchor, value.toString());
        res.json({ key: anchor, value: value.toString() });
    } catch (error) {
        console.error('Error fetching UTXO:', error);
        res.status(404).send('UTXO not found');
    }
});

// API endpoint to get total supply and total of balances
app.get('/api/stats', async (req, res) => {
    try {
        const totalSupply = await db.get('totalSupply').catch(() => '0');
        const totalOfBalances = await db.get('totalOfBalances').catch(() => '0');
        res.json({
            totalSupply: parseFloat(totalSupply.toString()),
            totalOfBalances: parseFloat(totalOfBalances.toString()),
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Start the server
app.listen(port, () => {
    console.log(`UTXO viewer server is running at http://localhost:${port}`);
});
