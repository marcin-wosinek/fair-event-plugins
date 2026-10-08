/**
 * Event Schedule - Manage Event tab
 *
 * Lets an organizer plan when and where each workshop from Prices takes
 * place, next to program items such as breaks. All edits stay in this
 * component's state until "Save schedule" sends the whole schedule; a
 * rejected save changes nothing, here or on the server.
 *
 * @package FairEventsExperimental
 */

import { useState, useEffect, useMemo, useCallback } from '@wordpress/element';
import {
	Card,
	CardBody,
	Button,
	Spinner,
	Notice,
	TextControl,
	TextareaControl,
	SelectControl,
	DropdownMenu,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	entryFromItem,
	entryName,
	errorsByEntry,
	newEntry,
	overlapsByEntry,
	serialize,
	toPayload,
	validateEntries,
} from './scheduleModel.js';

const TAB_NAME = 'schedule';

export default function EventSchedule( {
	eventDateId,
	eventDate,
	setTabDirty,
	getTabDraft,
	setTabDraft,
} ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ entries, setEntries ] = useState( [] );
	// Serialized entries as last loaded or saved; null until loaded.
	const [ savedState, setSavedState ] = useState( null );
	const [ options, setOptions ] = useState( [] );
	const [ readOnly, setReadOnly ] = useState( false );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ fieldErrors, setFieldErrors ] = useState( {} );
	// Server warnings by saved item ID (e.g. outside the event's dates).
	const [ warnings, setWarnings ] = useState( {} );
	const [ removeTarget, setRemoveTarget ] = useState( null );

	const applyResponse = useCallback( ( data ) => {
		const loaded = ( data.items || [] ).map( entryFromItem );
		setEntries( loaded );
		setSavedState( serialize( loaded ) );
		setOptions( data.options || [] );
		setReadOnly( !! data.read_only );
		setWarnings(
			Object.fromEntries(
				( data.warnings || [] ).map( ( warning ) => [
					warning.id,
					warning.message,
				] )
			)
		);
	}, [] );

	useEffect( () => {
		let cancelled = false;

		apiFetch( {
			path: `/fair-events/v1/event-dates/${ eventDateId }/schedule`,
		} )
			.then( ( data ) => {
				if ( cancelled ) {
					return;
				}
				applyResponse( data );

				// Unsaved edits parked when the organizer switched tabs win
				// over what was just loaded; the option list and the names
				// of linked workshops still come from the server.
				const draft = getTabDraft?.( TAB_NAME );
				if ( draft ) {
					const namesById = Object.fromEntries(
						( data.options || [] ).map( ( option ) => [
							option.id,
							option.name,
						] )
					);
					setEntries(
						draft.entries.map( ( entry ) =>
							entry.ticket_option_id &&
							namesById[ entry.ticket_option_id ]
								? {
										...entry,
										title: namesById[
											entry.ticket_option_id
										],
								  }
								: entry
						)
					);
					setSavedState( draft.savedState );
					setFieldErrors( draft.fieldErrors || {} );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err.message ||
							__(
								'Failed to load the schedule.',
								'fair-events-experimental'
							)
					);
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setLoading( false );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ eventDateId, applyResponse, getTabDraft ] );

	const dirty = savedState !== null && serialize( entries ) !== savedState;

	useEffect( () => {
		setTabDirty?.( TAB_NAME, dirty );
	}, [ dirty, setTabDirty ] );

	// Park unsaved edits with the host page, which outlives this tab.
	useEffect( () => {
		if ( savedState === null ) {
			return;
		}
		setTabDraft?.(
			TAB_NAME,
			dirty ? { entries, savedState, fieldErrors } : undefined
		);
	}, [ dirty, entries, savedState, fieldErrors, setTabDraft ] );

	const overlaps = useMemo( () => overlapsByEntry( entries ), [ entries ] );

	const addableOptions = options.filter(
		( option ) =>
			! entries.some( ( entry ) => entry.ticket_option_id === option.id )
	);

	const updateEntry = ( key, changes ) => {
		setEntries( ( prev ) =>
			prev.map( ( entry ) =>
				entry.key === key ? { ...entry, ...changes } : entry
			)
		);
		// A changed field no longer shows the message about its old value.
		setFieldErrors( ( prev ) => {
			if ( ! prev[ key ] ) {
				return prev;
			}
			const remaining = { ...prev[ key ] };
			if ( 'title' in changes ) {
				delete remaining.title;
			}
			if ( 'bookable' in changes ) {
				delete remaining.bookable;
			}
			if ( 'location' in changes ) {
				delete remaining.location;
			}
			if ( 'startDate' in changes || 'startTime' in changes ) {
				delete remaining.start_datetime;
				delete remaining.end_datetime;
			}
			if ( 'endDate' in changes || 'endTime' in changes ) {
				delete remaining.end_datetime;
			}
			return { ...prev, [ key ]: remaining };
		} );
	};

	const addEntry = ( option = null ) => {
		setEntries( ( prev ) => [ ...prev, newEntry( eventDate, option ) ] );
		setSuccess( null );
	};

	const confirmRemove = () => {
		const key = removeTarget.key;
		setEntries( ( prev ) => prev.filter( ( entry ) => entry.key !== key ) );
		setFieldErrors( ( prev ) => {
			const { [ key ]: removed, ...rest } = prev; // eslint-disable-line no-unused-vars
			return rest;
		} );
		setRemoveTarget( null );
		setSuccess( null );
	};

	const handleSave = async () => {
		setSuccess( null );

		const clientErrors = validateEntries( entries );
		if ( Object.keys( clientErrors ).length ) {
			setFieldErrors( clientErrors );
			setError(
				__(
					'The schedule was not saved. Check the marked fields and save again.',
					'fair-events-experimental'
				)
			);
			return;
		}

		setSaving( true );
		setError( null );
		setFieldErrors( {} );

		try {
			const data = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/schedule`,
				method: 'PUT',
				data: { items: toPayload( entries ) },
			} );
			applyResponse( data );
			setSuccess( __( 'Schedule saved.', 'fair-events-experimental' ) );
		} catch ( err ) {
			// The entries stay exactly as typed: nothing was saved.
			setFieldErrors( errorsByEntry( err.data?.errors ) );
			setError(
				err.message ||
					__(
						'Failed to save the schedule. Your changes are still here — try again.',
						'fair-events-experimental'
					)
			);
		} finally {
			setSaving( false );
		}
	};

	if ( loading ) {
		return (
			<Card style={ { marginTop: '16px' } }>
				<CardBody>
					<Spinner />
				</CardBody>
			</Card>
		);
	}

	if ( loadError ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ loadError }
			</Notice>
		);
	}

	let addWorkshopReason = '';
	if ( ! options.length ) {
		addWorkshopReason = __(
			'Workshops come from the add-ons in Prices. Add one there first.',
			'fair-events-experimental'
		);
	} else if ( ! addableOptions.length ) {
		addWorkshopReason = __(
			'Every add-on from Prices is on the schedule already.',
			'fair-events-experimental'
		);
	}

	const removeMessage = () => {
		if ( ! removeTarget ) {
			return '';
		}
		const name = entryName( removeTarget );
		if ( removeTarget.ticket_option_id && ! removeTarget.bookable ) {
			return sprintf(
				/* translators: %s: workshop name */
				__(
					'Remove %s from the schedule? Once you save, it can be booked again: only its schedule entry keeps it Not bookable.',
					'fair-events-experimental'
				),
				name
			);
		}
		if ( removeTarget.ticket_option_id ) {
			return sprintf(
				/* translators: %s: workshop name */
				__(
					'Remove %s from the schedule? Its add-on in Prices and its bookings stay as they are.',
					'fair-events-experimental'
				),
				name
			);
		}
		return sprintf(
			/* translators: %s: schedule item title */
			__( 'Remove %s from the schedule?', 'fair-events-experimental' ),
			name
		);
	};

	return (
		<VStack
			spacing={ 4 }
			className="fair-events-schedule"
			style={ { marginTop: '16px' } }
		>
			{ readOnly && (
				<Notice status="info" isDismissible={ false }>
					{ __(
						'The schedule is managed on the series. Its dates are shown shifted to this date.',
						'fair-events-experimental'
					) }
				</Notice>
			) }

			{ error && (
				<Notice
					status="error"
					isDismissible
					onRemove={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			{ success && (
				<Notice
					status="success"
					isDismissible
					onRemove={ () => setSuccess( null ) }
				>
					{ success }
				</Notice>
			) }

			{ ! readOnly && (
				<div className="fair-events-schedule-toolbar">
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ saving }
						disabled={ saving || ! dirty }
					>
						{ __( 'Save schedule', 'fair-events-experimental' ) }
					</Button>
					{ addableOptions.length > 0 ? (
						<DropdownMenu
							icon={ null }
							text={ __(
								'Add workshop',
								'fair-events-experimental'
							) }
							label={ __(
								'Add a workshop from Prices',
								'fair-events-experimental'
							) }
							toggleProps={ { variant: 'secondary' } }
							controls={ addableOptions.map( ( option ) => ( {
								title: option.name,
								onClick: () => addEntry( option ),
							} ) ) }
						/>
					) : (
						<Button
							variant="secondary"
							disabled
							accessibleWhenDisabled
							aria-describedby="fair-events-schedule-add-workshop-reason"
						>
							{ __( 'Add workshop', 'fair-events-experimental' ) }
						</Button>
					) }
					<Button variant="secondary" onClick={ () => addEntry() }>
						{ __(
							'Add schedule item',
							'fair-events-experimental'
						) }
					</Button>
					{ ! dirty && (
						<span className="fair-events-schedule-status">
							{ __(
								'No unsaved changes.',
								'fair-events-experimental'
							) }
						</span>
					) }
				</div>
			) }

			{ ! readOnly && addWorkshopReason && (
				<p
					id="fair-events-schedule-add-workshop-reason"
					className="fair-events-schedule-hint"
				>
					{ addWorkshopReason }
				</p>
			) }

			{ entries.length === 0 && (
				<Card>
					<CardBody>
						<p className="fair-events-schedule-empty">
							{ __(
								'Nothing is scheduled yet. Add a workshop to set its time and room, or a schedule item for a break or anything else that is not booked.',
								'fair-events-experimental'
							) }
						</p>
					</CardBody>
				</Card>
			) }

			{ entries.map( ( entry ) => {
				const errors = fieldErrors[ entry.key ] || {};
				const isWorkshop = !! entry.ticket_option_id;
				const parallel = overlaps[ entry.key ] || [];

				return (
					<Card
						key={ entry.key }
						className="fair-events-schedule-entry"
					>
						<CardBody>
							<HStack
								alignment="top"
								justify="space-between"
								wrap
							>
								<div className="fair-events-schedule-entry-heading">
									<h3>{ entryName( entry ) }</h3>
									<span className="fair-events-schedule-badge">
										{ isWorkshop
											? __(
													'Workshop from Prices',
													'fair-events-experimental'
											  )
											: __(
													'Schedule item',
													'fair-events-experimental'
											  ) }
									</span>
									<span
										className={
											entry.bookable
												? 'fair-events-schedule-badge is-bookable'
												: 'fair-events-schedule-badge is-not-bookable'
										}
									>
										{ entry.bookable
											? __(
													'Bookable',
													'fair-events-experimental'
											  )
											: __(
													'Not bookable',
													'fair-events-experimental'
											  ) }
									</span>
									{ entry.location.trim() && (
										<span className="fair-events-schedule-badge is-room">
											{ entry.location.trim() }
										</span>
									) }
								</div>
								{ ! readOnly && (
									<Button
										variant="tertiary"
										isDestructive
										size="small"
										onClick={ () =>
											setRemoveTarget( entry )
										}
										aria-label={ sprintf(
											/* translators: %s: schedule entry name */
											__(
												'Remove %s',
												'fair-events-experimental'
											),
											entryName( entry )
										) }
									>
										{ __(
											'Remove',
											'fair-events-experimental'
										) }
									</Button>
								) }
							</HStack>

							{ entry.id && warnings[ entry.id ] && (
								<Notice
									status="warning"
									isDismissible={ false }
								>
									{ warnings[ entry.id ] }
								</Notice>
							) }

							{ parallel.length > 0 && (
								<p className="fair-events-schedule-hint">
									{ sprintf(
										/* translators: %s: comma-separated names of other schedule entries */
										_n(
											'Runs at the same time as %s.',
											'Runs at the same time as: %s.',
											parallel.length,
											'fair-events-experimental'
										),
										parallel
											.map( ( other ) =>
												other.location.trim()
													? sprintf(
															/* translators: 1: schedule entry name, 2: room or location */
															__(
																'%1$s (%2$s)',
																'fair-events-experimental'
															),
															entryName( other ),
															other.location.trim()
													  )
													: entryName( other )
											)
											.join( ', ' )
									) }
								</p>
							) }

							<div className="fair-events-schedule-fields">
								{ ! isWorkshop && (
									<TextControl
										className={
											errors.title
												? 'fair-events-schedule-field is-wide has-error'
												: 'fair-events-schedule-field is-wide'
										}
										label={ __(
											'Title',
											'fair-events-experimental'
										) }
										value={ entry.title }
										onChange={ ( value ) =>
											updateEntry( entry.key, {
												title: value,
											} )
										}
										help={ errors.title }
										disabled={ readOnly }
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
								) }

								<SelectControl
									className={
										errors.bookable
											? 'fair-events-schedule-field is-wide has-error'
											: 'fair-events-schedule-field is-wide'
									}
									label={ __(
										'Booking',
										'fair-events-experimental'
									) }
									value={
										entry.bookable
											? 'bookable'
											: 'not-bookable'
									}
									options={ [
										{
											label: __(
												'Bookable',
												'fair-events-experimental'
											),
											value: 'bookable',
											disabled: ! isWorkshop,
										},
										{
											label: __(
												'Not bookable',
												'fair-events-experimental'
											),
											value: 'not-bookable',
										},
									] }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											bookable: value === 'bookable',
										} )
									}
									help={
										errors.bookable ||
										( isWorkshop
											? __(
													'Not bookable keeps the workshop on the schedule and stops new bookings. Price and capacity stay in Prices.',
													'fair-events-experimental'
											  )
											: __(
													'A schedule item is never a ticket choice. To take bookings, add it as an add-on in Prices and use Add workshop.',
													'fair-events-experimental'
											  ) )
									}
									disabled={ readOnly || ! isWorkshop }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>

								<TextControl
									className={
										errors.start_datetime
											? 'fair-events-schedule-field has-error'
											: 'fair-events-schedule-field'
									}
									label={ __(
										'Start date',
										'fair-events-experimental'
									) }
									type="date"
									value={ entry.startDate }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											startDate: value,
										} )
									}
									help={ errors.start_datetime }
									disabled={ readOnly }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									className={
										errors.start_datetime
											? 'fair-events-schedule-field has-error'
											: 'fair-events-schedule-field'
									}
									label={ __(
										'Start time',
										'fair-events-experimental'
									) }
									type="time"
									value={ entry.startTime }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											startTime: value,
										} )
									}
									disabled={ readOnly }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									className={
										errors.end_datetime
											? 'fair-events-schedule-field has-error'
											: 'fair-events-schedule-field'
									}
									label={ __(
										'End date',
										'fair-events-experimental'
									) }
									type="date"
									value={ entry.endDate }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											endDate: value,
										} )
									}
									help={ errors.end_datetime }
									disabled={ readOnly }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									className={
										errors.end_datetime
											? 'fair-events-schedule-field has-error'
											: 'fair-events-schedule-field'
									}
									label={ __(
										'End time',
										'fair-events-experimental'
									) }
									type="time"
									value={ entry.endTime }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											endTime: value,
										} )
									}
									disabled={ readOnly }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>

								<TextControl
									className={
										errors.location
											? 'fair-events-schedule-field is-wide has-error'
											: 'fair-events-schedule-field is-wide'
									}
									label={ __(
										'Room or location',
										'fair-events-experimental'
									) }
									value={ entry.location }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											location: value,
										} )
									}
									help={ errors.location }
									disabled={ readOnly }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>

								<TextareaControl
									className="fair-events-schedule-field is-full"
									label={ __(
										'Description',
										'fair-events-experimental'
									) }
									value={ entry.description }
									onChange={ ( value ) =>
										updateEntry( entry.key, {
											description: value,
										} )
									}
									rows={ 3 }
									disabled={ readOnly }
									__nextHasNoMarginBottom
								/>
							</div>
						</CardBody>
					</Card>
				);
			} ) }

			<ConfirmDialog
				isOpen={ removeTarget !== null }
				onConfirm={ confirmRemove }
				onCancel={ () => setRemoveTarget( null ) }
				confirmButtonText={ __(
					'Remove from schedule',
					'fair-events-experimental'
				) }
				cancelButtonText={ __( 'Cancel', 'fair-events-experimental' ) }
			>
				{ removeMessage() }
			</ConfirmDialog>
		</VStack>
	);
}
