/**
 * Adjust ticket sale period dates based on event date shift.
 *
 * @param {Array}  salePeriods          Array of sale period objects with sale_start and sale_end.
 * @param {string} originalStartDatetime Original event start datetime (YYYY-MM-DD HH:MM:SS).
 * @param {string} newStartDatetime      New event start datetime (YYYY-MM-DD HH:MM:SS).
 * @return {Array} New array with adjusted sale_start and sale_end dates.
 */
export function adjustTicketDates(
	salePeriods,
	originalStartDatetime,
	newStartDatetime
) {
	const originalStart = new Date(originalStartDatetime.replace(' ', 'T'));
	const newStart = new Date(newStartDatetime.replace(' ', 'T'));
	const diffMs = newStart.getTime() - originalStart.getTime();

	if (diffMs === 0) {
		return salePeriods;
	}

	return salePeriods.map((period) => {
		const adjusted = { ...period };

		if (period.sale_start) {
			const start = new Date(period.sale_start.replace(' ', 'T'));
			adjusted.sale_start = formatDatetime(
				new Date(start.getTime() + diffMs)
			);
		}

		if (period.sale_end) {
			const end = new Date(period.sale_end.replace(' ', 'T'));
			adjusted.sale_end = formatDatetime(
				new Date(end.getTime() + diffMs)
			);
		}

		return adjusted;
	});
}

function formatDatetime(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
