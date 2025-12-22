import { decodeQRCodesFromPDF } from './decode.js';
import fs from 'fs/promises';
import * as pako from 'pako';

async function analyzeQRData() {
    try {
        console.log('Analyzing QR code data for Structured Append sequence...\n');

        // Get QR codes from PDF
        const result = await decodeQRCodesFromPDF('65525_qr.pdf', { cleanupImages: false });
        const qrCodes = result.qrCodes.map(qr => qr.data);

        console.log('QR Code Analysis:');
        qrCodes.forEach((qr, i) => {
            console.log(`QR ${i + 1}: ${qr.length} chars - "${qr.substring(0, 30)}...${qr.substring(qr.length - 10)}"`);
        });

        // Based on the spec, we expect:
        // - Multiple QR codes with max 1264 bytes each
        // - Last QR code may be padded with spaces
        // - They form a sequence that when combined gives base64 data

        console.log('\n--- Sorting by data length (shortest likely has most padding) ---');
        const sorted = qrCodes.map((data, i) => ({ data, original: i + 1 }))
            .sort((a, b) => a.data.length - b.data.length);

        sorted.forEach(qr => {
            console.log(`QR ${qr.original}: ${qr.data.length} chars`);
        });

        // Try combinations, with the assumption that shorter codes might be last
        console.log('\n--- Testing Structured Append combinations ---');

        // For 3 QR codes, try logical orders
        const testOrders = [
            // Standard orders
            [0, 1, 2], [1, 2, 0], [2, 0, 1],
            // Reverse orders  
            [2, 1, 0], [1, 0, 2], [0, 2, 1],
            // Size-based orders (shortest last as it's padded)
            [sorted[1].original - 1, sorted[2].original - 1, sorted[0].original - 1],
            [sorted[2].original - 1, sorted[1].original - 1, sorted[0].original - 1]
        ];

        for (let i = 0; i < testOrders.length; i++) {
            const [a, b, c] = testOrders[i];
            console.log(`\n--- Testing order QR${a + 1}-QR${b + 1}-QR${c + 1} ---`);

            // Combine the QR codes
            let combined = qrCodes[a] + qrCodes[b] + qrCodes[c];

            // Clean trailing spaces from the combined data (as last QR is padded)
            combined = combined.trimEnd();

            console.log(`Combined length: ${combined.length} characters`);

            const success = await testDecompression(combined, `structured_${a + 1}_${b + 1}_${c + 1}.xml`);
            if (success) {
                console.log('\n🎉 FOUND CORRECT ORDER! 🎉');
                console.log(`Correct Structured Append order: QR${a + 1} -> QR${b + 1} -> QR${c + 1}`);

                // Save the raw combined data too
                await fs.writeFile('successful_structured_append.txt',
                    `Correct order: QR${a + 1} -> QR${b + 1} -> QR${c + 1}\n` +
                    `Combined data (${combined.length} chars):\n${combined}`);

                return;
            }
        }

        console.log('\n❌ No successful combination found');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function testDecompression(data, filename) {
    try {
        console.log(`  Data length: ${data.length}`);

        // Clean the data according to spec: remove CR/LF and trim spaces
        const cleanedData = data.replace(/[\r\n]/g, '').trimEnd();
        console.log(`  Cleaned length: ${cleanedData.length}`);

        // Try to decode base64
        let binaryData;
        try {
            binaryData = Buffer.from(cleanedData, 'base64');
            console.log(`  Base64 decoded: ${binaryData.length} bytes`);
        } catch (err) {
            console.log(`  ✗ Base64 decode failed: ${err.message}`);
            return;
        }

        // Try raw DEFLATE decompression (RFC 1951) as specified
        try {
            const result = pako.inflateRaw(binaryData, { to: 'string' });
            console.log(`  ✓ Raw DEFLATE SUCCESS: ${result.length} characters`);
            console.log(`    Preview: ${result.substring(0, 100)}...`);

            if (result.includes('<?xml') || result.includes('<')) {
                console.log(`    ✓ Contains XML!`);
                await fs.writeFile(filename, result, 'utf8');
                console.log(`    Saved to ${filename}`);
                return true; // Success
            }
        } catch (err) {
            console.log(`  ✗ Raw DEFLATE failed: ${err.message}`);
        }

        // Fallback: try other methods
        const methods = [
            { name: 'pako.inflate', fn: () => pako.inflate(binaryData, { to: 'string' }) },
            { name: 'pako.ungzip', fn: () => pako.ungzip(binaryData, { to: 'string' }) }
        ];

        for (const method of methods) {
            try {
                const result = method.fn();
                console.log(`  ✓ ${method.name} SUCCESS: ${result.length} characters`);
                console.log(`    Preview: ${result.substring(0, 100)}...`);

                if (result.includes('<?xml') || result.includes('<')) {
                    console.log(`    ✓ Contains XML!`);
                    await fs.writeFile(filename.replace('.xml', `_${method.name}.xml`), result, 'utf8');
                    console.log(`    Saved to ${filename.replace('.xml', `_${method.name}.xml`)}`);
                    return true;
                }
            } catch (err) {
                console.log(`  ✗ ${method.name} failed: ${err.message}`);
            }
        }

        return false;

    } catch (error) {
        console.log(`  ✗ Error: ${error.message}`);
        return false;
    }
}

analyzeQRData();