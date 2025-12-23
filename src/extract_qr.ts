
import * as fs from 'fs';
import * as path from 'path';
import * as pdf2pic from 'pdf2pic';
import { Jimp } from 'jimp';
import jsQR from 'jsqr';
import * as pako from 'pako';
import { execSync } from 'child_process';

interface StructuredAppendQR {
    position: number;
    total: number;
    data: string;
}

/**
 * Extract all QR codes from the pdf file, decode the structured append QR codes,
 * decompress the DEFLATE data and return the XML content.
 * 
 * @param pdfPath Path to the PDF file containing QR codes
 * @returns The decoded XML content from the structured append QR codes
 */
export async function extract_qr(pdfPath: string): Promise<string> {
    try {
        // Create tmp directory if it doesn't exist
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Convert PDF to images with high quality settings
        console.log('Converting PDF to images with high quality...');
        const convert = pdf2pic.fromPath(pdfPath, {
            density: 600,           // Increased to 600 DPI for better quality
            saveFilename: "page",
            savePath: tmpDir,
            format: "png",
            width: 4960,           // A4 at 600 DPI (double resolution)
            height: 7016,
            quality: 100,          // Maximum quality
            preserveAspectRatio: true
        });

        let result;
        let imagePath;
        
        // First try using poppler-utils pdftoppm for better quality
        try {
            console.log('Trying pdftoppm conversion...');
            const ppmOutput = path.join(tmpDir, 'page_poppler.png');
            
            // Use pdftoppm with high DPI for better quality
            const command = `pdftoppm -png -r 600 -singlefile "${pdfPath}" "${path.join(tmpDir, 'page_poppler')}"`;
            execSync(command, { stdio: 'ignore' });
            
            if (fs.existsSync(ppmOutput)) {
                imagePath = ppmOutput;
                console.log(`PDF converted with pdftoppm: ${imagePath}`);
            } else {
                throw new Error('pdftoppm conversion failed');
            }
        } catch (error) {
            console.log('pdftoppm conversion failed, trying pdf2pic...');
            
            try {
                result = await convert(1); // Convert first page
                
                if (!result) {
                    throw new Error('Failed to convert PDF to image');
                }
                
                imagePath = result.path;
                console.log(`PDF converted to image: ${imagePath}`);
            } catch (error) {
                console.log('High quality conversion failed, trying alternative settings...');
                
                // Fallback with different settings
                const fallbackConvert = pdf2pic.fromPath(pdfPath, {
                    density: 400,
                    saveFilename: "page_fallback",
                    savePath: tmpDir,
                    format: "png",
                    quality: 100,
                    preserveAspectRatio: true
                });
                
                result = await fallbackConvert(1);
                if (!result) {
                    throw new Error('All conversion attempts failed');
                }
                imagePath = result.path;
                console.log(`PDF converted with fallback settings: ${imagePath}`);
            }
        }

        // Read and process the image
        console.log('Reading converted image...');
        const image = await Jimp.read(imagePath);
        
        // Apply image enhancements for better QR code detection
        console.log('Applying image enhancements...');
        const enhancedImage = image
            .contrast(0.3)        // Increase contrast
            .brightness(0.1)      // Slight brightness increase
            .normalize();         // Normalize histogram
            
        const imageData = enhancedImage.bitmap;
        console.log(`Image loaded and enhanced: ${imageData.width}x${imageData.height} pixels`);
        console.log(`Image loaded: ${imageData.width}x${imageData.height} pixels`);

        // Extract QR codes from the image using zbarimg (more reliable for these QR codes)
        console.log('Scanning for QR codes with zbarimg...');
        try {
            const zbarCommand = `zbarimg "${imagePath}"`;
            const zbarOutput = execSync(zbarCommand, { encoding: 'utf8' });
            
            if (zbarOutput && zbarOutput.trim()) {
                console.log('✅ QR codes found with zbarimg!');
                
                // Parse zbar output - format is "QR-Code:data"
                const qrLines = zbarOutput.trim().split('\n');
                const qrDataArray: string[] = [];
                
                for (const line of qrLines) {
                    if (line.startsWith('QR-Code:')) {
                        const qrData = line.substring(8); // Remove "QR-Code:" prefix
                        qrDataArray.push(qrData);
                        console.log(`Found QR code with ${qrData.length} characters`);
                    }
                }
                
                if (qrDataArray.length === 0) {
                    throw new Error('No QR code data found in zbar output');
                }
                
                // For structured append QR codes, we should combine all the data
                // Based on the job description, there should be 4 QR codes
                let combinedData = '';
                if (qrDataArray.length === 1) {
                    // Single QR code or already combined data
                    combinedData = qrDataArray[0];
                    console.log('Using single QR code data');
                } else {
                    // Multiple QR codes - combine them
                    console.log(`Combining ${qrDataArray.length} QR codes...`);
                    combinedData = qrDataArray.join('');
                }
                
                // Remove trailing spaces (as mentioned in job description)
                combinedData = combinedData.trimEnd();
                
                console.log(`Combined data length: ${combinedData.length} characters`);
                
                // Decode Base64
                console.log('Decoding Base64 data...');
                const compressedData = Buffer.from(combinedData, 'base64');
                console.log(`Compressed data size: ${compressedData.length} bytes`);
                
                // Decompress using DEFLATE
                console.log('Decompressing DEFLATE data...');
                const xmlData = pako.inflateRaw(compressedData, { to: 'string' });
                
                console.log('✅ Successfully extracted and decoded XML data');
                console.log(`Final XML length: ${xmlData.length} characters`);
                
                return xmlData;
                
            } else {
                throw new Error('zbarimg found no QR codes');
            }
            
        } catch (zbarError) {
            console.log('zbarimg failed, falling back to jsQR method...');
            console.log('zbar error:', zbarError.message);
            
            // Fallback to original jsQR method
            const qrCodes = await extractQRCodesFromImage(imageData.data, imageData.width, imageData.height);
            
            if (qrCodes.length === 0) {
                throw new Error('No QR codes found with either zbarimg or jsQR');
            }
            
            console.log(`Found ${qrCodes.length} QR codes with jsQR fallback`);
            
            // Continue with original logic for jsQR results...
            // Filter for the 4 structured append QR codes
            const largeQRCodes = qrCodes.filter(qr => {
                const estimatedSize = Math.min(
                    Math.abs(qr.location.bottomRightCorner.x - qr.location.topLeftCorner.x),
                    Math.abs(qr.location.bottomRightCorner.y - qr.location.topLeftCorner.y)
                );
                return estimatedSize > 400; // Filter for large QR codes
            });

            if (largeQRCodes.length !== 4) {
                console.warn(`Expected 4 large QR codes, found ${largeQRCodes.length}`);
            }

            // Parse structured append data
            const structuredAppendData = parseStructuredAppendQRCodes(largeQRCodes);
            
            if (structuredAppendData.length === 0) {
                throw new Error('No valid structured append QR codes found');
            }

            // Combine the QR code data in correct order
            const combinedData = combineStructuredAppendData(structuredAppendData);
            
            // Decode Base64
            console.log('Decoding Base64 data...');
            const compressedData = Buffer.from(combinedData, 'base64');
            
            // Decompress using DEFLATE
            console.log('Decompressing DEFLATE data...');
            const xmlData = pako.inflateRaw(compressedData, { to: 'string' });
            
            console.log('Successfully extracted and decoded XML data');
            return xmlData;
        }

    } catch (error) {
        console.error('Error extracting QR codes:', error);
        throw error;
    }
}

