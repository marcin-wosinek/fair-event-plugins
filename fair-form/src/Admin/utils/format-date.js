// Stored datetimes are UTC without a timezone suffix — append one before parsing.
export function formatDate(dateString) {
	if (!dateString) {
		return '';
	}
	const date = new Date(dateString + 'Z');
	return date.toLocaleString();
}

// Same UTC convention as formatDate(), but a human-readable long form
// (e.g. "31 de julio de 2026, 20:19") for exports meant to be read, not sorted.
export function formatDateLong(dateString) {
	if (!dateString) {
		return '';
	}
	const date = new Date(dateString + 'Z');
	return date.toLocaleString(undefined, {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
}
