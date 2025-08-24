/**
 * Calendar utility functions
 */

import { google, outlook, yahoo, ics } from 'calendar-link';
import {
	faGoogle,
	faMicrosoft,
	faYahoo,
} from '@fortawesome/free-brands-svg-icons';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { icon } from '@fortawesome/fontawesome-svg-core';

/**
 * Handle calendar button click - now shows dropdown with options
 *
 * @param {Object} eventData - Event data object
 * @param {HTMLElement} buttonElement - The clicked button element
 */
export function handleCalendarClick(eventData, buttonElement) {
	// Remove any existing dropdown
	const existingDropdown = document.querySelector('.calendar-dropdown');
	if (existingDropdown) {
		existingDropdown.remove();
	}

	// Create dropdown
	const dropdown = createCalendarDropdown(eventData, buttonElement);
	document.body.appendChild(dropdown);

	// Position dropdown near the button
	positionDropdown(dropdown, buttonElement);

	// Close dropdown when clicking outside
	const closeDropdown = (e) => {
		if (!dropdown.contains(e.target) && !buttonElement.contains(e.target)) {
			dropdown.remove();
			document.removeEventListener('click', closeDropdown);
		}
	};
	setTimeout(() => document.addEventListener('click', closeDropdown), 0);
}

/**
 * Create calendar dropdown with provider options
 *
 * @param {Object} eventData - Event data object
 * @param {HTMLElement} buttonElement - The clicked button element
 * @return {HTMLElement} Dropdown element
 */
function createCalendarDropdown(eventData, buttonElement) {
	const dropdown = document.createElement('div');
	dropdown.className = 'calendar-dropdown';

	const providers = [
		{
			name: 'Google Calendar',
			key: 'google',
			generator: google,
			iconDef: faGoogle,
			color: '#4285f4',
		},
		{
			name: 'Outlook',
			key: 'outlook',
			generator: outlook,
			iconDef: faMicrosoft,
			color: '#0078d4',
		},
		{
			name: 'Yahoo Calendar',
			key: 'yahoo',
			generator: yahoo,
			iconDef: faYahoo,
			color: '#720e9e',
		},
		{
			name: 'Download ICS',
			key: 'ics',
			generator: ics,
			iconDef: faDownload,
			color: '#666',
		},
	];

	providers.forEach((provider) => {
		const option = document.createElement('button');
		option.className = 'calendar-dropdown-option';
		option.setAttribute('data-provider', provider.key);

		// Create SVG icon element
		const iconElement = createSVGIcon(provider.iconDef, provider.color);

		// Create text node
		const text = document.createTextNode(` ${provider.name}`);

		// Append icon and text to button
		option.appendChild(iconElement);
		option.appendChild(text);

		option.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			try {
				// Apply the same logic as the original commit: append URL to description
				const modifiedEventData = { ...eventData };

				if (modifiedEventData.url) {
					const currentDescription =
						modifiedEventData.description || '';
					modifiedEventData.description =
						currentDescription + '\n\n' + modifiedEventData.url;
				}

				const calendarUrl = provider.generator(modifiedEventData);

				if (provider.key === 'ics') {
					// For ICS, trigger download
					const link = document.createElement('a');
					link.href = calendarUrl;
					link.download = `${modifiedEventData.title || 'event'}.ics`;
					link.click();
				} else {
					// For web calendars, open in new tab
					window.open(calendarUrl, '_blank');
				}

				dropdown.remove();
			} catch (error) {
				console.error(`Error creating ${provider.name} link:`, error);
			}
		});

		dropdown.appendChild(option);
	});

	return dropdown;
}

/**
 * Create SVG icon element from Font Awesome icon definition
 *
 * @param {Object} iconDef - Font Awesome icon definition
 * @param {string} color - Icon color
 * @return {HTMLElement} SVG element
 */
function createSVGIcon(iconDef, color) {
	const iconHtml = icon(iconDef, {
		styles: { color: color },
	}).html[0];

	// Create a temporary container to parse the SVG HTML
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = iconHtml;

	const svgElement = tempDiv.querySelector('svg');
	if (svgElement) {
		svgElement.classList.add('calendar-icon');
		// Size is now controlled by CSS
	}

	return svgElement || tempDiv.firstChild;
}

/**
 * Position dropdown near the button
 *
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} buttonElement - Button element
 */
function positionDropdown(dropdown, buttonElement) {
	const buttonRect = buttonElement.getBoundingClientRect();
	const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
	const scrollLeft =
		window.pageXOffset || document.documentElement.scrollLeft;

	dropdown.style.position = 'absolute';
	dropdown.style.top = `${buttonRect.bottom + scrollTop + 5}px`;
	dropdown.style.left = `${buttonRect.left + scrollLeft}px`;
	dropdown.style.zIndex = '9999';
}

/**
 * Convert block attributes to calendar event data
 *
 * @param {Object} attributes - Block attributes
 * @return {Object} Event data for calendar-link
 */
export function createEventData(attributes) {
	const {
		start,
		end,
		allDay,
		description,
		location,
		title,
		recurring,
		rRule,
		url,
	} = attributes;
	const eventData = {};

	if (start) eventData.start = new Date(start);
	if (end) {
		const endDate = new Date(end);
		// For all-day events, make the end date inclusive by adding one day
		// This ensures multi-day all-day events include the end date
		if (allDay && start && end !== start) {
			endDate.setDate(endDate.getDate() + 1);
		}
		eventData.end = endDate;
	}
	if (allDay !== undefined) eventData.allDay = allDay;
	if (description) eventData.description = description;
	if (location) eventData.location = location;
	if (title) eventData.title = title;
	if (url) eventData.url = url;

	// Include rRule if recurring is enabled and rRule is provided
	if (recurring && rRule) {
		eventData.rRule = rRule;
	}

	return eventData;
}
