
const assert = require('assert');
const { Worker } = require('worker_threads');
const workerModule = require.resolve('./xmllint_worker.js');

function validateXML(options) {
	return new Promise(function validateXMLPromiseCb(resolve, reject) {

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

		const worker = new Worker(workerModule, {
			workerData: {
				preloads: preloads,
				args: args
			}
		});

		let output = '';

		function stdout(msg) {
			output += String.fromCharCode(msg);
		}

		function onExit(code) {
			if (code === 0) {
				resolve({
					valid: true,
					errors: [],
					rawOutput: output,
				});
			} else if (code === 3 || code === 4 /* validationError */) {
				resolve({
					valid: false,
					errors: parseErrors(output),
					rawOutput: output,
				});
			} else {
				const err = new Error(output);
				err.code = code;
				reject(err);
			}
		}

		worker.on('message', stdout);
		worker.on('exit', onExit);
		worker.on('error', err => {
			console.error('Unexpected error event from worker: ' + err);
			reject(err);
		});
	});
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

module.exports.validateXML = validateXML;
