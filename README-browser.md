# Building the browser demo from source

* `git submodule init`

* `git submodule update`

* `source /opt/emsdk/emsdk_env.sh` or whereever this is located on your machine

* `./script/clean`

* `./script/libxml2`

* `./script/compile`

* `./script/build-browser-demo`

* `./browser-demo/run_http_server &`

* Open *http://localhost:8088/* in your browser and run the example application.

* Find example files to copy & paste in `./test`.

* Find the sources of the example application in `./browser-demo/html-data/`
