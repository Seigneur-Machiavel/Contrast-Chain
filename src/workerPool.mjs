// workerPool.mjs
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

class WorkerPool {
    /**
     * Creates a new WorkerPool.
     * @param {string} workerScript - Path to the worker script.
     * @param {number} poolSize - Number of worker threads in the pool.
     */
    constructor(workerScript, poolSize) {
        this.workerScript = workerScript;
        this.poolSize = poolSize;
        this.workers = [];
        this.idleWorkers = [];
        this.taskQueue = [];

        this._initPool();
    }

    /**
     * Initializes the worker pool by creating worker threads.
     */
    _initPool() {
        for (let i = 0; i < this.poolSize; i++) {
            this._addNewWorker();
        }
    }

    /**
     * Adds a new worker to the pool.
     */
    _addNewWorker() {
        const worker = new Worker(this.workerScript, {
            // Ensure the worker script is treated as an ES module
            type: 'module'
        });

        worker.on('message', (message) => {
            const { resolve, reject } = worker.currentTask;
            if (message.success) {
                resolve(message.result);
            } else {
                reject(new Error(message.error));
            }
            worker.currentTask = null;
            this.idleWorkers.push(worker);
            this._processQueue();
        });

        worker.on('error', (error) => {
            if (worker.currentTask) {
                worker.currentTask.reject(error);
                worker.currentTask = null;
            }
            // Remove the errored worker and add a new one
            this.workers = this.workers.filter(w => w !== worker);
            this._addNewWorker();
            this._processQueue();
        });

        worker.on('exit', (code) => {
            if (code !== 0 && worker.currentTask) {
                worker.currentTask.reject(new Error(`Worker stopped with exit code ${code}`));
            }
            // Remove the exited worker and add a new one
            this.workers = this.workers.filter(w => w !== worker);
            this._addNewWorker();
            this._processQueue();
        });

        this.workers.push(worker);
        this.idleWorkers.push(worker);
    }

    /**
     * Adds a task to the queue.
     * @param {Object} taskData - Data to send to the worker.
     * @returns {Promise<Object>} - Promise resolving with the worker's result.
     */
    runTask(taskData) {
        return new Promise((resolve, reject) => {
            const task = { taskData, resolve, reject };
            this.taskQueue.push(task);
            this._processQueue();
        });
    }

    /**
     * Processes the task queue, assigning tasks to idle workers.
     */
    _processQueue() {
        if (this.taskQueue.length === 0 || this.idleWorkers.length === 0) {
            return;
        }

        const worker = this.idleWorkers.pop();
        const task = this.taskQueue.shift();
        worker.currentTask = task;
        worker.postMessage(task.taskData);
    }

    /**
     * Shuts down all workers in the pool.
     * @returns {Promise<void>}
     */
    async shutdown() {
        await Promise.all(this.workers.map(worker => worker.terminate()));
        this.workers = [];
        this.idleWorkers = [];
        this.taskQueue = [];
    }
}

export default WorkerPool;
