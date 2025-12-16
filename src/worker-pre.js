Module['preRun'] = Module['preRun'] || [];

Module['preRun'].push(function () {
	Module['__fs_write'] = FS.writeFile;
	Module['__fs_unlink'] = FS.unlink;
});