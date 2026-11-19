'use strict';
const fs = require('fs');
const assert = require('assert').strict;
const xmllint = require('../index-node.js');
const xmlValid = fs.readFileSync('./test/test-valid.xml', 'utf8');
const xmlValidFormatted = fs.readFileSync('./test/test-valid-formatted.xml', 'utf8');
const xmlInvalidFormatted = fs.readFileSync('./test/test-invalid-formatted.xml', 'utf8');
const xmlValidC14n = fs.readFileSync('./test/test-valid-c14n.xml', 'utf8');
const xmlInvalid = fs.readFileSync('./test/test-invalid.xml', 'utf8');
const schemaOptions = {
	schema: fs.readFileSync('./test/test.xsd', 'utf8'),
	preload: [
		{
			fileName: 'comment.xsd',
			contents: fs.readFileSync('./test/comment.xsd', 'utf8'),
		}
	]
};

async function testWithValidFile() {
	const {rawOutput, normalized, ...result} = await xmllint.validateXML({
		xml: {fileName: 'valid.xml', contents: xmlValid},
		...schemaOptions,
	});

	assert.deepEqual(result, {valid: true, errors: []});
	// "normalized" should be empty because we didn't pass the "normalization" option
	assert.equal(normalized, '');
	assert.equal(rawOutput.trim(), 'valid.xml validates');
}

async function testWithValidFileForFormat() {
	const {valid, normalized} = await xmllint.validateXML({
		xml: {fileName: 'valid.xml', contents: xmlValid},
		...schemaOptions,
		normalization: 'format'
	});

	assert(valid);
	assert.equal(normalized, xmlValidFormatted);
}

async function testWithValidFileForFormatWithoutSchema() {
	const {valid, normalized} = await xmllint.validateXML({
		xml: {fileName: 'valid.xml', contents: xmlValid},
		normalization: 'format'
	});

	assert(valid);
	assert.equal(normalized, xmlValidFormatted);
}

async function testWithValidFileForC14n() {
	const {valid, normalized} = await xmllint.validateXML({
		xml: {fileName: 'valid.xml', contents: xmlValid},
		...schemaOptions,
		normalization: 'c14n'
	});

	assert(valid);
	assert.equal(normalized, xmlValidC14n);
}

async function testWithInvalidFile() {
	const {rawOutput, normalized, ...result} = await xmllint.validateXML({
		...schemaOptions,
		xml: xmlInvalid,
	});
	const expectedErrorResult = {
		valid: false,
		errors: [
			{
				rawMessage: "file_0.xml:21: Schemas validity error : Element 'quantity': [facet 'maxExclusive'] The value '1000' must be less than '100'.",
				message: "Schemas validity error : Element 'quantity': [facet 'maxExclusive'] The value '1000' must be less than '100'.",
				loc: { fileName: 'file_0.xml', lineNumber: 21 }
			},
			{
				rawMessage: "file_0.xml:25: Schemas validity error : Element 'item', attribute 'partNum': [facet 'pattern'] The value '92-AA' is not accepted by the pattern '\\d{3}-[A-Z]{2}'.",
				message: "Schemas validity error : Element 'item', attribute 'partNum': [facet 'pattern'] The value '92-AA' is not accepted by the pattern '\\d{3}-[A-Z]{2}'.",
				loc: { fileName: 'file_0.xml', lineNumber: 25 }
			}
		]		
	};

	assert.equal(normalized, '');
	assert.deepEqual(result, expectedErrorResult);
}

async function testWithInvalidFileName() {
	let error1;
	try {
		await xmllint.validateXML({
			xml: {fileName: '--foo', contents: xmlValid},
			...schemaOptions,
		});
	} catch (err) {
		error1 = err;
	}
	assert.match(String(error1), /Invalid file name "--foo"/);

	let error2;
	try {
		await xmllint.validateXML({
			xml: {fileName: 'foo -bar', contents: xmlValid},
			...schemaOptions,
		});
	} catch (err) {
		error2 = err;
	}
	assert.match(String(error2), /Invalid file name "foo -bar"/);
}

async function testWithCustomOptions() {
	const {rawOutput} = await xmllint.validateXML({
		xml: [],
		modifyArguments(args) {
			assert(Array.isArray(args));
			assert(args.every(arg => typeof arg === 'string'));

			return ['--version'];
		}
	});
	assert.match(rawOutput, /using libxml version/);
}