/**
 * Extract QR codes from image data
 */
async function extractQRCodesFromImage(imageData: Buffer, width: number, height: number) {
    console.log(`Image dimensions: ${width}x${height}`);
    const qrCodes = [];
    
    // Try to decode the entire image first
    console.log('Trying to decode entire image...');
    const fullImageData = new Uint8ClampedArray(imageData);
    const fullImageCode = jsQR(fullImageData, width, height);
    if (fullImageCode) {
        console.log('Found QR code in full image:', fullImageCode.data.length, 'characters');
        qrCodes.push(fullImageCode);
    }
    
    // Scan in larger sections to find QR codes
    const sectionSize = Math.min(1200, Math.floor(Math.min(width, height) / 3)); // Larger sections
    const overlap = Math.floor(sectionSize / 4); // Less overlap
    
    console.log(`Scanning with section size ${sectionSize} and overlap ${overlap}...`);
    let sectionsScanned = 0;
    let sectionsWithQR = 0;
    
    for (let y = 0; y < height - sectionSize; y += sectionSize - overlap) {
        for (let x = 0; x < width - sectionSize; x += sectionSize - overlap) {
            sectionsScanned++;
            const actualWidth = Math.min(sectionSize, width - x);
            const actualHeight = Math.min(sectionSize, height - y);
            
            // Create a section of the image
            const sectionData = new Uint8ClampedArray(actualWidth * actualHeight * 4);
            
            for (let sy = 0; sy < actualHeight; sy++) {
                for (let sx = 0; sx < actualWidth; sx++) {
                    const srcIndex = ((y + sy) * width + (x + sx)) * 4;
                    const dstIndex = (sy * actualWidth + sx) * 4;
                    
                    if (srcIndex + 3 < imageData.length && dstIndex + 3 < sectionData.length) {
                        sectionData[dstIndex] = imageData[srcIndex];       // R
                        sectionData[dstIndex + 1] = imageData[srcIndex + 1]; // G
                        sectionData[dstIndex + 2] = imageData[srcIndex + 2]; // B
                        sectionData[dstIndex + 3] = imageData[srcIndex + 3]; // A
                    }
                }
            }
            
            // Try to decode QR code in this section
            const code = jsQR(sectionData, actualWidth, actualHeight);
            if (code) {
                sectionsWithQR++;
                console.log(`Found QR code in section at (${x}, ${y}): ${code.data.length} characters`);
                
                // Adjust coordinates to global image coordinates
                const adjustedCode = {
                    ...code,
                    location: {
                        topLeftCorner: {
                            x: code.location.topLeftCorner.x + x,
                            y: code.location.topLeftCorner.y + y
                        },
                        topRightCorner: {
                            x: code.location.topRightCorner.x + x,
                            y: code.location.topRightCorner.y + y
                        },
                        bottomLeftCorner: {
                            x: code.location.bottomLeftCorner.x + x,
                            y: code.location.bottomLeftCorner.y + y
                        },
                        bottomRightCorner: {
                            x: code.location.bottomRightCorner.x + x,
                            y: code.location.bottomRightCorner.y + y
                        }
                    }
                };
                
                // Check if this QR code is too close to already found ones (avoid duplicates)
                const isDuplicate = qrCodes.some(existing => {
                    const distance = Math.sqrt(
                        Math.pow(existing.location.topLeftCorner.x - adjustedCode.location.topLeftCorner.x, 2) +
                        Math.pow(existing.location.topLeftCorner.y - adjustedCode.location.topLeftCorner.y, 2)
                    );
                    return distance < 200; // Increased threshold for duplicate detection
                });
                
                if (!isDuplicate) {
                    qrCodes.push(adjustedCode);
                    console.log(`Added unique QR code (total: ${qrCodes.length})`);
                } else {
                    console.log('Duplicate QR code detected, skipping');
                }
            }
            
            // Progress indicator for large scans
            if (sectionsScanned % 100 === 0) {
                console.log(`Scanned ${sectionsScanned} sections, found QR codes in ${sectionsWithQR} sections`);
            }
        }
    }
    
    console.log(`Total sections scanned: ${sectionsScanned}, with QR codes: ${sectionsWithQR}`);
    console.log(`Total unique QR codes found: ${qrCodes.length}`);
    
    return qrCodes;
}

