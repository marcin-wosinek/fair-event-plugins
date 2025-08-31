/**
 * Frontend JavaScript for Schedule Accordion block
 */
import './view.css';

document.addEventListener('DOMContentLoaded', function () {
	const accordions = document.querySelectorAll(
		'.schedule-accordion-container.collapsed'
	);

	accordions.forEach(function (accordion) {
		function handleClick() {
			// Remove the collapsed class
			accordion.classList.remove('collapsed');

			// Remove this event listener
			accordion.removeEventListener('click', handleClick);
		}

		// Add click event listener
		accordion.addEventListener('click', handleClick);
	});
});
