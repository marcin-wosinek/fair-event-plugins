/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	TextControl,
	TextareaControl,
	SelectControl,
	Button,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import EventUrlField from './EventUrlField.js';
import TagField from './TagField.js';

const today = () => new Date().toISOString().split( 'T' )[ 0 ];

const getInitialFormData = ( entry ) => {
	if ( ! entry ) {
		return {
			amount: '',
			entry_type: 'cost',
			entry_date: today(),
			description: '',
			budget_id: '',
			event_url: '',
			event_date_id: null,
			tag: '',
			payment_source: '',
			payer_name: '',
		};
	}

	return {
		amount: entry.amount?.toString() || '',
		entry_type: entry.entry_type || 'cost',
		entry_date: entry.entry_date || today(),
		description: entry.description || '',
		budget_id: entry.budget_id?.toString() || '',
		event_url: entry.event_url || '',
		event_date_id: entry.event_date_id || null,
		tag: entry.tag || '',
		payment_source: entry.payment_source || '',
		payer_name: entry.payer_name || '',
	};
};

const EntryForm = ( {
	entry,
	budgets,
	eventsEnabled,
	tags,
	onSave,
	onCancel,
} ) => {
	// Initialize from the entry before the first render, so the dialog never
	// shows blank defaults that an early change could write back over it.
	const [ formData, setFormData ] = useState( () =>
		getInitialFormData( entry )
	);
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	// Merge into the latest state rather than a render-time snapshot.
	const updateFormData = ( changes ) =>
		setFormData( ( current ) => ( { ...current, ...changes } ) );

	const handleSubmit = async ( e ) => {
		e.preventDefault();
		setIsSaving( true );
		setError( null );

		try {
			const data = {
				...formData,
				amount: parseFloat( formData.amount ),
				budget_id: formData.budget_id
					? parseInt( formData.budget_id, 10 )
					: null,
				event_url: formData.event_url || null,
				event_date_id: formData.event_date_id || null,
				tag: formData.tag || null,
				// '' is "Unspecified": a plain accounting entry.
				payment_source: formData.payment_source || null,
				payer_name:
					'personal_funds' === formData.payment_source
						? formData.payer_name.trim()
						: null,
			};

			if ( entry ) {
				await apiFetch( {
					path: `/fair-finance/v1/financial-entries/${ entry.id }`,
					method: 'PUT',
					data,
				} );
			} else {
				await apiFetch( {
					path: '/fair-finance/v1/financial-entries',
					method: 'POST',
					data,
				} );
			}
			onSave();
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to save entry.', 'fair-finance' )
			);
		} finally {
			setIsSaving( false );
		}
	};

	const budgetOptions = [
		{
			label: __( '-- No Budget --', 'fair-finance' ),
			value: '',
		},
		...budgets.map( ( budget ) => ( {
			label: budget.name,
			value: budget.id.toString(),
		} ) ),
	];

	return (
		<Modal
			title={
				entry
					? __( 'Edit Financial Entry', 'fair-finance' )
					: __( 'Add Financial Entry', 'fair-finance' )
			}
			onRequestClose={ onCancel }
			style={ { maxWidth: '500px', width: '100%' } }
		>
			<form onSubmit={ handleSubmit }>
				<VStack spacing={ 4 }>
					{ error && (
						<div
							className="notice notice-error"
							style={ { margin: 0, padding: '8px' } }
						>
							{ error }
						</div>
					) }

					<SelectControl
						label={ __( 'Type', 'fair-finance' ) }
						value={ formData.entry_type }
						options={ [
							{
								label: __( 'Cost', 'fair-finance' ),
								value: 'cost',
							},
							{
								label: __( 'Income', 'fair-finance' ),
								value: 'income',
							},
						] }
						onChange={ ( value ) =>
							updateFormData( { entry_type: value } )
						}
					/>

					<TextControl
						label={ __( 'Amount', 'fair-finance' ) }
						value={ formData.amount }
						onChange={ ( value ) =>
							updateFormData( { amount: value } )
						}
						type="number"
						step="0.01"
						min="0.01"
						required
						help={ __( 'Enter amount in EUR', 'fair-finance' ) }
					/>

					<TextControl
						label={ __( 'Date', 'fair-finance' ) }
						value={ formData.entry_date }
						onChange={ ( value ) =>
							updateFormData( { entry_date: value } )
						}
						type="date"
						required
					/>

					<TextareaControl
						label={ __( 'Description', 'fair-finance' ) }
						value={ formData.description }
						onChange={ ( value ) =>
							updateFormData( { description: value } )
						}
						help={ __(
							'Optional description for this entry',
							'fair-finance'
						) }
					/>

					<SelectControl
						label={ __( 'Paid from', 'fair-finance' ) }
						value={ formData.payment_source }
						options={ [
							{
								label: __( 'Unspecified', 'fair-finance' ),
								value: '',
							},
							{
								label: __( 'Event cash', 'fair-finance' ),
								value: 'event_cash',
							},
							...( 'income' === formData.entry_type
								? []
								: [
										{
											label: __(
												'Personal funds',
												'fair-finance'
											),
											value: 'personal_funds',
										},
									] ),
						] }
						onChange={ ( value ) =>
							updateFormData( { payment_source: value } )
						}
						help={ __(
							'Event cash and personal funds are recorded from the event’s Finance tab and must stay linked to an event.',
							'fair-finance'
						) }
					/>

					{ 'personal_funds' === formData.payment_source &&
						'cost' === formData.entry_type && (
							<TextControl
								label={ __( 'Paid by', 'fair-finance' ) }
								value={ formData.payer_name }
								onChange={ ( value ) =>
									updateFormData( { payer_name: value } )
								}
								help={ __(
									'Name of the person who paid.',
									'fair-finance'
								) }
							/>
						) }

					<SelectControl
						label={ __( 'Budget Category', 'fair-finance' ) }
						value={ formData.budget_id }
						options={ budgetOptions }
						onChange={ ( value ) =>
							updateFormData( { budget_id: value } )
						}
					/>

					{ eventsEnabled && (
						<EventUrlField
							value={ formData.event_url }
							eventDateId={ formData.event_date_id }
							onChange={ ( url, dateId ) =>
								updateFormData( {
									event_url: url,
									event_date_id: dateId,
								} )
							}
						/>
					) }

					<TagField
						value={ formData.tag }
						tags={ tags }
						onChange={ ( value ) =>
							updateFormData( { tag: value } )
						}
					/>

					<HStack justify="flex-end" spacing={ 2 }>
						<Button
							variant="tertiary"
							onClick={ onCancel }
							disabled={ isSaving }
						>
							{ __( 'Cancel', 'fair-finance' ) }
						</Button>
						<Button
							variant="primary"
							type="submit"
							isBusy={ isSaving }
							disabled={
								isSaving ||
								! formData.amount ||
								! formData.entry_date
							}
						>
							{ entry
								? __( 'Update Entry', 'fair-finance' )
								: __( 'Create Entry', 'fair-finance' ) }
						</Button>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
};

export default EntryForm;
