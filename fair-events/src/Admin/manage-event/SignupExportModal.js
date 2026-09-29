/**
 * Signup export popup.
 *
 * Configurable export for the List tab's "Export" button, mirroring the
 * Fair Form Questionnaire Responses export experience: pick all columns or
 * handpick them, choose a format, and optionally include Fair Form answers
 * as individually selectable columns. Exports one row per listed ticket,
 * each with its own answers.
 *
 * @package FairEvents
 */

import { useState, useEffect, useMemo } from '@wordpress/element';
import {
	Button,
	CheckboxControl,
	Modal,
	Notice,
	RadioControl,
	Spinner,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { buildSignupExportText, downloadCsvFile } from './signup-export.js';
import {
	isMailingOptIn,
	ticketRowLabel,
	ticketRowTypeName,
} from './EventSignups.js';

/**
 * Names of the extras a ticket holds with a confirmed payment, in the
 * configured order.
 *
 * @param {Object|null} ticket        Ticket of the row.
 * @param {Array}       ticketOptions Configured extras.
 * @return {string} Comma-separated names, empty when none.
 */
export function ticketExtrasText( ticket, ticketOptions ) {
	const selected = ( ticket?.confirmed_activity_ids || [] ).map( Number );
	return ticketOptions
		.filter( ( option ) => selected.includes( Number( option.id ) ) )
		.map( ( option ) => option.name )
		.join( ', ' );
}

/**
 * Export columns for ticket rows. Purchase-level values repeat on every
 * ticket of the purchase, except the amount paid, which is given once per
 * registration so that summing the column counts each payment once.
 *
 * @param {Array} ticketOptions Configured extras.
 * @return {Array} Column descriptors.
 */
function buildBaseColumns( ticketOptions ) {
	return [
		{
			id: 'email',
			label: __( 'Email', 'fair-events' ),
			getValue: ( { item } ) => item.email,
		},
		{
			id: 'name',
			label: __( 'Name', 'fair-events' ),
			getValue: ( { item } ) => item.name,
		},
		{
			id: 'ticket',
			label: __( 'Ticket', 'fair-events' ),
			getValue: ( { item } ) => item.ticketLabel,
		},
		{
			id: 'ticket_type',
			label: __( 'Ticket Type', 'fair-events' ),
			getValue: ( { item } ) => ticketRowTypeName( item ),
		},
		{
			id: 'extras',
			label: __( 'Extras', 'fair-events' ),
			getValue: ( { item } ) =>
				ticketExtrasText( item.ticket, ticketOptions ),
		},
		{
			id: 'purchase_total',
			label: __(
				'Purchase total (once per registration)',
				'fair-events'
			),
			getValue: ( { item } ) => ( item.isFirstTicket ? item.amount : '' ),
		},
		{
			id: 'status',
			label: __( 'Status', 'fair-events' ),
			getValue: ( { item } ) =>
				item.ticket ? item.ticket.status : item.status,
		},
		{
			id: 'transaction_id',
			label: __( 'Transaction', 'fair-events' ),
			getValue: ( { item } ) => item.transaction_id,
		},
		{
			id: 'mailing_opt_in',
			label: __( 'Mailing', 'fair-events' ),
			getValue: ( { item } ) =>
				isMailingOptIn( item.mailing_opt_in ) ? 'yes' : 'no',
		},
		{
			id: 'date',
			label: __( 'Date', 'fair-events' ),
			getValue: ( { item } ) => item.created_at,
		},
	];
}

/**
 * Index the include_answers response for ticket rows: answers attached to
 * each ticket, and each registration's answers not attached to any ticket.
 *
 * @param {Array} signups Registrations from the include_answers response.
 * @return {{byTicketId: Object, unlinkedBySignupId: Object}} Answers
 */
export function indexAnswers( signups ) {
	const byTicketId = {};
	const unlinkedBySignupId = {};
	( signups || [] ).forEach( ( signup ) => {
		( signup.tickets || [] ).forEach( ( ticket ) => {
			if ( ( ticket.answers || [] ).length ) {
				byTicketId[ ticket.id ] = {
					answers: ticket.answers,
					needsReview: !! ticket.answers_need_review,
				};
			}
		} );
		const linked =
			signup.answers_ticket_id !== null &&
			signup.answers_ticket_id !== undefined;
		if ( ! linked && ( signup.answers || [] ).length ) {
			unlinkedBySignupId[ signup.id ] = signup.answers;
		}
	} );
	return { byTicketId, unlinkedBySignupId };
}

/**
 * Fair Form answers of one ticket row. Answers kept with no ticket go on the
 * registration's first row only, flagged for review, rather than being
 * copied to sibling tickets.
 *
 * @param {Object} row     Row from expandTicketRows().
 * @param {Object} indexed Result of indexAnswers().
 * @return {{answers: Array, answersFor: string}} Answers and their owner label
 */
export function ticketRowAnswers( row, indexed ) {
	const own = row.ticket ? indexed.byTicketId[ row.ticket.id ] : null;
	if ( own ) {
		const label = ticketRowLabel( row.ticket );
		return {
			answers: own.answers,
			answersFor: own.needsReview
				? sprintf(
						/* translators: %s: ticket label, e.g. "Ticket 1 (AE2671B5)" */
						__( '%s (needs review)', 'fair-events' ),
						label
				  )
				: label,
		};
	}
	const unlinked = indexed.unlinkedBySignupId[ row.signup.id ];
	if ( row.isFirstTicket && unlinked ) {
		return {
			answers: unlinked,
			answersFor: __( 'No ticket (needs review)', 'fair-events' ),
		};
	}
	return { answers: [], answersFor: '' };
}

/**
 * Column naming the ticket each row's answers belong to.
 */
const ANSWERS_OWNER_COLUMN = {
	id: 'answers_for',
	label: __( 'Answers for', 'fair-events' ),
	getValue: ( { item } ) => item.answersFor || '',
};

/**
 * Derive Fair Form answer columns from the loaded rows: one column per
 * distinct `question_key`, in first-seen order (which is `display_order`
 * within a submission). Duplicate question labels get a numeric suffix —
 * `Label`, `Label (2)` — since signup-origin submissions carry no form name
 * to disambiguate with.
 *
 * @param {Array} rowsWithAnswers Rows already carrying an `answers` array.
 * @return {Array} Column descriptors.
 */
function buildAnswerColumns( rowsWithAnswers ) {
	const textByKey = new Map();
	rowsWithAnswers.forEach( ( item ) => {
		( item.answers || [] ).forEach( ( answer ) => {
			if ( ! textByKey.has( answer.question_key ) ) {
				textByKey.set( answer.question_key, answer.question_text );
			}
		} );
	} );

	if ( textByKey.size === 0 ) {
		return [];
	}

	const labelCounts = new Map();
	const questionColumns = Array.from( textByKey.entries() ).map(
		( [ key, text ] ) => {
			const count = ( labelCounts.get( text ) || 0 ) + 1;
			labelCounts.set( text, count );
			return {
				id: `answer_${ key }`,
				label: count > 1 ? `${ text } (${ count })` : text,
				getValue: ( { item } ) => {
					const answer = ( item.answers || [] ).find(
						( a ) => a.question_key === key
					);
					return answer ? answer.answer_value : '';
				},
			};
		}
	);
	return [ ANSWERS_OWNER_COLUMN, ...questionColumns ];
}

export default function SignupExportModal( {
	eventDateId,
	rows,
	ticketOptions = [],
	onClose,
} ) {
	const baseColumns = useMemo(
		() => buildBaseColumns( ticketOptions ),
		[ ticketOptions ]
	);
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ indexedAnswers, setIndexedAnswers ] = useState( {
		byTicketId: {},
		unlinkedBySignupId: {},
	} );
	const [ includeAnswers, setIncludeAnswers ] = useState( false );
	const [ columnMode, setColumnMode ] = useState( 'all' );
	const [ selectedColumns, setSelectedColumns ] = useState(
		baseColumns.map( ( c ) => c.id )
	);
	const [ format, setFormat ] = useState( 'markdown' );
	const [ feedback, setFeedback ] = useState( null );

	useEffect( () => {
		let cancelled = false;
		setLoading( true );
		setLoadError( null );

		apiFetch( {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }&include_answers=true`,
		} )
			.then( ( data ) => {
				if ( cancelled ) {
					return;
				}
				setIndexedAnswers( indexAnswers( data ) );
				setLoading( false );
			} )
			.catch( ( err ) => {
				if ( cancelled ) {
					return;
				}
				setLoadError(
					err.message ||
						__( 'Failed to load Fair Form answers.', 'fair-events' )
				);
				setLoading( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [ eventDateId ] );

	// One export row per ticket, carrying its purchase's fields.
	const rowsWithAnswers = useMemo(
		() =>
			rows.map( ( row ) => ( {
				...row.signup,
				ticket: row.ticket,
				isFirstTicket: row.isFirstTicket,
				signup: row.signup,
				ticketLabel: ticketRowLabel( row.ticket ),
				...ticketRowAnswers( row, indexedAnswers ),
			} ) ),
		[ rows, indexedAnswers ]
	);

	const answerColumns = useMemo(
		() => buildAnswerColumns( rowsWithAnswers ),
		[ rowsWithAnswers ]
	);

	const hasAnswers = answerColumns.length > 0;

	const allColumns = includeAnswers
		? [ ...baseColumns, ...answerColumns ]
		: baseColumns;

	const activeColumns =
		columnMode === 'all'
			? allColumns
			: allColumns.filter( ( c ) => selectedColumns.includes( c.id ) );

	const toggleColumn = ( id ) => {
		setSelectedColumns( ( prev ) =>
			prev.includes( id )
				? prev.filter( ( c ) => c !== id )
				: [ ...prev, id ]
		);
	};

	const handleToggleIncludeAnswers = ( checked ) => {
		setIncludeAnswers( checked );
		setSelectedColumns( ( prev ) => {
			const answerIds = answerColumns.map( ( c ) => c.id );
			if ( checked ) {
				return [
					...prev,
					...answerIds.filter( ( id ) => ! prev.includes( id ) ),
				];
			}
			return prev.filter( ( id ) => ! answerIds.includes( id ) );
		} );
	};

	const buildExportText = () =>
		buildSignupExportText( {
			rows: rowsWithAnswers,
			columns: activeColumns,
			format,
		} );

	const handleDownloadCsv = () => {
		downloadCsvFile(
			buildExportText(),
			`signups-event-${ eventDateId }.csv`
		);
	};

	const handleCopy = () => {
		if ( ! navigator.clipboard ) {
			setFeedback( {
				status: 'error',
				message: __( 'Clipboard not available.', 'fair-events' ),
			} );
			return;
		}
		navigator.clipboard
			.writeText( buildExportText() )
			.then( () => {
				setFeedback( {
					status: 'success',
					message: __( 'Copied to clipboard.', 'fair-events' ),
				} );
			} )
			.catch( () => {
				setFeedback( {
					status: 'error',
					message: __( 'Failed to copy.', 'fair-events' ),
				} );
			} );
	};

	return (
		<Modal
			title={ __( 'Export', 'fair-events' ) }
			onRequestClose={ onClose }
			style={ { maxWidth: '500px', width: '100%' } }
		>
			{ loading && <Spinner /> }

			{ loadError && (
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
			) }

			{ ! loading && (
				<>
					<RadioControl
						label={ __( 'Columns', 'fair-events' ) }
						selected={ columnMode }
						options={ [
							{
								label: __( 'All columns', 'fair-events' ),
								value: 'all',
							},
							{
								label: __(
									'Handpicked columns',
									'fair-events'
								),
								value: 'pick',
							},
						] }
						onChange={ setColumnMode }
					/>

					{ columnMode === 'pick' && (
						<div style={ { marginBottom: '16px' } }>
							{ allColumns.map( ( column ) => (
								<CheckboxControl
									key={ column.id }
									label={ column.label }
									checked={ selectedColumns.includes(
										column.id
									) }
									onChange={ () => toggleColumn( column.id ) }
								/>
							) ) }
						</div>
					) }

					{ hasAnswers && (
						<CheckboxControl
							label={ __(
								'Include Fair Form answers',
								'fair-events'
							) }
							checked={ includeAnswers }
							onChange={ handleToggleIncludeAnswers }
						/>
					) }

					<RadioControl
						label={ __( 'Format', 'fair-events' ) }
						selected={ format }
						options={ [
							{
								label: __( 'Markdown', 'fair-events' ),
								value: 'markdown',
							},
							{
								label: __( 'CSV', 'fair-events' ),
								value: 'csv',
							},
							{
								label: __(
									'One line per ticket',
									'fair-events'
								),
								value: 'oneline',
							},
						] }
						onChange={ setFormat }
					/>

					{ feedback && (
						<Notice
							status={ feedback.status }
							isDismissible={ false }
						>
							{ feedback.message }
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
						<Button variant="secondary" onClick={ onClose }>
							{ __( 'Close', 'fair-events' ) }
						</Button>
						{ format === 'csv' && (
							<Button
								variant="secondary"
								onClick={ handleDownloadCsv }
								disabled={ activeColumns.length === 0 }
							>
								{ __( 'Download CSV', 'fair-events' ) }
							</Button>
						) }
						<Button
							variant="primary"
							onClick={ handleCopy }
							disabled={ activeColumns.length === 0 }
						>
							{ __( 'Copy to clipboard', 'fair-events' ) }
						</Button>
					</div>
				</>
			) }
		</Modal>
	);
}
