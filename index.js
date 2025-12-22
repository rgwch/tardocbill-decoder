import { decodeQRCode, decodeStructuredAppend, saveDecodedData, decodeQRCodesFromPDF, processDeflatedData } from './decode.js';

// Export functions for use as a library
export { decodeQRCode, decodeStructuredAppend, saveDecodedData, decodeQRCodesFromPDF, processDeflatedData };

// Example usage as a library
export async function decodeAndSave(imagePath, outputPath) {
  const qrData = await decodeQRCode(imagePath);

  if (!qrData) {
    throw new Error('No QR code found in image');
  }

  await saveDecodedData(qrData.data, outputPath);
  return qrData;
}

export async function decodeMultipleAndSave(imagePaths, outputPath) {
  const result = await decodeStructuredAppend(imagePaths);
  await saveDecodedData(result.decodedData, outputPath);
  return result;
}

export async function decodePDFAndSave(pdfPath, outputPath, options = {}) {
  const result = await decodeQRCodesFromPDF(pdfPath, options);

  if (result.totalQRCodes === 0) {
    throw new Error('No QR codes found in PDF');
  }

  // Combine all QR code data
  const allData = result.qrCodes.map(qr => qr.data).join('\n');
  await saveDecodedData(allData, outputPath);
  return result;
}

// Simple example
async function example() {
  console.log('QR Decoder Library');
  console.log('==================\n');
  console.log('This library can decode:');
  console.log('  • Single QR codes from images');
  console.log('  • Structured Append QR code series');
  console.log('  • QR codes from PDF documents\n');
  console.log('Usage:');
  console.log('  import { decodeQRCode, decodeStructuredAppend, decodeQRCodesFromPDF } from "./index.js";\n');
  console.log('  // Decode single QR code');
  console.log('  const data = await decodeQRCode("qr_code.png");\n');
  console.log('  // Decode Structured Append series');
  console.log('  const result = await decodeStructuredAppend(["part1.png", "part2.png"]);\n');
  console.log('  // Decode QR codes from PDF');
  console.log('  const pdfResult = await decodeQRCodesFromPDF("document.pdf");\n');
  console.log('Run: node decode.js --help for CLI usage');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  example();
}
