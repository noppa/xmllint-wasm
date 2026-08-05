;(function initWorker() {
	// #ifdef node
	const {parentPort} = require('worker_threads');
	// #endif

	// Our own messages are tagged with this key so that both sides of the
	// worker channel can tell them apart from unrelated messages that the
	// runtime might send over the same channel, like the "watch:require"
	// messages Node.js sends when running in watch mode.
	// https://github.com/noppa/xmllint-wasm/issues/37
	const messageKey = 'xmllint-wasm';

	let stdout = '';
	let stderr = '';

	function postToParent(message) {
		message[messageKey] = true;
		// #ifdef node
		parentPort.postMessage(message);
		// #ifdef browser
		postMessage(message);
		// #endif
	}

	function onExit(exitCode) {
		postToParent({
			exitCode,
			stdout,
			stderr,
		});
	};
	function onWorkerMessage(event) {
		// #ifdef browser
		var data = event.data;
		// #ifdef node
		var data = event;
		// #endif
		if (!data || data[messageKey] !== true) {
			// Not a message from us, ignore it.
			return;
		}
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
			onAbort(reason) {
				postToParent({
					exitCode: -1,
					stdout: '',
					stderr: 'WASM Abort: ' + reason,
				});
			},
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
