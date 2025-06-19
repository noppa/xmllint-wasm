# Changelog

## 5.0.0

Officially supported Node.js version is raised from 12 to 16, which is a **breaking change**.

Optimizes the XML file input reading, by switching from Emscripten `FS.createDataFile` to
`FS.writeFile`.  
I'm not 100% certain if this is actually a breaking change or not,
but this could possibly be a **breaking change** if you previously passed in
file contents that were strings, but not from an utf-8 encoded file.  Try
passing the non-utf8 encoded data as a Buffer instead, which we now also explicitly support
in `options.xml[i].contents`.  

Optimizes the output reading, by switching from Emscripten `Module.stdout` API (which apparently
pushed one byte of output at a time to an array), to the `print` API, which pushes more reasonably 
sized chunks of strings to the output string.  
This fixes a crash [#20 "Invalid array length on "large xml" file"](https://github.com/noppa/xmllint-wasm/issues/20),
that occurred on very large outputs.  
In some cases, the old output handling resulted in output not having a last line break at the end of
output. In the new output, the last line break is always included. This could **break** some tests 
where you expect some exact output that didn't previously have said line break in the end.  

We now validate that XML and Schema file names do not start with a dash (`-`), or contain 
a space and a dash (` -`), which would cause xmllint to interpret the file name
as a command line option. File names could be user-inputted, so this change is to
prevent end users from accidentally or maliciously changing the expected behaviour of
the validation. It is recommended, though, to also do stricter validation of file names
if you accept them from user input. 
This is a **breaking change** if you previously passed in file names that started with a dash.  
There is a new option `disableFileNameValidation` to disable this validation if you want
to keep the old behaviour and accept any kind of file name.

Adds new optional option `modifyArguments`, which allows you to arbitrarily add
or modify the command line arguments that are passed to the xmllint command. The
option is a function that receives the current arguments as an array, and should
return a new array of string arguments.  
Closes [#22](https://github.com/noppa/xmllint-wasm/issues/22).

## 4.0.2

Minor improvement to error handling
([#19](https://github.com/noppa/xmllint-wasm/issues/19),
[012dde34b](https://github.com/noppa/xmllint-wasm/commit/012dde34b7f7ca5394703e3a6859d677dde00474)).  

## 4.0.1

Fix to the TypeScript type definitions ([#16](https://github.com/noppa/xmllint-wasm/issues/16)).  
No runtime changes.

## 4.0.0

Add two new options, `initialMemoryPages` and `maxMemoryPages`, to control
how much memory the WebAssembly module allocates by default and is allowed
to allocate for the validation. 
[PR #13](https://github.com/noppa/xmllint-wasm/pull/13),
fixes [issue #8](https://github.com/noppa/xmllint-wasm/issues/8).  
Thanks [@MLSTRM](https://github.com/MLSTRM)!

The "**breaking change**" here is that we also raise the default maximum
memory cap from the old implicit 16MiB to double of that, 32MiB.  
With this new default, you may not even need to use the `maxMemoryPages` option
yourself, as 32MiB is probably already high enough for quite a lot of use cases.

In some _very_ memory constrained environments, this raised limit could impose
a problem if it causes the main process to run out of memory, so that's why
I'm calling it a breaking change. For most applications, though, this should
not be a problem. You can opt into the old limit by setting
```javascript
  maxMemoryPages: 16 * xmllint.memoryPages.MiB,
```

## 3.0.1

Fixes a broken build for Node in the previous version: Worker path
was defined relative to the index JS file, when Node actually resolves
relative Worker paths relative to the current working directory.
Fix by creating an absolute path with `path.resolve(__dirname, ..)`.

## 3.0.0

Should not contain breaking changes for most users, but there are
some internal file renames so I'm doing a major version bump just
in case someone was importing old files like index.js directly. 
`require('xmllint-wasm')` should still work as before.

* Upgrade libxml2 to 2.10.3
* Add browser support (fixes [#1](https://github.com/noppa/xmllint-wasm/issues/1)),
  thanks [@fhaftmann](https://github.com/fhaftmann) and [@th-we](https://github.com/th-we)!

## 2.2.0

No breaking changes to 2.0.0 - 2.1.0.

* Allow `schema` parameter to be omitted if `normalization` is set. i.e. allow
  formatting without doing validation to the XML ([PR #5](https://github.com/noppa/xmllint-wasm/pull/5)).

## 2.1.0

No known breaking changes to 2.0.0.

* Add support for xmllint option `--format` or `--c14n` via new config option
  `normalization` ([PR #3](https://github.com/noppa/xmllint-wasm/pull/3))
* Upgrade libxml2 version to 2.9.12 (fixes [#4](https://github.com/noppa/xmllint-wasm/issues/4) &
  [CVE-2021-3541](https://gitlab.gnome.org/GNOME/libxml2/-/commit/8598060bacada41a0eb09d95c97744ff4e428f8e))

