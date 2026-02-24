import { PDFParse } from 'pdf-parse'

export async function extractTextFromPdf(
  buffer: Buffer,
): Promise<string> {
    const uint8 = new Uint8Array(buffer);

    const parser = new PDFParse(uint8);
    const data = await parser.getText();

    return data.text ?? '';
}