import {extract_qr} from "./extract_qr"
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    try {
        // Check if source file is provided as command line argument
        const args = process.argv.slice(2);
        if (args.length === 0) {
            console.error("Usage: npm start <pdf-file>");
            console.error("Example: npm start rsc/example.pdf");
            process.exit(1);
        }
        
        const sourceFile = args[0];
        
        // Check if source file exists
        if (!fs.existsSync(sourceFile)) {
            console.error(`Error: Source file '${sourceFile}' not found`);
            process.exit(1);
        }
        
        console.log(`Starting QR code extraction from: ${sourceFile}`);
        const xmlData = await extract_qr(sourceFile);
        
        // Generate output filename with same basename but .xml extension
        const parsedPath = path.parse(sourceFile);
        const outputFile = path.join(parsedPath.dir, parsedPath.name + '.xml');
        
        // Write XML data to file
        fs.writeFileSync(outputFile, xmlData, 'utf8');
        
        console.log(`Successfully extracted XML data to: ${outputFile}`);
        console.log(`XML file size: ${xmlData.length} characters`);
        console.log("Done");
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
}

main();