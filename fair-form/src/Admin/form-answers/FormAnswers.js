import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardBody,
	Modal,
	Button,
	Notice,
	SelectControl,
	Spinner,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import SubmissionContext from '../components/SubmissionContext.js';
import DeleteSubmissionDialog from '../components/DeleteSubmissionDialog.js';
import { sourceFormLabel } from '../utils/source-form.js';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'created_at',
		direction: 'desc',
	},
	search: '',
	filters: [],
	fields: [ 'participant_name', 'source_form', 'created_at', 'event_name' ],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function FormAnswers() {
	const [ submissions, setSubmissions ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const [ editingItem, setEditingItem ] = useState( null );
	const [ eventDates, setEventDates ] = useState( [] );
	// 'idle' | 'loading' | 'loaded' | 'error'
	const [ eventDatesStatus, setEventDatesStatus ] = useState( 'idle' );
	const [ selectedEventDateId, setSelectedEventDateId ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	const [ deleteItem, setDeleteItem ] = useState( null );
	// Guards against a second Save landing before the re-render disables it.
	const savingRef = useRef( false );

	useEffect( () => {
		setIsLoading( true );
		apiFetch( {
			path: '/fair-form/v1/questionnaire-responses/all',
		} )
			.then( ( data ) => {
				setSubmissions( data );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading form answers:', err );
				setIsLoading( false );
			} );
	}, [] );

	// Event options are loaded once, the first time the editor opens (or
	// again after "Retry" resets the status to idle).
	useEffect( () => {
		if ( ! editingItem || eventDatesStatus !== 'idle' ) {
			return;
		}
		setEventDatesStatus( 'loading' );
		apiFetch( {
			path: '/fair-form/v1/questionnaire-responses/grouped?by=event',
		} )
			.then( ( data ) => {
				setEventDates( data );
				setEventDatesStatus( 'loaded' );
			} )
			.catch( () => {
				setEventDatesStatus( 'error' );
			} );
	}, [ editingItem, eventDatesStatus ] );

	const openEdit = ( item ) => {
		setEditingItem( item );
		setSelectedEventDateId(
			item.event_date_id ? String( item.event_date_id ) : ''
		);
		setSaveError( null );
	};

	const closeEdit = () => {
		if ( savingRef.current ) {
			return;
		}
		setEditingItem( null );
		setSaveError( null );
	};

	const handleSave = () => {
		if ( ! editingItem || savingRef.current ) {
			return;
		}

		savingRef.current = true;
		setIsSaving( true );
		setSaveError( null );
		apiFetch( {
			path: `/fair-form/v1/questionnaire-responses/${ editingItem.id }`,
			method: 'PUT',
			data: {
				event_date_id: selectedEventDateId
					? parseInt( selectedEventDateId, 10 )
					: 0,
			},
		} )
			.then( ( updated ) => {
				setSubmissions( ( prev ) =>
					prev.map( ( s ) =>
						s.id === editingItem.id
							? {
									...s,
									event_date_id: updated.event_date_id,
									event_name: updated.event_name || '',
							  }
							: s
					)
				);
				setEditingItem( null );
			} )
			.catch( ( err ) => {
				setSaveError(
					err?.message ||
						__(
							'The submission could not be updated. Try again.',
							'fair-form'
						)
				);
			} )
			.finally( () => {
				savingRef.current = false;
				setIsSaving( false );
			} );
	};

	const fields = useMemo(
		() => [
			{
				id: 'participant_name',
				label: __( 'Name', 'fair-form' ),
				enableSorting: true,
				enableHiding: false,
				render: ( { item } ) => (
					<a
						href={ `admin.php?page=fair-form-submission-detail&submission_id=${ item.id }` }
					>
						{ item.participant_name || '—' }
					</a>
				),
				getValue: ( { item } ) => item.participant_name || '',
			},
			{
				id: 'participant_email',
				label: __( 'Email', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => item.participant_email || '',
			},
			{
				id: 'source_form',
				label: __( 'Form', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => sourceFormLabel( item ),
			},
			{
				id: 'event_name',
				label: __( 'Event', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => item.event_name || '',
			},
			{
				id: 'created_at',
				label: __( 'Date', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => item.created_at || '',
			},
		],
		[]
	);

	const paginationInfo = useMemo(
		() => ( {
			totalItems: submissions.length,
			totalPages: Math.ceil(
				submissions.length / ( view.perPage || 25 )
			),
		} ),
		[ submissions.length, view.perPage ]
	);

	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __( 'Edit', 'fair-form' ),
				icon: 'edit',
				callback: ( [ item ] ) => openEdit( item ),
				supportsBulk: false,
			},
			{
				id: 'view',
				label: __( 'View', 'fair-form' ),
				icon: 'visibility',
				callback: ( [ item ] ) => {
					window.location.href = `admin.php?page=fair-form-submission-detail&submission_id=${ item.id }`;
				},
				supportsBulk: false,
			},
			{
				id: 'delete',
				label: __( 'Delete', 'fair-form' ),
				icon: 'trash',
				callback: ( [ item ] ) => setDeleteItem( item ),
				supportsBulk: false,
			},
		],
		[]
	);

	const eventDateOptions = useMemo( () => {
		const options = eventDates
			.filter( ( ed ) => ed.event_date_id )
			.map( ( ed ) => ( {
				label: `${ ed.label } (${ ed.count })`,
				value: String( ed.event_date_id ),
			} ) );

		// Keep the current assignment selectable even when the event list
		// hasn't loaded (or failed to), so it is never silently replaced.
		const currentId = editingItem?.event_date_id
			? String( editingItem.event_date_id )
			: '';
		if ( currentId && ! options.some( ( o ) => o.value === currentId ) ) {
			options.unshift( {
				label:
					editingItem.event_name ||
					sprintf(
						/* translators: %d: event date ID */
						__( 'Event date #%d', 'fair-form' ),
						editingItem.event_date_id
					),
				value: currentId,
			} );
		}

		return [
			{ label: __( '— None —', 'fair-form' ), value: '' },
			...options,
		];
	}, [ eventDates, editingItem ] );

	return (
		<div className="wrap fair-form-form-answers-page">
			<h1>{ __( 'Form Answers', 'fair-form' ) }</h1>

			<Card>
				<CardBody className="fair-form-form-answers__table">
					<DataViews
						data={ submissions }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ DEFAULT_LAYOUTS }
						isLoading={ isLoading }
						getItemId={ ( item ) => item.id }
					/>
				</CardBody>
			</Card>

			{ deleteItem && (
				<DeleteSubmissionDialog
					key={ deleteItem.id }
					submission={ deleteItem }
					onCancel={ () => setDeleteItem( null ) }
					onDeleted={ ( id ) => {
						setSubmissions( ( prev ) =>
							prev.filter( ( s ) => s.id !== id )
						);
						setDeleteItem( null );
					} }
				/>
			) }

			{ editingItem && (
				<Modal
					title={ __( 'Edit Submission', 'fair-form' ) }
					onRequestClose={ closeEdit }
					isDismissible={ ! isSaving }
					shouldCloseOnEsc={ ! isSaving }
					shouldCloseOnClickOutside={ ! isSaving }
					style={ { maxWidth: '480px', width: '100%' } }
				>
					<SubmissionContext submission={ editingItem } />
					<SelectControl
						label={ __( 'Event', 'fair-form' ) }
						value={ selectedEventDateId }
						options={ eventDateOptions }
						onChange={ setSelectedEventDateId }
						disabled={ isSaving }
						help={
							eventDatesStatus === 'loading'
								? __( 'Loading events…', 'fair-form' )
								: undefined
						}
					/>
					{ eventDatesStatus === 'error' && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'The list of events could not be loaded. The current assignment is kept.',
								'fair-form'
							) }{ ' ' }
							<Button
								variant="link"
								onClick={ () => setEventDatesStatus( 'idle' ) }
							>
								{ __( 'Retry', 'fair-form' ) }
							</Button>
						</Notice>
					) }
					{ saveError && (
						<Notice status="error" isDismissible={ false }>
							{ saveError }
						</Notice>
					) }
					<div
						style={ {
							marginTop: '16px',
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
						} }
					>
						<Button
							variant="tertiary"
							onClick={ closeEdit }
							disabled={ isSaving }
						>
							{ __( 'Cancel', 'fair-form' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleSave }
							isBusy={ isSaving }
							disabled={ isSaving }
						>
							{ isSaving ? (
								<Spinner />
							) : (
								__( 'Save', 'fair-form' )
							) }
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
