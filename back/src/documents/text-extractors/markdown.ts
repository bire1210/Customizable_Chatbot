export function extractTextFromMarkdown(markdown: string) {
	let text = markdown;

	// Remove fenced code blocks
	text = text.replace(/```[\s\S]*?```/g, ' ');

	// Remove inline code
	text = text.replace(/`[^`]*`/g, ' ');

	// Replace images with their alt text
	text = text.replace(/!\[([^\]]*)\]\([^\)]*\)/g, '$1');

	// Replace links with link text
	text = text.replace(/\[([^\]]+)\]\([^\)]*\)/g, '$1');

	// Keep headings and list boundaries instead of flattening structure.
	text = text.replace(/^>\s?/gm, '');
	text = text.replace(/^#{1,6}\s+/gm, '');
	text = text.replace(/^[\-*+]\s+/gm, '- ');
	text = text.replace(/^\d+\.\s+/gm, '- ');

	return text
		.replace(/\r/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
