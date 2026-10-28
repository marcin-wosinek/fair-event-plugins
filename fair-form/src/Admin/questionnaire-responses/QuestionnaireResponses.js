import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CheckboxControl,
	Modal,
	RadioControl,
	Notice,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { formatDate } from '../utils/format-date.js';
import {
	formatSiteLocalDatetime,
	formatDateOnly,
} from 'fair-events-shared/src/dateTime.js';
import { buildBulkExportText } from '../utils/export-format.js';
import DeleteSubmissionDialog from '../components/DeleteSubmissionDialog.js';
import AddToGroupModal, {
	collectParticipants,
	describeOutcome,
} from './AddToGroupModal.js';

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
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function QuestionnaireResponses() {
	const [ responses, setResponses ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ view, setView ] = useState( DEFAULT_VIEW );

	// WhatsApp message modal state.
	const [ isWaModalOpen, setIsWaModalOpen ] = useState( false );
	const [ waColumnMode, setWaColumnMode ] = useState( 'all' );
	const [ waSelectedColumns, setWaSelectedColumns ] = useState( [] );
	const [ waFormat, setWaFormat ] = useState( 'markdown' );
	const [ waFeedback, setWaFeedback ] = useState( null );

	// Delete confirmation state.
	const [ deleteItem, setDeleteItem ] = useState( null );

	// Add-to-group popup: the participants snapshotted when it opened (null =
	// closed), and the outcome reported next to its button once it closes.
	const [ groupDialog, setGroupDialog ] = useState( null );
	const [ groupResult, setGroupResult ] = useState( null );

	const params = new URLSearchParams( window.location.search );
	const eventDateId = params.get( 'event_date_id' );
	const postId = params.get( 'post_id' );
	const formId = params.get( 'form_id' );
	const title = params.get( 'title' );

	useEffect( () => {
		const parts = [];
		if ( eventDateId ) {
			parts.push( `event_date_id=${ eventDateId }` );
		}
		if ( postId ) {
			parts.push( `post_id=${ postId }` );
		}
		if ( formId ) {
			parts.push( `form_id=${ encodeURIComponent( formId ) }` );
		}
		if ( title ) {
			parts.push( `title=${ encodeURIComponent( title ) }` );
		}

		const apiPath = `/fair-form/v1/questionnaire-responses${
			parts.length ? '?' + parts.join( '&' ) : ''
		}`;

		setIsLoading( true );
		apiFetch( {
			path: apiPath,
		} )
			.then( ( data ) => {
				setResponses( data );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading questionnaire responses:', err );
				setIsLoading( false );
			} );
	}, [ eventDateId, postId, formId ] );

	// Derive dynamic question columns from all responses.
	const questionColumns = useMemo( () => {
		const seen = new Map();
		responses.forEach( ( response ) => {
			( response.answers || [] ).forEach( ( answer ) => {
				if ( ! seen.has( answer.question_key ) ) {
					seen.set( answer.question_key, {
						text: answer.question_text,
						type: answer.question_type,
					} );
				}
			} );
		} );
		return Array.from( seen.entries() ).map(
			( [ key, { text, type } ] ) => ( {
				key,
				text,
				type,
			} )
		);
	}, [ responses ] );

	// Whether any loaded response carries a participant link — drives the
	// participant columns, the group button and the export picker so they
	// can never disagree with each other.
	const hasParticipantData = useMemo(
		() =>
			responses.some(
				( response ) => parseInt( response.participant_id, 10 ) > 0
			),
		[ responses ]
	);

	// Build fields for DataViews.
	const fields = useMemo( () => {
		const participantFields = [
			{
				id: 'participant_name',
				label: __( 'Name', 'fair-form' ),
				enableSorting: true,
				enableHiding: false,
				getValue: ( { item } ) => item.participant_name || '',
				render: ( { item } ) =>
					item.participant_id ? (
						// TODO(phase-3): retarget to fair-form participant detail once it exists.
						<a
							href={ `admin.php?page=fair-audience-participant-detail&participant_id=${ item.participant_id }` }
						>
							{ item.participant_name || '' }
						</a>
					) : (
						item.participant_name || ''
					),
			},
			{
				id: 'participant_email',
				label: __( 'Email', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => item.participant_email || '',
			},
			{
				id: 'participant_status',
				label: __( 'Status', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => item.participant_status || '',
				render: ( { item } ) => {
					const labels = {
						pending: __( 'Pending', 'fair-form' ),
						confirmed: __( 'Confirmed', 'fair-form' ),
					};
					return (
						labels[ item.participant_status ] ||
						item.participant_status ||
						'—'
					);
				},
				elements: [
					{ value: 'pending', label: __( 'Pending', 'fair-form' ) },
					{
						value: 'confirmed',
						label: __( 'Confirmed', 'fair-form' ),
					},
				],
				filterBy: { operators: [ 'is' ] },
			},
			{
				id: 'participant_mailing',
				label: __( 'Mailing', 'fair-form' ),
				enableSorting: true,
				getValue: ( { item } ) => item.participant_mailing || '',
				render: ( { item } ) => {
					const labels = {
						minimal: __( 'Minimal', 'fair-form' ),
						marketing: __( 'Marketing', 'fair-form' ),
					};
					return (
						labels[ item.participant_mailing ] ||
						item.participant_mailing ||
						'—'
					);
				},
				elements: [
					{ value: 'minimal', label: __( 'Minimal', 'fair-form' ) },
					{
						value: 'marketing',
						label: __( 'Marketing', 'fair-form' ),
					},
				],
				filterBy: { operators: [ 'is' ] },
			},
			{
				id: 'participant_categories',
				label: __( 'Subscribed Categories', 'fair-form' ),
				enableSorting: false,
				getValue: ( { item } ) =>
					( item.participant_categories || [] )
						.map( ( c ) => c.name )
						.join( ', ' ),
				render: ( { item } ) => {
					const cats = item.participant_categories || [];
					if ( cats.length === 0 ) {
						return '—';
					}
					return cats.map( ( c ) => c.name ).join( ', ' );
				},
			},
		];

		const createdAtField = {
			id: 'created_at',
			label: __( 'Date', 'fair-form' ),
			enableSorting: true,
			// Hideable only when it isn't the primary column.
			enableHiding: hasParticipantData,
			getValue: ( { item } ) => item.created_at || '',
			render: ( { item } ) => (
				<a
					href={ `admin.php?page=fair-form-submission-detail&submission_id=${ item.id }` }
				>
					{ formatDate( item.created_at ) || '—' }
				</a>
			),
		};

		const dynamicFields = questionColumns.map( ( col ) => ( {
			id: `question_${ col.key }`,
			label: col.text,
			enableSorting: false,
			getAnswer: ( { item } ) =>
				( item.answers || [] ).find(
					( a ) => a.question_key === col.key
				),
			getValue: ( { item } ) => {
				const answer = ( item.answers || [] ).find(
					( a ) => a.question_key === col.key
				);
				if ( col.type === 'file_upload' ) {
					return answer?.file_url || answer?.answer_value || '';
				}
				return answer ? answer.answer_value : '';
			},
			...( col.type === 'file_upload' && {
				render: ( { item } ) => {
					const answer = ( item.answers || [] ).find(
						( a ) => a.question_key === col.key
					);
					if ( ! answer?.file_url ) {
						return answer?.answer_value || '';
					}
					const label = answer.is_image
						? __( 'Photo', 'fair-form' )
						: __( 'File', 'fair-form' );
					return (
						<a
							href={ answer.file_url }
							target="_blank"
							rel="noopener noreferrer"
						>
							{ label }
						</a>
					);
				},
			} ),
			...( col.type === 'url' && {
				render: ( { item } ) => {
					const answer = ( item.answers || [] ).find(
						( a ) => a.question_key === col.key
					);
					const value = answer ? answer.answer_value : '';
					if ( ! value || ! /^https?:\/\//.test( value ) ) {
						return value || '';
					}
					return (
						<span>
							<a
								href={ value }
								target="_blank"
								rel="noopener noreferrer"
							>
								{ value }
							</a>
						</span>
					);
				},
			} ),
			...( col.type === 'date' && {
				render: ( { item } ) => {
					const answer = ( item.answers || [] ).find(
						( a ) => a.question_key === col.key
					);
					return formatDateOnly( answer?.answer_value ) || '';
				},
			} ),
			...( col.type === 'datetime' && {
				render: ( { item } ) => {
					const answer = ( item.answers || [] ).find(
						( a ) => a.question_key === col.key
					);
					return answer?.answer_value
						? formatSiteLocalDatetime( answer.answer_value )
						: '';
				},
			} ),
		} ) );

		return [
			...( hasParticipantData ? participantFields : [] ),
			createdAtField,
			...dynamicFields,
		];
	}, [ questionColumns, hasParticipantData ] );

	// Reconcile the persisted view.fields against the current data-derived
	// field set: keep the user's order/selection for fields that still exist,
	// and append any newly-available fields (e.g. once responses load, or
	// once participant columns appear) instead of losing them.
	const viewWithFields = useMemo( () => {
		const ids = fields.map( ( f ) => f.id );
		const selected = ( view.fields || [] ).filter( ( id ) =>
			ids.includes( id )
		);
		const missing = ids.filter(
			( id ) => ! ( view.fields || [] ).includes( id )
		);
		return {
			...view,
			fields: view.fields ? [ ...selected, ...missing ] : ids,
		};
	}, [ view, fields ] );

	const paginationInfo = useMemo(
		() => ( {
			totalItems: responses.length,
			totalPages: Math.ceil( responses.length / ( view.perPage || 25 ) ),
		} ),
		[ responses.length, view.perPage ]
	);

	const actions = useMemo(
		() => [
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

	const openGroupModal = () => {
		setGroupResult( null );
		setGroupDialog( collectParticipants( responses ) );
	};

	const closeGroupModal = ( { groupName, added, skipped, failed } ) => {
		setGroupDialog( null );
		if ( added + skipped + failed > 0 ) {
			setGroupResult( { groupName, added, skipped, failed } );
		}
	};

	const openWaModal = () => {
		setWaColumnMode( 'all' );
		setWaSelectedColumns( fields.map( ( f ) => f.id ) );
		setWaFormat( 'markdown' );
		setWaFeedback( null );
		setIsWaModalOpen( true );
	};

	const toggleWaColumn = ( id ) => {
		setWaSelectedColumns( ( prev ) =>
			prev.includes( id )
				? prev.filter( ( c ) => c !== id )
				: [ ...prev, id ]
		);
	};

	const activeWaColumns = useMemo( () => {
		if ( waColumnMode === 'all' ) {
			return fields;
		}
		return fields.filter( ( f ) => waSelectedColumns.includes( f.id ) );
	}, [ waColumnMode, waSelectedColumns, fields ] );

	const buildWaMessage = () =>
		buildBulkExportText( {
			responses,
			columns: activeWaColumns,
			format: waFormat,
		} );

	const copyWaMessage = () => {
		if ( ! navigator.clipboard ) {
			setWaFeedback( {
				status: 'error',
				message: __( 'Clipboard not available.', 'fair-form' ),
			} );
			return;
		}
		navigator.clipboard
			.writeText( buildWaMessage() )
			.then( () => {
				setWaFeedback( {
					status: 'success',
					message: __( 'Message copied to clipboard.', 'fair-form' ),
				} );
			} )
			.catch( () => {
				setWaFeedback( {
					status: 'error',
					message: __( 'Failed to copy.', 'fair-form' ),
				} );
			} );
	};

	const downloadWaCsv = () => {
		const csvContent = buildWaMessage();

		// BOM for UTF-8 Excel compatibility.
		const bom = '﻿';
		const blob = new Blob( [ bom + csvContent ], {
			type: 'text/csv;charset=utf-8;',
		} );
		const url = URL.createObjectURL( blob );
		const link = document.createElement( 'a' );
		link.href = url;
		const contextId = eventDateId || postId || formId || 'all';
		link.download = `questionnaire-responses-${ contextId }.csv`;
		link.click();
		URL.revokeObjectURL( url );
	};

	return (
		<div className="wrap fair-form-questionnaire-responses-page">
			<h1>{ __( 'Questionnaire Responses', 'fair-form' ) }</h1>

			<p>
				<a href="admin.php?page=fair-form">
					&larr; { __( 'Back to Answers Overview', 'fair-form' ) }
				</a>
				{ eventDateId && (
					<>
						{ ' | ' }
						<a
							href={ `admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }` }
						>
							{ __( 'Event edit page', 'fair-form' ) }
						</a>
					</>
				) }
				{ postId && (
					<>
						{ ' | ' }
						<a href={ `post.php?post=${ postId }&action=edit` }>
							{ __( 'Post entry', 'fair-form' ) }
						</a>
					</>
				) }
			</p>

			<div className="fair-form-questionnaire-responses__actions">
				{ hasParticipantData && (
					<Button variant="primary" onClick={ openGroupModal }>
						{ __( 'Add participants to group', 'fair-form' ) }
					</Button>
				) }
				<Button
					variant="secondary"
					onClick={ openWaModal }
					disabled={ responses.length === 0 }
				>
					{ __( 'Export', 'fair-form' ) }
				</Button>
			</div>

			{ groupResult && (
				<Notice
					status={ groupResult.failed > 0 ? 'warning' : 'success' }
					onRemove={ () => setGroupResult( null ) }
					className="fair-form-questionnaire-responses__group-result"
				>
					{ groupResult.groupName && (
						<p>
							{ sprintf(
								/* translators: %s: group name */
								__( 'Group: %s', 'fair-form' ),
								groupResult.groupName
							) }
						</p>
					) }
					{ describeOutcome(
						groupResult.added,
						groupResult.skipped
					).map( ( sentence ) => (
						<p key={ sentence }>{ sentence }</p>
					) ) }
					{ groupResult.failed > 0 && (
						<p>
							{ sprintf(
								/* translators: %d: number of participants */
								_n(
									'%d participant could not be added.',
									'%d participants could not be added.',
									groupResult.failed,
									'fair-form'
								),
								groupResult.failed
							) }
						</p>
					) }
				</Notice>
			) }

			{ deleteItem && (
				<DeleteSubmissionDialog
					key={ deleteItem.id }
					submission={ deleteItem }
					onCancel={ () => setDeleteItem( null ) }
					onDeleted={ ( id ) => {
						setResponses( ( prev ) =>
							prev.filter( ( r ) => r.id !== id )
						);
						setDeleteItem( null );
					} }
				/>
			) }

			{ groupDialog && (
				<AddToGroupModal
					participants={ groupDialog.participants }
					unlinkedCount={ groupDialog.unlinkedCount }
					duplicateCount={ groupDialog.duplicateCount }
					onClose={ closeGroupModal }
				/>
			) }

			{ isWaModalOpen && (
				<Modal
					title={ __( 'Export', 'fair-form' ) }
					onRequestClose={ () => setIsWaModalOpen( false ) }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<RadioControl
						label={ __( 'Columns', 'fair-form' ) }
						selected={ waColumnMode }
						options={ [
							{
								label: __( 'All columns', 'fair-form' ),
								value: 'all',
							},
							{
								label: __( 'Handpicked columns', 'fair-form' ),
								value: 'pick',
							},
						] }
						onChange={ setWaColumnMode }
					/>

					{ waColumnMode === 'pick' && (
						<div style={ { marginBottom: '16px' } }>
							{ fields.map( ( field ) => (
								<CheckboxControl
									key={ field.id }
									label={ field.label }
									checked={ waSelectedColumns.includes(
										field.id
									) }
									onChange={ () =>
										toggleWaColumn( field.id )
									}
								/>
							) ) }
						</div>
					) }

					<RadioControl
						label={ __( 'Format', 'fair-form' ) }
						selected={ waFormat }
						options={ [
							{
								label: __( 'Markdown', 'fair-form' ),
								value: 'markdown',
							},
							{ label: __( 'CSV', 'fair-form' ), value: 'csv' },
							{
								label: __( 'One line per person', 'fair-form' ),
								value: 'oneline',
							},
						] }
						onChange={ setWaFormat }
					/>

					{ waFeedback && (
						<Notice
							status={ waFeedback.status }
							isDismissible={ false }
						>
							{ waFeedback.message }
						</Notice>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ () => setIsWaModalOpen( false ) }
						>
							{ __( 'Close', 'fair-form' ) }
						</Button>
						{ waFormat === 'csv' && (
							<Button
								variant="secondary"
								onClick={ downloadWaCsv }
								disabled={ activeWaColumns.length === 0 }
							>
								{ __( 'Download CSV', 'fair-form' ) }
							</Button>
						) }
						<Button
							variant="primary"
							onClick={ copyWaMessage }
							disabled={ activeWaColumns.length === 0 }
						>
							{ __( 'Copy to clipboard', 'fair-form' ) }
						</Button>
					</div>
				</Modal>
			) }

			<Card>
				<CardBody className="fair-form-questionnaire-responses__table">
					<DataViews
						data={ responses }
						fields={ fields }
						view={ viewWithFields }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ DEFAULT_LAYOUTS }
						isLoading={ isLoading }
						getItemId={ ( item ) => item.id }
					/>
				</CardBody>
			</Card>
		</div>
	);
}
