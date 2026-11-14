// Vite plugin that embeds xmllint.wasm into the JavaScript bundle as a base91
// string, so that loading xmllint-wasm doesn't need a separate request for it.
// See https://github.com/noppa/xmllint-wasm/issues/32.
//
// This is a demo, not a supported part of xmllint-wasm: it depends on how
// index-browser.mjs refers to the wasm file, which can change in any version.
//
// The library compiles the Web Assembly module on the main thread and shares it
// with its workers, so only index-browser.mjs is changed. The worker keeps its
// own reference to the xmllint.wasm file, which Vite still emits, and only
// fetches it if the page can't compile the module itself, like when its
// Content Security Policy doesn't allow Web Assembly.

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {encode, decode} from './base91.mjs';

const virtualId = 'virtual:xmllint-wasm-base91';
const resolvedVirtualId = '\0' + virtualId;
const wasmUrlExpression = 'new URL(\'./xmllint.wasm\', import.meta.url)';

export default function xmllintWasmBase91() {
	/** Directory of the index-browser.mjs that was transformed. */
	let libraryDir = null;

	return {
		name: 'xmllint-wasm-base91',
		// Run before Vite's own handling of new URL(..., import.meta.url), which
		// would otherwise turn the reference into an asset URL first.
		enforce: 'pre',

		resolveId(id) {
			return id === virtualId ? resolvedVirtualId : null;
		},

		async load(id) {
			if (id !== resolvedVirtualId) {
				return null;
			}
			if (!libraryDir) {
				throw new Error(`${virtualId} can only be imported by xmllint-wasm's index-browser.mjs`);
			}
			const wasmPath = path.join(libraryDir, 'xmllint.wasm');
			this.addWatchFile(wasmPath);
			const data = encode(await readFile(wasmPath));
			// The base91 alphabet has no single quotes or backslashes, so the data
			// can be put in a single-quoted string as is.
			return `const data = '${data}';
const decode = ${decode.toString()};
let url = null;

/** A blob: URL to the decoded xmllint.wasm, created on first use. */
export function getWasmUrl() {
	if (!url) {
		url = URL.createObjectURL(new Blob([decode(data)], {type: 'application/wasm'}));
	}
	return url;
}
`;
		},

		transform(code, id) {
			const file = id.split('?')[0];
			if (!file.endsWith('/index-browser.mjs') || !code.includes('xmllint-wasm')) {
				return null;
			}
			const count = code.split(wasmUrlExpression).length - 1;
			if (count !== 1) {
				this.error(`Expected ${file} to refer to xmllint.wasm with ${wasmUrlExpression} once, found it ${count} times. `
					+ 'This version of xmllint-wasm is not supported by this plugin.');
			}
			libraryDir = path.dirname(file);
			return {
				code: `import {getWasmUrl as __xmllintGetWasmUrl} from '${virtualId}';\n`
					+ code.replace(wasmUrlExpression, 'new URL(__xmllintGetWasmUrl())'),
				map: null,
			};
		},
	};
}
