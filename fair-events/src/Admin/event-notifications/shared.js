/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';

export const PATH = '/fair-events/v1/event-notifications';

/**
 * Notification kinds, in the order they are offered. Mirrors
 * Configurations::TYPES; a configuration without a name is shown by its
 * kind's name.
 */
export const TYPE_LABELS = {
	telegram: __( 'Telegram', 'fair-events' ),
	bulk_email: __( 'Bulk email', 'fair-events' ),
	individual_email: __( 'Individual email', 'fair-events' ),
};

export const DAYS = [
	{ value: '1', label: __( 'Monday', 'fair-events' ) },
	{ value: '2', label: __( 'Tuesday', 'fair-events' ) },
	{ value: '3', label: __( 'Wednesday', 'fair-events' ) },
	{ value: '4', label: __( 'Thursday', 'fair-events' ) },
	{ value: '5', label: __( 'Friday', 'fair-events' ) },
	{ value: '6', label: __( 'Saturday', 'fair-events' ) },
	{ value: '7', label: __( 'Sunday', 'fair-events' ) },
];

export const WEEK_SCOPES = [
	{ value: 'current', label: __( 'The week of the send', 'fair-events' ) },
	{ value: 'next', label: __( 'The following week', 'fair-events' ) },
];

export const RUN_STATUS_LABELS = {
	sent: __( 'Sent', 'fair-events' ),
	partial: __( 'Partly sent', 'fair-events' ),
	failed: __( 'Failed', 'fair-events' ),
	skipped: __( 'Skipped — no events', 'fair-events' ),
	skipped_empty: __( 'Skipped — no events', 'fair-events' ),
	expired: __( 'Skipped — week ended', 'fair-events' ),
	suspended: __( 'Not sent — paused', 'fair-events' ),
	configuration_error: __( 'Configuration error', 'fair-events' ),
};

const STATE_COLORS = {
	sent: '#00a32a',
	partial: '#b26200',
	uncertain: '#b26200',
	suspended: '#b26200',
	failed: '#d63638',
	configuration_error: '#d63638',
};

export function errorMessage( error, fallback ) {
	return error?.message || error?.data?.message || fallback;
}

/**
 * Warn before the page is left while a section holds unsaved changes.
 *
 * @param {boolean} dirty Whether the section has unsaved changes.
 */
export function useUnsavedWarning( dirty ) {
	useEffect( () => {
		if ( ! dirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ dirty ] );
}

export function StatusText( { state, label } ) {
	return (
		<span
			style={ {
				color: STATE_COLORS[ state ] || '#50575e',
				fontWeight: 600,
			} }
		>
			{ label }
		</span>
	);
}

export function Row( { children, detail } ) {
	return (
		<div className="fair-events-notifications__row">
			{ children }
			{ detail && (
				<p className="fair-events-notifications__row-detail">
					{ detail }
				</p>
			) }
		</div>
	);
}

/**
 * Options for an event source select, keeping a saved source that is no
 * longer available visible instead of silently dropping it.
 *
 * @param {Array}  sources Enabled event sources.
 * @param {string} current Selected slug.
 * @return {Array} Select options.
 */
export function sourceOptions( sources, current ) {
	const options = [
		{ value: '', label: __( 'Choose an event feed', 'fair-events' ) },
		...sources.map( ( source ) => ( {
			value: source.slug,
			label: source.name,
		} ) ),
	];
	if ( current && ! sources.some( ( source ) => source.slug === current ) ) {
		options.push( {
			value: current,
			label: sprintf(
				/* translators: %s: event feed slug */
				__( '%s (unavailable)', 'fair-events' ),
				current
			),
		} );
	}
	return options;
}
