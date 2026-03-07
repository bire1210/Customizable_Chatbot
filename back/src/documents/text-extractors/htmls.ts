const entityMap: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&nbsp;': ' ',
};

export function extractTextFromHtml(html: string) {
	const withoutScripts = html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
		.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
		.replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

	const structured = withoutScripts
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\s*\/?\s*(p|div|section|article|li|h[1-6]|tr)\b[^>]*>/gi, '\n');

	const withoutTags = structured.replace(/<[^>]+>/g, ' ');

	const decoded = withoutTags.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
		return entityMap[entity] ?? ' ';
	});

	return decoded
		.replace(/\r/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