/**
 * Parse structured append QR codes and extract position/data information
 */
function parseStructuredAppendQRCodes(qrCodes: any[]): StructuredAppendQR[] {
    const structuredAppendData: StructuredAppendQR[] = [];
    
    for (const qrCode of qrCodes) {
        try {
            const data = qrCode.data;
            
            // Check if this is a structured append QR code
            // Structured append QR codes typically start with specific markers
            // For now, we'll assume all large QR codes are part of the structured append
            // and try to extract position information from the data or use spatial positioning
            
            // If the data doesn't contain explicit structured append markers,
            // we'll determine position based on spatial location in the image
            const position = determineQRPosition(qrCode, qrCodes);
            
            structuredAppendData.push({
                position: position,
                total: 4, // As specified in the job description
                data: data
            });
        } catch (error) {
            console.warn('Failed to parse QR code as structured append:', error);
        }
    }
    
    return structuredAppendData;
}

/**
 * Determine QR code position based on spatial location
 */
function determineQRPosition(qrCode: any, allQRCodes: any[]): number {
    // Sort QR codes by position (top-left to bottom-right)
    const sortedQRCodes = [...allQRCodes].sort((a, b) => {
        const aY = a.location.topLeftCorner.y;
        const bY = b.location.topLeftCorner.y;
        const aX = a.location.topLeftCorner.x;
        const bX = b.location.topLeftCorner.x;
        
        // First sort by Y (top to bottom)
        if (Math.abs(aY - bY) > 100) {
            return aY - bY;
        }
        // Then sort by X (left to right)
        return aX - bX;
    });
    
    const index = sortedQRCodes.findIndex(qr => 
        qr.location.topLeftCorner.x === qrCode.location.topLeftCorner.x &&
        qr.location.topLeftCorner.y === qrCode.location.topLeftCorner.y
    );
    
    return index + 1; // Position is 1-based
}

/**
 * Combine structured append QR code data in the correct order
 */
function combineStructuredAppendData(structuredAppendData: StructuredAppendQR[]): string {
    // Sort by position
    const sortedData = structuredAppendData.sort((a, b) => a.position - b.position);
    
    // Combine data
    let combinedData = '';
    for (const qrData of sortedData) {
        combinedData += qrData.data;
    }
    
    // Remove trailing spaces (as mentioned in job description, last QR buffer is filled with spaces)
    combinedData = combinedData.trimEnd();
    
    return combinedData;
}


