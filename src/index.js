'use strict';

/** @type {import("./index").MemoryPagesConstant} */
const memoryPages = {
	MiB: 16,
	GiB: 16384,
	defaultInitialMemoryPages: 256 /* 16MiB */,
	defaultMaxMemoryPages: 512 /* 32MiB */,
	max: 65536
};

/**
 * @returns {{fileName: string, contents: string}[]}
 */
function normalizeInput(fileInput, extension) {
	if (!Array.isArray(fileInput)) fileInput = [fileInput];
	return fileInput.map((xmlInfo, i) => {
		if (typeof xmlInfo === 'string') {
			return {
				fileName: `file_${i}.${extension}`,
				contents: xmlInfo,
			};
		} else {
			return xmlInfo;
		}
	});
};

function validateOptions(processedOptions) {
	const orig = processedOptions.original;

	if (!orig.disableFileNameValidation)	{
		const files = processedOptions.files;
		for (const file of files.xmls.concat(files.schemas)) {
			if (/(^|\s)-/.test(file.fileName)) {
				throw new Error(`Invalid file name "${file.fileName}" that would be interpreted as a command line option.`);
			}
		}
	}

	const extension = orig.extension || 'schema';
	const normalization = orig.normalization || '';

	validateOption(['schema', 'relaxng'], 'extension', extension);
	validateOption(['', 'format', 'c14n'], 'normalization', normalization);
	validateMemoryLimitOptions(processedOptions.memory);
}

/**
 * @param {import("./index").XMLLintOptions} options
 */
function preprocessOptions(options) {
	const xmls = normalizeInput(options.xml, 'xml');
	const schemas = normalizeInput(options.schema || [], 'xsd');
	const preloads = normalizeInput(options.preload || [], 'xml');

	const normalization = options.normalization || '';
	const extension = options.extension || 'schema';

	/** @type string[] */
	const args = [];
	schemas.forEach(function(schema) {
		args.push(`--${extension}`);
		args.push(schema['fileName']);
	});

	if (normalization) {
		args.push(`--${normalization}`);
	} else {
		// If no normalization is requested, we'll default to no output at all to "normalized" field.
		args.push('--noout');
	}

	if (options.stream) {
		args.push('--stream');
	}

	xmls.forEach(function(xml) {
		args.push(xml['fileName']);
	});

	const opts = {
		args,
		files: {
			xmls,
			schemas,
			preloads,
		},
		memory: resolveMemoryOptions(options),
		original: options
	};

	return opts;
}

function resolveMemoryOptions(options) {
	return {
		initialMemory: options.initialMemoryPages || memoryPages.defaultInitialMemoryPages,
		maxMemory: options.maxMemoryPages || memoryPages.defaultMaxMemoryPages,
	};
}

function validationSucceeded(exitCode) {
	if (exitCode === 0) {
		return true;
	} else if (exitCode === 3 || exitCode === 4 /* validationError */) {
		return false;
	} else /* unknown situation */ {
		return null;
	}
}

function validateOption(allowedValues, optionName, actualValue) {
	if (!allowedValues.includes(actualValue)) {
		const actualValueStr = typeof actualValue === 'string' ? `"${actualValue}"` : actualValue;
		throw new Error(`Invalid value for option ${optionName}: ${actualValueStr}`);
	}
}

function validateMemoryLimitOptions({initialMemory, maxMemory}) {
	if (initialMemory < 0 || maxMemory < initialMemory || maxMemory > memoryPages.max) {
		throw new Error(
			'Invalid memory options.'
			+ ` Expected 0 < initialMemoryPages (${initialMemory}) <= maxMemoryPages (${maxMemory}) <= 4GiB (${memoryPages.max})`
		);
	}
}

function parseErrors(/** @type {string} */ output) {
	const errorLines = output
		.split('\n')
		.slice(0, -2);

	return errorLines.map(line => {
		const [fileName, lineNumber, ...rest] = line.split(':');
		if (fileName && lineNumber && rest.length) {
			return {
				rawMessage: line,
				message: rest.join(':').trim(),
				loc: {
					fileName,
					lineNumber: parseInt(lineNumber),
				}
			};
		} else {
			return {
				rawMessage: line,
				message: line,
				loc: null,
			};
		}
	}).filter(errorInfo => {
		// xmllint outputs "file.xml validates" for those files that are valid.
		const wasValid = !errorInfo.loc && errorInfo.rawMessage
			.trim()
			.endsWith(' validates');
		// don't list those files in errors list
		return !wasValid;
	});
}

