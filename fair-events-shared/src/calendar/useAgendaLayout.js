/**
 * Whether the calendar is showing its mobile agenda layout.
 *
 * @package FairEventsShared
 */

import { useState, useEffect } from '@wordpress/element';

/**
 * Media query for the mobile agenda. Keep in sync with the agenda block in
 * style.css.
 */
export const AGENDA_MEDIA_QUERY = 'screen and (max-width: 600px)';

function matchesAgenda() {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( AGENDA_MEDIA_QUERY ).matches
	);
}

/**
 * Track the agenda media query. Without `matchMedia` (old browsers, tests)
 * the calendar is treated as a grid.
 *
 * @param {boolean} enabled Whether the consumer needs the value at all.
 * @return {boolean} True while the agenda layout applies.
 */
export default function useAgendaLayout( enabled = true ) {
	const [ isAgenda, setIsAgenda ] = useState(
		() => enabled && matchesAgenda()
	);

	useEffect( () => {
		if ( ! enabled || typeof window.matchMedia !== 'function' ) {
			setIsAgenda( false );
			return undefined;
		}
		const query = window.matchMedia( AGENDA_MEDIA_QUERY );
		const update = () => setIsAgenda( query.matches );
		update();
		query.addEventListener( 'change', update );
		return () => query.removeEventListener( 'change', update );
	}, [ enabled ] );

	return isAgenda;
}
