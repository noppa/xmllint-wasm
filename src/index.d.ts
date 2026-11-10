export type XMLString = string;

export interface XMLFileInfo {
  readonly fileName: string;
  readonly contents: XMLString | Uint8Array;
}

export type XMLInput = XMLString | XMLFileInfo;

interface Schema { readonly schema: XMLInput | ReadonlyArray<XMLInput> }
interface Normalization {
  /**
   * Pass either --format or --c14n to xmllint to get a formatted
   * version of the input document to "normalized" property of the result.
   * normalization: 'format' reformats and reindents the output.
   * normalization: 'c14n' performs W3C XML Canonicalisation (C14N).
   */
  readonly normalization: 'format' | 'c14n';
}

interface XMLLintOptionsBase {
  /**
   * XML file contents to validate.
   * Note that xmllint only supports UTF-8 encoded files.
  */
  readonly xml: XMLInput | ReadonlyArray<XMLInput>;
	/**
	 * By default, we do some sanity checks on the file names
	 * to make sure they won't be intepreted by xmllint as command line arguments.
	 * This is new in version 5 of the library. If you want to keep the old behavior
	 * and allow filenames starting with dashes, you can set this to true.
	 * Default: false.
	 */
	readonly disableFileNameValidation?: boolean;
  /**
   * Other files that should be added to Emscripten's in-memory
   * file system so that xmllint can access them.
   * Useful if your schema contains imports.
   */
  readonly preload?: null | undefined | XMLFileInfo | ReadonlyArray<XMLFileInfo>;
  /**
   * @default 'schema'
   */
  readonly extension?: 'schema' | 'relaxng';
	/*
	* Maximum memory capacity, in Web Assembly memory pages. If not
	* set, this will also default to 256 pages. Max is 65536 (4GiB).
	* Use this to raise the memory limit if your XML to validate are large enough to
	* cause out of memory errors.
	* The following example would set the max memory to 2GiB.
	*/
  readonly initialMemoryPages?: number;
	/*
	* Maximum memory capacity, in Web Assembly memory pages. If not
	* set, this will also default to 256 pages. Max is 65536 (4GiB).
	* Use this to raise the memory limit if your XML to validate are large enough to
	* cause out of memory errors.
	* The following example would set the max memory to 2GiB.
	*/
  readonly maxMemoryPages?: number;

	/**
	 * Use xmllint's streaming API.
	 * Useful when used in combination with --relaxng or --valid options for validation of
	 * files that are too large to be held in memory.
	 * Default: false.
	 */
	readonly stream?: boolean;

	/**
	 * Allows arbitrary modifications to the arguments passed to xmllint.
	 * Useful for adding custom options that are not supported first-class by
	 * this library.
	 */
	readonly modifyArguments?: (args: string[]) => string[];
}

export type XMLLintOptions = XMLLintOptionsBase & (Schema | Normalization | (Schema & Normalization));

export interface XMLValidationError {
  readonly rawMessage: string;
  /**
   * Error message without the file name and line number.
   */
  readonly message: string;
  /**
   * Position of the error.
   * null if we failed to parse the position from the raw message for some reason.
   */
  readonly loc: null | {
    readonly fileName: string;
    readonly lineNumber: number;
  };
}

export interface XMLValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<XMLValidationError>;
  readonly rawOutput: string;
  /**
   * If the "normalization" option was set in the options, this will contain
   * the formatted output. Otherwise, it will be empty string.
   */
  readonly normalized: string;
}

export function validateXML(options: XMLLintOptions): Promise<XMLValidationResult>;

/**
 * Memory configuration for XMLLint.init, in 64KiB Web Assembly pages.
 * See memoryPages for useful constants.
 */
export interface XMLLintMemoryConfig {
  readonly initialMemory: number;
  readonly maxMemory: number;
}

/**
 * Options for XMLLint#process when passing the xmllint command line arguments directly.
 * The files referenced in the arguments need to be added with mount or addFile first.
 */
export interface XMLLintProcessArgsOptions {
  readonly args: ReadonlyArray<string>;
  readonly modifyArguments?: (args: string[]) => string[];
}

/**
 * Options for XMLLint#process using the same options as validateXML.
 * The xml and schema files are added to the instance's file system
 * (replacing files with the same name) before running xmllint.
 * Preloads and memory options are not supported here: add files with
 * mount or addFile, and configure memory in XMLLint.init.
 */
export type XMLLintProcessFileOptions =
  Omit<XMLLintOptionsBase, 'preload' | 'initialMemoryPages' | 'maxMemoryPages' | 'disableFileNameValidation'>
  & (Schema | Normalization | (Schema & Normalization));

export type XMLLintProcessOptions = XMLLintProcessArgsOptions | XMLLintProcessFileOptions;

/**
 * An xmllint instance that keeps its worker, Web Assembly runtime and
 * in-memory file system alive between calls. Useful when validating many
 * documents against the same (large) schema set, so that the schema files
 * need to be sent to the worker only once.
 *
 * Remember to call terminate when you are done with the instance.
 */
export class XMLLint {
  private constructor();

  /**
   * Starts a new worker and the Web Assembly runtime in it.
   */
  static init(memory?: XMLLintMemoryConfig): XMLLint;

  /**
   * Adds files to the in-memory file system, removing all files
   * previously added with mount or addFile.
   */
  mount(files: ReadonlyArray<XMLFileInfo>): void;

  /**
   * Adds a file to the in-memory file system, keeping the other files.
   * Replaces a previously added file with the same name.
   */
  addFile(fileName: string, contents: XMLString | Uint8Array): void;

  /**
   * Runs xmllint once. Calls on the same instance are run one at a time, in order.
   */
  process(options: XMLLintProcessOptions): Promise<XMLValidationResult>;

  /**
   * Stops the worker. Calls that are still pending are rejected.
   */
  terminate(): void;
}

interface MemoryPagesConstant {
	/**
	 * 1MiB as a number of 64KiB Web Assembly pages.
	 */
	readonly MiB: number;
	/**
	 * 1GiB as a number of 64KiB Web Assembly pages.
	 */
	readonly GiB: number;
	/**
	 * The default number of 64KiB Web Assembly pages for
	 * the initialMemoryPages option (16MiB).
	 */
	readonly defaultInitialMemoryPages: number;
	/**
	 * The default value for the maxMemoryPages option, which defines
	 * the upper limit number of 64KiB Web Assembly pages (32MiB).
	 */
	readonly defaultMaxMemoryPages: number;
	/**
	 * The maximum possible value for the memory options (4GiB).
	 */
	readonly max: number;
}

export const memoryPages: MemoryPagesConstant;