// Our own messages are tagged with this key so that both sides of the
// worker channel can tell them apart from unrelated messages that the
// runtime might send over the same channel, like the "watch:require"
// messages Node.js sends when running in watch mode.
// https://github.com/noppa/xmllint-wasm/issues/37
const messageKey = 'xmllint-wasm';

// The compiled Web Assembly module, shared by all workers. Compiling is most of
// the cost of starting a worker, and a compiled module can be sent to a worker
// without compiling or copying its code again. Starts on the first preload or
// init, not on import, so that importing the library costs nothing.
/** @type {Promise<WebAssembly.Module | null> | null} */
let wasmModule = null;

// #ifdef browser
var compileWasmModule = async function() {
	const url = new URL('./xmllint.wasm', import.meta.url);
	try {
		return await WebAssembly.compileStreaming(fetch(url));
	} catch (err) {
		// Streaming needs the file served as application/wasm, which is reported
		// as a TypeError, like failing to fetch the file is. Like Emscripten, try
		// again without streaming. A CompileError, like the one a Content Security
		// Policy causes, would only happen again.
		if (!(err instanceof TypeError)) {
			throw err;
		}
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Could not fetch ${url}: ${response.status}`);
		}
		return await WebAssembly.compile(await response.arrayBuffer());
	}
};
// #endif

// #ifdef node
var compileWasmModule = async function() {
	const {readFile} = require('fs/promises');
	const bytes = await readFile(require('path').resolve(__dirname, './xmllint.wasm'));
	return await WebAssembly.compile(bytes);
};
// #endif

/**
 * Resolves with the shared module, or with null if it could not be compiled here.
 * The worker then loads the module itself, which is also where the error is
 * reported: a page whose Content Security Policy allows Web Assembly in the
 * worker but not on the page should still work, and a missing file should still
 * be reported by init as a WASM Abort.
 *
 * A module that doesn't compile here, because of the Content Security Policy or
 * a broken file, won't compile on the next try either, so that is kept. Trying
 * again would cost a download and, with a Content Security Policy, a violation
 * report for each new instance. A file that couldn't be fetched or read is
 * tried again by the next call.
 */
function getWasmModule() {
	if (!wasmModule) {
		wasmModule = compileWasmModule().catch((err) => {
			if (!(err instanceof WebAssembly.CompileError)) {
				wasmModule = null;
			}
			return null;
		});
	}
	return wasmModule;
}

/** @type {import("./index").validateXML} */
async function validateXML(options) {
	let linter, ret;

	const preprocessed = preprocessOptions(options);
	validateOptions(preprocessed);

	let args = preprocessed.args;
	if (options.modifyArguments) {
		args = options.modifyArguments(args);
		if (!Array.isArray(args)) {
			throw new Error('modifyArguments must return an array of arguments');
		}
	}

	try {
		linter = await XMLLint.init({
			initialMemoryPages: options.initialMemoryPages,
			maxMemoryPages: options.maxMemoryPages,
		});
		await linter.mount([...preprocessed.files.xmls, ...preprocessed.files.schemas, ...preprocessed.files.preloads]);
		ret = await linter.process({args});
	} finally {
		if (linter) {
			linter.terminate();
		}
	}

	return ret ? ret : Promise.reject('Unexepected error');
}

class XMLLint {
	/**
	 * Use XMLLint.init instead, which also waits for the runtime to be ready.
	 */
	constructor() {
		this.worker = null;
		this.messageId = 0;
		this.pending = new Map();
		this._terminated = false;
		/** The error that ended the instance. */
		this._failure = null;

		// #ifdef browser
		this.worker = new Worker(new URL('./xmllint-browser.mjs', import.meta.url), { type: 'module' });
		this.listen = this.worker.addEventListener.bind(this.worker);
		// #endif

		// #ifdef node
		const { Worker } = require('worker_threads');
		this.worker = new Worker(require('path').resolve(__dirname, './xmllint-node.js'));
		this.listen = this.worker.on.bind(this.worker);
		// #endif

		this._bindListeners();
	}

	/** @type {typeof import("./index").XMLLint.init} */
	static async init(options) {
		const memory = resolveMemoryOptions(options || {});
		validateMemoryLimitOptions(memory);

		// The worker script loads while the module compiles.
		const linter = new XMLLint();
		try {
			const module = await getWasmModule();
			if (linter._failure) {
				// The worker failed while the module was compiling, before there was
				// a request to reject with the error.
				throw linter._failure;
			}
			await linter._request({
				type: 'INIT',
				initialMemory: memory.initialMemory,
				maxMemory: memory.maxMemory,
				wasmModule: module
			});
		} catch (err) {
			linter.terminate();
			throw err;
		}
		return linter;
	}

	/** @type {typeof import("./index").XMLLint.preload} */
	static async preload() {
		await getWasmModule();
	}

	/**
	 * Internal setup for worker communication
	 */
	_bindListeners() {
		const onmessage = (event) => {
			// #ifdef browser
			var data = event.data;
			// #endif
			// #ifdef node
			var data = event;
			// #endif

			if (!data || data[messageKey] !== true) {
				// Not a message from our worker, ignore it.
				return;
			}

			if (data.type === 'EXIT') {
				// xmllint called exit(), which ends the runtime.
				this._fail(new Error(`XMLLint worker: xmllint exited with code ${data.exitCode}`));
				return;
			}

			const prom = this.pending.get(data.seq);
			if (!prom) {
				// The call was already rejected, e.g. by terminate.
				return;
			}
			this.pending.delete(data.seq);

			if (data.error) {
				const err = new Error(data.error);
				prom.reject(err);
				if (data.fatal) {
					// The runtime can't run anything anymore.
					this._fail(err);
				}
			} else if (data.type === 'DONE') {
				prom.resolve();
			} else if (data.type === 'RESULT') {
				const valid = validationSucceeded(data.exitCode);
				if (valid === null) {
					const err = new Error(data.stderr);
					err.code = data.exitCode;
					prom.reject(err);
				} else {
					prom.resolve({
						valid: valid,
						normalized: data.stdout,
						errors: valid ? [] : parseErrors(data.stderr),
						rawOutput: data.stderr
					});
				}
			} else {
				prom.reject(new Error(`XMLLint: unexpected message type ${data.type} from the worker`));
			}
		};

		const onerror = (err) => {
			// A worker that failed answers nothing further, so everything waiting on
			// it has to be told.
			this._fail(err);
		};

		this.listen('message', onmessage);
		this.listen('error', onerror);
		// #ifdef node
		this.listen('exit', (exitCode) => {
			this._fail(new Error(`XMLLint worker exited with code ${exitCode}`));
		});
		// #endif
	}

	/**
	 * True when the instance can't be used anymore, either because terminate was
	 * called, or because the worker or its runtime failed. Create a new instance
	 * with XMLLint.init to continue.
	 */
	get terminated() {
		return this._terminated;
	}

	_post(message) {
		message[messageKey] = true;
		this.worker.postMessage(message);
	}

	/**
	 * Sends a message to the worker. Resolves with the worker's answer to it.
	 */
	_request(message) {
		if (this._terminated) {
			return Promise.reject(new Error('XMLLint instance is terminated. Create a new one with XMLLint.init.'));
		}

		const seq = ++this.messageId;
		return new Promise((resolve, reject) => {
			this.pending.set(seq, { resolve, reject });
			this._post({...message, seq});
		});
	}

	/**
	 * Replaces all files previously added with mount or addFile.
	 */
	mount(files) {
		return this._request({type: 'MOUNT', files});
	}

	/**
	 * Adds a file, keeping the others.
	 */
	addFile(fileName, contents) {
		return this._request({type: 'ADDFILES', files: [{fileName, contents}]});
	}

	/**
	 * Runs xmllint with the given arguments.
	 */
	process(options) {
		const args = options.args;
		if (!Array.isArray(args) || args.length === 0) {
			return Promise.reject(new Error('XMLLint process: args must be a non-empty array of xmllint arguments'));
		}

		return this._request({type: 'PROCESS', args});
	}

	/** Rejects everything outstanding. */
	_failAll(err) {
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const prom of pending) prom.reject(err);
	}

	terminate() {
		// Use the error from here rather than the call site: it points at the
		// terminate, which is what a user debugging this needs to see.
		this._fail(new Error('Worker terminated'));
	}

	/** Ends the instance: stops the worker and rejects everything outstanding. */
	_fail(err) {
		if (!this._terminated) {
			this._failure = err;
		}
		this._terminated = true;
		if (this.worker) {
			const worker = this.worker;
			this.worker = null;
			worker.terminate();
		}
		this._failAll(err);
	}

	[Symbol.dispose]() {
		this.terminate();
	}
}

// #ifdef browser
export { validateXML, memoryPages, XMLLint };
// #ifdef node
module.exports.validateXML = validateXML;
module.exports.memoryPages = memoryPages;
module.exports.XMLLint = XMLLint;
// #endif
