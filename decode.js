import Jimp from 'jimp';
import jsQR from 'jsqr';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import * as pako from 'pako';

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
 * Automatically detect the correct Structured Append order for QR codes
 * Based on V500 invoice specification: base64-encoded raw DEFLATE compressed XML
 */
async function detectStructuredAppendOrder(qrCodes) {
  console.log('\n--- Auto-detecting Structured Append order ---');

  // Sort by length - shortest is likely padded and goes last
  const sorted = qrCodes.map((qr, i) => ({ qr, index: i, length: qr.data.length }))
    .sort((a, b) => b.length - a.length); // Longest first

  console.log('QR codes by length:');
  sorted.forEach((item, i) => {
    console.log(`  ${i + 1}. QR${item.index + 1}: ${item.length} chars`);
  });

  // Common patterns for 3 QR codes: try logical sequences
  const testOrders = [
    // Most common: medium, long, short (short is padded)
    [sorted[1].index, sorted[0].index, sorted[2].index],
    [sorted[0].index, sorted[1].index, sorted[2].index],
    // Try other combinations
    [sorted[1].index, sorted[2].index, sorted[0].index],
    [sorted[2].index, sorted[0].index, sorted[1].index],
    [sorted[2].index, sorted[1].index, sorted[0].index],
    [sorted[0].index, sorted[2].index, sorted[1].index]
  ];

  for (const order of testOrders) {
    const orderLabels = order.map(i => `QR${i + 1}`).join(' -> ');
    console.log(`Testing: ${orderLabels}`);

    try {
      // Combine QR codes in this order
      let combined = order.map(i => qrCodes[i].data).join('');

      // Clean and trim (remove padding spaces)
      combined = combined.replace(/[\r\n]/g, '').trimEnd();

      // Try to decode and decompress
      const binaryData = Buffer.from(combined, 'base64');
      const decompressed = pako.inflateRaw(binaryData, { to: 'string' });

      // Check if it's valid XML
      if (decompressed.trim().startsWith('<?xml')) {
        console.log(`✓ SUCCESS! Order: ${orderLabels}`);
        console.log(`   Decompressed: ${decompressed.length} characters`);
        console.log(`   XML detected: ${decompressed.substring(0, 100)}...`);

        return {
          order: order,
          orderLabels: orderLabels,
          combinedData: combined,
          decompressedData: decompressed
        };
      }

    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
  }

  return null; // No valid order found
}

/**
 * Automatically detect the correct Structured Append order for QR codes
/**
 * Process base64-encoded deflated data (typically XML) using raw DEFLATE
 */
export async function processDeflatedData(base64Data, outputPath) {
  try {
    console.log('Processing base64-encoded raw DEFLATE data...');

    // Clean base64 data (remove any CR/LF and trim spaces from end)
    const cleanedBase64 = base64Data.replace(/[\r\n\s]/g, '').trim();
    console.log(`Cleaned base64 length: ${cleanedBase64.length} characters`);

    // Decode from base64
    const binaryData = Buffer.from(cleanedBase64, 'base64');
    console.log(`Base64 decoded: ${binaryData.length} bytes`);

    // Decompress using raw DEFLATE (RFC 1951)
    const decompressed = pako.inflateRaw(binaryData, { to: 'string' });
    console.log(`Raw DEFLATE decompressed: ${decompressed.length} characters`);

    // Save decompressed data
    await fs.writeFile(outputPath, decompressed, 'utf8');
    console.log(`Decompressed data saved to: ${outputPath}`);

    // Try to detect if it's XML
    if (decompressed.trim().startsWith('<?xml') || decompressed.trim().startsWith('<')) {
      console.log('✓ Detected XML content');

      // Also save with .xml extension if output doesn't already have it
      if (!outputPath.endsWith('.xml')) {
        const xmlPath = outputPath.replace(/\.[^.]*$/, '.xml');
        await fs.writeFile(xmlPath, decompressed, 'utf8');
        console.log(`XML file also saved as: ${xmlPath}`);
      }
    }

    return {
      originalBytes: binaryData.length,
      decompressedChars: decompressed.length,
      decompressedData: decompressed,
      isXML: decompressed.trim().startsWith('<?xml') || decompressed.trim().startsWith('<')
    };

  } catch (error) {
    throw new Error(`Failed to process raw DEFLATE data: ${error.message}`);
  }
}

/**
 * Extract QR codes from a PDF file by converting pages to images using ImageMagick
 */
export async function decodeQRCodesFromPDF(pdfPath, options = {}) {
  try {
    const {
      outputDir = './pdf_temp',
      density = 300,
      cleanupImages = true
    } = options;

    console.log(`Processing PDF file: ${pdfPath}`);

    // Create temporary directory for extracted images
    await fs.mkdir(outputDir, { recursive: true });

    // Use ImageMagick to convert PDF to PNG images
    const outputPattern = path.join(outputDir, 'page-%03d.png');
    const convertCommand = `convert -density ${density} "${pdfPath}" "${outputPattern}"`;

    console.log('Converting PDF pages to images using ImageMagick...');

    try {
      execSync(convertCommand, { stdio: 'pipe' });
    } catch (error) {
      throw new Error(`ImageMagick conversion failed: ${error.message}`);
    }

    // Find all generated image files
    const files = await fs.readdir(outputDir);
    const imageFiles = files
      .filter(file => file.startsWith('page-') && file.endsWith('.png'))
      .sort(); // Ensure proper order

    if (imageFiles.length === 0) {
      throw new Error('No images were generated from the PDF');
    }

    console.log(`Generated ${imageFiles.length} image(s) from PDF`);

    const allQRCodes = [];
    const tempImagePaths = [];

    // Process each generated image
    for (const imageFile of imageFiles) {
      const imagePath = path.join(outputDir, imageFile);
      tempImagePaths.push(imagePath);

      // Extract page number from filename (page-001.png -> 1)
      const pageMatch = imageFile.match(/page-(\d+)\.png/);
      const pageNum = pageMatch ? parseInt(pageMatch[1], 10) + 1 : 1; // Convert 0-based to 1-based

      console.log(`Processing page ${pageNum}...`);

      try {
        // Decode QR codes from this page image
        const pageQRCodes = await findMultipleQRCodesInImage(imagePath);

        if (pageQRCodes.length > 0) {
          console.log(`Found ${pageQRCodes.length} QR code(s) on page ${pageNum}`);
          pageQRCodes.forEach((qr, index) => {
            allQRCodes.push({
              ...qr,
              page: pageNum,
              qrIndex: index,
              source: `page_${pageNum}_qr_${index + 1}`,
              imagePath: imagePath
            });
          });
        }

      } catch (error) {
        console.warn(`Warning: Error processing page ${pageNum}: ${error.message}`);
        continue;
      }
    }

    // Cleanup temporary images if requested
    if (cleanupImages) {
      console.log('Cleaning up temporary images...');
      for (const imagePath of tempImagePaths) {
        try {
          await fs.unlink(imagePath);
        } catch (error) {
          console.warn(`Warning: Could not delete ${imagePath}: ${error.message}`);
        }
      }
      try {
        await fs.rmdir(outputDir);
      } catch (error) {
        console.warn(`Warning: Could not remove directory ${outputDir}: ${error.message}`);
      }
    }

    return {
      totalPages: imageFiles.length,
      totalQRCodes: allQRCodes.length,
      qrCodes: allQRCodes,
      pdfPath: pdfPath
    };

  } catch (error) {
    throw new Error(`Failed to decode QR codes from PDF ${pdfPath}: ${error.message}`);
  }
}

/**
 * Find multiple QR codes in a single image by scanning different regions and scales
 */
async function findMultipleQRCodesInImage(imagePath) {
  try {
    const image = await Jimp.read(imagePath);
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    const foundQRCodes = [];
    const processedRegions = new Set();

    // Helper function to check if QR is already found
    function isDuplicateQR(newQR, existingQRs) {
      return existingQRs.some(existing =>
        existing.data === newQR.data ||
        (Math.abs(existing.location.topLeftCorner.x - newQR.location.topLeftCorner.x) < 50 &&
          Math.abs(existing.location.topLeftCorner.y - newQR.location.topLeftCorner.y) < 50)
      );
    }

    // Helper function to scan a region
    function scanRegion(img, regionName) {
      const imageData = {
        data: new Uint8ClampedArray(img.bitmap.data),
        width: img.bitmap.width,
        height: img.bitmap.height
      };

      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && !isDuplicateQR(code, foundQRCodes)) {
        foundQRCodes.push({
          data: code.data,
          binaryData: code.binaryData,
          chunks: code.chunks,
          version: code.version,
          location: code.location,
          region: regionName
        });
        return true;
      }
      return false;
    }

    // 1. Scan the full image first
    scanRegion(image, 'full');

    // 2. Try different scales to catch QR codes of different sizes
    const scales = [0.5, 0.75, 1.25, 1.5, 2.0];
    for (const scale of scales) {
      try {
        const scaledImage = image.clone().scale(scale);
        scanRegion(scaledImage, `scaled_${scale}`);
      } catch (error) {
        // Skip this scale if it fails
        continue;
      }
    }

    // 3. Enhanced grid scanning - try different grid sizes
    const gridSizes = [2, 3, 4, 5];

    for (const gridSize of gridSizes) {
      const sectionWidth = Math.floor(width / gridSize);
      const sectionHeight = Math.floor(height / gridSize);

      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const x = col * sectionWidth;
          const y = row * sectionHeight;
          const sectionW = (col === gridSize - 1) ? width - x : sectionWidth;
          const sectionH = (row === gridSize - 1) ? height - y : sectionHeight;

          // Create a cropped image for this section
          try {
            const section = image.clone().crop(x, y, sectionW, sectionH);
            scanRegion(section, `grid_${gridSize}x${gridSize}_${row}_${col}`);
          } catch (error) {
            // Skip this section if cropping fails
            continue;
          }
        }
      }
    }

    // 4. Try overlapping scanning windows
    const windowSize = Math.min(width, height) / 2;
    const stepSize = windowSize / 3;

    for (let y = 0; y <= height - windowSize; y += stepSize) {
      for (let x = 0; x <= width - windowSize; x += stepSize) {
        try {
          const window = image.clone().crop(x, y, windowSize, windowSize);
          scanRegion(window, `window_${Math.floor(x)}_${Math.floor(y)}`);
        } catch (error) {
          continue;
        }
      }
    }

    // 5. Try contrast and brightness adjustments
    const adjustments = [
      { brightness: 0.1, contrast: 0.1 },
      { brightness: -0.1, contrast: 0.1 },
      { brightness: 0.2, contrast: 0.2 },
      { brightness: -0.2, contrast: 0.2 }
    ];

    for (const adj of adjustments) {
      try {
        const adjusted = image.clone().brightness(adj.brightness).contrast(adj.contrast);
        scanRegion(adjusted, `adjusted_b${adj.brightness}_c${adj.contrast}`);
      } catch (error) {
        continue;
      }
    }

    console.log(`  -> Found ${foundQRCodes.length} unique QR codes using multiple scanning methods`);
    return foundQRCodes;

  } catch (error) {
    console.warn(`Warning: Could not scan for QR codes in ${imagePath}: ${error.message}`);
    return [];
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
  node decode.js <document.pdf> [-o output.txt]

Options:
  -o, --output    Output file path (default: decoded_output.txt)
  --keep-images   Keep temporary images when processing PDF files

Examples:
  # Decode single QR code
  node decode.js qr_code.png

  # Decode QR codes from PDF
  node decode.js document.pdf -o result.txt

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
  let keepImages = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputPath = args[++i];
    } else if (args[i] === '--keep-images') {
      keepImages = true;
    } else {
      imagePaths.push(args[i]);
    }
  }

  if (imagePaths.length === 0) {
    console.error('Error: No files specified');
    process.exit(1);
  }

  try {
    // Check if the input is a PDF file
    if (imagePaths.length === 1 && path.extname(imagePaths[0]).toLowerCase() === '.pdf') {
      console.log(`Processing PDF file: ${imagePaths[0]}`);

      const pdfResult = await decodeQRCodesFromPDF(imagePaths[0], {
        cleanupImages: !keepImages
      });

      console.log(`\n--- PDF Processing Results ---`);
      console.log(`Total pages processed: ${pdfResult.totalPages}`);
      console.log(`Total QR codes found: ${pdfResult.totalQRCodes}`);

      if (pdfResult.totalQRCodes === 0) {
        console.log('No QR codes found in the PDF file.');
        process.exit(1);
      }

      // Display information about each QR code found
      let allData = '';
      const structuredAppendCodes = [];

      pdfResult.qrCodes.forEach((qr, index) => {
        console.log(`\nQR Code ${index + 1}:`);
        console.log(`  Page: ${qr.page}`);
        console.log(`  Region: ${qr.region}`);
        console.log(`  Data length: ${qr.data.length} characters`);
        console.log(`  Preview: ${qr.data.substring(0, 50)}${qr.data.length > 50 ? '...' : ''}`);

        // Debug: Show chunks information
        if (qr.chunks && qr.chunks.length > 0) {
          console.log(`  Chunks found: ${qr.chunks.length}`);
          qr.chunks.forEach((chunk, ci) => {
            console.log(`    Chunk ${ci + 1}: type=${chunk.type}, data length=${chunk.data ? chunk.data.length : 'N/A'}`);
            if (chunk.type === 'structuredappend') {
              console.log(`      StructuredAppend: ${chunk.currentSequence}/${chunk.totalSequence}, parity=${chunk.parity}`);
            }
          });
        }

        // Check for Structured Append
        const saInfo = getStructuredAppendInfo(qr);
        if (saInfo) {
          console.log(`  Structured Append: ${saInfo.currentSequence}/${saInfo.totalSequence}, parity=${saInfo.parity}`);
          structuredAppendCodes.push({
            ...qr,
            structuredAppend: saInfo
          });
        } else {
          console.log(`  Structured Append: No`);
          allData += qr.data + '\n';
        }
      });

      // Check for automatic Structured Append detection (V500 invoices)
      if (pdfResult.totalQRCodes === 3) {
        console.log('\n--- Attempting Structured Append Detection ---');
        console.log('Found 3 QR codes - checking for V500 Structured Append sequence...');

        const structuredResult = await detectStructuredAppendOrder(pdfResult.qrCodes);

        if (structuredResult) {
          console.log('\n--- Structured Append SUCCESS ---');
          console.log(`Correct order: ${structuredResult.orderLabels}`);
          console.log(`Combined data: ${structuredResult.combinedData.length} characters`);
          console.log(`Decompressed XML: ${structuredResult.decompressedData.length} characters`);

          // Generate output filenames based on PDF basename
          const pdfBasename = path.basename(imagePaths[0], path.extname(imagePaths[0]));
          const xmlOutputPath = `${pdfBasename}.xml`;
          const base64OutputPath = `${pdfBasename}.base64`;
          
          await fs.writeFile(xmlOutputPath, structuredResult.decompressedData, 'utf8');
          console.log(`✓ V500 XML invoice saved to: ${xmlOutputPath}`);

          // Save raw combined base64 data
          await fs.writeFile(base64OutputPath, structuredResult.combinedData, 'utf8');
          console.log(`✓ Base64 data saved to: ${base64OutputPath}`);

          // Show XML preview
          const preview = structuredResult.decompressedData.substring(0, 300);
          console.log(`\nXML Preview:\n${preview}...`);

          console.log('\n✅ Structured Append QR codes successfully processed!');
          console.log('   This appears to be a Swiss medical invoice (V500 format)');

          console.log('\n✓ Done!');
          return; // Exit successfully
        } else {
          console.log('\n--- No Structured Append Pattern Found ---');
          console.log('Falling back to manual detection...');
        }
      }

      // Handle Structured Append codes if found
      if (structuredAppendCodes.length > 0) {
        console.log(`\n--- Structured Append Processing ---`);
        structuredAppendCodes.sort((a, b) =>
          a.structuredAppend.currentSequence - b.structuredAppend.currentSequence
        );

        const expectedTotal = structuredAppendCodes[0].structuredAppend.totalSequence + 1;
        const sequences = structuredAppendCodes.map(qr => qr.structuredAppend.currentSequence);
        const missingSequences = [];

        for (let i = 0; i < expectedTotal; i++) {
          if (!sequences.includes(i)) {
            missingSequences.push(i);
          }
        }

        console.log(`Expected total: ${expectedTotal}`);
        console.log(`Found: ${structuredAppendCodes.length}`);
        console.log(`Complete: ${missingSequences.length === 0 ? '✓ Yes' : '✗ No'}`);

        if (missingSequences.length > 0) {
          console.log(`Missing sequences: ${missingSequences.join(', ')}`);
          console.log('Warning: Incomplete Structured Append sequence. Results may be corrupted.');
        }

        const structuredData = structuredAppendCodes.map(qr => qr.data).join('');
        console.log(`Structured Append combined length: ${structuredData.length} characters`);

        // Generate output filenames based on PDF basename
        const pdfBasename = path.basename(imagePaths[0], path.extname(imagePaths[0]));
        
        // Try to process as deflated XML data
        try {
          const xmlOutputPath = `${pdfBasename}.xml`;
          const result = await processDeflatedData(structuredData, xmlOutputPath);
          console.log(`\\n--- Decompression Results ---`);
          console.log(`Original compressed size: ${result.originalBytes} bytes`);
          console.log(`Decompressed size: ${result.decompressedChars} characters`);
          console.log(`Content type: ${result.isXML ? 'XML' : 'Unknown'}`);

          if (result.isXML) {
            console.log(`Preview: ${result.decompressedData.substring(0, 200)}...`);
          }

          // Save raw combined base64 data
          const base64OutputPath = `${pdfBasename}.base64`;
          await fs.writeFile(base64OutputPath, structuredData, 'utf8');
          console.log(`✓ Base64 data saved to: ${base64OutputPath}`);

        } catch (decompressError) {
          console.log(`\\nWarning: Could not decompress as deflated data: ${decompressError.message}`);
          console.log('Saving raw combined data instead...');
          const base64OutputPath = `${pdfBasename}.base64`;
          await fs.writeFile(base64OutputPath, structuredData, 'utf8');
          console.log(`✓ Base64 data saved to: ${base64OutputPath}`);
        }
      } else {
        // No structured append, save all QR data
        console.log(`\nSaving ${pdfResult.totalQRCodes} individual QR code(s)...`);
        const pdfBasename = path.basename(imagePaths[0], path.extname(imagePaths[0]));
        const dataOutputPath = `${pdfBasename}.base64`;
        await fs.writeFile(dataOutputPath, allData.trim(), 'utf8');
        console.log(`✓ QR data saved to: ${dataOutputPath}`);
      }

    } else {
      // Handle regular image files
      console.log(`Decoding ${imagePaths.length} image(s)...`);

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
