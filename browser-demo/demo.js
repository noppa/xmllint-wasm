import { EditorState, EditorView, basicSetup } from '@codemirror/basic-setup';
import { xml } from '@codemirror/lang-xml';
import { validateXML } from '../index-browser';

const theme = EditorView.baseTheme({
	'&': {
		height: '100vh',
	}
});

let validationTimer;

const editorExtensions = [
	basicSetup,
	xml(),
	theme,
	EditorView.updateListener.of((v) => {
		if (v.docChanged) {
			if (validationTimer) clearTimeout(validationTimer);
			validationTimer = setTimeout(validate, 3000);
		}
	})];

const editor = new EditorView({
	parent: document.getElementById('editor')
});

let runningValidation = false;

function validate() {
	if (runningValidation) return;
	runningValidation = true;
	runValidation().then(() => {
		runningValidation = false;
	}, (err) => {
		console.error(err);
		runningValidation = false;
	});
}

let currentlySelectedFileId;

async function runValidation() {
	const files = Array.from(
		document.querySelectorAll('input[name="file-list-files"]'),
		(/** @type {HTMLInputElement} */inputEl) => {
			const filename = inputEl.nextSibling.textContent.trim();
			const {id} = inputEl;
			const contents = id === currentlySelectedFileId
				? editor.state.doc.text
				: closedTabStates.get(id)?.doc.toString() || '';
			return {filename, contents};
		}
	);

	const isSchemaFile = (file) => file.filename.endsWith('.xsd');
	const xml = files.filter((file) => !isSchemaFile(file));
	const schema = files.filter(isSchemaFile);

	const perfDebugLabel = 'xmllint-wasm validation';
	console.time(perfDebugLabel);
	try {
		const validationResult = await validateXML({
			xml,
			schema,
		});
		console.log(validationResult);
	} catch(err) {
		console.error(err);
	}
	console.timeEnd(perfDebugLabel);

}

const closedTabStates = new Map();


function selectFile() {
	/** @type {HTMLInputElement} */
	const fileListInput = this;

	if (currentlySelectedFileId) {
		closedTabStates.set(currentlySelectedFileId, editor.state);
	}

	currentlySelectedFileId = fileListInput.id;
	const prevState = closedTabStates.get(currentlySelectedFileId);
	editor.setState(EditorState.create({
		extensions: editorExtensions,
		...prevState,
	}));
}

function addFile(name, form, contents = '') {
	/** @type {HTMLElement} */
	const container = form.querySelector('#file-list-files');
	const labelEl = document.createElement('label');
	const labelText = document.createTextNode(name);
	const filesListCount = container.children.length;
	const newFileInput = document.createElement('input');
	Object.assign(newFileInput, {
		type: 'radio',
		id: 'file-list-' + (filesListCount + 1),
		name: 'file-list-files',
		onclick: selectFile,
	});

	if (contents) {
		closedTabStates.set(newFileInput.id, {doc: contents});
	}

	labelEl.appendChild(newFileInput);
	labelEl.appendChild(labelText);
	container.appendChild(labelEl);

	return newFileInput;
}

async function fetchFile(path) {
	const resp = await fetch(path);
	if (!resp.ok) {
		throw new Error(`Failed to fetch ${path}: ${resp.status} ${resp.statusText}`);
	}
	return resp.text();
}

async function initView() {
	const [exampleXML, exampleSchema] = await Promise.all([
		fetchFile(new URL('../test/test-invalid.xml', import.meta.url)),
		fetchFile(new URL('../test/test.xsd', import.meta.url)),
	]);

	const fileListForm = document.getElementById('file-list');
	fileListForm.addEventListener('submit', (e) => {
		e.preventDefault();
		/** @type{HTMLInputElement} */
		const newNameInput = fileListForm.querySelector('#file-list-new-name');
		addFile(newNameInput.value || 'new.xml', fileListForm);
		newNameInput.value = '';
	});

	addFile('example.xml', fileListForm, exampleXML);
	const schema = addFile('schema.xml', fileListForm, exampleSchema);

	schema.click();
}

window.addEventListener('DOMContentLoaded', initView);
