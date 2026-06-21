/**
 * Events Week View - Frontend Script
 *
 * Handles the "Copy summary" button click.
 */

(function () {
	'use strict';

	function initCopySummaryButtons() {
		const buttons = document.querySelectorAll(
			'.fair-events-copy-summary-btn'
		);

		buttons.forEach((button) => {
			button.addEventListener('click', function () {
				const summary = button.dataset.summary;
				if (!summary) {
					return;
				}

				navigator.clipboard.writeText(summary).then(() => {
					const original = button.textContent;
					button.textContent = button.dataset.copiedLabel || '✓';
					setTimeout(() => {
						button.textContent = original;
					}, 2000);
				});
			});
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initCopySummaryButtons);
	} else {
		initCopySummaryButtons();
	}
})();