async function testWithTwoFiles() {
	const input = [
		{
			fileName: 'valid.xml',
			contents: xmlValid,
		},
		{
			fileName: 'invalid.xml',
			contents: xmlInvalid,
		},
	];
	const {rawOutput, normalized, ...result} = await xmllint.validateXML({
		xml: input,
		...schemaOptions,
		normalization: 'format',
	});
	const expectedResultForBoth = {
		'valid': false,
		'errors': [
			{
				rawMessage: "invalid.xml:21: Schemas validity error : Element 'quantity': [facet 'maxExclusive'] The value '1000' must be less than '100'.",
				message: "Schemas validity error : Element 'quantity': [facet 'maxExclusive'] The value '1000' must be less than '100'.",
				loc: {
					fileName: 'invalid.xml',
					lineNumber: 21
				}
			},
			{
				rawMessage: "invalid.xml:25: Schemas validity error : Element 'item', attribute 'partNum': [facet 'pattern'] The value '92-AA' is not accepted by the pattern '\\d{3}-[A-Z]{2}'.",
				message: "Schemas validity error : Element 'item', attribute 'partNum': [facet 'pattern'] The value '92-AA' is not accepted by the pattern '\\d{3}-[A-Z]{2}'.",
				loc: {
					fileName: 'invalid.xml',
					lineNumber: 25
				}
			}
		]
	};

	assert.equal(normalized, xmlValidFormatted + xmlInvalidFormatted);
	assert.deepEqual(result, expectedResultForBoth);
}

async function testWithLargeFile() {
	// Takes the first item XML from the test file. I know I know, never parse
	// XML with regex, but this is good enough for our test case.
	let [partToRepliacate] = xmlValid.match(/<item\b(?:.|[\r\n])*<\/item>/) || [];
	if (!partToRepliacate) {
		throw new Error('Could not find item in test file.');
	}
	// Make a large XML file by repeating the item 300 000 times.
	// This will take about 300MB.
	const xml = xmlValid.replace(partToRepliacate, partToRepliacate.repeat(300000));
	partToRepliacate = '';
	let error = 'No error. XML length: '
	// Force V8 to eagerly evaluate length of the created string to fight
	// any weird optimiziations that it migt be tempted to do.
		+ xml.length;

	// We are doing tests here that are sensitive to the exact amount of memory
	// this test takes. Invoke the GC to try and make the test more predictable/stable.
	if (typeof gc === 'function') {
		/* globals gc */
		gc();
	}

	try {
		await xmllint.validateXML({
			xml,
			...schemaOptions,
		});
	} catch (err) {
		error = String(err);
	}
	if (error) {
		console.info('This is expected: Test without memory limit failed with error:', error);
	} else {
		// Don't fail the CI just because of this. When we hit OOM and when not is pretty flaky.
		console.warn('Unexpected: Test passed even without memory limit.');
	}

	if (typeof gc === 'function') {
		gc();
	}

	// Should pass if we increase the max heap size.
	const resultUsingIncreasedMemory = await xmllint.validateXML({
		xml,
		...schemaOptions,
		// This is not really relevant for the passing of the test, but included
		// here for a sanity check that the option doesn't blow things up either.
		initialMemoryPages: xmllint.memoryPages.MiB * 30,
		maxMemoryPages: xmllint.memoryPages.GiB,
	});
	assert(resultUsingIncreasedMemory.valid);

	// Try the same with streaming instead of the raised memory limits
	const resultUsingStreaming = await xmllint.validateXML({
		xml,
		stream: true,
		...schemaOptions,
	});
	assert(resultUsingStreaming.valid);
}

async function runTests(...tests) {
	for (const test of tests) {
		try {
			await test();
		} catch(err) {
			console.error(err);
			console.error(`Test ${test.name} failed. See the error above`);
			return process.exit(1);
		}
	}
	console.log('All tests passed.');
}

