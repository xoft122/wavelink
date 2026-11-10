/* @ts-self-types="./soundkit_wasm.d.ts" */

export class Decoder {
    static __wrap(ptr) {
        const obj = Object.create(Decoder.prototype);
        obj.__wbg_ptr = ptr;
        DecoderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_decoder_free(ptr, 0);
    }
    /**
     * Final EOF/drain call. The decoder should not be reused after this.
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.decoder_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.decoder_new();
        this.__wbg_ptr = ret;
        DecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Decoder}
     */
    static newAuto() {
        const ret = wasm.decoder_newAuto();
        return Decoder.__wrap(ret);
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @returns {Decoder}
     */
    static newRawLinear16(sample_rate, channels) {
        const ret = wasm.decoder_newRawLinear16(sample_rate, channels);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Decoder.__wrap(ret[0]);
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @returns {Decoder}
     */
    static newRawLinear32(sample_rate, channels) {
        const ret = wasm.decoder_newRawLinear32(sample_rate, channels);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Decoder.__wrap(ret[0]);
    }
    /**
     * @param {string} format
     * @returns {Decoder}
     */
    static newWithFormat(format) {
        const ptr0 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decoder_newWithFormat(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Decoder.__wrap(ret[0]);
    }
    /**
     * Push arbitrary encoded bytes and receive all PCM frames currently available.
     *
     * This method drains decoder output after each push. Use `flush()` once at EOF
     * to force final container/codec drain.
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decoder_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) Decoder.prototype[Symbol.dispose] = Decoder.prototype.free;

export class WasmAacDeboxer {
    static __wrap(ptr) {
        const obj = Object.create(WasmAacDeboxer.prototype);
        obj.__wbg_ptr = ptr;
        WasmAacDeboxerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAacDeboxerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaacdeboxer_free(ptr, 0);
    }
    /**
     * Final drain call. The deboxer should not be reused after this.
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmaacdeboxer_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmaacdeboxer_new();
        this.__wbg_ptr = ret;
        WasmAacDeboxerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WasmAacDeboxer}
     */
    static newAuto() {
        const ret = wasm.wasmaacdeboxer_newAuto();
        return WasmAacDeboxer.__wrap(ret);
    }
    /**
     * @param {string} format
     * @returns {WasmAacDeboxer}
     */
    static newWithFormat(format) {
        const ptr0 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaacdeboxer_newWithFormat(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmAacDeboxer.__wrap(ret[0]);
    }
    /**
     * Push arbitrary MP4/M4A bytes and receive AAC config/packet events.
     *
     * Packet events contain ADTS AAC frames in `data` and the original MP4
     * access unit in `rawData`.
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaacdeboxer_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmAacDeboxer.prototype[Symbol.dispose] = WasmAacDeboxer.prototype.free;

export class WasmAacLcDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAacLcDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaaclcdecoder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get channels() {
        const ret = wasm.wasmaaclcdecoder_channels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} access_unit
     * @returns {Float32Array}
     */
    decodeInterleaved(access_unit) {
        const ptr0 = passArray8ToWasm0(access_unit, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaaclcdecoder_decodeInterleaved(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Uint8Array} access_unit
     * @param {Float32Array} output
     * @returns {number}
     */
    decodeInterleavedInto(access_unit, output) {
        const ptr0 = passArray8ToWasm0(access_unit, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaaclcdecoder_decodeInterleavedInto(this.__wbg_ptr, ptr0, len0, output);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {Uint8Array} access_unit
     * @returns {Array<any>}
     */
    decodePlanar(access_unit) {
        const ptr0 = passArray8ToWasm0(access_unit, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaaclcdecoder_decodePlanar(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get framesPerAccessUnit() {
        const ret = wasm.wasmaaclcdecoder_framesPerAccessUnit(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} audio_specific_config
     */
    constructor(audio_specific_config) {
        const ptr0 = passArray8ToWasm0(audio_specific_config, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaaclcdecoder_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmAacLcDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get sampleRate() {
        const ret = wasm.wasmaaclcdecoder_sampleRate(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmAacLcDecoder.prototype[Symbol.dispose] = WasmAacLcDecoder.prototype.free;

/**
 * Incremental AIFF PCM writer. The final frame count makes the first
 * emitted header exact. AIFF holds integer PCM; float input is rounded to
 * the chosen width.
 */
export class WasmAiffEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAiffEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaiffencoder_free(ptr, 0);
    }
    /**
     * @param {Float32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarF32(planar, frames_per_channel) {
        const ptr0 = passArrayF32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaiffencoder_encodePlanarF32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int16Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI16(planar, frames_per_channel) {
        const ptr0 = passArray16ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaiffencoder_encodePlanarI16(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI24(planar, frames_per_channel) {
        const ptr0 = passArray32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaiffencoder_encodePlanarI24(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI32(planar, frames_per_channel) {
        const ptr0 = passArray32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaiffencoder_encodePlanarI32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    finish() {
        const ret = wasm.wasmaiffencoder_finish(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get framesWritten() {
        const ret = wasm.wasmaiffencoder_framesWritten(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    header() {
        const ret = wasm.wasmaiffencoder_header(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {string} sample_format
     * @param {number} total_frames
     */
    constructor(sample_rate, channels, sample_format, total_frames) {
        const ptr0 = passStringToWasm0(sample_format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaiffencoder_new(sample_rate, channels, ptr0, len0, total_frames);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmAiffEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get totalFrames() {
        const ret = wasm.wasmaiffencoder_totalFrames(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmAiffEncoder.prototype[Symbol.dispose] = WasmAiffEncoder.prototype.free;

/**
 * Bounded ALAC access-unit decoder for seekable MP4 and CAF adapters.
 */
export class WasmAlacPacketDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAlacPacketDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmalacpacketdecoder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get bitDepth() {
        const ret = wasm.wasmalacpacketdecoder_bitDepth(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get channels() {
        const ret = wasm.wasmalacpacketdecoder_channels(this.__wbg_ptr);
        return ret;
    }
    /**
     * Decode exactly one container-demuxed ALAC packet.
     * @param {Uint8Array} packet
     * @returns {any}
     */
    decode(packet) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmalacpacketdecoder_decode(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get maximumPcmSamples() {
        const ret = wasm.wasmalacpacketdecoder_maximumPcmSamples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} magic_cookie
     */
    constructor(magic_cookie) {
        const ptr0 = passArray8ToWasm0(magic_cookie, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmalacpacketdecoder_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmAlacPacketDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get sampleRate() {
        const ret = wasm.wasmalacpacketdecoder_sampleRate(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmAlacPacketDecoder.prototype[Symbol.dispose] = WasmAlacPacketDecoder.prototype.free;

export class WasmAudioContentCipher {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAudioContentCipherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaudiocontentcipher_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} key
     */
    constructor(key) {
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiocontentcipher_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmAudioContentCipherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} expected_key_epoch
     * @param {Uint8Array} envelope
     * @param {Uint8Array} authenticated_data
     * @returns {Uint8Array}
     */
    open(expected_key_epoch, envelope, authenticated_data) {
        const ptr0 = passArray8ToWasm0(envelope, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(authenticated_data, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiocontentcipher_open(this.__wbg_ptr, expected_key_epoch, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} key_epoch
     * @param {Uint8Array} nonce
     * @param {Uint8Array} plaintext
     * @param {Uint8Array} authenticated_data
     * @returns {Uint8Array}
     */
    seal(key_epoch, nonce, plaintext, authenticated_data) {
        const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(authenticated_data, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiocontentcipher_seal(this.__wbg_ptr, key_epoch, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmAudioContentCipher.prototype[Symbol.dispose] = WasmAudioContentCipher.prototype.free;

/**
 * Opens the endpoint-specific envelope that transports an audio content key.
 *
 * The wrapping key comes from P-256 ECDH and HKDF-SHA256. The caller supplies
 * the canonical key-exchange context as additional authenticated data.
 */
export class WasmAudioContentKeyUnwrapper {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAudioContentKeyUnwrapperFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaudiocontentkeyunwrapper_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} key
     */
    constructor(key) {
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiocontentkeyunwrapper_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmAudioContentKeyUnwrapperFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} nonce
     * @param {Uint8Array} ciphertext
     * @param {Uint8Array} authenticated_data
     * @returns {Uint8Array}
     */
    open(nonce, ciphertext, authenticated_data) {
        const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(authenticated_data, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiocontentkeyunwrapper_open(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Uint8Array} nonce
     * @param {Uint8Array} plaintext
     * @param {Uint8Array} authenticated_data
     * @returns {Uint8Array}
     */
    seal(nonce, plaintext, authenticated_data) {
        const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(authenticated_data, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiocontentkeyunwrapper_seal(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmAudioContentKeyUnwrapper.prototype[Symbol.dispose] = WasmAudioContentKeyUnwrapper.prototype.free;

export class WasmAudioTrackDemuxer {
    static __wrap(ptr) {
        const obj = Object.create(WasmAudioTrackDemuxer.prototype);
        obj.__wbg_ptr = ptr;
        WasmAudioTrackDemuxerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAudioTrackDemuxerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaudiotrackdemuxer_free(ptr, 0);
    }
    /**
     * Final drain call. The demuxer should not be reused after this.
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmaudiotrackdemuxer_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmaudiotrackdemuxer_new();
        this.__wbg_ptr = ret;
        WasmAudioTrackDemuxerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WasmAudioTrackDemuxer}
     */
    static newAuto() {
        const ret = wasm.wasmaudiotrackdemuxer_newAuto();
        return WasmAudioTrackDemuxer.__wrap(ret);
    }
    /**
     * @param {string} format
     * @returns {WasmAudioTrackDemuxer}
     */
    static newWithFormat(format) {
        const ptr0 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiotrackdemuxer_newWithFormat(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmAudioTrackDemuxer.__wrap(ret[0]);
    }
    /**
     * Push arbitrary container bytes and receive audio-track config/packet events.
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmaudiotrackdemuxer_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmAudioTrackDemuxer.prototype[Symbol.dispose] = WasmAudioTrackDemuxer.prototype.free;

/**
 * Seekable, Rust-validated CAF ALAC packet index.
 */
export class WasmCafAlacIndex {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCafAlacIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcafalacindex_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get bitDepth() {
        const ret = wasm.wasmcafalacindex_bitDepth(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get channels() {
        const ret = wasm.wasmcafalacindex_channels(this.__wbg_ptr);
        return ret;
    }
    /**
     * Validate, decode, priming/remainder trim, and encode one CAF packet.
     * Only the indexed packet bytes cross the WASM boundary.
     * @param {number} index
     * @param {Uint8Array} source_bytes
     * @param {WasmStreamingLibraryEncoder} encoder
     * @returns {any}
     */
    encodeAlacSample(index, source_bytes, encoder) {
        const ptr0 = passArray8ToWasm0(source_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(encoder, WasmStreamingLibraryEncoder);
        const ret = wasm.wasmcafalacindex_encodeAlacSample(this.__wbg_ptr, index, ptr0, len0, encoder.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    get magicCookie() {
        const ret = wasm.wasmcafalacindex_magicCookie(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Uint8Array} description
     * @param {Uint8Array} magic_cookie
     * @param {Uint8Array} packet_table
     * @param {number} data_payload_offset
     * @param {number} data_payload_size
     */
    constructor(description, magic_cookie, packet_table, data_payload_offset, data_payload_size) {
        const ptr0 = passArray8ToWasm0(description, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(magic_cookie, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(packet_table, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafalacindex_new(ptr0, len0, ptr1, len1, ptr2, len2, data_payload_offset, data_payload_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmCafAlacIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Validate exactly one packet range before codec decode.
     * @param {number} index
     * @param {Uint8Array} source_bytes
     * @returns {Uint8Array}
     */
    packet(index, source_bytes) {
        const ptr0 = passArray8ToWasm0(source_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafalacindex_packet(this.__wbg_ptr, index, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get packetCount() {
        const ret = wasm.wasmcafalacindex_packetCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} index
     * @returns {object}
     */
    sample(index) {
        const ret = wasm.wasmcafalacindex_sample(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get sampleRate() {
        const ret = wasm.wasmcafalacindex_sampleRate(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {any}
     */
    get validFrames() {
        const ret = wasm.wasmcafalacindex_validFrames(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmCafAlacIndex.prototype[Symbol.dispose] = WasmCafAlacIndex.prototype.free;

/**
 * Seekable, Rust-validated CAF audio sample index.
 */
export class WasmCafAudioIndex {
    static __wrap(ptr) {
        const obj = Object.create(WasmCafAudioIndex.prototype);
        obj.__wbg_ptr = ptr;
        WasmCafAudioIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCafAudioIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcafaudioindex_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    config() {
        const ret = wasm.wasmcafaudioindex_config(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {WasmCafAudioIndex}
     */
    static fromFile(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafaudioindex_fromFile(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmCafAudioIndex.__wrap(ret[0]);
    }
    /**
     * @param {number} index
     * @param {Uint8Array} source_bytes
     * @returns {any}
     */
    packet(index, source_bytes) {
        const ptr0 = passArray8ToWasm0(source_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafaudioindex_packet(this.__wbg_ptr, index, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} index
     * @returns {object}
     */
    sample(index) {
        const ret = wasm.wasmcafaudioindex_sample(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get sampleCount() {
        const ret = wasm.wasmcafaudioindex_sampleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmCafAudioIndex.prototype[Symbol.dispose] = WasmCafAudioIndex.prototype.free;

/**
 * Incremental Core Audio Format linear-PCM writer. The final frame count
 * makes the first emitted header exact.
 */
export class WasmCafEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCafEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcafencoder_free(ptr, 0);
    }
    /**
     * @param {Float32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarF32(planar, frames_per_channel) {
        const ptr0 = passArrayF32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafencoder_encodePlanarF32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int16Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI16(planar, frames_per_channel) {
        const ptr0 = passArray16ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafencoder_encodePlanarI16(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI24(planar, frames_per_channel) {
        const ptr0 = passArray32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafencoder_encodePlanarI24(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI32(planar, frames_per_channel) {
        const ptr0 = passArray32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafencoder_encodePlanarI32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    finish() {
        const ret = wasm.wasmcafencoder_finish(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get framesWritten() {
        const ret = wasm.wasmcafencoder_framesWritten(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    header() {
        const ret = wasm.wasmcafencoder_header(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {string} sample_format
     * @param {number} total_frames
     */
    constructor(sample_rate, channels, sample_format, total_frames) {
        const ptr0 = passStringToWasm0(sample_format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcafencoder_new(sample_rate, channels, ptr0, len0, total_frames);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmCafEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get totalFrames() {
        const ret = wasm.wasmcafencoder_totalFrames(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmCafEncoder.prototype[Symbol.dispose] = WasmCafEncoder.prototype.free;

/**
 * Format-detecting decode, normalization, and hashing in one bounded session.
 */
export class WasmCanonicalPcmDecoder {
    static __wrap(ptr) {
        const obj = Object.create(WasmCanonicalPcmDecoder.prototype);
        obj.__wbg_ptr = ptr;
        WasmCanonicalPcmDecoderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCanonicalPcmDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcanonicalpcmdecoder_free(ptr, 0);
    }
    /**
     * Drain decoder and normalizer tails and finalize the source identity.
     * @returns {any}
     */
    finish() {
        const ret = wasm.wasmcanonicalpcmdecoder_finish(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmcanonicalpcmdecoder_new();
        this.__wbg_ptr = ret;
        WasmCanonicalPcmDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WasmCanonicalPcmDecoder}
     */
    static newAuto() {
        const ret = wasm.wasmcanonicalpcmdecoder_newAuto();
        return WasmCanonicalPcmDecoder.__wrap(ret);
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @returns {WasmCanonicalPcmDecoder}
     */
    static newRawLinear16(sample_rate, channels) {
        const ret = wasm.wasmcanonicalpcmdecoder_newRawLinear16(sample_rate, channels);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmCanonicalPcmDecoder.__wrap(ret[0]);
    }
    /**
     * @param {string} format
     * @returns {WasmCanonicalPcmDecoder}
     */
    static newWithFormat(format) {
        const ptr0 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcanonicalpcmdecoder_newWithFormat(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmCanonicalPcmDecoder.__wrap(ret[0]);
    }
    /**
     * Decode one bounded source byte range.
     * @param {Uint8Array} bytes
     * @returns {any}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcanonicalpcmdecoder_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmCanonicalPcmDecoder.prototype[Symbol.dispose] = WasmCanonicalPcmDecoder.prototype.free;

export class WasmFlacEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmFlacEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmflacencoder_free(ptr, 0);
    }
    /**
     * @param {Float32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarF32(planar, frames_per_channel) {
        const ptr0 = passArrayF32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmflacencoder_encodePlanarF32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Signal EOF and drain the final FLAC packet.
     * The encoder can buffer a short final block until this call.
     * @returns {Uint8Array}
     */
    finish() {
        const ret = wasm.wasmflacencoder_finish(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {number} bits_per_sample
     * @param {number} frame_size
     * @param {number} compression_level
     */
    constructor(sample_rate, channels, bits_per_sample, frame_size, compression_level) {
        const ret = wasm.wasmflacencoder_new(sample_rate, channels, bits_per_sample, frame_size, compression_level);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmFlacEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        const ret = wasm.wasmflacencoder_reset(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Return the current STREAMINFO metadata block. After finish() this
     * contains the final sample count and PCM MD5.
     * @returns {Uint8Array}
     */
    streamHeader() {
        const ret = wasm.wasmflacencoder_streamHeader(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmFlacEncoder.prototype[Symbol.dispose] = WasmFlacEncoder.prototype.free;

/**
 * Persistent raw-FLAC packet decoder for low-latency transports.
 *
 * Each call consumes one raw FLAC frame and returns one interleaved PCM
 * block. The decoder and its PCM allocation are reused across calls.
 */
export class WasmFlacFrameDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmFlacFrameDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmflacframedecoder_free(ptr, 0);
    }
    /**
     * Decode a packet already copied into `inputPacketView`.
     * @param {number} packet_length
     * @returns {number}
     */
    decodeBuffered(packet_length) {
        const ret = wasm.wasmflacframedecoder_decodeBuffered(this.__wbg_ptr, packet_length);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Decode exactly one raw FLAC frame into interleaved PCM.
     * @param {Uint8Array} packet
     * @returns {Int32Array}
     */
    decodeInterleavedI32(packet) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmflacframedecoder_decodeInterleavedI32(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Decode one packet and return an ephemeral zero-copy PCM view.
     *
     * The view must be consumed before another call into WebAssembly that can
     * grow memory, and its samples are overwritten by the next decode call.
     * Use `decodeInterleavedI32` when the returned PCM must be retained.
     * @param {Uint8Array} packet
     * @returns {Int32Array}
     */
    decodeInterleavedI32View(packet) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmflacframedecoder_decodeInterleavedI32View(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Return the persistent decoded PCM output buffer.
     *
     * Its samples are overwritten by the next decode call. Reacquire the view
     * after any unrelated call that can grow WebAssembly memory.
     * @returns {Int32Array}
     */
    decodedPcmView() {
        const ret = wasm.wasmflacframedecoder_decodedPcmView(this.__wbg_ptr);
        return ret;
    }
    /**
     * Return the reusable encoded-packet input buffer.
     *
     * Copy one packet into this view, then call `decodeBuffered` with its byte
     * length. Reacquire the view after any unrelated call that can grow
     * WebAssembly memory.
     * @returns {Uint8Array}
     */
    inputPacketView() {
        const ret = wasm.wasmflacframedecoder_inputPacketView(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {number} bits_per_sample
     * @param {number} frame_size
     */
    constructor(sample_rate, channels, bits_per_sample, frame_size) {
        const ret = wasm.wasmflacframedecoder_new(sample_rate, channels, bits_per_sample, frame_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmFlacFrameDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get packetCapacity() {
        const ret = wasm.wasmflacframedecoder_packetCapacity(this.__wbg_ptr);
        return ret >>> 0;
    }
    reset() {
        const ret = wasm.wasmflacframedecoder_reset(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get sampleCount() {
        const ret = wasm.wasmflacframedecoder_sampleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {boolean} enabled
     */
    setVerifyChecksums(enabled) {
        wasm.wasmflacframedecoder_setVerifyChecksums(this.__wbg_ptr, enabled);
    }
}
if (Symbol.dispose) WasmFlacFrameDecoder.prototype[Symbol.dispose] = WasmFlacFrameDecoder.prototype.free;

/**
 * Persistent raw-FLAC packet encoder for low-latency transports.
 *
 * Each call consumes exactly one configured PCM block and returns one raw
 * FLAC frame. The encoder and its packet allocation are reused across calls.
 */
export class WasmFlacFrameEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmFlacFrameEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmflacframeencoder_free(ptr, 0);
    }
    /**
     * Encode `inputPcmView` and return an ephemeral zero-copy packet view.
     * @returns {Uint8Array}
     */
    encodeBufferedView() {
        const ret = wasm.wasmflacframeencoder_encodeBufferedView(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Encode exactly one interleaved PCM block into one raw FLAC frame.
     * @param {Int32Array} interleaved
     * @returns {Uint8Array}
     */
    encodeInterleavedI32(interleaved) {
        const ptr0 = passArray32ToWasm0(interleaved, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmflacframeencoder_encodeInterleavedI32(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Encode one block and return an ephemeral zero-copy view of the packet.
     *
     * The view must be consumed before another call into WebAssembly that can
     * grow memory, and its bytes are overwritten by the next encode call. Use
     * `encodeInterleavedI32` when the returned packet must be retained.
     * @param {Int32Array} interleaved
     * @returns {Uint8Array}
     */
    encodeInterleavedI32View(interleaved) {
        const ptr0 = passArray32ToWasm0(interleaved, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmflacframeencoder_encodeInterleavedI32View(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Return the reusable PCM input block for the buffer-reusing API.
     *
     * Fill this view, then call `encodeBufferedView`. WebAssembly memory growth
     * invalidates the view, so reacquire it after calling unrelated Wasm APIs
     * that can allocate.
     * @returns {Int32Array}
     */
    inputPcmView() {
        const ret = wasm.wasmflacframeencoder_inputPcmView(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {number} bits_per_sample
     * @param {number} frame_size
     * @param {number} compression_level
     */
    constructor(sample_rate, channels, bits_per_sample, frame_size, compression_level) {
        const ret = wasm.wasmflacframeencoder_new(sample_rate, channels, bits_per_sample, frame_size, compression_level);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmFlacFrameEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        wasm.wasmflacframeencoder_reset(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    get sampleCount() {
        const ret = wasm.wasmflacframeencoder_sampleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmFlacFrameEncoder.prototype[Symbol.dispose] = WasmFlacFrameEncoder.prototype.free;

/**
 * A library import that reads its source itself.
 *
 * Every other way in makes the caller decide how a file should be read,
 * and that decision is not the caller's to make: whether a source can be
 * pushed from the front or has to be indexed first is a property of the
 * container, which is exactly what this crate knows and JavaScript does
 * not. A QuickTime file keeps its sample table at the end, so streaming it
 * never reaches the table; feeding the table early moves every offset it
 * records. Both mistakes are avoidable only from in here.
 *
 * So the caller hands over a way to read bytes and nothing else. `read` is
 * called as `read(offset, length)` and returns those bytes — in a worker,
 * an OPFS sync access handle answers that directly. Rust detects the
 * container, seeks where it must, and drives the samples.
 */
export class WasmLibraryImport {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLibraryImportFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlibraryimport_free(ptr, 0);
    }
    /**
     * True once every byte the programme needs has been read.
     * @returns {boolean}
     */
    get drained() {
        const ret = wasm.wasmlibraryimport_drained(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Function} read
     * @param {number} size
     * @param {boolean} preserve_lossless
     */
    constructor(read, size, preserve_lossless) {
        const ret = wasm.wasmlibraryimport_new(read, size, preserve_lossless);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmLibraryImportFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Pumps one bounded unit and returns the same batch `push` returns.
     * @param {number} maximum_bytes
     * @returns {any}
     */
    process(maximum_bytes) {
        const ret = wasm.wasmlibraryimport_process(this.__wbg_ptr, maximum_bytes);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * How far through the source this is, from zero to one.
     *
     * The encoder only knows a frame count once it has decoded far enough
     * to have one, and an indexed source knows its position from the
     * start — so the honest number comes from here rather than from the
     * caller guessing at bytes it did not choose to read.
     * @returns {number}
     */
    get progress() {
        const ret = wasm.wasmlibraryimport_progress(this.__wbg_ptr);
        return ret;
    }
    /**
     * What the source turned out to be: `sequential` or `mp4`.
     * @returns {string}
     */
    get shape() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmlibraryimport_shape(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Whether the supplied audio codec is lossless, independently of the
     * FLAC preservation copy requested by the caller.
     * @returns {boolean}
     */
    get sourceLossless() {
        const ret = wasm.wasmlibraryimport_sourceLossless(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) WasmLibraryImport.prototype[Symbol.dispose] = WasmLibraryImport.prototype.free;

/**
 * Streaming Rust fragmented-MP4/CMAF audio-and-video demuxer.
 */
export class WasmMp4MediaDemuxer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMp4MediaDemuxerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmp4mediademuxer_free(ptr, 0);
    }
    /**
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmmp4mediademuxer_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmmp4mediademuxer_new();
        this.__wbg_ptr = ret;
        WasmMp4MediaDemuxerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} track_id
     * @param {number} presentation_time
     * @param {number} packet_duration
     * @param {number} decoded_frames
     * @returns {any}
     */
    pcmTrim(track_id, presentation_time, packet_duration, decoded_frames) {
        const ret = wasm.wasmmp4mediademuxer_pcmTrim(this.__wbg_ptr, track_id, presentation_time, packet_duration, decoded_frames);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmp4mediademuxer_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmMp4MediaDemuxer.prototype[Symbol.dispose] = WasmMp4MediaDemuxer.prototype.free;

/**
 * Seekable, Rust-validated MOV/MP4 audio-and-video sample index.
 */
export class WasmMp4MediaIndex {
    static __wrap(ptr) {
        const obj = Object.create(WasmMp4MediaIndex.prototype);
        obj.__wbg_ptr = ptr;
        WasmMp4MediaIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMp4MediaIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmp4mediaindex_free(ptr, 0);
    }
    /**
     * Validate, decode, edit-list trim, and encode one indexed AAC-LC sample.
     * @param {number} index
     * @param {Uint8Array} source_bytes
     * @param {WasmStreamingLibraryEncoder} encoder
     * @returns {any}
     */
    encodeAacLcSample(index, source_bytes, encoder) {
        const ptr0 = passArray8ToWasm0(source_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(encoder, WasmStreamingLibraryEncoder);
        const ret = wasm.wasmmp4mediaindex_encodeAacLcSample(this.__wbg_ptr, index, ptr0, len0, encoder.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Validate, decode, edit-list trim, and encode one indexed ALAC sample.
     * JavaScript transports only the requested container byte range; PCM
     * remains within Rust throughout the operation.
     * @param {number} index
     * @param {Uint8Array} source_bytes
     * @param {WasmStreamingLibraryEncoder} encoder
     * @returns {any}
     */
    encodeAlacSample(index, source_bytes, encoder) {
        const ptr0 = passArray8ToWasm0(source_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(encoder, WasmStreamingLibraryEncoder);
        const ret = wasm.wasmmp4mediaindex_encodeAlacSample(this.__wbg_ptr, index, ptr0, len0, encoder.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Conformance helper for small complete files. Large browser imports
     * should locate and read only `moov`, then call the constructor.
     * @param {Uint8Array} bytes
     * @returns {WasmMp4MediaIndex}
     */
    static fromFile(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmp4mediaindex_fromFile(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmMp4MediaIndex.__wrap(ret[0]);
    }
    /**
     * Construct from the payload bytes inside a `moov` box. This is the
     * production path for seekable browser files and native file handles.
     * @param {Uint8Array} moov_payload
     */
    constructor(moov_payload) {
        const ptr0 = passArray8ToWasm0(moov_payload, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmp4mediaindex_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmMp4MediaIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Validate and normalize exactly one indexed source range.
     * @param {number} index
     * @param {Uint8Array} source_bytes
     * @returns {object}
     */
    packet(index, source_bytes) {
        const ptr0 = passArray8ToWasm0(source_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmp4mediaindex_packet(this.__wbg_ptr, index, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Return the Rust-owned slice of decoded PCM that belongs to the edited
     * programme. `null` means the whole packet is codec preroll or padding.
     * @param {number} index
     * @param {number} decoded_frames
     * @returns {any}
     */
    pcmTrim(index, decoded_frames) {
        const ret = wasm.wasmmp4mediaindex_pcmTrim(this.__wbg_ptr, index, decoded_frames);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} index
     * @returns {object}
     */
    sample(index) {
        const ret = wasm.wasmmp4mediaindex_sample(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get sampleCount() {
        const ret = wasm.wasmmp4mediaindex_sampleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Array<any>}
     */
    tracks() {
        const ret = wasm.wasmmp4mediaindex_tracks(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmMp4MediaIndex.prototype[Symbol.dispose] = WasmMp4MediaIndex.prototype.free;

/**
 * Streaming Rust MXF KLV demuxer that emits both picture and sound essence.
 */
export class WasmMxfMediaDemuxer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMxfMediaDemuxerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmxfmediademuxer_free(ptr, 0);
    }
    /**
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmmxfmediademuxer_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmmxfmediademuxer_new();
        this.__wbg_ptr = ret;
        WasmMxfMediaDemuxerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmxfmediademuxer_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmMxfMediaDemuxer.prototype[Symbol.dispose] = WasmMxfMediaDemuxer.prototype.free;

export class WasmOpusDeboxer {
    static __wrap(ptr) {
        const obj = Object.create(WasmOpusDeboxer.prototype);
        obj.__wbg_ptr = ptr;
        WasmOpusDeboxerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmOpusDeboxerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmopusdeboxer_free(ptr, 0);
    }
    /**
     * Final drain call. The deboxer should not be reused after this.
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmopusdeboxer_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmopusdeboxer_new();
        this.__wbg_ptr = ret;
        WasmOpusDeboxerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WasmOpusDeboxer}
     */
    static newAuto() {
        const ret = wasm.wasmopusdeboxer_newAuto();
        return WasmOpusDeboxer.__wrap(ret);
    }
    /**
     * @param {string} format
     * @returns {WasmOpusDeboxer}
     */
    static newWithFormat(format) {
        const ptr0 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmopusdeboxer_newWithFormat(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmOpusDeboxer.__wrap(ret[0]);
    }
    /**
     * Push arbitrary container bytes and receive Opus config/packet events.
     *
     * Packet events contain encoded Opus packet bytes suitable for a JS Opus
     * decoder. Config events carry channel/sample-rate/pre-skip metadata.
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmopusdeboxer_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmOpusDeboxer.prototype[Symbol.dispose] = WasmOpusDeboxer.prototype.free;

export class WasmOpusDecodeResult {
    static __wrap(ptr) {
        const obj = Object.create(WasmOpusDecodeResult.prototype);
        obj.__wbg_ptr = ptr;
        WasmOpusDecodeResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmOpusDecodeResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmopusdecoderesult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get decodedSize() {
        const ret = wasm.wasmopusdecoderesult_decodedSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Int16Array}
     */
    get output() {
        const ret = wasm.wasmopusdecoderesult_output(this.__wbg_ptr);
        var v1 = getArrayI16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
}
if (Symbol.dispose) WasmOpusDecodeResult.prototype[Symbol.dispose] = WasmOpusDecodeResult.prototype.free;

export class WasmOpusDecoder {
    static __wrap(ptr) {
        const obj = Object.create(WasmOpusDecoder.prototype);
        obj.__wbg_ptr = ptr;
        WasmOpusDecoderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmOpusDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmopusdecoder_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} packet
     * @returns {WasmOpusDecodeResult}
     */
    dec_frame(packet) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmopusdecoder_dec_frame(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmOpusDecodeResult.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} packet
     * @returns {number}
     */
    dec_frame_reuse(packet) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmopusdecoder_dec_frame_reuse(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @returns {number}
     */
    get decodedSize() {
        const ret = wasm.wasmopusdecoder_decodedSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    destroy() {
        const ptr = this.__destroy_into_raw();
        wasm.wasmopusdecoder_destroy(ptr);
    }
    /**
     * Uses the allocation-light CELT decoder for SoundKit-owned cache
     * streams. It rejects SILK or hybrid packets.
     * @param {number} channels
     * @param {number} sample_rate
     * @param {number} frame_size
     * @returns {WasmOpusDecoder}
     */
    static forSoundKitStream(channels, sample_rate, frame_size) {
        const ret = wasm.wasmopusdecoder_forSoundKitStream(channels, sample_rate, frame_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmOpusDecoder.__wrap(ret[0]);
    }
    /**
     * @param {number} channels
     * @param {number} sample_rate
     * @param {number} frame_size
     */
    constructor(channels, sample_rate, frame_size) {
        const ret = wasm.wasmopusdecoder_new(channels, sample_rate, frame_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmOpusDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get outputLen() {
        const ret = wasm.wasmopusdecoder_outputLen(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get outputPtr() {
        const ret = wasm.wasmopusdecoder_outputPtr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmOpusDecoder.prototype[Symbol.dispose] = WasmOpusDecoder.prototype.free;

export class WasmOpusEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmOpusEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmopusencoder_free(ptr, 0);
    }
    /**
     * @param {Int16Array} interleaved
     * @returns {Uint8Array}
     */
    encodeInterleavedI16(interleaved) {
        const ptr0 = passArray16ToWasm0(interleaved, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmopusencoder_encodeInterleavedI16(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {number} bitrate
     * @param {number} frame_size
     */
    constructor(sample_rate, channels, bitrate, frame_size) {
        const ret = wasm.wasmopusencoder_new(sample_rate, channels, bitrate, frame_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmOpusEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        const ret = wasm.wasmopusencoder_reset(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) WasmOpusEncoder.prototype[Symbol.dispose] = WasmOpusEncoder.prototype.free;

/**
 * One-pass encoder for the library import fast path.
 *
 * A 48 kHz stereo PCM16 WAV is already in the geometry used by the library's
 * Opus cache. Keeping the WAV parser and both encoders together means each
 * bounded input chunk is parsed once and immediately fans out to Opus and,
 * for lossless imports, FLAC. No decoded PCM crosses into JavaScript and no
 * seekable Float32 working copy has to be completed before encoding starts.
 */
export class WasmPcm16WaveLibraryEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmPcm16WaveLibraryEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmpcm16wavelibraryencoder_free(ptr, 0);
    }
    /**
     * Drain the last partial Opus/FLAC blocks. No complete PCM is retained.
     * @returns {any}
     */
    finish() {
        const ret = wasm.wasmpcm16wavelibraryencoder_finish(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {boolean} preserve_lossless
     */
    constructor(preserve_lossless) {
        const ret = wasm.wasmpcm16wavelibraryencoder_new(preserve_lossless);
        this.__wbg_ptr = ret;
        WasmPcm16WaveLibraryEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Parse and encode one bounded WAV byte range.
     * @param {Uint8Array} bytes
     * @returns {any}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmpcm16wavelibraryencoder_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmPcm16WaveLibraryEncoder.prototype[Symbol.dispose] = WasmPcm16WaveLibraryEncoder.prototype.free;

/**
 * Bounded incremental SHA-256 for browser streams that are not otherwise
 * passing through a SoundKit import encoder.
 */
export class WasmSha256 {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSha256Finalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsha256_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    finish() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmsha256_finish(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    constructor() {
        const ret = wasm.wasmsha256_new();
        this.__wbg_ptr = ret;
        WasmSha256Finalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} bytes
     */
    update(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsha256_update(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) WasmSha256.prototype[Symbol.dispose] = WasmSha256.prototype.free;

export class WasmSoundKitFrameDecoder {
    static __wrap(ptr) {
        const obj = Object.create(WasmSoundKitFrameDecoder.prototype);
        obj.__wbg_ptr = ptr;
        WasmSoundKitFrameDecoderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSoundKitFrameDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsoundkitframedecoder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    bufferedBytes() {
        const ret = wasm.wasmsoundkitframedecoder_bufferedBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    clearKey() {
        wasm.wasmsoundkitframedecoder_clearKey(this.__wbg_ptr);
    }
    finish() {
        const ret = wasm.wasmsoundkitframedecoder_finish(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    constructor() {
        const ret = wasm.wasmsoundkitframedecoder_new();
        this.__wbg_ptr = ret;
        WasmSoundKitFrameDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {WasmSoundKitFrameDecoder}
     */
    static newUnencrypted() {
        const ret = wasm.wasmsoundkitframedecoder_newUnencrypted();
        return WasmSoundKitFrameDecoder.__wrap(ret);
    }
    /**
     * @param {string} key
     * @returns {WasmSoundKitFrameDecoder}
     */
    static newWithDecimalKey(key) {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitframedecoder_newWithDecimalKey(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSoundKitFrameDecoder.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} key
     * @returns {WasmSoundKitFrameDecoder}
     */
    static newWithKeyBytes(key) {
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitframedecoder_newWithKeyBytes(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSoundKitFrameDecoder.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitframedecoder_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    reset() {
        wasm.wasmsoundkitframedecoder_reset(this.__wbg_ptr);
    }
    /**
     * @param {string} key
     */
    setDecimalKey(key) {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitframedecoder_setDecimalKey(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array} key
     */
    setKeyBytes(key) {
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitframedecoder_setKeyBytes(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) WasmSoundKitFrameDecoder.prototype[Symbol.dispose] = WasmSoundKitFrameDecoder.prototype.free;

/**
 * A stored SoundKit v2 stream, decoded back to interleaved 16-bit PCM.
 *
 * The browser could already write one of these — the library encoder puts
 * a track down as framed Opus, and a lossless import as framed FLAC beside
 * it — but nothing could read one back, so a page that wanted a waveform
 * or a transport had to deframe and then decode packet by packet, and
 * arrive at its own answer for how a 24-bit frame becomes 16.
 *
 * `SoundKitV2Decoder` already answers all of that in one place, including
 * the width reduction. This is that decoder, reachable.
 */
export class WasmSoundKitV2Decoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSoundKitV2DecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsoundkitv2decoder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    bufferedBytes() {
        const ret = wasm.wasmsoundkitv2decoder_bufferedBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get channels() {
        const ret = wasm.wasmsoundkitv2decoder_channels(this.__wbg_ptr);
        return ret;
    }
    finish() {
        const ret = wasm.wasmsoundkitv2decoder_finish(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    constructor() {
        const ret = wasm.wasmsoundkitv2decoder_new();
        this.__wbg_ptr = ret;
        WasmSoundKitV2DecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Feeds the next slice of the stream and takes whatever it completes.
     *
     * The stream may be cut anywhere; a frame split across two calls is
     * held until the rest of it arrives. Returns interleaved samples,
     * empty when the slice completed no frame.
     * @param {Uint8Array} bytes
     * @returns {Int16Array}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitv2decoder_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Decode interleaved float32 PCM without an intermediate PCM16 conversion.
     * @param {Uint8Array} bytes
     * @returns {Float32Array}
     */
    pushFloat(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsoundkitv2decoder_pushFloat(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    reset() {
        wasm.wasmsoundkitv2decoder_reset(this.__wbg_ptr);
    }
    /**
     * The rate and channel count the last frame declared.
     * @returns {number}
     */
    get sampleRate() {
        const ret = wasm.wasmsoundkitv2decoder_sampleRate(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmSoundKitV2Decoder.prototype[Symbol.dispose] = WasmSoundKitV2Decoder.prototype.free;

/**
 * Bounded, format-detecting library import pipeline.
 *
 * Encoded source bytes enter Rust once. SoundKit decodes them incrementally,
 * normalizes each PCM block to the library's 48 kHz stereo geometry, and
 * immediately emits indexed SoundKit-v2 Opus and optional FLAC packets. PCM
 * never crosses the WASM boundary and no complete decoded source is retained.
 */
export class WasmStreamingLibraryEncoder {
    static __wrap(ptr) {
        const obj = Object.create(WasmStreamingLibraryEncoder.prototype);
        obj.__wbg_ptr = ptr;
        WasmStreamingLibraryEncoderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmStreamingLibraryEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmstreaminglibraryencoder_free(ptr, 0);
    }
    /**
     * Drain decoder, resampler, and codec tails without retaining complete
     * PCM in either Rust or JavaScript.
     * @returns {any}
     */
    finish() {
        const ret = wasm.wasmstreaminglibraryencoder_finish(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {boolean} preserve_lossless
     */
    constructor(preserve_lossless) {
        const ret = wasm.wasmstreaminglibraryencoder_new(preserve_lossless);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmStreamingLibraryEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Open the bounded output pipeline for seekable AAC-LC container samples.
     * @param {Uint8Array} audio_specific_config
     * @param {boolean} preserve_lossless
     * @returns {WasmStreamingLibraryEncoder}
     */
    static newAacLc(audio_specific_config, preserve_lossless) {
        const ptr0 = passArray8ToWasm0(audio_specific_config, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstreaminglibraryencoder_newAacLc(ptr0, len0, preserve_lossless);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmStreamingLibraryEncoder.__wrap(ret[0]);
    }
    /**
     * Open the same bounded output pipeline for a seekable ALAC container.
     * The adapter supplies Rust-validated packet ranges; decoded PCM remains
     * inside this object and feeds the shared Opus/FLAC encoders directly.
     * @param {Uint8Array} magic_cookie
     * @param {boolean} preserve_lossless
     * @returns {WasmStreamingLibraryEncoder}
     */
    static newAlac(magic_cookie, preserve_lossless) {
        const ptr0 = passArray8ToWasm0(magic_cookie, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstreaminglibraryencoder_newAlac(ptr0, len0, preserve_lossless);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmStreamingLibraryEncoder.__wrap(ret[0]);
    }
    /**
     * Decode and encode one bounded source byte range.
     * @param {Uint8Array} bytes
     * @returns {any}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstreaminglibraryencoder_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Decode one indexed AAC-LC access unit and encode its selected frames.
     * @param {Uint8Array} packet
     * @param {number} source_frame_start
     * @param {number} frame_count
     * @returns {any}
     */
    pushAacLcPacket(packet, source_frame_start, frame_count) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstreaminglibraryencoder_pushAacLcPacket(this.__wbg_ptr, ptr0, len0, source_frame_start, frame_count);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Decode one indexed ALAC access unit and encode only its Rust-selected
     * presentation-frame slice.
     * @param {Uint8Array} packet
     * @param {number} source_frame_start
     * @param {number} frame_count
     * @returns {any}
     */
    pushAlacPacket(packet, source_frame_start, frame_count) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstreaminglibraryencoder_pushAlacPacket(this.__wbg_ptr, ptr0, len0, source_frame_start, frame_count);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Hash a bounded source range without decoding it. Seekable container
     * adapters use this while scanning metadata and packet ranges once.
     * @param {Uint8Array} bytes
     */
    updateSourceBytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstreaminglibraryencoder_updateSourceBytes(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) WasmStreamingLibraryEncoder.prototype[Symbol.dispose] = WasmStreamingLibraryEncoder.prototype.free;

/**
 * Pure-Rust video access-unit decoder shared by browser and native imports.
 */
export class WasmVideoDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmVideoDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmvideodecoder_free(ptr, 0);
    }
    /**
     * Decode one complete codec access unit. Non-finite timestamps mean
     * unknown and avoid JavaScript BigInt conversion at this boundary.
     * @param {Uint8Array} access_unit
     * @param {number} pts
     * @param {number} duration
     * @returns {Array<any>}
     */
    decode(access_unit, pts, duration) {
        const ptr0 = passArray8ToWasm0(access_unit, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvideodecoder_decode(this.__wbg_ptr, ptr0, len0, pts, duration);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Decode a complete Annex-B elementary stream. This is intended for
     * import validation; normal playback should use access-unit decoding.
     * @param {Uint8Array} stream
     * @returns {Array<any>}
     */
    decodeStream(stream) {
        const ptr0 = passArray8ToWasm0(stream, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvideodecoder_decodeStream(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmvideodecoder_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} codec
     */
    constructor(codec) {
        const ptr0 = passStringToWasm0(codec, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmvideodecoder_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmVideoDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmVideoDecoder.prototype[Symbol.dispose] = WasmVideoDecoder.prototype.free;

/**
 * Incremental RIFF/RF64 PCM writer. The final frame count makes the first
 * emitted header exact, so browser streams never need a complete WAV buffer.
 */
export class WasmWavEncoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWavEncoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwavencoder_free(ptr, 0);
    }
    /**
     * @param {Float32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarF32(planar, frames_per_channel) {
        const ptr0 = passArrayF32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwavencoder_encodePlanarF32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int16Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI16(planar, frames_per_channel) {
        const ptr0 = passArray16ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwavencoder_encodePlanarI16(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Int32Array} planar
     * @param {number} frames_per_channel
     * @returns {Uint8Array}
     */
    encodePlanarI32(planar, frames_per_channel) {
        const ptr0 = passArray32ToWasm0(planar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwavencoder_encodePlanarI32(this.__wbg_ptr, ptr0, len0, frames_per_channel);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    finish() {
        const ret = wasm.wasmwavencoder_finish(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get framesWritten() {
        const ret = wasm.wasmwavencoder_framesWritten(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    header() {
        const ret = wasm.wasmwavencoder_header(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get isRf64() {
        const ret = wasm.wasmwavencoder_isRf64(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} sample_rate
     * @param {number} channels
     * @param {string} sample_format
     * @param {number} total_frames
     */
    constructor(sample_rate, channels, sample_format, total_frames) {
        const ptr0 = passStringToWasm0(sample_format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwavencoder_new(sample_rate, channels, ptr0, len0, total_frames);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmWavEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get totalFrames() {
        const ret = wasm.wasmwavencoder_totalFrames(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmWavEncoder.prototype[Symbol.dispose] = WasmWavEncoder.prototype.free;

/**
 * Streaming Rust WebM demuxer that emits both video and audio tracks.
 */
export class WasmWebmMediaDemuxer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWebmMediaDemuxerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwebmmediademuxer_free(ptr, 0);
    }
    /**
     * @returns {Array<any>}
     */
    flush() {
        const ret = wasm.wasmwebmmediademuxer_flush(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    constructor() {
        const ret = wasm.wasmwebmmediademuxer_new();
        this.__wbg_ptr = ret;
        WasmWebmMediaDemuxerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {Array<any>}
     */
    push(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwebmmediademuxer_push(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmWebmMediaDemuxer.prototype[Symbol.dispose] = WasmWebmMediaDemuxer.prototype.free;

/**
 * @param {string} session_context
 * @param {string} transport_session_id
 * @param {number} config_generation
 * @param {string} epoch_id
 * @param {string} pts_samples
 * @param {number} sample_rate
 * @param {number} frame_count
 * @param {number} group_count
 * @param {number} group_id
 * @param {number} group_index
 * @param {number} channel_start
 * @param {number} channel_count
 * @param {number} payload_kind
 * @param {number} sample_format
 * @param {number} flags
 * @returns {Uint8Array}
 */
export function buildAudioGroupAssociatedData(session_context, transport_session_id, config_generation, epoch_id, pts_samples, sample_rate, frame_count, group_count, group_id, group_index, channel_start, channel_count, payload_kind, sample_format, flags) {
    const ptr0 = passStringToWasm0(session_context, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(transport_session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(epoch_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(pts_samples, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.buildAudioGroupAssociatedData(ptr0, len0, ptr1, len1, config_generation, ptr2, len2, ptr3, len3, sample_rate, frame_count, group_count, group_id, group_index, channel_start, channel_count, payload_kind, sample_format, flags);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} encoding
 * @param {number} payload_size
 * @param {number} sample_size
 * @param {number} sample_rate
 * @param {number} channels
 * @param {number} bits_per_sample
 * @param {number} pts
 * @returns {Uint8Array}
 */
export function buildSoundKitFrameHeaderV2(encoding, payload_size, sample_size, sample_rate, channels, bits_per_sample, pts) {
    const ret = wasm.buildSoundKitFrameHeaderV2(encoding, payload_size, sample_size, sample_rate, channels, bits_per_sample, pts);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} encoding
 * @param {Uint8Array} payload
 * @param {number} sample_size
 * @param {number} sample_rate
 * @param {number} channels
 * @param {number} bits_per_sample
 * @param {number} pts
 * @returns {Uint8Array}
 */
export function buildSoundKitFrameV2(encoding, payload, sample_size, sample_rate, channels, bits_per_sample, pts) {
    const ptr0 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.buildSoundKitFrameV2(encoding, ptr0, len0, sample_size, sample_rate, channels, bits_per_sample, pts);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Inspect one CAF chunk header without reading its payload.
 * @param {Uint8Array} header
 * @param {number} absolute_offset
 * @param {number} file_size
 * @returns {object}
 */
export function inspectCafChunk(header, absolute_offset, file_size) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inspectCafChunk(ptr0, len0, absolute_offset, file_size);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Inspect one top-level MOV/MP4 box without reading its payload.
 *
 * JavaScript owns only range I/O. Rust owns box sizes, extended sizes, EOF
 * bounds, and the resulting source offsets.
 * @param {Uint8Array} header
 * @param {number} absolute_offset
 * @param {number} file_size
 * @returns {object}
 */
export function inspectMp4TopLevelBox(header, absolute_offset, file_size) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inspectMp4TopLevelBox(ptr0, len0, absolute_offset, file_size);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Validate a CAF file header without reading the source payload.
 * @param {Uint8Array} header
 * @param {number} file_size
 */
export function validateCafFileHeader(header, file_size) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.validateCafFileHeader(ptr0, len0, file_size);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Return the current WebAssembly linear-memory size in bytes.
 * @returns {number}
 */
export function wasmMemoryBytes() {
    const ret = wasm.wasmMemoryBytes();
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_debug_string_a57024b9c6e4a48b: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_undefined_6cff064c44e0d823: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_memory_5dc2a138835b0f8e: function() {
            const ret = wasm.memory;
            return ret;
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_buffer_8117fe4dab119813: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_byteLength_336bc7d303511ba0: function(arg0) {
            const ret = arg0.byteLength;
            return ret;
        },
        __wbg_call_0f2a9af232c18fd2: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_get_971a0c45d172643f: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_e20b893aeafc3fca: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_isArray_6339f732981044bf: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_length_1009454859bb3e03: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_36bd29c6848c2144: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_ecfa2c63d3d0d82c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_116be93542d39019: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_77cc4f4f472aeb81: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_ebe3e0f6837f0879: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_1f7a0d975f26baea: function(arg0, arg1) {
            const ret = new Int32Array(getArrayI32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_3eea173078478cfe: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_6fd7e6a4e2c9de83: function(arg0, arg1) {
            const ret = new Int16Array(getArrayI16FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_709ab7061ebcc5da: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_with_length_3ffc1c56427c525c: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_prototypesetcall_de8e0d9553586985: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_adb0107829f02d75: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_577f5f7485b6744e: function(arg0, arg1, arg2) {
            arg0.set(getArrayF32FromWasm0(arg1, arg2));
        },
        __wbg_set_8155bb79a948541b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_subarray_095365bb46f94afd: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I32)) -> NamedExternref("Int32Array")`.
            const ret = getArrayI32FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./soundkit_wasm_bg.js": import0,
    };
}

const DecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_decoder_free(ptr, 1));
const WasmAacDeboxerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaacdeboxer_free(ptr, 1));
const WasmAacLcDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaaclcdecoder_free(ptr, 1));
const WasmAiffEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaiffencoder_free(ptr, 1));
const WasmAlacPacketDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmalacpacketdecoder_free(ptr, 1));
const WasmAudioContentCipherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaudiocontentcipher_free(ptr, 1));
const WasmAudioContentKeyUnwrapperFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaudiocontentkeyunwrapper_free(ptr, 1));
const WasmAudioTrackDemuxerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaudiotrackdemuxer_free(ptr, 1));
const WasmCafAlacIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcafalacindex_free(ptr, 1));
const WasmCafAudioIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcafaudioindex_free(ptr, 1));
const WasmCafEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcafencoder_free(ptr, 1));
const WasmCanonicalPcmDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcanonicalpcmdecoder_free(ptr, 1));
const WasmFlacEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmflacencoder_free(ptr, 1));
const WasmFlacFrameDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmflacframedecoder_free(ptr, 1));
const WasmFlacFrameEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmflacframeencoder_free(ptr, 1));
const WasmLibraryImportFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlibraryimport_free(ptr, 1));
const WasmMp4MediaDemuxerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmp4mediademuxer_free(ptr, 1));
const WasmMp4MediaIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmp4mediaindex_free(ptr, 1));
const WasmMxfMediaDemuxerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmxfmediademuxer_free(ptr, 1));
const WasmOpusDeboxerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmopusdeboxer_free(ptr, 1));
const WasmOpusDecodeResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmopusdecoderesult_free(ptr, 1));
const WasmOpusDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmopusdecoder_free(ptr, 1));
const WasmOpusEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmopusencoder_free(ptr, 1));
const WasmPcm16WaveLibraryEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmpcm16wavelibraryencoder_free(ptr, 1));
const WasmSha256Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsha256_free(ptr, 1));
const WasmSoundKitFrameDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsoundkitframedecoder_free(ptr, 1));
const WasmSoundKitV2DecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsoundkitv2decoder_free(ptr, 1));
const WasmStreamingLibraryEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmstreaminglibraryencoder_free(ptr, 1));
const WasmVideoDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmvideodecoder_free(ptr, 1));
const WasmWavEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwavencoder_free(ptr, 1));
const WasmWebmMediaDemuxerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwebmmediademuxer_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedInt16ArrayMemory0 = null;
function getInt16ArrayMemory0() {
    if (cachedInt16ArrayMemory0 === null || cachedInt16ArrayMemory0.byteLength === 0) {
        cachedInt16ArrayMemory0 = new Int16Array(wasm.memory.buffer);
    }
    return cachedInt16ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedInt16ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        throw new Error('SoundKit must be initialized with WaveLink bundled bytes');
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
