/**
 * Frontend JavaScript for Schedule Accordion block
 */

document.addEventListener('DOMContentLoaded', function () {
	const accordions = document.querySelectorAll(
		'.schedule-accordion-container'
	);

	accordions.forEach(function (accordion) {
		const autoCollapsedAfter = accordion.dataset.autoCollapsedAfter || 3;
		const detailsElements = accordion.querySelectorAll('details');

		// Auto-collapse items beyond the specified limit
		detailsElements.forEach(function (details, index) {
			if (index >= autoCollapsedAfter) {
				details.removeAttribute('open');
			}
		});
	});
});
