/**
 * EventTimingStatus — explains what the saved timing of an event date
 * means beyond its fields (#1851):
 *
 * - For a date of a series, whether its dates and times follow the series
 *   or are its own, with an action that gives them back to the series
 *   (`inherit_timing`, #1819). Dates and times are separate groups; the
 *   times group includes all day.
 * - Whether visitors can add the event to their calendars, which needs
 *   both times unless the event is all day.
 *
 * @package FairEvents
 */

import {
	Button,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { isCalendarExportable } from '../components/eventTiming.js';

/**
 * @param {Object}      props
 * @param {Object}      props.eventDate    Saved event date from the REST API.
 * @param {boolean}     props.detailsDirty Whether Event Details has unsaved edits.
 * @param {string|null} props.inheriting   Group being reset ('dates' | 'times'), or null.
 * @param {string|null} props.error        Error from the last reset, or null.
 * @param {Function}    props.onInherit    Called with 'dates' or 'times'.
 */
export default function EventTimingStatus( {
	eventDate,
	detailsDirty,
	inheriting,
	error,
	onInherit,
} ) {
	const overrides =
		eventDate.occurrence_type === 'generated'
			? eventDate.timing_overrides
			: null;
	const showExportNote =
		!! eventDate.start_date && ! isCalendarExportable( eventDate );

	if ( ! overrides && ! showExportNote ) {
		return null;
	}

	const resetButton = ( group, label ) => (
		<Button
			variant="secondary"
			size="compact"
			onClick={ () => onInherit( group ) }
			isBusy={ inheriting === group }
			disabled={ !! inheriting || detailsDirty }
			accessibleWhenDisabled
		>
			{ label }
		</Button>
	);

	return (
		<VStack spacing={ 2 } className="fair-events-timing-status">
			{ overrides && (
				<>
					{ overrides.dates && (
						<HStack alignment="left" spacing={ 2 } wrap>
							<p style={ { margin: 0 } }>
								{ __(
									'This date has been moved from its place in the series.',
									'fair-events'
								) }
							</p>
							{ resetButton(
								'dates',
								__( 'Use the series date', 'fair-events' )
							) }
						</HStack>
					) }
					{ overrides.times ? (
						<HStack alignment="left" spacing={ 2 } wrap>
							<p style={ { margin: 0 } }>
								{ __(
									'This date has its own times. Changes to the series times leave it unchanged.',
									'fair-events'
								) }
							</p>
							{ resetButton(
								'times',
								__( 'Use the series times', 'fair-events' )
							) }
						</HStack>
					) : (
						<p style={ { margin: 0 } }>
							{ __(
								'The times follow the series. Changing or clearing a time here gives this date its own times.',
								'fair-events'
							) }
						</p>
					) }
					{ ( overrides.dates || overrides.times ) &&
						detailsDirty && (
							<p style={ { margin: 0, color: '#757575' } }>
								{ __(
									'Save your changes before restoring the series timing.',
									'fair-events'
								) }
							</p>
						) }
					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }
				</>
			) }

			{ showExportNote && (
				<Notice status="info" isDismissible={ false }>
					{ eventDate.occurrence_type === 'master'
						? __(
								'Visitors can’t add dates of this series without both start and end times to their calendars, unless they are all day.',
								'fair-events'
							)
						: __(
								'Visitors can’t add this event to their calendars yet: both start and end times are required, unless the event is all day.',
								'fair-events'
							) }
				</Notice>
			) }
		</VStack>
	);
}
