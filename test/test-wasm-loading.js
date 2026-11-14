'use strict';
// Tests for how the Web Assembly module is loaded. The compiled module is kept
// for the lifetime of the process, so each of these runs in a fresh process,
// started by test.js: node test/test-wasm-loading.js <test name>
const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const xmllint = require('../index-node.js');

const args = ['--noout', 'doc.xml'];

// Locally xmllint.wasm is at the repo root; in CI the package is installed
// from a tarball into node_modules/xmllint-wasm/ so we fall back there.
function getWasmPath() {
	const wasmPath = path.resolve(__dirname, '../xmllint.wasm');
	if (fs.existsSync(wasmPath)) {
		return wasmPath;
	}
	return path.join(path.dirname(require.resolve('xmllint-wasm')), 'xmllint.wasm');
}

async function withoutWasmFile(fn) {
	const wasmPath = getWasmPath();
	const tmpPath = wasmPath + '.bak';
	fs.renameSync(wasmPath, tmpPath);
	try {
		await fn();
	} finally {
		fs.renameSync(tmpPath, wasmPath);
	}
}

async function processWithNewInstance() {
	const linter = await xmllint.XMLLint.init();
	try {
		await linter.addFile('doc.xml', '<foo/>');
		const result = await linter.process({args});
		assert.equal(result.valid, true);
	} finally {
		linter.terminate();
	}
}

const tests = {
	async testWithMissingWasmFile() {
		await withoutWasmFile(async () => {
			await assert.rejects(xmllint.validateXML({xml: '<foo/>', normalization: 'format'}), /WASM Abort/);
		});
	},

	// init only resolves once the runtime is ready, so a runtime that fails to
	// start is reported by init.
	async testInitRejectsWhenRuntimeFails() {
		await withoutWasmFile(async () => {
			await assert.rejects(xmllint.XMLLint.init(), /WASM Abort/);
		});
	},

	// A module that failed to load isn't kept, so the next init tries again.
	async testInitRetriesAfterFailure() {
		await withoutWasmFile(async () => {
			await assert.rejects(xmllint.XMLLint.init(), /WASM Abort/);
		});
		await processWithNewInstance();
	},

	async testPreloadDoesNotReject() {
		await withoutWasmFile(async () => {
			assert.equal(await xmllint.XMLLint.preload(), undefined);
		});
		await processWithNewInstance();
	},

	// Once compiled, the module is shared by all new instances, which don't
	// load the file anymore.
	async testInstancesShareThePreloadedModule() {
		await xmllint.XMLLint.preload();
		await withoutWasmFile(async () => {
			await processWithNewInstance();
			await processWithNewInstance();
			const {valid} = await xmllint.validateXML({xml: '<foo/>', normalization: 'format'});
			assert.equal(valid, true);
		});
	},

	// If the main thread can't compile the module, like when a browser page's
	// Content Security Policy doesn't allow it, the worker loads it itself.
	// That would fail the same way again, so it is tried only once.
	async testWorkerLoadsTheModuleWhenSharingFails() {
		const originalCompile = WebAssembly.compile;
		let compileCalls = 0;
		WebAssembly.compile = () => {
			compileCalls++;
			return Promise.reject(new WebAssembly.CompileError('Compiling is not allowed'));
		};
		try {
			await processWithNewInstance();
			await processWithNewInstance();
			await xmllint.XMLLint.preload();
		} finally {
			WebAssembly.compile = originalCompile;
		}
		assert.equal(compileCalls, 1);
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
