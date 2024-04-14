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
