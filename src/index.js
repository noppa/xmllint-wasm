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
		memory: {
			initialMemory: options.initialMemoryPages || memoryPages.defaultInitialMemoryPages,
			maxMemory: options.maxMemoryPages || memoryPages.defaultMaxMemoryPages,
		},
		original: options
	};

	return opts;
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

/** @type {import("./index").validateXML} */
async function validateXML(options) {
	let linter, ret;

	const preprocessed = preprocessOptions(options);
	validateOptions(preprocessed);

	try {
		linter = XMLLint.init(preprocessed.memory);
		linter.mount([...preprocessed.files.xmls, ...preprocessed.files.schemas, ...preprocessed.files.preloads]);
		ret = await linter.process({args: preprocessed.args, modifyArguments: options.modifyArguments});
	} finally {
		if (linter) {
			linter.terminate();
		}
	}

	return ret ? ret : Promise.reject('Unexepected error');
}

class XMLLint {
	constructor(memoryCfg) {
		this.worker = null;
		this.messageId = 0;
		this.pending = new Map();

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

		if (memoryCfg) {
			this.worker.postMessage({
				seq: ++this.messageId,
				type: 'INIT',
				initialMemory: memoryCfg.initialMemory,
				maxMemory: memoryCfg.maxMemory
			});
		} else {
			this.worker.postMessage({
				seq: ++this.messageId,
				type: 'INIT',
				initialMemory: memoryPages.defaultInitialMemoryPages,
				maxMemory: memoryPages.defaultMaxMemoryPages
			});
		}
	}

	static init(memoryCfg) {
		// TODO add type: {initialMemory, maxMemory}
		return new XMLLint(memoryCfg);
	}

	/**
	 * Internal setup for worker communication
	 */
	_bindListeners() {
		const onmessage = async (event) => {
			// #ifdef browser
			var data = event.data;
			// #endif
			// #ifdef node
			var data = event;
			// #endif

			if (!data.seq) {
				throw new Error('Message without sequence id');
			}

			let resolve, reject;
			if (this.pending.has(data.seq)) {
				const prom = this.pending.get(data.seq);
				resolve = prom.resolve;
				reject = prom.reject;
			} else {
				resolve = () => {};
				reject = (err) => {
					throw err;
				};
			}

			this.pending.delete(data.seq);

			if (data.error) {
				reject(new Error(data.error));
				return;
			}

			if (data.type === 'RESULT') {
				const valid = validationSucceeded(data.exitCode);
				if (valid === null) {
					const err = new Error(data.stderr);
					err.code = data.exitCode;
					reject(err);
				} else {
					resolve({
						valid: valid,
						normalized: data.stdout,
						errors: valid ? [] : parseErrors(data.stderr),
						rawOutput: data.stderr
					});
				}
			} else {
				reject(new Error('Could not process message'));
			}
		};

		const onerror = (err) => {
			if (this.pendingProcess) {
				this.pendingProcess.reject(err);
				this.pendingProcess = null;
			}
			console.error('XMLLint Worker Error:', err);
		};

		this.listen('message', onmessage);
		this.listen('error', onerror);
	}

	/**
	 * Mount initial files (clears previous VFS)
	 */
	mount(files) {
		// TODO add types [{fileName, contents}]
		this.worker.postMessage({
			seq: ++this.messageId,
			type: 'MOUNT',
			files: files
		});
	}

	/**
	 * Add a single file to the VFS without clearing others
	 */
	addFile(fileName, contents) {
		this.worker.postMessage({
			seq: ++this.messageId,
			type: 'ADDFILES',
			files: [{fileName, contents}]
		});
	}

	/**
	 * Run the validation (PROCESS)
	 * Returns a Promise that resolves when the worker flushes stdout/stderr
	 */
	process(options) {
		// TODO Add type: {args, modifyArguments} | {xml, schema, extension, normalization, stream}
		const seq = ++this.messageId;

		let args = options.args;
		if (args === undefined || (Array.isArray(args) && args.length == 0)) {
			const processed = preprocessOptions(options);
			args = processed.args;

			const files = processed.files;
			const toAdd = files.xmls.concat(files.schemas);

			if (toAdd.length > 0) {
				this.worker.postMessage({
					seq: ++this.messageId,
					type: 'ADDFILES',
					files: toAdd
				});
			}
		}

		if (options.modifyArguments) {
			args = opts.modifyArguments(args);
			if (!Array.isArray(args)) {
				throw new Error('modifyArguments must return an array of arguments');
			}
		}

		return new Promise((resolve, reject) => {
			this.pending.set(seq, { resolve, reject });

			this.worker.postMessage({
				seq,
				type: 'PROCESS',
				args: args
			});
		});
	}

	terminate() {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}

		const err = new Error('Worker terminated'); // let's be gentle and use the error from here, this helps debugging for our users
		for (const pending of this.pending.values()) pending.reject(err);
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
