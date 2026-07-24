// Stored datetimes are UTC without a timezone suffix — append one before parsing.
export function formatDate(dateString) {
	if (!dateString) {
		return '';
	}
	const date = new Date(dateString + 'Z');
	return date.toLocaleString();
}