async function testWithFilesInSubdirectories() {
	// FS.writeFile does not create parent directories, so a fileName containing
	// a slash used to fail with ENOENT. Schema sets that import each other by
	// relative path depend on this working.
	const schema = fs.readFileSync('./test/test.xsd', 'utf8')
		.replace('schemaLocation="comment.xsd"', 'schemaLocation="../shared/comment.xsd"');

	const {valid, errors} = await xmllint.validateXML({
		xml: {fileName: 'valid.xml', contents: xmlValid},
		schema: [{fileName: 'main/test.xsd', contents: schema}],
		preload: [{
			fileName: 'shared/comment.xsd',
			contents: fs.readFileSync('./test/comment.xsd', 'utf8'),
		}],
	});

	assert.deepEqual({valid, errors}, {valid: true, errors: []});
}

// validateXML reuses its workers, but each call runs in a runtime of its own,
// so nothing one call does reaches the next: not its files, not its verdict and
// not the allocator that --maxmem installs.
async function testCallsDontShareState() {
	const args = ['--schema', 'test.xsd', '--noout', 'doc.xml'];
	const validate = (xml, extraArgs = []) => xmllint.validateXML({
		xml: {fileName: 'doc.xml', contents: xml},
		schema: {fileName: 'test.xsd', contents: schemaOptions.schema},
		preload: schemaOptions.preload,
		modifyArguments: () => [...extraArgs, ...args],
	});

	const verdicts = [];
	for (const xml of [xmlValid, xmlInvalid, xmlValid]) {
		verdicts.push((await validate(xml)).valid);
	}
	assert.deepEqual(verdicts, [true, false, true]);

	await assert.rejects(validate(xmlValid, ['--maxmem', '1000']), /Maximum memory exceeded/);
	assert.equal((await validate(xmlValid)).valid, true);

	// doc.xml was written by the calls above, but not by this one.
	const {valid, rawOutput} = await xmllint.validateXML({xml: [], modifyArguments: () => ['--noout', 'doc.xml']});
	assert.equal(valid, false);
	assert.match(rawOutput, /failed to load "doc.xml"/);
}

// Calls running at the same time each get the answer to their own document.
async function testConcurrentCalls() {
	const count = 3 * require('os').availableParallelism();
	const results = await Promise.all(Array.from({length: count}, (_, i) => xmllint.validateXML({
		xml: {fileName: `doc_${i}.xml`, contents: i % 2 ? xmlInvalid : xmlValid},
		...schemaOptions,
	})));

	results.forEach((result, i) => {
		if (i % 2) {
			assert.equal(result.valid, false);
			assert.deepEqual(result.errors.map(e => e.loc.fileName), [`doc_${i}.xml`, `doc_${i}.xml`]);
		} else {
			assert.equal(result.valid, true);
			assert.equal(result.rawOutput.trim(), `doc_${i}.xml validates`);
		}
	});
}

// The workers that validateXML keeps for later calls don't keep the process running.
async function testProcessExitsAfterValidateXML() {
	const {execFile} = require('child_process');
	const indexPath = require.resolve('../index-node.js');
	const script = `require(${JSON.stringify(indexPath)})
		.validateXML({xml: '<foo/>', normalization: 'format'})
		.then(result => console.log(result.valid));`;

	const stdout = await new Promise((resolve, reject) => {
		execFile(process.execPath, ['-e', script], {timeout: 10000}, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`The process did not exit by itself (${err.signal || err.code}):\n${stdout}${stderr}`));
			} else {
				resolve(stdout);
			}
		});
	});
	assert.equal(stdout.trim(), 'true');
}

// The point of keeping an instance alive is that documents share it. Nothing
// one document does may reach the next: xmllint holds its options and its exit
// status in statics, so a run that fails leaves them set unless the build
// resets them, and every later document is then reported as failing while the
// output still says it validates.
async function testKeepAliveDoesNotCarryVerdicts() {
	const linter = await xmllint.XMLLint.init();
	try {
		await linter.mount(schemaOptions.preload);

		const verdicts = [];
		for (const xml of [xmlValid, xmlValid, xmlInvalid, xmlValid, xmlInvalid]) {
			await linter.addFile('doc.xml', xml);
			await linter.addFile('test.xsd', schemaOptions.schema);
			const result = await linter.process({
				args: ['--schema', 'test.xsd', '--noout', 'doc.xml'],
			});
			verdicts.push(result.valid);
		}

		assert.deepEqual(verdicts, [true, true, false, true, false]);
	} finally {
		linter.terminate();
	}
}

