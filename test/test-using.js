'use strict';
// Kept in its own file, because Node.js versions that don't support using
// declarations fail to parse the whole file. test.js only loads this when the
// syntax is supported.
const assert = require('assert').strict;

module.exports = async function testKeepAliveWithUsing(xmllint, {xmlValid, schemaOptions}) {
	const args = ['--schema', 'test.xsd', '--noout', 'doc.xml'];
	let pending;
	{
		using linter = xmllint.XMLLint.init();
		linter.mount(schemaOptions.preload);
		linter.addFile('test.xsd', schemaOptions.schema);
		linter.addFile('doc.xml', xmlValid);

		const result = await linter.process({args});
		assert.equal(result.valid, true);

		// Leaving the block disposes the instance, which rejects this call.
		pending = linter.process({args});
	}
	await assert.rejects(pending, /Worker terminated/);
};
