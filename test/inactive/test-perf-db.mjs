import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import fs from 'fs-extra';

async function testLevelDBWritePerformance() {
    const dbPath = './test-leveldb';
    const totalEntries = 50000; // 5,000 entries for testing

    // Ensure the database directory is clean
    await fs.remove(dbPath);

    // **Create Entries Once**
    const entries = [];
    for (let i = 0; i < totalEntries; i++) {
        const key = `key-${i}`;
        const value = crypto.randomBytes(32).toString('hex'); // 64-character hex string
        entries.push({ key, value });
    }

    // **Test 1: Batch Writes**
    const dbBatch = LevelUp(LevelDown(dbPath));
    const batchSize = 50000; // Number of entries per batch

    console.log(`\nStarting batch write of ${totalEntries} entries to LevelDB...`);

    const batchStartTime = performance.now();

    for (let i = 0; i < totalEntries; i += batchSize) {
        const batch = dbBatch.batch();
        for (let j = 0; j < batchSize && (i + j) < totalEntries; j++) {
            const { key, value } = entries[i + j];
            batch.put(key, value);
        }
        await batch.write();
    }

    const batchEndTime = performance.now();
    const batchTotalSeconds = (batchEndTime - batchStartTime) / 1000;

    console.log(`Batch write completed: ${totalEntries} entries in ${batchTotalSeconds.toFixed(3)} seconds.`);

    await dbBatch.close();

    // **Test 2: Individual Writes (One by One)**
    await fs.remove(dbPath); // Remove existing data
    const dbIndividual = LevelUp(LevelDown(dbPath));

    console.log(`\nStarting individual write of ${totalEntries} entries to LevelDB...`);

    const individualStartTime = performance.now();

    for (let i = 0; i < totalEntries; i++) {
        const { key, value } = entries[i];
        await dbIndividual.put(key, value);
    }

    const individualEndTime = performance.now();
    const individualTotalSeconds = (individualEndTime - individualStartTime) / 1000;

    console.log(`Individual write completed: ${totalEntries} entries in ${individualTotalSeconds.toFixed(3)} seconds.`);

    await dbIndividual.close();

    // **Test 3: Concurrent Writes with Promises**
    await fs.remove(dbPath); // Remove existing data
    const dbConcurrent = LevelUp(LevelDown(dbPath));

    console.log(`\nStarting concurrent write of ${totalEntries} entries to LevelDB without concurrency limit...`);

    const concurrentStartTime = performance.now();

    const writePromises = entries.map(({ key, value }, index) => {
        return dbConcurrent.put(key, value).then(() => {

        }).catch((error) => {
            console.error('Error during concurrent write:', error);
        });
    });

    await Promise.all(writePromises);

    const concurrentEndTime = performance.now();
    const concurrentTotalSeconds = (concurrentEndTime - concurrentStartTime) / 1000;

    console.log(`Concurrent write completed: ${totalEntries} entries in ${concurrentTotalSeconds.toFixed(3)} seconds.`);

    await dbConcurrent.close();

    // Test 4: Concurrent Writes with Promises
    await fs.remove(dbPath); // Remove existing data
    const dbBatchOps = LevelUp(LevelDown(dbPath));

    const batchOpsStartTime = performance.now();
    const ops = entries.map(({ key, value }) => ({ type: 'put', key, value }));

    const dbBatchOpsResolved = new Promise((resolve, reject) => {
        dbBatchOps.batch(ops, function (err) {
            if (err) return console.log('Ooops!', err) // some kind of I/O error
            console.log('Great success dear leader!')
            resolve();
        });
    });
    console.log(`\nStarting batch write of ${ totalEntries } entries to LevelDB using batch operations...`);
    await dbBatchOpsResolved;
    const dbBatchOpsEndTime = performance.now();
    const dbBatchOpsTotalSeconds = (dbBatchOpsEndTime - batchOpsStartTime) / 1000;
    console.log(`dbBatchOps write completed: ${totalEntries} entries in ${dbBatchOpsTotalSeconds.toFixed(3)} seconds.`);

    await dbBatchOps.close();
    await fs.remove(dbPath); // Remove existing data
}

testLevelDBWritePerformance().catch((error) => {
    console.error('Error during LevelDB write test:', error);
});
