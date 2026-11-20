'use strict';
// Tests that depend on validateXML starting a new worker. Its workers are kept
// for the next calls for the lifetime of the process, so each of these runs in
// a fresh process, started by test.js: node test/test-worker-reuse.js <test name>
const assert = require('assert').strict;
const workerThreads = require('worker_threads');
const xmllint = require('../index-node.js');

async function validate(options) {
	const {valid} = await xmllint.validateXML({xml: '<foo/>', normalization: 'format', ...options});
	assert.equal(valid, true);
}

// Records the workers that get started, until restore is called. Each has an
// exited Promise, and hasExited once it resolved.
function countWorkers() {
	const workers = [];
	const OriginalWorker = workerThreads.Worker;
	workerThreads.Worker = class extends OriginalWorker {
		constructor(...args) {
			super(...args);
			this.exited = new Promise((resolve) => this.once('exit', resolve));
			this.hasExited = false;
			this.exited.then(() => {
				this.hasExited = true;
			});
			workers.push(this);
		}
	};
	workers.restore = () => {
		workerThreads.Worker = OriginalWorker;
	};
	return workers;
}

// Resolves once count of the workers have exited.
function exits(workers, count) {
	return new Promise((resolve) => {
		let exited = 0;
		for (const worker of workers) {
			worker.exited.then(() => {
				if (++exited === count) resolve();
			});
		}
	});
}

const tests = {
	// Node.js sends messages of its own, like {'watch:require': [...]} in watch
	// mode, over the same channel that we use to talk with the worker. Both sides
	// should ignore messages that are not ours instead of crashing on them.
	// https://github.com/noppa/xmllint-wasm/issues/37
	async testWithUnexpectedWorkerMessages() {
		const OriginalWorker = workerThreads.Worker;
		const unrelatedMessage = {
			'watch:require': ['/app/node_modules/xmllint-wasm/xmllint-node.js'],
		};

		class NoisyWorker extends OriginalWorker {
			postMessage(value) {
				// By the time we get here, the parent has already subscribed to the
				// worker's messages, so we can send noise to both directions.
				super.postMessage(unrelatedMessage);
				this.emit('message', unrelatedMessage);
				return super.postMessage(value);
			}
		}

		workerThreads.Worker = NoisyWorker;
		try {
			// The second call reuses the worker of the first one.
			for (let i = 0; i < 2; i++) {
				const {valid, errors} = await xmllint.validateXML({xml: '<foo/>', normalization: 'format'});
				assert.deepEqual({valid, errors}, {valid: true, errors: []});
			}
		} finally {
			workerThreads.Worker = OriginalWorker;
		}
	},

	// Calls one after another use the same worker. One that fails while it waits
	// for the next call is replaced.
	async testWorkerIsReused() {
		const workers = countWorkers();
		try {
			await validate();
			await validate();
			assert.equal(workers.length, 1);

			await workers[0].terminate();
			await validate();
			assert.equal(workers.length, 2);
		} finally {
			workers.restore();
		}
	},

	// A worker whose runtime needed more than the default maximum memory would
	// hold on to it while waiting, so the next call gets a new worker.
	async testWorkerWithLargeMemoryIsNotKept() {
		const workers = countWorkers();
		try {
			await validate({maxMemoryPages: xmllint.memoryPages.defaultMaxMemoryPages});
			await validate();
			assert.equal(workers.length, 1);

			await validate({
				initialMemoryPages: xmllint.memoryPages.defaultMaxMemoryPages + xmllint.memoryPages.MiB,
				maxMemoryPages: xmllint.memoryPages.GiB,
			});
			await validate();
			assert.equal(workers.length, 2);
		} finally {
			workers.restore();
		}
	},

	// Lowering the maximum terminates the idle workers above it, and later calls
	// keep no more than it.
	async testSetMaxIdleWorkers() {
		const workers = countWorkers();
		try {
			xmllint.setMaxIdleWorkers(3);
			await Promise.all([validate(), validate(), validate(), validate()]);
			assert.equal(workers.length, 4);
			// The fourth worker was not kept.
			await exits(workers, 1);
			assert.equal(workers.filter((worker) => !worker.hasExited).length, 3);

			xmllint.setMaxIdleWorkers(1);
			await exits(workers.filter((worker) => !worker.hasExited), 2);
			// The one kept is still used.
			await validate();
			assert.equal(workers.length, 4);
			assert.equal(workers.filter((worker) => !worker.hasExited).length, 1);
		} finally {
			workers.restore();
		}
	},

	// With a maximum of 0, each call starts a new worker and terminates it.
	async testSetMaxIdleWorkersToZero() {
		const workers = countWorkers();
		try {
			await validate();
			xmllint.setMaxIdleWorkers(0);
			await workers[0].exited;

			await validate();
			await validate();
			assert.equal(workers.length, 3);
			await Promise.all(workers.map((worker) => worker.exited));
		} finally {
			workers.restore();
		}
	},

	async testSetMaxIdleWorkersRejectsInvalidValues() {
		for (const value of [-1, 1.5, NaN, Infinity, '2', undefined]) {
			assert.throws(() => xmllint.setMaxIdleWorkers(value), /Invalid maximum number of idle workers/);
		}
		// The default is unchanged: the second call reuses the first one's worker.
		const workers = countWorkers();
		try {
			await validate();
			await validate();
			assert.equal(workers.length, 1);
		} finally {
			workers.restore();
		}
	},

	// Idle workers are terminated, and later calls start new ones. A worker whose
	// call is still running is kept when it finishes.
	async testTerminateIdleWorkers() {
		const workers = countWorkers();
		try {
			xmllint.setMaxIdleWorkers(2);
			await Promise.all([validate(), validate()]);

			// Takes one of the two idle workers. Only the other one is terminated.
			const running = validate();
			xmllint.terminateIdleWorkers();
			await exits(workers, 1);
			await running;

			// The running call's worker was kept, and is used by the next call.
			await validate();
			assert.equal(workers.length, 2);
			assert.equal(workers.filter((worker) => !worker.hasExited).length, 1);

			xmllint.terminateIdleWorkers();
			await exits(workers, 2);
			await validate();
			assert.equal(workers.length, 3);
		} finally {
			workers.restore();
		}
	},
};

module.exports = Object.keys(tests);

if (require.main === module) {
	const name = process.argv[2];
	if (!tests[name]) {
		console.error(`Unknown test ${name}. Expected one of: ${Object.keys(tests).join(', ')}`);
		process.exit(1);
	}

	// Idle workers don't keep the process running, so a test waiting on one that
	// never exits would end the process early. That counts as a failure.
	process.exitCode = 1;
	tests[name]().then(() => process.exit(0), (err) => {
		console.error(err);
		process.exit(1);
	});
}
