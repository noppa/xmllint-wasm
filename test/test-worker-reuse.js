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

// Records the workers that get started, until restore is called.
function countWorkers() {
	const workers = [];
	const OriginalWorker = workerThreads.Worker;
	workerThreads.Worker = class extends OriginalWorker {
		constructor(...args) {
			super(...args);
			workers.push(this);
		}
	};
	workers.restore = () => {
		workerThreads.Worker = OriginalWorker;
	};
	return workers;
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
};

module.exports = Object.keys(tests);

if (require.main === module) {
	const name = process.argv[2];
	if (!tests[name]) {
		console.error(`Unknown test ${name}. Expected one of: ${Object.keys(tests).join(', ')}`);
		process.exit(1);
	}

	tests[name]().then(() => process.exit(0), (err) => {
		console.error(err);
		process.exit(1);
	});
}
