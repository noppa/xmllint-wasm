;(function initWorker() {
	// #ifdef node
	const {parentPort} = require('worker_threads');
	// #endif

	let queue = Promise.resolve();
	let stdout = '';
	let stderr = '';
	let wasmMemory;
	let module;
	let files = [];

	function post(message) {
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

		stdout='';
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
				onAbort: (err) => reject(err),
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
		});
	}
	async function ensureModule() {
		if (module == undefined) {
			throw new Error('XMLLint worker: cannot run commands before init was called first.');
		}

		return await module;
	}

	function writeToVFS(mod, file) {
		files.push(file['fileName']);
		mod.__fs_write('/' + file['fileName'], file['contents']);
	}

	async function mount(data) {
		const mod = await ensureModule();

		files.forEach(file => {
			mod.__fs_unlink('/' + file);
		});

		files = [];
		data.files.forEach((file) => writeToVFS(mod, file));
	}

	async function addFile(data) {
		const mod = await ensureModule();
		writeToVFS(mod, { fileName: data.fileName , contents: data.contents });
	}

	async function process(data) {
		const mod = await ensureModule();
		const exitCode = mod.callMain(data.args);

		const {stdout, stderr} = flush(exitCode);
		post({
			seq: data.seq,
			type: 'RESULT',
			exitCode, stdout, stderr
		});
	}

	// #endif
	async function onWorkerMessage(event) {
		// #ifdef browser
		var data = event.data;
		// #ifdef node
		var data = event;
		// #endif
		
		if (!data.type) throw new Error('XMLLint worker: Expecting message type in worker message');
		if (!data.seq) throw new Error('XMLLint worker: Expecting sequence number in worker message');

		switch(data.type) {
		case 'INIT':
			enqueue(() => init(data));
			break;
		case 'MOUNT':
			enqueue(() => mount(data));
			break;
		case 'ADDFILE':
			enqueue(() => addFile(data));
			break;
		case 'PROCESS':
			enqueue(() => process(data));
			break;
		default:
			throw new Error(`XMLLint worker: Unknown message type ${data.type}`);
		}
	}


	// #ifdef node
	parentPort.on('message', onWorkerMessage);
	// #ifdef browser
	addEventListener('message', onWorkerMessage);
	// #endif
})();
