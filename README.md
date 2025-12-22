# QR Code Decoder for Swiss Tardoc Bill QR-Sheets

## Install:

```
git clone https://github.com/rgwch/tardocbill-decoder
cd tardocbill-decoder
npm i
```
## Usage
`node decode.js 65525_qr.pdf`

will create 
* 65525_qr.base64 - the compressed and base64 encoded contents of the QR sequence
* 65525_qr.xml - the XML version of the tardoc bill

