/**
 * Signup export popup.
 *
 * Configurable export for the Signups tab's "Export" button, mirroring the
 * Fair Form Questionnaire Responses export experience: pick all columns or
 * handpick them, choose a format, and optionally include Fair Form answers
 * associated with each signup as individually selectable columns.
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
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { buildSignupExportText, downloadCsvFile } from './signup-export.js';
import { isMailingOptIn } from './EventSignups.js';

/**
 * The nine signup fields the CSV download used to cover, now expressed as
 * export column descriptors.
 */
const BASE_COLUMNS = [
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
		id: 'ticket_type',
		label: __( 'Ticket Type', 'fair-events' ),
		getValue: ( { item } ) => item.ticket_type_name || '—',
	},
	{
		id: 'quantity',
		label: __( 'Quantity', 'fair-events' ),
		getValue: ( { item } ) => item.quantity,
	},
	{
		id: 'amount',
		label: __( 'Amount', 'fair-events' ),
		getValue: ( { item } ) => item.amount,
	},
	{
		id: 'status',
		label: __( 'Status', 'fair-events' ),
		getValue: ( { item } ) => item.status,
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

	const labelCounts = new Map();
	return Array.from( textByKey.entries() ).map( ( [ key, text ] ) => {
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
	} );
}

export default function SignupExportModal( { eventDateId, rows, onClose } ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ answersById, setAnswersById ] = useState( {} );
	const [ includeAnswers, setIncludeAnswers ] = useState( false );
	const [ columnMode, setColumnMode ] = useState( 'all' );
	const [ selectedColumns, setSelectedColumns ] = useState(
		BASE_COLUMNS.map( ( c ) => c.id )
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
				const map = {};
				( data || [] ).forEach( ( signup ) => {
					map[ signup.id ] = signup.answers || [];
				} );
				setAnswersById( map );
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

	const rowsWithAnswers = useMemo(
		() =>
			rows.map( ( item ) => ( {
				...item,
				answers: answersById[ item.id ] || [],
			} ) ),
		[ rows, answersById ]
	);

	const answerColumns = useMemo(
		() => buildAnswerColumns( rowsWithAnswers ),
		[ rowsWithAnswers ]
	);

	const hasAnswers = answerColumns.length > 0;

	const allColumns = includeAnswers
		? [ ...BASE_COLUMNS, ...answerColumns ]
		: BASE_COLUMNS;

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
									'One line per person',
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
