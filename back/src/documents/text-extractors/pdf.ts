import { PDFParse } from 'pdf-parse'

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse(buffer);
    const data = await parser.getText();
    return data.text ?? '';
}