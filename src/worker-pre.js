Module['preRun'] = function () {
	Module['inputFiles'].forEach(function(inputFile) {
		var path = '/' + inputFile['fileName'];
		// FS.writeFile does not create missing parent directories, so a fileName
		// containing a slash fails with ENOENT. Schema sets that import each
		// other by relative path need those directories to exist.
		var dir = path.substring(0, path.lastIndexOf('/'));
		if (dir.length > 1) {
			FS.createPath('/', dir.substring(1), true, true);
		}
		FS.writeFile(path, inputFile['contents']);
	});
};
