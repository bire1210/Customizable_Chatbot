import { PDFParse } from 'pdf-parse'

export async function extractTextFromPdf(
  buffer: Buffer,
): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const data = await parser.getText({
      lineEnforce: true,
      cellSeparator: ' ',
      pageJoiner: '\n',
    });

    return cleanPdfText(data.text ?? '');
  } finally {
    await parser.destroy();
  }
}

function cleanPdfText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
