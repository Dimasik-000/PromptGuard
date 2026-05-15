const fs = require('fs');
const https = require('https');
const path = require('path');

const MODEL = 'Xenova/bert-base-NER';
const FILES = [
  'onnx/model_quantized.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json'
];

function download(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });

    https.get(url, { headers: { 'User-Agent': 'node' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        const nextUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, url).toString();
        response.resume();
        resolve(download(nextUrl, destination, redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }

      const output = fs.createWriteStream(destination);
      response.pipe(output);

      output.on('finish', () => {
        output.close(() => resolve());
      });

      output.on('error', reject);
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  for (const file of FILES) {
    const url = `https://huggingface.co/${MODEL}/resolve/main/${file}`;
    const destination = path.join('models', 'bert-base-NER', file);
    await download(url, destination);
    console.log(`OK ${destination}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});