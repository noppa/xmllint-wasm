// @flow
import * as xmllint from '../index-node';

xmllint.validateXML({
	xml: [],
	normalization: 'format',
});

xmllint.validateXML({
	// Error expected: normalization or schema param is required
});

import * as fs from 'fs';

async function example() {
	const [myXMLFile, mySchemaFile] = await Promise.all([
		fs.promises.readFile('./my-xml-file.xml', 'utf8'),
		fs.promises.readFile('./my-schema-file.xml', 'utf8'),
	]);

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
		console.log('There were no errors!');
	} else {
		console.warn(validationResult.errors);
	}
}

async function keepAliveExample(schema: string, xml: string) {
	const linter = xmllint.XMLLint.init({
		initialMemory: xmllint.memoryPages.defaultInitialMemoryPages,
		maxMemory: 2 * xmllint.memoryPages.GiB,
	});
	try {
		linter.mount([{fileName: 'schema.xsd', contents: schema}]);
		linter.addFile('doc.xml', xml);
		const fromArgs = await linter.process({args: ['--schema', 'schema.xsd', '--noout', 'doc.xml']});
		const fromOptions = await linter.process({xml, schema, normalization: 'format'});
		console.log(fromArgs.valid, fromOptions.normalized);

		linter.process({
			xml,
			schema,
			// Error expected: preload is not supported in process, use mount or addFile
			preload: [{fileName: 'other.xsd', contents: schema}],
		});
	} finally {
		linter.terminate();
	}
}
