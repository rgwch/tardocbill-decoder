import Jimp from 'jimp';
import jsQR from 'jsqr';
import fs from 'fs/promises';
import path from 'path';

/**
 * Decode a single QR code from an image file
 */
export async function decodeQRCode(imagePath) {
  try {
    const image = await Jimp.read(imagePath);
    const imageData = {
      data: new Uint8ClampedArray(image.bitmap.data),
      width: image.bitmap.width,
      height: image.bitmap.height
    };

    const code = jsQR(imageData.data, imageData.width, imageData.height);
    
    if (!code) {
      return null;
    }

    return {
      data: code.data,
      binaryData: code.binaryData,
      chunks: code.chunks,
      version: code.version,
      location: code.location
    };
  } catch (error) {
    throw new Error(`Failed to decode QR code from ${imagePath}: ${error.message}`);
  }
}

/**
 * Check if QR code is part of a Structured Append sequence
 */
function isStructuredAppend(qrData) {
  if (!qrData.chunks || qrData.chunks.length === 0) {
    return false;
  }

  // Check for Structured Append mode indicator
  return qrData.chunks.some(chunk => chunk.type === 'structuredappend');
}

/**
 * Extract Structured Append information from QR code data
 */
function getStructuredAppendInfo(qrData) {
  if (!qrData.chunks) {
    return null;
  }

  const saChunk = qrData.chunks.find(chunk => chunk.type === 'structuredappend');
  
  if (saChunk) {
    return {
      currentSequence: saChunk.currentSequence,
      totalSequence: saChunk.totalSequence,
      parity: saChunk.parity
    };
  }

  return null;
}

/**
 * Decode multiple QR codes (Structured Append series) from image files
 */
export async function decodeStructuredAppend(imagePaths) {
  const qrCodes = [];

  // Decode all QR codes
  for (const imagePath of imagePaths) {
    const qrData = await decodeQRCode(imagePath);
    
    if (!qrData) {
      console.warn(`Warning: No QR code found in ${imagePath}`);
      continue;
    }

    const saInfo = getStructuredAppendInfo(qrData);
    
    qrCodes.push({
      imagePath,
      data: qrData.data,
      binaryData: qrData.binaryData,
      structuredAppend: saInfo,
      isStructuredAppend: saInfo !== null
    });
  }

  // Check if any codes are Structured Append
  const structuredCodes = qrCodes.filter(qr => qr.isStructuredAppend);
  
  if (structuredCodes.length === 0) {
    // No structured append, return concatenated data
    return {
      isStructuredAppend: false,
      totalCodes: qrCodes.length,
      decodedData: qrCodes.map(qr => qr.data).join(''),
      codes: qrCodes
    };
  }

  // Sort by sequence number
  structuredCodes.sort((a, b) => {
    return a.structuredAppend.currentSequence - b.structuredAppend.currentSequence;
  });

  // Validate sequence
  const expectedTotal = structuredCodes[0].structuredAppend.totalSequence + 1;
  
  if (structuredCodes.length !== expectedTotal) {
    console.warn(`Warning: Expected ${expectedTotal} codes but found ${structuredCodes.length}`);
  }

  // Check for missing sequences
  const sequences = structuredCodes.map(qr => qr.structuredAppend.currentSequence);
  const missingSequences = [];
  
  for (let i = 0; i < expectedTotal; i++) {
    if (!sequences.includes(i)) {
      missingSequences.push(i);
    }
  }

  // Combine data
  const combinedData = structuredCodes.map(qr => qr.data).join('');

  return {
    isStructuredAppend: true,
    totalCodes: structuredCodes.length,
    expectedTotal: expectedTotal,
    missingSequences: missingSequences,
    complete: missingSequences.length === 0,
    decodedData: combinedData,
    codes: structuredCodes
  };
}

/**
 * Save decoded data to a file
 */
export async function saveDecodedData(data, outputPath) {
  try {
    await fs.writeFile(outputPath, data, 'utf8');
    console.log(`Decoded data saved to: ${outputPath}`);
  } catch (error) {
    throw new Error(`Failed to save decoded data: ${error.message}`);
  }
}

/**
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
QR Code Decoder with Structured Append Support

Usage:
  node decode.js <image1.png> [image2.png ...] [-o output.txt]

Options:
  -o, --output    Output file path (default: decoded_output.txt)

Examples:
  # Decode single QR code
  node decode.js qr_code.png

  # Decode Structured Append series
  node decode.js qr_part1.png qr_part2.png qr_part3.png -o result.txt

  # Decode multiple files with pattern
  node decode.js qr_*.png -o output.txt
    `);
    process.exit(0);
  }

  // Parse arguments
  const imagePaths = [];
  let outputPath = 'decoded_output.txt';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputPath = args[++i];
    } else {
      imagePaths.push(args[i]);
    }
  }

  if (imagePaths.length === 0) {
    console.error('Error: No image files specified');
    process.exit(1);
  }

  console.log(`Decoding ${imagePaths.length} image(s)...`);

  try {
    if (imagePaths.length === 1) {
      // Single QR code
      const qrData = await decodeQRCode(imagePaths[0]);
      
      if (!qrData) {
        console.error('Error: No QR code found in image');
        process.exit(1);
      }

      console.log('✓ QR code decoded successfully');
      console.log(`Data length: ${qrData.data.length} characters`);
      console.log(`Data preview: ${qrData.data.substring(0, 100)}${qrData.data.length > 100 ? '...' : ''}`);

      await saveDecodedData(qrData.data, outputPath);
    } else {
      // Multiple QR codes (potential Structured Append)
      const result = await decodeStructuredAppend(imagePaths);

      console.log(`\n--- Decode Results ---`);
      console.log(`Type: ${result.isStructuredAppend ? 'Structured Append' : 'Multiple QR codes'}`);
      console.log(`Total codes decoded: ${result.totalCodes}`);
      
      if (result.isStructuredAppend) {
        console.log(`Expected total: ${result.expectedTotal}`);
        console.log(`Complete: ${result.complete ? '✓ Yes' : '✗ No'}`);
        
        if (result.missingSequences.length > 0) {
          console.log(`Missing sequences: ${result.missingSequences.join(', ')}`);
        }
      }

      console.log(`Combined data length: ${result.decodedData.length} characters`);
      console.log(`Data preview: ${result.decodedData.substring(0, 100)}${result.decodedData.length > 100 ? '...' : ''}`);

      await saveDecodedData(result.decodedData, outputPath);
    }

    console.log('\n✓ Done!');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
