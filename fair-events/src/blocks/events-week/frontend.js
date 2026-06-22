/**
 * Events Week View - Frontend Script
 *
 * Handles the "Copy summary" button click.
 */

(function () {
	'use strict';

	function fallbackCopy(text, onSuccess) {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		try {
			if (document.execCommand('copy')) {
				onSuccess();
			}
		} finally {
			document.body.removeChild(textarea);
		}
	}

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

				const showCopied = () => {
					const original = button.textContent;
					button.textContent = button.dataset.copiedLabel || '✓';
					setTimeout(() => {
						button.textContent = original;
					}, 2000);
				};

				if (navigator.clipboard) {
					navigator.clipboard
						.writeText(summary)
						.then(showCopied)
						.catch(() => {
							fallbackCopy(summary, showCopied);
						});
				} else {
					fallbackCopy(summary, showCopied);
				}
			});
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initCopySummaryButtons);
	} else {
		initCopySummaryButtons();
	}
})();
