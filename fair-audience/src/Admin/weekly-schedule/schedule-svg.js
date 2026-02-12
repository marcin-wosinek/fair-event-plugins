/**
 * XML-escape special characters.
 *
 * @param {string} str Input string.
 * @return {string} Escaped string safe for SVG/XML.
 */
const XML_ENTITIES = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;',
};

function escapeXml(str) {
	return String(str).replace(/[&<>"']/g, (ch) => XML_ENTITIES[ch]);
}

/**
 * Generate a 1080x1080 Instagram-ready SVG of the weekly schedule.
 *
 * Events are grouped by day (empty days are skipped). The layout uses a dark
 * background with colored day headers and white event titles.
 *
 * @param {Object} data API response with source, week, and days.
 * @return {string} SVG markup string.
 */
export function generateScheduleSvg(data) {
	if (!data || !data.days) {
		return '';
	}

	const { source, days } = data;
	const W = 1080;
	const H = 1080;
	const PAD = 60;

	// Skip days with no events.
	const activeDays = days.filter((d) => d.events.length > 0);

	// Date range for the header.
	const firstDay = days[0];
	const lastDay = days[days.length - 1];
	const dateRange = `${firstDay.day_num}\u2013${lastDay.day_num} de ${firstDay.month_name}`;

	// Count total items (day headers + events) for layout calculation.
	let totalItems = 0;
	for (const day of activeDays) {
		totalItems += 1; // day header row
		totalItems += day.events.length;
	}

	// Adaptive row sizing based on content amount.
	const HEADER_BOTTOM = 190;
	const BOTTOM_PAD = 40;
	const available = H - HEADER_BOTTOM - BOTTOM_PAD;
	const rowH =
		totalItems > 0 ? Math.min(52, Math.floor(available / totalItems)) : 52;
	const dayFontSize = rowH > 40 ? 28 : rowH > 30 ? 24 : 20;
	const eventFontSize = rowH > 40 ? 26 : rowH > 30 ? 22 : 18;
	const dayHeaderGap = rowH > 40 ? 8 : 4;

	const parts = [];

	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
	);

	// Background gradient.
	parts.push('<defs>');
	parts.push(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="${H}">`);
	parts.push('<stop offset="0%" stop-color="#1a1a2e"/>');
	parts.push('<stop offset="100%" stop-color="#16213e"/>');
	parts.push('</linearGradient>');
	parts.push('</defs>');
	parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);

	// Source name.
	parts.push(
		`<text x="${PAD}" y="90" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="bold">${escapeXml(
			source.name
		)}</text>`
	);

	// Date range.
	parts.push(
		`<text x="${PAD}" y="142" fill="#a0a0c0" font-family="Arial, Helvetica, sans-serif" font-size="32">${escapeXml(
			dateRange
		)}</text>`
	);

	// Accent line.
	parts.push(
		`<rect x="${PAD}" y="162" width="${
			W - PAD * 2
		}" height="3" fill="#e94560" rx="1.5"/>`
	);

	// Render events grouped by day.
	let y = HEADER_BOTTOM;

	for (const day of activeDays) {
		// Day header.
		y += dayHeaderGap;
		const dayLabelY = y + dayFontSize;
		parts.push(
			`<text x="${PAD}" y="${dayLabelY}" fill="#e94560" font-family="Arial, Helvetica, sans-serif" font-size="${dayFontSize}" font-weight="bold">${escapeXml(
				day.weekday
			)} ${escapeXml(String(day.day_num))}</text>`
		);
		y += rowH;

		// Events for this day.
		for (const event of day.events) {
			const textY = y + eventFontSize;
			const indent = PAD + 20;

			// Build time string.
			let timeStr = '';
			if (!event.all_day) {
				if (event.end_time && event.end_time !== event.start_time) {
					timeStr = `${event.start_time}\u2013${event.end_time}`;
				} else if (event.start_time) {
					timeStr = event.start_time;
				}
			}

			let titleX = indent;
			if (timeStr) {
				parts.push(
					`<text x="${indent}" y="${textY}" fill="#8888aa" font-family="Arial, Helvetica, sans-serif" font-size="${eventFontSize}">${escapeXml(
						timeStr
					)}</text>`
				);
				titleX = indent + 220;
			}

			// Title — truncate if it would overflow.
			const maxTitleW = W - PAD - titleX;
			const charW = eventFontSize * 0.55;
			const maxChars = Math.floor(maxTitleW / charW);
			let title = event.title;
			if (title.length > maxChars) {
				title = title.substring(0, maxChars - 1) + '\u2026';
			}

			parts.push(
				`<text x="${titleX}" y="${textY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${eventFontSize}">${escapeXml(
					title
				)}</text>`
			);

			y += rowH;
		}
	}

	// Empty state.
	if (activeDays.length === 0) {
		parts.push(
			`<text x="${W / 2}" y="${
				H / 2
			}" fill="#666680" font-family="Arial, Helvetica, sans-serif" font-size="32" text-anchor="middle">No events this week</text>`
		);
	}

	parts.push('</svg>');
	return parts.join('\n');
}
