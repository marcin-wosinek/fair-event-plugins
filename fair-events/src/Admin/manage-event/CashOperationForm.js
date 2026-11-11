/**
 * Cash Operation Form
 *
 * Modal for recording or correcting one event income or expense operation
 * in Fair Finance: aggregate cash income ("€115 gate sales on Friday"), or
 * an expense paid from event cash or an organizer's personal funds.
 *
 * @package FairEvents
 */

import { useRef, useState } from '@wordpress/element';
import {
	Modal,
	Button,
	Notice,
	TextControl,
	TextareaControl,
	RadioControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export const SOURCE_EVENT_CASH = 'event_cash';
export const SOURCE_PERSONAL_FUNDS = 'personal_funds';

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a typed amount, accepting a comma as the decimal separator.
 *
 * @param {string} value Typed amount.
 * @return {number|null} Amount, or null when it is not a valid amount.
 */
export function parseAmount( value ) {
	const trimmed = String( value ?? '' ).trim();
	if ( ! AMOUNT_PATTERN.test( trimmed ) ) {
		return null;
	}
	const amount = parseFloat( trimmed.replace( ',', '.' ) );
	return Number.isFinite( amount ) ? amount : null;
}

/**
 * Field problems that keep the form from being saved.
 *
 * @param {Object} values Form values.
 * @return {Object} Message per field; empty when the form is valid.
 */
export function validateOperation( values ) {
	const errors = {};
	const amount = parseAmount( values.amount );

	if ( '' === String( values.amount ?? '' ).trim() ) {
		errors.amount = __( 'Enter an amount.', 'fair-events' );
	} else if ( null === amount ) {
		errors.amount = __(
			'Enter the amount as a number with at most two decimals, e.g. 115 or 12.50.',
			'fair-events'
		);
	} else if ( amount <= 0 ) {
		errors.amount = __(
			'The amount must be greater than zero.',
			'fair-events'
		);
	} else if ( amount > 99999999.99 ) {
		errors.amount = __(
			'The amount must be at most 99,999,999.99.',
			'fair-events'
		);
	}

	if ( ! DATE_PATTERN.test( values.entry_date || '' ) ) {
		errors.entry_date = __(
			'Choose the date of the operation.',
			'fair-events'
		);
	}

	if ( 'cost' === values.entry_type ) {
		if ( ! ( values.description || '' ).trim() ) {
			errors.description = __(
				'Enter a note explaining the expense.',
				'fair-events'
			);
		}
		if (
			SOURCE_PERSONAL_FUNDS === values.payment_source &&
			! ( values.payer_name || '' ).trim()
		) {
			errors.payer_name = __(
				'Enter the name of the person who paid.',
				'fair-events'
			);
		}
	}

	return errors;
}

/**
 * The initial form values for a new or existing operation.
 *
 * @param {Object|null} entry       Existing entry, or null.
 * @param {string}      entryType   'income' or 'cost' for a new entry.
 * @param {string}      defaultDate Default operation date (Y-m-d), or ''.
 * @return {Object} Form values.
 */
function initialValues( entry, entryType, defaultDate ) {
	if ( entry ) {
		return {
			entry_type: entry.entry_type,
			amount: entry.amount !== undefined ? String( entry.amount ) : '',
			entry_date: entry.entry_date || '',
			description: entry.description || '',
			payment_source: entry.payment_source || SOURCE_EVENT_CASH,
			payer_name: entry.payer_name || '',
		};
	}
	return {
		entry_type: entryType,
		amount: '',
		entry_date: defaultDate || '',
		description: '',
		payment_source: SOURCE_EVENT_CASH,
		payer_name: '',
	};
}

/**
 * Add or edit one event income or expense.
 *
 * The operation always belongs to the event date being managed: changing
 * its date never moves it to another event. Every field stays as typed when
 * a save fails, and the dialog cannot be dismissed while a save runs.
 *
 * @param {Object}      props
 * @param {number}      props.eventDateId Event date the operation belongs to.
 * @param {Object|null} props.entry       Entry being edited, or null to add.
 * @param {string}      props.entryType   'income' or 'cost' when adding.
 * @param {string}      props.defaultDate The event's date (Y-m-d), or ''.
 * @param {Function}    props.onSaved     Receives the saved entry.
 * @param {Function}    props.onCancel    Called when the dialog is dismissed.
 * @return {Element} The dialog.
 */
export default function CashOperationForm( {
	eventDateId,
	entry = null,
	entryType = 'income',
	defaultDate = '',
	onSaved,
	onCancel,
} ) {
	const [ values, setValues ] = useState( () =>
		initialValues( entry, entryType, defaultDate )
	);
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	// Fields the organizer has changed: their messages show right away,
	// while an untouched new form doesn't open covered in errors.
	const [ touched, setTouched ] = useState( {} );
	// Guards against a double click firing before the re-render.
	const busy = useRef( false );

	const isIncome = 'income' === values.entry_type;
	const isPersonal =
		! isIncome && SOURCE_PERSONAL_FUNDS === values.payment_source;
	const fieldErrors = validateOperation( values );
	const hasErrors = Object.keys( fieldErrors ).length > 0;
	const shownErrors = Object.fromEntries(
		Object.entries( fieldErrors ).filter(
			( [ field ] ) => touched[ field ]
		)
	);
	// The disabled save button says why: the first remaining problem.
	const blockingReason = Object.values( fieldErrors )[ 0 ];

	const set = ( field ) => ( value ) => {
		setValues( ( current ) => ( { ...current, [ field ]: value } ) );
		setTouched( ( current ) => ( { ...current, [ field ]: true } ) );
	};

	let title;
	if ( entry ) {
		title = isIncome
			? __( 'Edit income', 'fair-events' )
			: __( 'Edit expense', 'fair-events' );
	} else {
		title = isIncome
			? __( 'Add income', 'fair-events' )
			: __( 'Add expense', 'fair-events' );
	}

	const handleCancel = () => {
		if ( ! busy.current ) {
			onCancel();
		}
	};

	const handleSubmit = async ( event ) => {
		event.preventDefault();
		if ( busy.current ) {
			return;
		}
		if ( hasErrors ) {
			return;
		}

		busy.current = true;
		setSaving( true );
		setError( null );

		const data = {
			amount: parseAmount( values.amount ),
			entry_type: values.entry_type,
			entry_date: values.entry_date,
			description: values.description.trim(),
			event_date_id: eventDateId,
			payment_source: isIncome
				? SOURCE_EVENT_CASH
				: values.payment_source,
			payer_name: isPersonal ? values.payer_name.trim() : null,
		};

		try {
			let saved;
			if ( entry ) {
				// PUT replaces the entry, so carry over what this form
				// doesn't edit.
				saved = await apiFetch( {
					path: `/fair-finance/v1/financial-entries/${ entry.id }`,
					method: 'PUT',
					data: {
						...data,
						budget_id: entry.budget_id ?? null,
						event_url: entry.event_url ?? null,
						tag: entry.tag ?? null,
					},
				} );
			} else {
				saved = await apiFetch( {
					path: '/fair-finance/v1/financial-entries',
					method: 'POST',
					data,
				} );
			}
			busy.current = false;
			setSaving( false );
			onSaved( saved );
		} catch ( err ) {
			busy.current = false;
			setSaving( false );
			setError(
				err?.message ||
					__(
						'The operation could not be saved. Please try again.',
						'fair-events'
					)
			);
		}
	};

	let submitLabel = __( 'Save expense', 'fair-events' );
	if ( saving ) {
		submitLabel = __( 'Saving…', 'fair-events' );
	} else if ( isIncome ) {
		submitLabel = __( 'Save income', 'fair-events' );
	}

	return (
		<Modal
			title={ title }
			onRequestClose={ handleCancel }
			isDismissible={ ! saving }
			shouldCloseOnEsc={ ! saving }
			shouldCloseOnClickOutside={ ! saving }
			style={ { maxWidth: '560px', width: '100%' } }
		>
			<form onSubmit={ handleSubmit } noValidate>
				<VStack spacing={ 4 }>
					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }

					{ isIncome && (
						<p style={ { margin: 0 } }>
							{ __(
								'Record cash received at the event, such as the total of a day’s gate sales. No tickets or participants are created.',
								'fair-events'
							) }
						</p>
					) }

					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Amount (EUR)', 'fair-events' ) }
						value={ values.amount }
						onChange={ set( 'amount' ) }
						inputMode="decimal"
						help={ shownErrors.amount }
						aria-invalid={ !! shownErrors.amount }
					/>

					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Date', 'fair-events' ) }
						type="date"
						value={ values.entry_date }
						onChange={ set( 'entry_date' ) }
						help={
							shownErrors.entry_date ||
							( ! defaultDate && ! entry
								? __(
										'This event has no date yet, so choose the operation’s date.',
										'fair-events'
									)
								: undefined )
						}
						aria-invalid={ !! shownErrors.entry_date }
					/>

					{ ! isIncome && (
						<RadioControl
							label={ __( 'Paid from', 'fair-events' ) }
							selected={ values.payment_source }
							options={ [
								{
									label: __( 'Event cash', 'fair-events' ),
									value: SOURCE_EVENT_CASH,
								},
								{
									label: __(
										'Personal funds',
										'fair-events'
									),
									value: SOURCE_PERSONAL_FUNDS,
								},
							] }
							onChange={ set( 'payment_source' ) }
							help={ __(
								'Personal funds covers an organizer’s own cash or card. It counts as an event expense but not as cash leaving the event.',
								'fair-events'
							) }
						/>
					) }

					{ isPersonal && (
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ __( 'Paid by', 'fair-events' ) }
							value={ values.payer_name }
							onChange={ set( 'payer_name' ) }
							help={
								shownErrors.payer_name ||
								__(
									'Name of the person who paid.',
									'fair-events'
								)
							}
							aria-invalid={ !! shownErrors.payer_name }
						/>
					) }

					<TextareaControl
						__nextHasNoMarginBottom
						label={
							isIncome
								? __( 'Note (optional)', 'fair-events' )
								: __( 'Note', 'fair-events' )
						}
						value={ values.description }
						onChange={ set( 'description' ) }
						help={
							shownErrors.description ||
							( isIncome
								? __(
										'For example, “Gate sales Friday”.',
										'fair-events'
									)
								: __(
										'What the expense was for.',
										'fair-events'
									) )
						}
						aria-invalid={ !! shownErrors.description }
					/>

					<HStack justify="flex-end" spacing={ 3 } wrap>
						<Button
							variant="tertiary"
							onClick={ handleCancel }
							disabled={ saving }
						>
							{ __( 'Cancel', 'fair-events' ) }
						</Button>
						<Button
							variant="primary"
							type="submit"
							isBusy={ saving }
							disabled={ saving || hasErrors }
							accessibleWhenDisabled
							aria-describedby={
								hasErrors && ! saving
									? 'fair-events-cash-operation-blocked'
									: undefined
							}
						>
							{ submitLabel }
						</Button>
					</HStack>
					{ hasErrors && ! saving && (
						<p
							id="fair-events-cash-operation-blocked"
							style={ {
								margin: 0,
								textAlign: 'right',
								color: '#757575',
							} }
						>
							{ blockingReason }
						</p>
					) }
				</VStack>
			</form>
		</Modal>
	);
}
