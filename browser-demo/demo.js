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
console.log(editor);

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

async function runValidation() {

}

const closedTabStates = new Map();

let previousSelectedFileId;

function selectFile() {
	/** @type {HTMLInputElement} */
	const fileListInput = this;

	if (previousSelectedFileId) {
		const prevEl = fileListInput.parentElement.querySelector(`#${previousSelectedFileId}`);
		closedTabStates.set(prevEl.id, editor.state);
	}

	const prevState = closedTabStates.get(fileListInput.id);
	console.log(prevState);
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
