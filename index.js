
const assert = require('assert');
const { Worker } = require('worker_threads');
const workerModule = require.resolve('./xmllint_worker.js');

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
}

function preprocessOptions(options) {
	const xmls = normalizeInput(options.xml, 'xml');
	const extension = options.extension || 'schema';
	assert(['schema', 'relaxng'].includes(extension));
	const schemas = normalizeInput(options.schema, 'xsd');
	const more_preloads = normalizeInput(options.preload || [], 'xml');

	const preloads = xmls.concat(schemas, more_preloads);
	const args = ['--noout']; // Don't print back the xml file in output;
	schemas.forEach(function(schema) {
		args.push(`--${extension}`);
		args.push(schema['fileName']);
	});
	xmls.forEach(function(xml) {
		args.push(xml['fileName']);
	});

	return { preloads, args };
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

function parseErrors(/** @type {string} */output) {
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

function validateXML(options) {

	preprocessedOptions = preprocessOptions(options);

	return new Promise(function validateXMLPromiseCb(resolve, reject) {

		const worker = new Worker(workerModule, {
			workerData: preprocessedOptions
		});

		let stdout = '';
		let stderr = '';

		function onMessage({isStdout, txt}) {
			var s = String.fromCharCode(txt)
			if (isStdout) {
				stdout += s;
			} else {
				stderr += s;
			}
		}

		function onExit(exitCode) {
			const valid = validationSucceeded(exitCode);
			if (valid === null) {
				const err = new Error(stderr);
				err.code = exitCode;
				reject(err);
			} else {
				resolve({
					valid: valid,
					errors: valid ? [] : parseErrors(stderr),
					rawOutput: stderr
					/* Traditionally, stdout has been suppressed both
					 * by libxml2 compile options as well as explict
					 * --noout in arguments; hence »rawOutput« refers
					 * only to stderr, which is a reasonable attribute value
					 * despite the slightly odd attribute name.
					 */
				});
			}
		}

		function onError(err) {
			console.error('Unexpected error event from worker: ' + err);
			reject(err);
		}

		worker.on('message', onMessage);
		worker.on('exit', onExit);
		worker.on('error', onError);
	});
}

module.exports.validateXML = validateXML;
