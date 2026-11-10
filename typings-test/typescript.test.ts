import * as xmllint from '../index-node'
import * as fs from 'fs'


xmllint.validateXML({
	xml: [],
	normalization: 'format',
});

xmllint.validateXML({
	// Error expected: normalization or schema param is required
});


async function example() {
	const [myXMLFile, mySchemaFile] = await Promise.all([
		// Read as a Buffer to test that the types also accept that
		fs.promises.readFile('./my-xml-file.xml'),
		fs.promises.readFile('./my-schema-file.xml', 'utf8'),
	])

	const validationResult = await xmllint.validateXML({
		xml: [{
			fileName: 'my-xml-file.xml',
			contents: myXMLFile,
		}],
		// All the schema files that are required to validate the documents.
		// The main XSD should be first in the array, followed by its possible dependencies.
		schema: [mySchemaFile],
	});

	if (validationResult.valid) {
		console.log('There were no errors!')
	} else {
		console.warn(validationResult.errors);
	}
}

async function keepAliveExample(schema: string, xml: Buffer) {
	const linter = await xmllint.XMLLint.init({
		initialMemoryPages: xmllint.memoryPages.defaultInitialMemoryPages,
		maxMemoryPages: 2 * xmllint.memoryPages.GiB,
	});
	try {
		await linter.mount([{fileName: 'schema.xsd', contents: schema}]);
		await linter.addFile('doc.xml', xml);
		const result = await linter.process({
			args: ['--schema', 'schema.xsd', '--noout', 'doc.xml'],
			modifyArguments: (args) => [...args, '--nonet'],
		});
		console.log(result.valid, result.errors, linter.terminated);
		// Error expected: terminated is read-only
		linter.terminated = true;

		linter.process({
			// Error expected: process only accepts xmllint arguments, not validateXML's options
			xml,
			schema,
		});
	} finally {
		linter.terminate();
	}
}

async function keepAliveWithUsing(xml: string) {
	using linter = await xmllint.XMLLint.init();
	await linter.addFile('doc.xml', xml);
	await linter.process({args: ['--noout', 'doc.xml']});
}

// Error expected: use XMLLint.init instead
new xmllint.XMLLint();
