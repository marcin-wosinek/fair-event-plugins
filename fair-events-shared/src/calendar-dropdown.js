/**
 * Shared "add to calendar" dropdown for the calendar-button blocks of
 * Fair Events and Fair Calendar Button.
 *
 * Each plugin bundles this module into its own public script, so it must stay
 * free of editor dependencies. The plugins inject their provider generators
 * (calendar-link), the Font Awesome icon renderer and definitions, the
 * translated ICS label, and optional analytics; date conversion stays in each
 * plugin's own `createEventData`.
 *
 * @package FairEventsShared
 */

/**
 * Provider order, keys, default labels and icon colors. The ICS label is
 * supplied by the plugin so it is translated in the plugin's text domain.
 */
const PROVIDERS = [
	{ key: 'google', name: 'Google Calendar', color: '#4285f4' },
	{ key: 'outlook', name: 'Outlook', color: '#0078d4' },
	{ key: 'yahoo', name: 'Yahoo Calendar', color: '#720e9e' },
	{ key: 'ics', name: 'Download ICS', color: '#666' },
];

/**
 * The dropdown currently owned by this bundle, with its listener state, so
 * replacing or closing it also removes its document listener.
 *
 * @type {{element: HTMLElement, closeListener: Function, timeoutId: number}|null}
 */
let activeDropdown = null;

/**
 * Format event description by appending URL if present
 *
 * @param {string} description - Original description
 * @param {string} url         - URL to append
 * @return {string} Formatted description
 */
export function formatEventDescription( description, url ) {
	if ( ! url ) return description || '';

	const currentDescription = description || '';
	return currentDescription ? currentDescription + '\n\n' + url : url;
}

/**
 * Close the dropdown owned by this bundle and remove its listeners.
 */
export function closeCalendarDropdown() {
	if ( ! activeDropdown ) {
		return;
	}

	const { element, closeListener, timeoutId } = activeDropdown;
	activeDropdown = null;
	clearTimeout( timeoutId );
	document.removeEventListener( 'click', closeListener );
	element.remove();
}

/**
 * Show the calendar provider dropdown for an event below the clicked button.
 *
 * @param {Object}      eventData                    - Event data for calendar-link.
 * @param {HTMLElement} buttonElement                - The clicked button.
 * @param {Object}      options                      - Plugin-supplied dependencies.
 * @param {Object}      options.generators           - Link generators keyed by provider (google, outlook, yahoo, ics).
 * @param {Object}      options.icons                - Font Awesome icon definitions keyed by provider.
 * @param {Function}    options.renderIcon           - Font Awesome `icon()` renderer.
 * @param {string}      [options.icsLabel]           - Translated label for the ICS option.
 * @param {Function}    [options.onProviderSelect]   - Called with the provider key when an option is chosen.
 * @return {HTMLElement} The dropdown element.
 */
export function openCalendarDropdown( eventData, buttonElement, options ) {
	// Replace this bundle's dropdown and any dropdown left by another bundle.
	closeCalendarDropdown();
	document
		.querySelectorAll( '.calendar-dropdown' )
		.forEach( ( existing ) => existing.remove() );

	const element = createCalendarDropdown( eventData, options );
	document.body.appendChild( element );
	positionDropdown( element, buttonElement );

	const closeListener = ( e ) => {
		if (
			! element.contains( e.target ) &&
			! buttonElement.contains( e.target )
		) {
			closeCalendarDropdown();
		}
	};

	// Register on the next tick so the opening click doesn't close it.
	const timeoutId = setTimeout(
		() => document.addEventListener( 'click', closeListener ),
		0
	);

	activeDropdown = { element, closeListener, timeoutId };

	return element;
}

/**
 * Create the dropdown with one option per provider.
 *
 * @param {Object} eventData - Event data for calendar-link.
 * @param {Object} options   - See openCalendarDropdown.
 * @return {HTMLElement} Dropdown element.
 */
function createCalendarDropdown( eventData, options ) {
	const { generators, icons, renderIcon, icsLabel, onProviderSelect } =
		options;

	const dropdown = document.createElement( 'div' );
	dropdown.className = 'calendar-dropdown';

	PROVIDERS.forEach( ( { key, name: defaultName, color } ) => {
		const name = key === 'ics' && icsLabel ? icsLabel : defaultName;

		const option = document.createElement( 'button' );
		option.className = 'calendar-dropdown-option';
		option.setAttribute( 'data-provider', key );
		option.appendChild( createSVGIcon( renderIcon, icons[ key ], color ) );
		option.appendChild( document.createTextNode( ` ${ name }` ) );

		option.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			e.stopPropagation();

			if ( typeof onProviderSelect === 'function' ) {
				onProviderSelect( key );
			}

			try {
				const modifiedEventData = { ...eventData };

				if ( modifiedEventData.url ) {
					modifiedEventData.description = formatEventDescription(
						modifiedEventData.description,
						modifiedEventData.url
					);
				}

				const calendarUrl = generators[ key ]( modifiedEventData );

				if ( key === 'ics' ) {
					const link = document.createElement( 'a' );
					link.href = calendarUrl;
					link.download = `${
						modifiedEventData.title || 'event'
					}.ics`;
					link.click();
				} else {
					window.open( calendarUrl, '_blank' );
				}

				if ( activeDropdown?.element === dropdown ) {
					closeCalendarDropdown();
				} else {
					dropdown.remove();
				}
			} catch ( error ) {
				// eslint-disable-next-line no-console
				console.error( `Error creating ${ name } link:`, error );
			}
		} );

		dropdown.appendChild( option );
	} );

	return dropdown;
}

/**
 * Create an SVG icon element from a Font Awesome icon definition.
 *
 * @param {Function} renderIcon - Font Awesome `icon()` renderer.
 * @param {Object}   iconDef    - Font Awesome icon definition.
 * @param {string}   color      - Icon color.
 * @return {Node} SVG element.
 */
function createSVGIcon( renderIcon, iconDef, color ) {
	const iconHtml = renderIcon( iconDef, {
		styles: { color },
	} ).html[ 0 ];

	const tempDiv = document.createElement( 'div' );
	tempDiv.innerHTML = iconHtml;

	const svgElement = tempDiv.querySelector( 'svg' );
	if ( svgElement ) {
		svgElement.classList.add( 'calendar-icon' );
	}

	return svgElement || tempDiv.firstChild;
}

/**
 * Position the dropdown below the button.
 *
 * @param {HTMLElement} dropdown      - Dropdown element.
 * @param {HTMLElement} buttonElement - Button element.
 */
function positionDropdown( dropdown, buttonElement ) {
	const buttonRect = buttonElement.getBoundingClientRect();
	const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
	const scrollLeft =
		window.pageXOffset || document.documentElement.scrollLeft;

	dropdown.style.position = 'absolute';
	dropdown.style.top = `${ buttonRect.bottom + scrollTop + 5 }px`;
	dropdown.style.left = `${ buttonRect.left + scrollLeft }px`;
	dropdown.style.zIndex = '9999';
}
