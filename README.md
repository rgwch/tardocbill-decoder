# QR Code Decoder with Structured Append Support

A Node.js project that decodes QR codes from images, including support for **Structured Append** (multi-part QR codes).

## Features

- ✅ Decode single QR codes from image files
- ✅ Decode Structured Append QR code series
- ✅ Save decoded data to files
- ✅ CLI interface for easy usage
- ✅ Library API for programmatic use
- ✅ Support for common image formats (PNG, JPEG, BMP, etc.)

## What is Structured Append?

Structured Append is a QR code feature that allows large data to be split across multiple QR codes. Each code contains:
- A sequence number (its position in the series)
- Total number of codes in the series
- A parity byte for validation

This decoder automatically detects and properly reconstructs data from Structured Append series.

## Installation

```bash
npm install
```

## Usage

### CLI Mode

#### Decode a single QR code:
```bash
node decode.js qr_code.png
```

#### Decode Structured Append series:
```bash
node decode.js qr_part1.png qr_part2.png qr_part3.png -o result.txt
```

#### Specify output file:
```bash
node decode.js qr_code.png --output decoded_data.txt
```

#### Using wildcards:
```bash
node decode.js images/qr_*.png -o output.txt
```

### Library Mode

```javascript
import { decodeQRCode, decodeStructuredAppend, saveDecodedData } from './index.js';

// Decode single QR code
const qrData = await decodeQRCode('qr_code.png');
console.log('Decoded:', qrData.data);

// Decode Structured Append series
const imagePaths = ['part1.png', 'part2.png', 'part3.png'];
const result = await decodeStructuredAppend(imagePaths);

console.log('Is Structured Append:', result.isStructuredAppend);
console.log('Total codes:', result.totalCodes);
console.log('Complete series:', result.complete);
console.log('Decoded data:', result.decodedData);

// Save to file
await saveDecodedData(result.decodedData, 'output.txt');
```

## API Reference

### `decodeQRCode(imagePath)`

Decodes a single QR code from an image file.

**Parameters:**
- `imagePath` (string): Path to the image file

**Returns:** Object containing:
- `data` (string): Decoded text data
- `binaryData` (Uint8Array): Raw binary data
- `chunks` (array): QR code data chunks
- `version` (number): QR code version
- `location` (object): Corner coordinates

### `decodeStructuredAppend(imagePaths)`

Decodes multiple QR codes, with automatic Structured Append detection.

**Parameters:**
- `imagePaths` (array): Array of image file paths

**Returns:** Object containing:
- `isStructuredAppend` (boolean): Whether codes use Structured Append
- `totalCodes` (number): Number of codes decoded
- `expectedTotal` (number): Expected total codes in series
- `missingSequences` (array): Array of missing sequence numbers
- `complete` (boolean): Whether all codes are present
- `decodedData` (string): Combined decoded data
- `codes` (array): Array of individual code data

### `saveDecodedData(data, outputPath)`

Saves decoded data to a file.

**Parameters:**
- `data` (string): Data to save
- `outputPath` (string): Output file path

## Dependencies

- **jimp**: Image processing library
- **jsqr**: QR code decoding library

## Supported Image Formats

- PNG
- JPEG
- BMP
- TIFF
- GIF

## Examples

### Example 1: Basic QR Code Decoding

```javascript
import { decodeQRCode } from './index.js';

const data = await decodeQRCode('my_qr_code.png');
console.log('QR code contains:', data.data);
```

### Example 2: Structured Append Series

```javascript
import { decodeStructuredAppend } from './index.js';

const parts = [
  'qr_series_0.png',
  'qr_series_1.png',
  'qr_series_2.png'
];

const result = await decodeStructuredAppend(parts);

if (result.complete) {
  console.log('Complete series decoded!');
  console.log('Full data:', result.decodedData);
} else {
  console.log('Missing parts:', result.missingSequences);
}
```

### Example 3: Error Handling

```javascript
import { decodeQRCode } from './index.js';

try {
  const data = await decodeQRCode('maybe_qr.png');
  
  if (!data) {
    console.log('No QR code found in image');
  } else {
    console.log('Decoded:', data.data);
  }
} catch (error) {
  console.error('Error:', error.message);
}
```

## Troubleshooting

### No QR code detected
- Ensure the image is clear and high quality
- Check that the QR code has sufficient contrast
- Try increasing image resolution

### Incomplete Structured Append series
- Verify all parts are present
- Check sequence numbers in error message
- Ensure images are named/ordered correctly

## License

ISC
