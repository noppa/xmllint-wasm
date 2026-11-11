/*
 * Entry point of the wasm build, in place of libxml2's lintmain.c.
 *
 * One Emscripten instance is kept alive and main is called once per run, so
 * main must leave the process as it found it. xmllintMain keeps its state per
 * call, except for --maxmem: that installs allocators which enforce the limit,
 * and xmllintMain never removes them. Left in place, they fail every allocation
 * in the next run, which has a limit of 0. Restore the allocators that were in
 * use before the run, as libxml2's own fuzzer does after each call.
 */

#include <stdio.h>

#include <libxml/xmlmemory.h>

#include "private/lint.h"

int
main(int argc, char **argv) {
    xmlFreeFunc freeFunc;
    xmlMallocFunc mallocFunc;
    xmlReallocFunc reallocFunc;
    xmlStrdupFunc strdupFunc;
    int ret;

    xmlMemGet(&freeFunc, &mallocFunc, &reallocFunc, &strdupFunc);
    ret = xmllintMain(argc, (const char **) argv, stderr, NULL);
    xmlMemSetup(freeFunc, mallocFunc, reallocFunc, strdupFunc);

    return ret;
}
