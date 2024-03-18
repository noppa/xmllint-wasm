;(function initWorker() {
	// #ifdef node
	const {parentPort} = require('worker_threads');
	// #endif

	let stdout = '';
	let stderr = '';

	function onExit(exitCode) {
		const message = {
			exitCode,
			stdout,
			stderr,
		};
		// #ifdef node
		parentPort.postMessage(message);
		// #ifdef browser
		postMessage(message);
		// #endif
	};
	// #endif
	function onWorkerMessage(event) {
		// #ifdef browser
		var data = event.data;
		// #ifdef node
		var data = event;
		// #endif
		const wasmMemory = new WebAssembly.Memory({
			initial: data.initialMemory,
			maximum: data.maxMemory
		});

		Module({
			inputFiles: data.inputFiles,
			arguments: data.args,
			// TODO: We could eagerly start sending stdout to the parent thread while
			// waiting for more. Or we could probably use some other, more efficient
			// Emscripten API for output communication in the first place.
			// But this seems to work fine for now, better than pushing the stdout
			// values to an array.
			print(text) {
				stdout += text + '\n';
			},
			printErr(text) {
				stderr += text + '\n';
			},
			onExit,
			wasmMemory,
			// #ifdef browser
			locateFile(path) {
				if (path !== 'xmllint.wasm') {
					return path;
				}
				// Fix wasm file path to be relative to the worker file path.
				// This also makes bundlers automatically pick up the wasm file.
				return new URL('./xmllint.wasm', import.meta.url).href;
			}
			// #endif
		});
	}


	// #ifdef node
	parentPort.on('message', onWorkerMessage);
	// #ifdef browser
	addEventListener('message', onWorkerMessage);
	// #endif
})();