// --maxmem installs allocators that enforce the limit for the rest of the
// process. A kept-alive instance must remove them after the run, or the next
// run, with no limit set, fails its first allocation.
async function testKeepAliveMaxmemDoesNotCarryOver() {
	const linter = await xmllint.XMLLint.init();
	try {
		await linter.mount(schemaOptions.preload);
		await linter.addFile('doc.xml', xmlValid);
		await linter.addFile('test.xsd', schemaOptions.schema);
		const args = ['--schema', 'test.xsd', '--noout', 'doc.xml'];

		await assert.rejects(
			linter.process({args: ['--maxmem', '1000', ...args]}),
			/Maximum memory exceeded/,
		);

		const unlimited = await linter.process({args});
		assert.equal(unlimited.valid, true, JSON.stringify(unlimited.errors));
	} finally {
		linter.terminate();
	}
}

// The same documents through the same instance must reach the same verdicts as
// the one-shot API, which gets a fresh runtime every time.
async function testKeepAliveAgreesWithValidateXML() {
	const linter = await xmllint.XMLLint.init();
	try {
		await linter.mount(schemaOptions.preload);

		for (const [name, xml] of [['valid', xmlValid], ['invalid', xmlInvalid]]) {
			const oneShot = await xmllint.validateXML({
				xml: {fileName: 'doc.xml', contents: xml},
				...schemaOptions,
			});

			await linter.addFile('doc.xml', xml);
			await linter.addFile('test.xsd', schemaOptions.schema);
			const kept = await linter.process({
				args: ['--schema', 'test.xsd', '--noout', 'doc.xml'],
			});

			assert.equal(kept.valid, oneShot.valid, `${name}: verdicts differ`);
			assert.equal(kept.errors.length, oneShot.errors.length, `${name}: error counts differ`);
		}
	} finally {
		linter.terminate();
	}
}

// A call that cannot be answered has to reject rather than hang.
async function testKeepAliveRejectsOnTerminate() {
	const linter = await xmllint.XMLLint.init();
	await linter.mount(schemaOptions.preload);
	await linter.addFile('doc.xml', xmlValid);
	await linter.addFile('test.xsd', schemaOptions.schema);

	const pending = linter.process({
		args: ['--schema', 'test.xsd', '--noout', 'doc.xml'],
	});
	linter.terminate();

	let error;
	try {
		await pending;
	} catch (err) {
		error = err;
	}
	assert(error, 'Expected the outstanding call to reject when the worker is terminated');
}

async function testKeepAliveMemoryOptions() {
	await assert.rejects(
		xmllint.XMLLint.init({maxMemoryPages: xmllint.memoryPages.max + 1}),
		/Invalid memory options/
	);

	const linter = await xmllint.XMLLint.init({
		initialMemoryPages: xmllint.memoryPages.MiB * 30,
		maxMemoryPages: xmllint.memoryPages.GiB,
	});
	try {
		await linter.mount(schemaOptions.preload);
		await linter.addFile('doc.xml', xmlValid);
		await linter.addFile('test.xsd', schemaOptions.schema);
		const result = await linter.process({
			args: ['--schema', 'test.xsd', '--noout', 'doc.xml'],
		});
		assert.equal(result.valid, true);
	} finally {
		linter.terminate();
	}
}

// process only takes xmllint arguments. validateXML's options would have to
// send the schema files on every call, which defeats keeping the instance alive.
async function testKeepAliveProcessRequiresArgs() {
	const linter = await xmllint.XMLLint.init();
	try {
		await assert.rejects(
			linter.process({xml: xmlValid, schema: schemaOptions.schema}),
			/args must be a non-empty array/
		);
	} finally {
		linter.terminate();
	}
}

// Adding a file with the same name again replaces it, and a later mount has
// to remove it only once.
async function testKeepAliveRemountAfterReplacingFiles() {
	const linter = await xmllint.XMLLint.init();
	const args = ['--schema', 'test.xsd', '--noout', 'doc.xml'];
	try {
		for (let i = 0; i < 2; i++) {
			await linter.mount(schemaOptions.preload);
			await linter.addFile('test.xsd', schemaOptions.schema);
			await linter.addFile('doc.xml', xmlValid);
			await linter.addFile('doc.xml', xmlInvalid);
			const result = await linter.process({args});
			assert.equal(result.valid, false, `round ${i}`);
		}
	} finally {
		linter.terminate();
	}
}

