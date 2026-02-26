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
		.replace(/<style[\s\S]*?<\/style>/gi, ' ');

	const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');

	const decoded = withoutTags.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
		return entityMap[entity] ?? ' ';
	});

	return decoded.replace(/\s+/g, ' ').trim();
}
