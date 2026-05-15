const path = require('path');

const MODEL_NAME = 'bert-base-NER';
const MODEL_ROOT = path.join(__dirname, '..', 'models', MODEL_NAME);
const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  path.join('onnx', 'model_quantized.onnx')
];

function getModelPath(relativePath) {
  return path.join(MODEL_ROOT, relativePath);
}

function getModelManifest() {
  return MODEL_FILES.map(file => ({
    file,
    path: getModelPath(file)
  }));
}

if (require.main === module) {
  console.log(MODEL_ROOT);
}

module.exports = {
  MODEL_NAME,
  MODEL_ROOT,
  MODEL_FILES,
  getModelPath,
  getModelManifest
};