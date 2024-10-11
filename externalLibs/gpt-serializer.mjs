export class BinarySerializer {
    constructor() {
        this.buffer = [];
    }

    // Serialize a JavaScript value to binary
    encode(value) {
        this.buffer = [];
        this._writeValue(value);
        return new Uint8Array(this.buffer);
    }

    // Deserialize binary data to a JavaScript value
    decode(uint8array) {
        this.buffer = uint8array;
        this.offset = 0;
        return this._readValue();
    }

    // Helper methods for writing data
    _writeValue(value) {
        if (value === null) {
            this.buffer.push(0x00);
        } else if (typeof value === 'number') {
            this.buffer.push(0x01);
            this._writeNumber(value);
        } else if (typeof value === 'boolean') {
            this.buffer.push(0x02);
            this.buffer.push(value ? 0x01 : 0x00);
        } else if (typeof value === 'string') {
            this.buffer.push(0x03);
            this._writeString(value);
        } else if (Array.isArray(value)) {
            this.buffer.push(0x04);
            this._writeArray(value);
        } else if (typeof value === 'object') {
            this.buffer.push(0x05);
            this._writeObject(value);
        } else {
            throw new Error(`Unsupported data type: ${typeof value}`);
        }
    }

    _writeNumber(num) {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setFloat64(0, num, true); // little endian
        for (let i = 0; i < 8; i++) {
            this.buffer.push(view.getUint8(i));
        }
    }

    _writeString(str) {
        const encoder = new TextEncoder();
        const encoded = encoder.encode(str);
        this._writeUint32(encoded.length);
        this.buffer.push(...encoded);
    }

    _writeArray(arr) {
        this._writeUint32(arr.length);
        for (let item of arr) {
            this._writeValue(item);
        }
    }

    _writeObject(obj) {
        const keys = Object.keys(obj);
        this._writeUint32(keys.length);
        for (let key of keys) {
            this._writeString(key);
            this._writeValue(obj[key]);
        }
    }

    _writeUint32(num) {
        // Write as little endian
        this.buffer.push(num & 0xFF);
        this.buffer.push((num >> 8) & 0xFF);
        this.buffer.push((num >> 16) & 0xFF);
        this.buffer.push((num >> 24) & 0xFF);
    }

    // Helper methods for reading data
    _readValue() {
        const type = this._readUint8();
        switch (type) {
            case 0x00:
                return null;
            case 0x01:
                return this._readNumber();
            case 0x02:
                return this._readBoolean();
            case 0x03:
                return this._readString();
            case 0x04:
                return this._readArray();
            case 0x05:
                return this._readObject();
            default:
                throw new Error(`Unknown type marker: ${type}`);
        }
    }

    _readNumber() {
        const bytes = this._readBytes(8);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getFloat64(0, true); // little endian
    }

    _readBoolean() {
        const byte = this._readUint8();
        return byte === 0x01;
    }

    _readString() {
        const length = this._readUint32();
        const bytes = this._readBytes(length);
        const decoder = new TextDecoder();
        return decoder.decode(bytes);
    }

    _readArray() {
        const length = this._readUint32();
        const arr = [];
        for (let i = 0; i < length; i++) {
            arr.push(this._readValue());
        }
        return arr;
    }

    _readObject() {
        const length = this._readUint32();
        const obj = {};
        for (let i = 0; i < length; i++) {
            const key = this._readString();
            const value = this._readValue();
            obj[key] = value;
        }
        return obj;
    }

    _readUint8() {
        if (this.offset >= this.buffer.length) {
            throw new Error('Unexpected end of buffer');
        }
        return this.buffer[this.offset++];
    }

    _readUint32() {
        if (this.offset + 4 > this.buffer.length) {
            throw new Error('Unexpected end of buffer');
        }
        const num = this.buffer[this.offset] |
                    (this.buffer[this.offset + 1] << 8) |
                    (this.buffer[this.offset + 2] << 16) |
                    (this.buffer[this.offset + 3] << 24);
        this.offset += 4;
        return num;
    }

    _readBytes(length) {
        if (this.offset + length > this.buffer.length) {
            throw new Error('Unexpected end of buffer');
        }
        const bytes = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return new Uint8Array(bytes);
    }
}