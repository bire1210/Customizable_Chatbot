import { PDFParse } from 'pdf-parse'

export async function extractTextFromPdf(
  buffer: Buffer,
): Promise<string> {
    const uint8 = new Uint8Array(buffer);

    const parser = new PDFParse(uint8);
    const data = await parser.getText();

    return cleanPdfText(data.text ?? '');
}

  function cleanPdfText(text: string) {
    return text
    .replace(/\r/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  }