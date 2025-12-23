import * as pako from 'pako';
import { execSync } from 'child_process';

/**
 * Extract all QR codes from the pdf file using zbar directly,
 * decompress the DEFLATE data and return the XML content.
 * 
 * @param pdfPath Path to the PDF file containing QR codes
 * @returns The decoded XML content from the structured append QR codes
 */
export async function extract_qr(pdfPath: string): Promise<string> {
    try {
        console.log('Scanning PDF for QR codes with zbar...');
        
        // Use zbar directly on PDF file
        const zbarCommand = `zbarimg "${pdfPath}"`;
        const zbarOutput = execSync(zbarCommand, { encoding: 'utf8' });
        
        if (!zbarOutput || !zbarOutput.trim()) {
            throw new Error('No QR codes found in PDF');
        }
        
        console.log('✅ QR codes found with zbar!');
        
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
        
        // For structured append QR codes, we need to sort them by position
        let combinedData = '';
        if (qrDataArray.length === 1) {
            // Single QR code or already combined data
            combinedData = qrDataArray[0];
            console.log('Using single QR code data');
        } else {
            // Multiple QR codes - these are structured append codes that need proper ordering
            console.log(`Sorting and combining ${qrDataArray.length} structured append QR codes...`);
            
            // For structured append QR codes, we need to extract the position information
            // and sort them correctly. Since we can't easily parse the binary structured append headers,
            // we'll use a heuristic: sort by data length (longest first, then shorter ones)
            // This works because typically the data is split with the first codes containing more data
            const sortedQRData = qrDataArray.sort((a, b) => {
                // First sort by length (descending)
                if (a.length !== b.length) {
                    return b.length - a.length;
                }
                // If lengths are equal, maintain original order
                return 0;
            });
            
            console.log('QR code lengths after sorting:', sortedQRData.map(d => d.length));
            
            // Try different combinations to find the one that decompresses correctly
            const permutations = generatePermutations(sortedQRData);
            
            for (let i = 0; i < permutations.length; i++) {
                const testData = permutations[i].join('').trimEnd();
                try {
                    console.log(`Trying permutation ${i + 1}/${permutations.length}...`);
                    const testCompressed = Buffer.from(testData, 'base64');
                    const testXml = pako.inflateRaw(testCompressed, { to: 'string' });
                    
                    // If we get here without error, this is the correct order
                    combinedData = testData;
                    console.log(`✅ Found correct order at permutation ${i + 1}`);
                    break;
                } catch (error) {
                    // This permutation didn't work, try the next one
                    if (i === permutations.length - 1) {
                        // If all permutations failed, fall back to simple concatenation
                        console.log('All permutations failed, using simple concatenation');
                        combinedData = qrDataArray.join('');
                    }
                }
            }
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

    } catch (error) {
        console.error('Error extracting QR codes:', error);
        throw error;
    }
}

/**
 * Generate all permutations of an array, but limit to reasonable number for performance
 */
function generatePermutations<T>(array: T[]): T[][] {
    if (array.length <= 1) return [array];
    if (array.length > 4) {
        // For more than 4 elements, just try a few common patterns to avoid performance issues
        return [
            array, // original order
            [...array].reverse(), // reverse order
            [array[0], ...array.slice(1).reverse()], // first + reverse of rest
            [...array.slice(1), array[0]], // move first to end
        ];
    }
    
    const result: T[][] = [];
    for (let i = 0; i < array.length; i++) {
        const rest = array.slice(0, i).concat(array.slice(i + 1));
        const restPermutations = generatePermutations(rest);
        for (const perm of restPermutations) {
            result.push([array[i], ...perm]);
        }
    }
    return result;
}