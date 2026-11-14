// basE91 encoding, as described at https://base91.sourceforge.net/.
// It stores binary data in printable ASCII with about 23% overhead, compared
// to base64's 33%.

export const alphabet =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encode(bytes) {
	const out = [];
	let bits = 0;
	let bitCount = 0;
	for (const byte of bytes) {
		bits |= byte << bitCount;
		bitCount += 8;
		if (bitCount > 13) {
			let value = bits & 8191;
			if (value > 88) {
				bits >>= 13;
				bitCount -= 13;
			} else {
				value = bits & 16383;
				bits >>= 14;
				bitCount -= 14;
			}
			out.push(alphabet[value % 91], alphabet[Math.floor(value / 91)]);
		}
	}
	if (bitCount > 0) {
		out.push(alphabet[bits % 91]);
		if (bitCount > 7 || bits > 90) {
			out.push(alphabet[Math.floor(bits / 91)]);
		}
	}
	return out.join('');
}

// The decoder is also inlined into the bundle as source text, so it must not
// refer to anything outside of itself.
/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function decode(text) {
	const alphabet =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';
	const table = new Int8Array(128).fill(-1);
	for (let i = 0; i < alphabet.length; i++) {
		table[alphabet.charCodeAt(i)] = i;
	}

	// Every pair of characters holds 13 or 14 bits.
	const out = new Uint8Array(Math.ceil(text.length * 7 / 8) + 1);
	let length = 0;
	let bits = 0;
	let bitCount = 0;
	let value = -1;
	for (let i = 0; i < text.length; i++) {
		const digit = table[text.charCodeAt(i)];
		if (digit === -1 || digit === undefined) {
			continue;
		}
		if (value < 0) {
			value = digit;
			continue;
		}
		value += digit * 91;
		bits |= value << bitCount;
		bitCount += (value & 8191) > 88 ? 13 : 14;
		do {
			out[length++] = bits & 255;
			bits >>= 8;
			bitCount -= 8;
		} while (bitCount > 7);
		value = -1;
	}
	if (value > -1) {
		out[length++] = (bits | value << bitCount) & 255;
	}
	return out.subarray(0, length);
}
