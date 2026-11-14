# xmllint-wasm

libxml2's xmllint tool compiled to WebAssembly using Emscripten, to be used
in Node.js applications in environments where you can't or don't want to
depend on the native library.

This is a fork of Alan Zakai's amazing work at
[kripken/xml.js](https://github.com/kripken/xml.js)
(be sure to also check out his [blog post](http://mozakai.blogspot.com/2012/03/howto-port-cc-library-to-javascript.html) about
that exact project).
This fork continues the original build with some neat updates
as well as somewhat opinionated breaking changes.

Works in Node.js and modern browsers.

## Overview of changes made to the original project

* libxml2 version is upgraded to v2.15.4
* The output is wasm instead of asm.js
* In addition to modern browsers with wasm support, works in Node.js 22 or later
* Library size is quite a bit smaller, the wasm file and wrapper js files
  weigh about 860K combined
* Allows normalization / formatting of the input XML in addition to validation
* There are some changes to the API, which is described in more detail
  below. Overall this project behaves more like a library that you'd call from
  a JS application, instead of like a command-line tool that xmllint normally is.

## Installation
```sh
npm i xmllint-wasm
```
The library uses Node.js [Worker threads](https://nodejs.org/api/worker_threads.html)
to isolate the Emscripten wrapper from your main process (so that
when it calls process.exit your whole server won't go down).  
We require Node.js version 22 or later.

## API

See type definitions at [index.d.ts](./src/index.d.ts).

### Basic usage
```javascript
const {validateXML, memoryPages} = require('xmllint-wasm');

async function example() {
  const [myXMLFile, mySchemaFile, generalXmlXsdFile] = await Promise.all([
    fs.promises.readFile('./my-xml-file.xml', 'utf8'),
    fs.promises.readFile('./my-schema-file.xsd', 'utf8'),
    // Some other XSD file that our main schema my-schema-file.xsd happens to depend on
    fs.promises.readFile('./xml.xsd', 'utf8'),
  ])

  const validationResult = await validateXML({
    xml: [{
      fileName: 'my-xml-file.xml',
      contents: myXMLFile,
    }],
    // All the schema files that are required to validate the documents.
    // The main XSD should be first in the array, followed by its possible dependencies.
    schema: [mySchemaFile],
    // Optional: Files that the schema file depends on (xsd:import, xsd:include).
    // xmllint-wasm won't make any network requests or other IO to retrieve depdencicy files,
    // so these they must be loaded beforehand and passed in here.
    preload: [{
      fileName: 'xml.xsd',
      contents: generalXmlXsdFile,
    }],
    // Optional: Initial memory capacity in Web Assembly memory pages (1 = 6.4KiB) - 256
    // is minimum and default here (16MiB).
    initialMemoryPages: 256,
    // Optional: Maximum memory capacity, in Web Assembly memory pages. If not
    // set, this will also default to 256 pages. Max is 65536 (4GiB).
    // Use this to raise the memory limit if your XML to validate are large enough to
    // cause out of memory errors.
    // The following example would set the max memory to 2GiB.
    maxMemoryPages: 2 * memoryPages.GiB,
  });
  
  if (validationResult.valid) {
    console.log('There were no errors!')
  } else {
    console.warn(validationResult.errors);
  }
}

```
Giving explicit fileNames is optional (you can just pass the file contents
as string instead), but might help with mapping the correct error to a correct
file if you are validating multiple files at once. 

If you want the output to contain the (formatted) input XML, add
`normalization: 'format'` or `normalization: 'c14n'` to the options.

The return value is a Promise. Even though the xmllint command-line tool
returns with a non-zero exit code if the xml fails to validate, we
don't reject the Promise if there are validation errors as long as
the validation completes successfully. Unexpected errors, like
a syntax error in schema file, do reject the Promise.

The Promise resolved with a object like the following

```javascript

{
  valid: false,
  errors: [
    {
      // Raw output from running xmllint for
      // this particular error/line of the output
      rawMessage: "my-xml-file.xml:21: element quantity: Schemas validity error : Element 'quantity': [facet 'maxExclusive'] The value '1000' must be less than '100'.",
      // Error message without the location info
      message: "element quantity: Schemas validity error : Element 'quantity': [facet 'maxExclusive'] The value '1000' must be less than '100'.",
      // Error location info, if we managed to parse that from the output (null otherwise)
      loc: { fileName: 'my-xml-file.xml', lineNumber: 21 }
    }
  ],
  // Raw output string from running xmllint
  rawOutput: "my-xml-file.xml:21: element quantity: Schemas validity error ...",
  normalized: ""
}
```

### Keeping an instance alive

Each `validateXML` call starts a new worker and Web Assembly runtime, and
copies all the given files to it. When validating many documents against the same
schema set, especially a large one, you can instead keep one `XMLLint` instance
alive and send the schema files to it only once.

```javascript
const {XMLLint, memoryPages} = require('xmllint-wasm');

async function example(documents, schemaFiles) {
  // Optional, same as the memory options of validateXML.
  // Resolves once the worker and its Web Assembly runtime are ready.
  const linter = await XMLLint.init({
    maxMemoryPages: 2 * memoryPages.GiB,
  });
  try {
    // Add the schema files to the instance's in-memory file system once.
    // Calling mount again replaces all previously added files.
    // schemaFiles: [{fileName: 'main.xsd', contents: '...'}, ...]
    await linter.mount(schemaFiles);

    for (const doc of documents) {
      // addFile keeps the other files, and replaces a file with the same name.
      await linter.addFile('doc.xml', doc);
      // Pass the xmllint command line arguments directly.
      // The result has the same format as validateXML's.
      const result = await linter.process({
        args: ['--schema', 'main.xsd', '--noout', 'doc.xml'],
      });
      console.log(result.valid, result.errors);
    }
  } finally {
    // Stops the worker. Pending calls are rejected.
    linter.terminate();
  }
}
```

Unlike `validateXML`, `process` only takes the xmllint command line arguments,
so the files they reference need to be added with `mount` or `addFile` first.

In environments that support
[explicit resource management](https://github.com/tc39/proposal-explicit-resource-management),
you can declare the instance with `using` instead of calling `terminate` yourself.
With TypeScript, this requires the `esnext.disposable` lib (or `esnext`) in your `tsconfig.json`.

```javascript
using linter = await XMLLint.init();
```

`mount` and `addFile` return promises too, which reject if a file can't be written.
Await them, or at least handle their errors: in Node.js, a rejected promise that is
not handled ends the process by default.

If xmllint can't run, like when a schema doesn't parse, that `process` call is
rejected, but the instance stays usable. Only when the worker or its Web Assembly
runtime fails, or after `terminate`, is the instance terminated for good. You can check
`linter.terminated` to know when to create a new instance:

```javascript
if (linter.terminated) {
  linter = await XMLLint.init();
  await linter.mount(schemaFiles);
}
```

Calls to `process` on the same instance are run one at a time, in order.
xmllint still parses the schema on each call, so the speedup depends on how
much of the time goes to starting the runtime and copying the files, compared to
the validation itself.

### Loading the Web Assembly module ahead of time

The Web Assembly module is compiled once, the first time it's needed, and shared by
all later `validateXML` calls and `XMLLint` instances. To have it ready before the
first call, start compiling it early, for example when your page loads:

```javascript
XMLLint.preload();
```

The returned promise never rejects. If the module can't be compiled on the main
thread, like on a page whose Content Security Policy doesn't allow Web Assembly,
each worker loads it itself instead, and `init` or `validateXML` report the error
if that fails too.

### Usage in browsers

Check [./browser-demo/html-data](./browser-demo/html-data) index.html and
logic.js for a full example. Import the browser version, index-browser.js, as an
EcmaScript module and use like you would use the Node.js version.

Works out of the box in latest Chrome, Edge and Safari.  
Firefox, however, does not support Worker modules yet (tracked in issue
[1247687](https://bugzilla.mozilla.org/show_bug.cgi?id=1247687)), which would be
required by the implementation in this library.
To get Firefox to work, you'll need to use a bundler like [Parcel](https://parceljs.org/) or
Webpack to bundle the sources from modules to regular old scripts.

```javascript
import * as xmllint from './node_modules/xmllint/index-browser.mjs';
```

## Building xmllint from source

Clone the project (including the submodules with git `--recursive`) and build.  

### With Docker or Podman

```sh
  npm run build
```

### With locally installed Emscripten

[Install emscripten](https://emscripten.org/docs/getting_started/downloads.html#installation-instructions-using-the-emsdk-recommended)
and source their shell env.  
Finally, run the commands for Emscripten build

```sh
  ./script/clean
  ./script/libxml2
  ./script/compile
  ./script/test
```
There might also be some other system dependencies required for the build that are not listed here.
