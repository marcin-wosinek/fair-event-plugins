/**
 * Edit component for the Calendar Button Block
 */

import {
	TextControl,
	PanelBody,
	ToggleControl,
	TextareaControl,
	SelectControl,
	Notice,
	Spinner,
} from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { calculateDuration } from 'fair-events-shared';
import {
	calculateEndTime,
	convertToDateOnly,
	calculateDaysInclusive,
	calculateEndDate,
	validateDateTimeOrder,
	getDateTimeValidationError,
} from '../utils/dateTime.js';
import { rruleManager } from '../utils/rruleManager.js';
import RecurringEventsCalendar from './RecurringEventsCalendar.js';
import { useEventSync } from '../utils/useEventSync.js';

/**
 * Edit component for the Calendar Button Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {Object}   props.context       - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( {
	attributes,
	setAttributes,
	context,
} ) {
	const blockProps = useBlockProps();

	const {
		start,
		end,
		allDay,
		description,
		location,
		recurring,
		recurrence,
		syncWithEvent,
	} = attributes;

	// Detect if we're on a fair_event post type. The block's post context
	// names the post it renders for, which differs from the edited post
	// only when the block sits in a query loop.
	const { postType, postId, isCurrentPost } = useSelect(
		( select ) => {
			const editor = select( 'core/editor' );
			const currentPostId = editor?.getCurrentPostId();
			const contextPostId = context?.postId ?? currentPostId;

			return {
				postType: context?.postType ?? editor?.getCurrentPostType(),
				postId: contextPostId,
				isCurrentPost: contextPostId === currentPostId,
			};
		},
		[ context?.postId, context?.postType ]
	);

	const isOnFairEvent = postType === 'fair_event';

	// Auto-enable sync when block is first added to a fair_event post
	useEffect( () => {
		if ( isOnFairEvent && ! syncWithEvent && ! start && ! end ) {
			// Only enable sync if this appears to be a new block (no dates set yet)
			setAttributes( { syncWithEvent: true } );
		}
	}, [ isOnFairEvent ] );

	const sync = useEventSync( {
		enabled: syncWithEvent && isOnFairEvent,
		postId,
		isCurrentPost,
	} );
	// Synchronized fields follow the event and can't be edited here, also
	// while the event data is unavailable: turning sync off unlocks them
	// with the latest values.
	const fieldsLocked = sync.status !== 'off';
	const syncNotice = getSyncNotice( sync );

	// Copy the event's values into the attributes whenever they change.
	useEffect( () => {
		if ( sync.status !== 'synced' ) {
			return;
		}

		const { values } = sync;
		if (
			values.start !== start ||
			values.end !== end ||
			values.allDay !== allDay ||
			values.location !== location
		) {
			setAttributes( values );
		}
	}, [ sync ] );

	// Extract recurrence values with defaults
	const frequency = recurrence?.frequency || 'WEEKLY';
	const repeatCount = recurrence?.count || null;
	const untilDate = recurrence?.until || '';

	// State to preserve datetime values when switching between all-day and timed events
	const [ preservedStartTime, setPreservedStartTime ] = useState( '' );
	const [ preservedEndTime, setPreservedEndTime ] = useState( '' );

	// Duration options for timed events (in minutes)
	const durationOptions = [
		{ label: __( 'Other', 'fair-calendar-button' ), value: 'other' },
		{ label: __( '30 minutes', 'fair-calendar-button' ), value: '30' },
		{ label: __( '1 hour', 'fair-calendar-button' ), value: '60' },
		{
			label: __( '1 hour 30 minutes', 'fair-calendar-button' ),
			value: '90',
		},
		{ label: __( '2 hours', 'fair-calendar-button' ), value: '120' },
		{
			label: __( '2 hours 30 minutes', 'fair-calendar-button' ),
			value: '150',
		},
		{ label: __( '3 hours', 'fair-calendar-button' ), value: '180' },
		{ label: __( '4 hours', 'fair-calendar-button' ), value: '240' },
		{ label: __( '6 hours', 'fair-calendar-button' ), value: '360' },
		{ label: __( '8 hours', 'fair-calendar-button' ), value: '480' },
	];

	// Length options for all-day events (in days)
	const allDayLengthOptions = [
		{ label: __( 'Other', 'fair-calendar-button' ), value: 'other' },
		{ label: __( '1 day', 'fair-calendar-button' ), value: '1' },
		{ label: __( '2 days', 'fair-calendar-button' ), value: '2' },
		{ label: __( '3 days', 'fair-calendar-button' ), value: '3' },
	];

	// Function to calculate current event duration in minutes
	const calculateCurrentDuration = ( startTime, endTime ) => {
		return calculateDuration( startTime, endTime );
	};

	// Function to calculate current all-day event length in days
	const calculateCurrentAllDayLength = ( startDate, endDate ) => {
		return calculateDaysInclusive( startDate, endDate );
	};

	// Get validation status and error message
	const dateTimeValidation = {
		isValid: validateDateTimeOrder( start, end ),
		errorMessage: getDateTimeValidationError( start, end, allDay ),
	};

	// Handle start time change while maintaining constant duration
	const handleStartTimeChange = ( newStartTime ) => {
		setAttributes( { start: newStartTime } );

		// Only adjust end time if both start and end times exist
		if ( end && newStartTime ) {
			if ( allDay ) {
				// For all-day events, maintain the same number of days
				const currentLength = calculateCurrentAllDayLength(
					start,
					end
				);
				if ( currentLength !== null && currentLength > 0 ) {
					const newEndDate = calculateEndDate(
						newStartTime,
						currentLength.toString()
					);
					if ( newEndDate ) {
						setAttributes( { end: newEndDate } );
					}
				}
			} else {
				// For timed events, maintain the same duration in minutes
				const currentDuration = calculateCurrentDuration( start, end );
				if ( currentDuration !== null && currentDuration > 0 ) {
					const newEndTime = calculateEndTime(
						newStartTime,
						currentDuration.toString()
					);
					if ( newEndTime ) {
						setAttributes( { end: newEndTime } );
					}
				}
			}
		}
	};

	// Get current duration selection value for timed events
	const getCurrentDurationSelection = () => {
		if ( ! start || ! end || allDay ) {
			return 'other';
		}

		const currentDuration = calculateCurrentDuration( start, end );
		if ( currentDuration === null ) {
			return 'other';
		}

		// Check if current duration matches any of the predefined options
		const matchingOption = durationOptions.find(
			( option ) =>
				option.value !== 'other' &&
				parseInt( option.value ) === currentDuration
		);

		return matchingOption ? matchingOption.value : 'other';
	};

	// Get current length selection value for all-day events
	const getCurrentAllDayLengthSelection = () => {
		if ( ! start || ! end || ! allDay ) {
			return 'other';
		}

		const currentLength = calculateCurrentAllDayLength( start, end );
		if ( currentLength === null ) {
			return 'other';
		}

		// Check if current length matches any of the predefined options
		const matchingOption = allDayLengthOptions.find(
			( option ) =>
				option.value !== 'other' &&
				parseInt( option.value ) === currentLength
		);

		return matchingOption ? matchingOption.value : 'other';
	};

	// Update RRULE when components change
	const updateRRule = ( newRecurrence = recurrence ) => {
		const newRRule = rruleManager.toRRule( newRecurrence );
		setAttributes( { rRule: newRRule } );
	};

	// Handle frequency change
	const handleFrequencyChange = ( newFrequency ) => {
		const newRecurrence = {
			...recurrence,
			frequency: newFrequency,
		};
		setAttributes( { recurrence: newRecurrence } );
		updateRRule( newRecurrence );
	};

	// Handle repeat count change
	const handleRepeatCountChange = ( newCount ) => {
		const count = newCount ? parseInt( newCount ) : null;
		const newRecurrence = {
			...recurrence,
			count,
			until: '', // Clear until date when count is set
		};
		setAttributes( { recurrence: newRecurrence } );
		updateRRule( newRecurrence );
	};

	// Handle until date change
	const handleUntilDateChange = ( newUntilDate ) => {
		const newRecurrence = {
			...recurrence,
			until: newUntilDate,
			count: null, // Clear repeat count when until is set
		};
		setAttributes( { recurrence: newRecurrence } );
		updateRRule( newRecurrence );
	};

	// Handle allDay toggle while preserving datetime values
	const handleAllDayToggle = ( newAllDayValue ) => {
		if ( newAllDayValue ) {
			// Switching to all-day: preserve datetime values and convert to date format
			if ( start ) {
				setPreservedStartTime( start );
				setAttributes( { start: convertToDateOnly( start ) } );
			}
			if ( end ) {
				setPreservedEndTime( end );
				setAttributes( { end: convertToDateOnly( end ) } );
			}
		} else {
			// Switching to timed event: restore preserved datetime values if available
			if ( preservedStartTime ) {
				setAttributes( { start: preservedStartTime } );
			}
			if ( preservedEndTime ) {
				setAttributes( { end: preservedEndTime } );
			}
		}

		setAttributes( { allDay: newAllDayValue } );
	};

	// Handle duration change for timed events
	const handleDurationChange = ( duration ) => {
		if ( duration === 'other' ) {
			// Don't change the end time, let user set it manually
			return;
		}

		const newEndTime = calculateEndTime( start, duration );
		if ( newEndTime ) {
			setAttributes( { end: newEndTime } );
		}
	};

	// Handle length change for all-day events
	const handleAllDayLengthChange = ( length ) => {
		if ( length === 'other' ) {
			// Don't change the end date, let user set it manually
			return;
		}

		const newEndDate = calculateEndDate( start, length );
		if ( newEndDate ) {
			setAttributes( { end: newEndDate } );
		}
	};

	const TEMPLATE = [
		[
			'core/button',
			{
				text: __( 'Add to Calendar', 'fair-calendar-button' ),
				url: '',
			},
		],
	];

	// Add wp-block-buttons class to support button width settings
	const innerBlocksProps = useInnerBlocksProps(
		{
			...blockProps,
			className: `${
				blockProps.className || ''
			} wp-block-buttons`.trim(),
		},
		{
			template: TEMPLATE,
			templateLock: false,
			allowedBlocks: [ 'core/button' ],
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __(
						'Calendar Button Settings',
						'fair-calendar-button'
					) }
				>
					{ isOnFairEvent && (
						<ToggleControl
							label={ __(
								'Keep in sync with event data',
								'fair-calendar-button'
							) }
							checked={ syncWithEvent }
							onChange={ ( value ) =>
								setAttributes( { syncWithEvent: value } )
							}
							help={ __(
								'Automatically use the start, end, all-day setting, and location from the event.',
								'fair-calendar-button'
							) }
						/>
					) }
					{ sync.status === 'loading' && (
						<p className="fair-calendar-button-sync-loading">
							<Spinner />
							{ __(
								'Loading event details…',
								'fair-calendar-button'
							) }
						</p>
					) }
					{ syncNotice && (
						<Notice status="warning" isDismissible={ false }>
							{ syncNotice }
						</Notice>
					) }
					<ToggleControl
						label={ __( 'All Day Event', 'fair-calendar-button' ) }
						checked={ allDay }
						onChange={ handleAllDayToggle }
						disabled={ fieldsLocked }
					/>
					<TextControl
						label={
							allDay
								? __( 'Start Date', 'fair-calendar-button' )
								: __(
										'Start Date/Time',
										'fair-calendar-button'
									)
						}
						value={ start }
						onChange={ handleStartTimeChange }
						type={ allDay ? 'date' : 'datetime-local' }
						disabled={ fieldsLocked }
					/>
					{ allDay && (
						<SelectControl
							label={ __(
								'Event Length',
								'fair-calendar-button'
							) }
							value={ getCurrentAllDayLengthSelection() }
							options={ allDayLengthOptions }
							onChange={ handleAllDayLengthChange }
							disabled={ fieldsLocked }
						/>
					) }
					{ ! allDay && (
						<SelectControl
							label={ __(
								'Event Length',
								'fair-calendar-button'
							) }
							value={ getCurrentDurationSelection() }
							options={ durationOptions }
							onChange={ handleDurationChange }
							disabled={ fieldsLocked }
						/>
					) }
					<TextControl
						label={
							allDay
								? __( 'End Date', 'fair-calendar-button' )
								: __( 'End Date/Time', 'fair-calendar-button' )
						}
						value={ end }
						onChange={ ( value ) =>
							setAttributes( { end: value } )
						}
						type={ allDay ? 'date' : 'datetime-local' }
						disabled={ fieldsLocked }
						className={
							! dateTimeValidation.isValid
								? 'has-error'
								: undefined
						}
						help={
							! dateTimeValidation.isValid
								? dateTimeValidation.errorMessage
								: undefined
						}
					/>
					<TextControl
						label={ __( 'Location', 'fair-calendar-button' ) }
						value={ location }
						onChange={ ( value ) =>
							setAttributes( { location: value } )
						}
						disabled={ fieldsLocked }
					/>
					<TextareaControl
						label={ __( 'Description', 'fair-calendar-button' ) }
						value={ description }
						onChange={ ( value ) =>
							setAttributes( { description: value } )
						}
					/>
					<ToggleControl
						label={ __(
							'Recurring Event',
							'fair-calendar-button'
						) }
						checked={ recurring }
						onChange={ ( value ) =>
							setAttributes( { recurring: value } )
						}
						help={ __(
							'Enable this to set up a recurring event with an iCal recurrence rule.',
							'fair-calendar-button'
						) }
					/>
					{ recurring && (
						<>
							<SelectControl
								label={ __(
									'Frequency',
									'fair-calendar-button'
								) }
								value={ frequency }
								options={ [
									{
										label: __(
											'Daily',
											'fair-calendar-button'
										),
										value: 'DAILY',
									},
									{
										label: __(
											'Weekly',
											'fair-calendar-button'
										),
										value: 'WEEKLY',
									},
									{
										label: __(
											'Biweekly',
											'fair-calendar-button'
										),
										value: 'BIWEEKLY',
									},
								] }
								onChange={ handleFrequencyChange }
								help={ __(
									'How often the event repeats.',
									'fair-calendar-button'
								) }
							/>
							<TextControl
								label={ __(
									'Number of Repetitions',
									'fair-calendar-button'
								) }
								type="number"
								value={ repeatCount || '' }
								onChange={ handleRepeatCountChange }
								help={ __(
									'Leave empty for unlimited repetitions, or set "Until Date" below.',
									'fair-calendar-button'
								) }
								min={ 1 }
							/>
							<TextControl
								label={ __(
									'Until Date',
									'fair-calendar-button'
								) }
								type="date"
								value={ untilDate }
								onChange={ handleUntilDateChange }
								help={ __(
									'Leave empty for unlimited repetitions, or set "Number of Repetitions" above.',
									'fair-calendar-button'
								) }
							/>

							<RecurringEventsCalendar
								startDate={ start }
								recurrence={ recurrence }
							/>
						</>
					) }
				</PanelBody>
			</InspectorControls>
			<div { ...innerBlocksProps } />
		</>
	);
}

/**
 * Explain why a synchronized button has no event data to use, and how to
 * recover.
 *
 * @param {Object} sync State from useEventSync().
 * @return {string} Notice text, empty when there is nothing to report.
 */
