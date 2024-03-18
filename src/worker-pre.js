Module['preRun'] = function () {
	Module['inputFiles'].forEach(function(inputFile) {
		FS.writeFile('/' + inputFile['fileName'], inputFile['contents']);
	});
};