// File system errors reject the call that caused them, with a message that
// says what failed. They used to reach the caller as "[object Object]".
async function testKeepAliveFileSystemErrorMessage() {
	const linter = await xmllint.XMLLint.init();
	try {
		await linter.addFile('a', xmlValid);
		// "a" is a file, so it cannot be a directory too.
		await assert.rejects(
			linter.addFile('a/b.xml', xmlValid),
			/could not write file "a\/b.xml"/
		);
		// The instance survives it.
		const result = await linter.process({args: ['--noout', 'a']});
		assert.equal(result.valid, true);
		assert.equal(linter.terminated, false);
	} finally {
		linter.terminate();
	}
}

// The same as terminate, used by using declarations.
async function testKeepAliveDispose() {
	const linter = await xmllint.XMLLint.init();
	await linter.mount(schemaOptions.preload);
	await linter.addFile('test.xsd', schemaOptions.schema);
	await linter.addFile('doc.xml', xmlValid);
	const pending = linter.process({args: ['--schema', 'test.xsd', '--noout', 'doc.xml']});
	linter[Symbol.dispose]();
	await assert.rejects(pending, /Worker terminated/);
}

function supportsUsingDeclarations() {
	try {
		new Function('{ using x = null; }');
		return true;
	} catch (err) {
		if (err instanceof SyntaxError) return false;
		throw err;
	}
}

async function testKeepAliveWithUsing() {
	if (!supportsUsingDeclarations()) {
		console.log(`Skipping testKeepAliveWithUsing: Node.js ${process.version} does not support using declarations.`);
		return;
	}
	await require('./test-using.js')(xmllint, {xmlValid, schemaOptions});
}

async function testKeepAliveTerminatedFlag() {
	const args = ['--schema', 'test.xsd', '--noout', 'doc.xml'];
	const linter = await xmllint.XMLLint.init();
	try {
		assert.equal(linter.terminated, false);
		await linter.mount(schemaOptions.preload);

		// Errors that the instance survives don't terminate it.
		await linter.addFile('test.xsd', '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><broken');
		await linter.addFile('doc.xml', xmlValid);
		await assert.rejects(linter.process({args}), /parser error/);
		assert.equal(linter.terminated, false);
	} finally {
		linter.terminate();
	}

	assert.equal(linter.terminated, true);
	await assert.rejects(linter.process({args}), /instance is terminated/);
	await assert.rejects(linter.addFile('doc.xml', xmlValid), /instance is terminated/);
	await assert.rejects(linter.mount([]), /instance is terminated/);
}

// Runs each test of the given file in a fresh process.
async function runInFreshProcesses(fileName) {
	const {execFile} = require('child_process');
	const script = require('path').resolve(__dirname, fileName);
	for (const name of require(script)) {
		await new Promise((resolve, reject) => {
			execFile(process.execPath, [script, name], (err, stdout, stderr) => {
				if (err) {
					reject(new Error(`${name} failed:\n${stdout}${stderr}`));
				} else {
					resolve();
				}
			});
		});
	}
}

// The compiled Web Assembly module is kept for the lifetime of the process,
// so the tests that depend on how it gets loaded run in fresh processes.
async function testWasmLoading() {
	await runInFreshProcesses('test-wasm-loading.js');
}

// So are the workers of validateXML.
async function testWorkerReuse() {
	await runInFreshProcesses('test-worker-reuse.js');
}

runTests(
	testWithValidFile,
	testWithValidFileForFormat,
	testWithValidFileForFormatWithoutSchema,
	testWithValidFileForC14n,
	testWithInvalidFile,
	testWithInvalidFileName,
	testWithCustomOptions,
	testWithTwoFiles,
	testWithFilesInSubdirectories,
	testCallsDontShareState,
	testConcurrentCalls,
	testProcessExitsAfterValidateXML,
	testWithLargeFile,
	testKeepAliveDoesNotCarryVerdicts,
	testKeepAliveMaxmemDoesNotCarryOver,
	testKeepAliveAgreesWithValidateXML,
	testKeepAliveRejectsOnTerminate,
	testKeepAliveMemoryOptions,
	testKeepAliveProcessRequiresArgs,
	testKeepAliveRemountAfterReplacingFiles,
	testKeepAliveFileSystemErrorMessage,
	testKeepAliveDispose,
	testKeepAliveWithUsing,
	testKeepAliveTerminatedFlag,
	testWasmLoading,
	testWorkerReuse,
);