function getSyncNotice( sync ) {
	switch ( sync.status ) {
		case 'unavailable':
			return __(
				'Fair Events is not active, so this button can’t read the event’s dates. Visitors can’t add the event to their calendar until Fair Events is active again or you turn off syncing and enter the dates here.',
				'fair-calendar-button'
			);
		case 'missing':
			return __(
				'This event has no dates yet. Visitors can’t add it to their calendar until you set its dates in the Event Details panel or turn off syncing and enter them here.',
				'fair-calendar-button'
			);
		case 'incomplete':
			return __(
				'Visitors can’t add this event to their calendar until it has both a start and an end time, or is all-day. Complete its times in the Event Details panel, or turn off syncing and enter them here.',
				'fair-calendar-button'
			);
		case 'error':
			return sync.errorMessage
				? sprintf(
						/* translators: %s: error message from the server. */
						__(
							'The event’s details could not be loaded (%s). Visitors can’t add the event to their calendar until they load. Reload the editor to try again, or turn off syncing and enter the dates here.',
							'fair-calendar-button'
						),
						sync.errorMessage
					)
				: __(
						'The event’s details could not be loaded. Visitors can’t add the event to their calendar until they load. Reload the editor to try again, or turn off syncing and enter the dates here.',
						'fair-calendar-button'
					);
		default:
			return '';
	}
}
