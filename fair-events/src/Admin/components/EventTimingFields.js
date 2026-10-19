/**
 * EventTimingFields — the dates, optional times and all-day choice of an
 * event date, shared by the Quick Add popup, Manage Event and the event
 * meta box (#1851).
 *
 * Dates are required for a dated event; either time may be left empty and
 * cleared on its own, and an empty time stays unspecified. All day is an
 * explicit choice. The optional Event length shortcut only ever fills the
 * end from a supplied start, never a missing time.
 *
 * @package FairEvents
 */

import { useMemo } from '@wordpress/element';
import {
	TextControl,
	CheckboxControl,
	SelectControl,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { DurationOptions, calculateDuration } from 'fair-events-shared';
import { getDurationLabelConfig } from './durationLabels.js';

const pad = ( value ) => String( value ).padStart( 2, '0' );

const toDateString = ( date ) =>
	`${ date.getFullYear() }-${ pad( date.getMonth() + 1 ) }-${ pad( date.getDate() ) }`;

/**
 * @param {Object}   props
 * @param {Object}   props.value                  Fields: `allDay`, `startDate`, `startTime`, `endDate`, `endTime` (`HH:MM`, '' when empty).
 * @param {Function} props.onChange               Called with the changed fields, e.g. `{ startTime: '' }`.
 * @param {string}   [props.error]                Validation message shown below the fields (see getTimingError()).
 * @param {boolean}  [props.withDuration]         Whether to offer the Event length shortcut.
 * @param {boolean}  [props.datesRequired]        Whether the dates are required form fields.
 * @param {boolean}  [props.disabled]             Whether every field is read-only.
 */
export default function EventTimingFields( {
	value,
	onChange,
	error = null,
	withDuration = false,
	datesRequired = false,
	disabled = false,
} ) {
	const { allDay, startDate, startTime, endDate, endTime } = value;

	const timedDurationOptions = useMemo(
		() =>
			new DurationOptions( {
				values: [ 30, 60, 90, 120, 150, 180, 240, 360, 480 ],
				unit: 'minutes',
				...getDurationLabelConfig(),
			} ),
		[]
	);

	const allDayDurationOptions = useMemo(
		() =>
			new DurationOptions( {
				values: [ 1, 2, 3, 4, 5, 6, 7 ],
				unit: 'days',
				...getDurationLabelConfig(),
			} ),
		[]
	);

	const getCurrentDuration = () => {
		if ( allDay ) {
			if ( ! startDate || ! endDate ) return 'other';
			const start = new Date( startDate );
			const end = new Date( endDate );
			const diffDays =
				Math.ceil( ( end - start ) / ( 1000 * 60 * 60 * 24 ) ) + 1;
			return allDayDurationOptions.getCurrentSelection( diffDays );
		}
		if ( ! startDate || ! startTime || ! endDate || ! endTime )
			return 'other';
		const minutes = calculateDuration(
			`${ startDate }T${ startTime }`,
			`${ endDate }T${ endTime }`
		);
		if ( minutes === null ) return 'other';
		return timedDurationOptions.getCurrentSelection( minutes );
	};

	// The length is counted from the start, so a timed event needs its
	// start time before a length can set the end.
	const durationUnavailable = ! startDate || ( ! allDay && ! startTime );

	const handleDurationChange = ( duration ) => {
		if ( duration === 'other' || durationUnavailable ) return;
		if ( allDay ) {
			const end = new Date( `${ startDate }T00:00:00` );
			end.setDate( end.getDate() + parseInt( duration, 10 ) - 1 );
			onChange( { endDate: toDateString( end ) } );
			return;
		}
		const start = new Date( `${ startDate }T${ startTime }` );
		const end = new Date(
			start.getTime() + parseInt( duration, 10 ) * 60000
		);
		onChange( {
			endDate: toDateString( end ),
			endTime: `${ pad( end.getHours() ) }:${ pad( end.getMinutes() ) }`,
		} );
	};

	let durationHelp;
	if ( ! startDate ) {
		durationHelp = __(
			'Enter a start date to choose an event length.',
			'fair-events'
		);
	} else if ( durationUnavailable ) {
		durationHelp = __(
			'Enter a start time to choose an event length.',
			'fair-events'
		);
	}

	const durationOptions = allDay
		? allDayDurationOptions.getDurationOptions()
		: timedDurationOptions.getDurationOptions();

	const dateField = ( label, field ) => (
		<TextControl
			label={ label }
			type="date"
			value={ value[ field ] }
			onChange={ ( next ) => onChange( { [ field ]: next } ) }
			required={ datesRequired }
			disabled={ disabled }
		/>
	);

	const timeField = ( label, field ) => (
		<TextControl
			label={ label }
			type="time"
			value={ value[ field ] }
			onChange={ ( next ) => onChange( { [ field ]: next } ) }
			disabled={ disabled }
		/>
	);

	return (
		<VStack spacing={ 3 } className="fair-events-timing-fields">
			<CheckboxControl
				label={ __( 'All day', 'fair-events' ) }
				checked={ allDay }
				onChange={ ( next ) => onChange( { allDay: next } ) }
				disabled={ disabled }
			/>

			<HStack spacing={ 4 } alignment="topLeft" wrap>
				{ dateField( __( 'Start date', 'fair-events' ), 'startDate' ) }
				{ ! allDay &&
					timeField(
						__( 'Start time (optional)', 'fair-events' ),
						'startTime'
					) }
			</HStack>
			<HStack spacing={ 4 } alignment="topLeft" wrap>
				{ dateField( __( 'End date', 'fair-events' ), 'endDate' ) }
				{ ! allDay &&
					timeField(
						__( 'End time (optional)', 'fair-events' ),
						'endTime'
					) }
			</HStack>

			{ ! allDay && (
				<p
					className="fair-events-timing-fields__help"
					style={ { margin: 0, color: '#757575', fontSize: '12px' } }
				>
					{ __(
						'Leave a time empty until it is known. Visitors see only the times you enter.',
						'fair-events'
					) }
				</p>
			) }

			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			{ withDuration && (
				<SelectControl
					label={ __( 'Event length', 'fair-events' ) }
					value={ String( getCurrentDuration() ) }
					options={ durationOptions.map( ( opt ) => ( {
						label: opt.label,
						value: String( opt.value ),
					} ) ) }
					onChange={ handleDurationChange }
					disabled={ disabled || durationUnavailable }
					help={ durationHelp }
				/>
			) }
		</VStack>
	);
}
