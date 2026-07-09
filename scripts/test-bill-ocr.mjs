import { readFileSync } from "fs";
import { createWorker } from "tesseract.js";
import {
  extractBillValues,
  parseBillFromText,
} from "../src/services/billExtractor.service.js";

const imagePath = new URL(
  "../../Frontend/src/assets/bill sample.png",
  import.meta.url,
);

const buf = readFileSync(imagePath);
const worker = await createWorker("eng");
const {
  data: { text },
} = await worker.recognize(buf);
await worker.terminate();

console.log("--- OCR TEXT ---");
console.log(text);
console.log("--- PARSED ---");
console.log(JSON.stringify(parseBillFromText(text), null, 2));
console.log("--- FULL EXTRACT ---");
console.log(JSON.stringify(await extractBillValues(buf), null, 2));
