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

	let queue = Promise.resolve();
	let stdout = '';
	let stderr = '';
	let wasmMemory;
	let module;
	// Names of the files added with mount or addFile, to remove on the next mount.
	// A Set, because adding a file with the same name again replaces it.
	const files = new Set();

	function post(message) {
		message[messageKey] = true;
		// #ifdef node
		parentPort.postMessage(message);
		// #ifdef browser
		postMessage(message);
		// #endif
	}

	// We use a 'resolve-only' queue, because otherwise errors don't really bubble up nicely.
	// I intentionally did NOT put a catch block here.
	async function enqueue(fn) {
		const prevQueue = queue;
		let release;
		try {
			queue = new Promise(resolve => {release = resolve;});
			await prevQueue;
			await fn();
		} finally {
			release();
		}
	}

	function onExit(exitCode) {
		const {stdout, stderr} = flush(exitCode);

		post({
			seq: -1,
			type: 'EXIT',
			exitCode, stdout, stderr
		});
	}

	function flush() {
		const message = {
			stdout,
			stderr
		};

		stdout = '';
		stderr = '';

		return message;
	}

	async function init(data) {
		if (wasmMemory) {
			throw new Error('XMLLint Worker already initialised');
		}

		wasmMemory = new WebAssembly.Memory({
			initial: data.initialMemory,
			maximum: data.maxMemory
		});

		module = new Promise((resolve, reject) => {
			// #34 established that a wasm file that cannot be loaded reaches the
			// caller as a WASM Abort. Keep that shape: onAbort does not see this
			// one, because the factory rejects before the runtime exists.
			const abort = (err) => reject(
				new Error('WASM Abort: ' + ((err && err.message) || String(err)))
			);

			const m = Module({
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
				onAbort: abort,
				onExit: (exitCode) => {onExit(exitCode); reject();},
				wasmMemory,
				// #ifdef browser
				locateFile(path) {
					if (path !== 'xmllint.wasm') {
						return path;
					}
					// Fix wasm file path to be relative to the worker file path.
					// This also makes bundlers automatically pick up the wasm file.
					return new URL('./xmllint.wasm', import.meta.url).href;
				},
				// #endif
				onRuntimeInitialized: () => {
					resolve(m);
				}
			});

			Promise.resolve(m).catch(abort);
		});
	}
	async function ensureModule() {
		if (module === undefined) {
			throw new Error('XMLLint worker: cannot run commands before init was called first.');
		}

		return await module;
	}

	// Emscripten's file system errors carry no message, and their errno field is
	// renamed by the Closure compiler, so name the operation and the file instead.
	function fsOperation(description, fileName, fn) {
		try {
			fn();
		} catch (err) {
			throw new Error(`XMLLint worker: could not ${description} "${fileName}" (${(err && err.name) || err})`);
		}
	}

	function writeToVFS(mod, file) {
		const fileName = file['fileName'];
		const path = '/' + fileName;
		fsOperation('write file', fileName, () => {
			// FS.writeFile does not create missing parent directories, so a fileName
			// containing a slash fails with ENOENT. Schema sets that import each
			// other by relative path need those directories to exist.
			const dir = path.substring(0, path.lastIndexOf('/'));
			if (dir.length > 1) {
				mod.__fs_createPath('/', dir.substring(1), true, true);
			}
			mod.__fs_write(path, file['contents']);
		});
		files.add(fileName);
	}

	async function mount(data) {
		const mod = await ensureModule();

		files.forEach(fileName => {
			fsOperation('remove file', fileName, () => mod.__fs_unlink('/' + fileName));
		});

		files.clear();
		data.files.forEach((file) => writeToVFS(mod, file));
	}

	async function addFile(data) {
		const mod = await ensureModule();

		data.files.forEach((file) => writeToVFS(mod, file));
	}

	async function process(data) {
		const mod = await ensureModule();
		const exitCode = mod.callMain(data.args);

		mod._fflush(0);
		mod._putchar(10);

		const {stdout, stderr} = flush();

		// Re-remove the newline char we introduced due to our buffer force (putchar)
		const finalStdout = stdout.slice(0, -1);

		post({
			seq: data.seq,
			type: 'RESULT',
			exitCode, stdout:finalStdout, stderr
		});
	}

	async function onWorkerMessage(event) {
		// #ifdef browser
		var data = event.data;
		// #ifdef node
		var data = event;
		// #endif
		if (!data || data[messageKey] !== true) {
			// Not a message from us, ignore it.
			return;
		}

		if (!data.type) throw new Error('XMLLint worker: Expecting message type in worker message');
		if (!data.seq) throw new Error('XMLLint worker: Expecting sequence number in worker message');

		const handlers = {
			INIT: init,
			MOUNT: mount,
			ADDFILES: addFile,
			PROCESS: process
		};

		const handler = handlers[data.type];
		if (!handler) {
			throw new Error(`XMLLint worker: Unknown message type ${data.type}`);
		}

		// A handler that throws has to answer the message that caused it. Left to
		// reject on its own it would surface as an unhandled rejection here and as
		// a call that never settles on the other side.
		enqueue(() => handler(data).catch((err) => post({
			seq: data.seq,
			error: (err && err.message) || String(err)
		})));
	}


	// #ifdef node
	parentPort.on('message', onWorkerMessage);
	// #ifdef browser
	addEventListener('message', onWorkerMessage);
	// #endif
})();
