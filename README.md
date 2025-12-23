# Tardocbill-decoder

Extract XML informations from the [XML 5.0 PDF sheets](https://www.forum-datenaustausch.ch/xml-standards/rechnung) as used for swiss Tardoc bills.

## Installation

```
git clone https://github.com/rgwch/tardocbill-decoder
cd tardocbill-decoder
npm i
npx tsc
```

## Usage

`node dist/index.js ./rsc/example.pdf` 
will extract the contents of the pdf bill to an XML

