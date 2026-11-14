import path from 'node:path';
import {fileURLToPath} from 'node:url';
import xmllintWasmBase91 from './plugin.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// The same demo page as ../run_vite, with xmllint.wasm embedded as base91.
export default {
	root: path.join(here, '../html-data'),
	build: {
		outDir: path.join(here, 'dist'),
		emptyOutDir: true,
	},
	plugins: [xmllintWasmBase91()],
};
