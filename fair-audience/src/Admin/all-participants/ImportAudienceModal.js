/**
 * Import an audience CSV exported by another Fair Audience site (#2218).
 *
 * Before importing, the popup says what moves and what does not. After the
 * import it lists, by line number, every row that was skipped or rejected
 * and why. Existing members are never changed by an import.
 *
 * @package FairAudience
 */

import { useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const MODAL_STYLE = {
	maxWidth: '640px',
	width: '100%',
	overflowWrap: 'anywhere',
};

const FILE_INPUT_ID = 'fair-audience-import-file';

/**
 * Label of a transferable field, for conflict and error reports.
 *
 * @param {string} field Column name.
 * @return {string} Label.
 */
export const fieldLabel = ( field ) => {
	switch ( field ) {
		case 'name':
			return __( 'First name', 'fair-audience' );
		case 'surname':
			return __( 'Surname', 'fair-audience' );
		case 'email':
			return __( 'Email', 'fair-audience' );
		case 'phone':
			return __( 'Phone', 'fair-audience' );
		case 'instagram':
			return __( 'Instagram', 'fair-audience' );
		case 'email_profile':
			return __( 'Mailing', 'fair-audience' );
		case 'weekly_summary_opt_out':
			return __( 'Weekly summary opt-out', 'fair-audience' );
		default:
			return field;
	}
};

/**
 * Name and email of a reported row, with its line number.
 *
 * @param {Object} row Reported row: line, name, email.
 * @return {string} Label.
 */
const rowLabel = ( row ) => {
	const who = [ row.name, row.email ].filter( Boolean ).join( ' — ' );
	return sprintf(
		/* translators: 1: line number in the CSV file, 2: name and email of the person */
		__( 'Line %1$d: %2$s', 'fair-audience' ),
		row.line,
		who || __( '(no name)', 'fair-audience' )
	);
};

/**
 * One list of reported rows.
 *
 * @param {Object}   props
 * @param {string}   props.title    Section heading.
 * @param {string}   props.help     What the rows have in common.
 * @param {Array}    props.rows     Reported rows.
 * @param {Function} props.describe Optional detail per row.
 * @return {Element|null} Section.
 */
function RowSection( { title, help, rows, describe } ) {
	if ( ! rows.length ) {
		return null;
	}
	return (
		<section className="fair-audience-import__section">
			<h3>{ title }</h3>
			<p>{ help }</p>
			<ul className="fair-audience-import__rows">
				{ rows.map( ( row ) => (
					<li key={ row.line }>
						<strong>{ rowLabel( row ) }</strong>
						{ describe && (
							<div className="fair-audience-import__detail">
								{ describe( row ) }
							</div>
						) }
					</li>
				) ) }
			</ul>
		</section>
	);
}

/**
 * What the import did.
 *
 * @param {Object} props
 * @param {Object} props.result Import result from the API.
 * @return {Element} Report.
 */
export function ImportResults( { result } ) {
	const unresolvedOptOuts = result.conflicts.filter(
		( row ) => row.untransferred_opt_out.length > 0
	);
	const notImported =
		result.already_present.length +
		result.missing_email.length +
		result.conflicts.length +
		result.invalid.length +
		result.failed.length;

	return (
		<VStack spacing={ 3 }>
			<Notice
				status={ notImported > 0 ? 'warning' : 'success' }
				isDismissible={ false }
			>
				<p>
					{ sprintf(
						/* translators: %d: number of rows in the file */
						_n(
							'The file had %d row.',
							'The file had %d rows.',
							result.total,
							'fair-audience'
						),
						result.total
					) }{ ' ' }
					{ sprintf(
						/* translators: %d: number of members added */
						_n(
							'Added %d new member.',
							'Added %d new members.',
							result.imported.length,
							'fair-audience'
						),
						result.imported.length
					) }
				</p>
				<ul className="fair-audience-import__counts">
					<li>
						{ sprintf(
							/* translators: %d: number of rows */
							__(
								'Already present, skipped: %d',
								'fair-audience'
							),
							result.already_present.length
						) }
					</li>
					<li>
						{ sprintf(
							/* translators: %d: number of rows */
							__(
								'Conflicts with existing members, skipped: %d',
								'fair-audience'
							),
							result.conflicts.length
						) }
					</li>
					<li>
						{ sprintf(
							/* translators: %d: number of rows */
							__( 'Without email, skipped: %d', 'fair-audience' ),
							result.missing_email.length
						) }
					</li>
					<li>
						{ sprintf(
							/* translators: %d: number of rows */
							__(
								'Invalid values, rejected: %d',
								'fair-audience'
							),
							result.invalid.length
						) }
					</li>
					<li>
						{ sprintf(
							/* translators: %d: number of rows */
							__( 'Could not be saved: %d', 'fair-audience' ),
							result.failed.length
						) }
					</li>
				</ul>
			</Notice>

			{ unresolvedOptOuts.length > 0 && (
				<Notice status="error" isDismissible={ false }>
					{ sprintf(
						/* translators: %d: number of members */
						_n(
							'%d member opted out in the file but not on this site. The import did not change them: review them below and update their mailing settings before you send them mail.',
							'%d members opted out in the file but not on this site. The import did not change them: review them below and update their mailing settings before you send them mail.',
							unresolvedOptOuts.length,
							'fair-audience'
						),
						unresolvedOptOuts.length
					) }
				</Notice>
			) }

			<Notice status="info" isDismissible={ false }>
				{ __(
					'Feed subscriptions were not transferred. New members receive no weekly feed emails until they choose feeds on this site, and they stay pending until they confirm their email address here.',
					'fair-audience'
				) }
			</Notice>

			<RowSection
				title={ __( 'Conflicts', 'fair-audience' ) }
				help={ __(
					'A member with this email already exists here with different details. Nothing was changed; update the member by hand if the file is right.',
					'fair-audience'
				) }
				rows={ result.conflicts }
				describe={ ( row ) => (
					<>
						{ sprintf(
							/* translators: %s: comma-separated list of field names */
							__( 'Different: %s', 'fair-audience' ),
							row.fields.map( fieldLabel ).join( ', ' )
						) }
						{ row.untransferred_opt_out.length > 0 && (
							<p className="fair-audience-import__opt-out">
								{ sprintf(
									/* translators: %s: comma-separated list of field names */
									__(
										'Opt-out not transferred (%s): this member still receives that mail here.',
										'fair-audience'
									),
									row.untransferred_opt_out
										.map( fieldLabel )
										.join( ', ' )
								) }
							</p>
						) }
					</>
				) }
			/>
			<RowSection
				title={ __( 'Invalid values', 'fair-audience' ) }
				help={ __(
					'Fix these rows in the file and import it again; rows already added will be skipped.',
					'fair-audience'
				) }
				rows={ result.invalid }
				describe={ ( row ) => (
					<ul>
						{ row.errors.map( ( error ) => (
							<li key={ error.field }>{ error.message }</li>
						) ) }
					</ul>
				) }
			/>
			<RowSection
				title={ __( 'Without email', 'fair-audience' ) }
				help={ __(
					'Members are matched by email, so these rows were not imported.',
					'fair-audience'
				) }
				rows={ result.missing_email }
			/>
			<RowSection
				title={ __( 'Could not be saved', 'fair-audience' ) }
				help={ __(
					'Import the file again to retry these rows.',
					'fair-audience'
				) }
				rows={ result.failed }
			/>
		</VStack>
	);
}

/**
 * @param {Object}   props
 * @param {Function} props.onClose    Close the popup.
 * @param {Function} props.onImported Called after an import that added members.
 * @return {Element} Popup.
 */
export default function ImportAudienceModal( { onClose, onImported } ) {
	const [ file, setFile ] = useState( null );
	const [ isImporting, setIsImporting ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ result, setResult ] = useState( null );
	// Refuses a second submission before the first one re-rendered the popup.
	const inFlight = useRef( false );
	// The report replaces the form, and the button that had focus with it:
	// focus moves to the report so the popup keeps it (Escape, Tab).
	const reportRef = useRef( null );

	useEffect( () => {
		if ( result ) {
			reportRef.current?.focus();
		}
	}, [ result ] );

	const close = () => {
		if ( ! inFlight.current ) {
			onClose();
		}
	};

	const submit = async () => {
		if ( inFlight.current || ! file ) {
			return;
		}
		inFlight.current = true;
		setIsImporting( true );
		setError( null );

		try {
			const body = new window.FormData();
			body.append( 'file', file );
			const response = await apiFetch( {
				path: '/fair-audience/v1/participants/import',
				method: 'POST',
				body,
			} );
			setResult( response );
			if ( response.imported.length > 0 ) {
				onImported();
			}
		} catch ( err ) {
			setError(
				err?.message ||
					__(
						'The file could not be imported. Nothing was changed. Please try again.',
						'fair-audience'
					)
			);
		} finally {
			inFlight.current = false;
			setIsImporting( false );
		}
	};

	return (
		<Modal
			title={ __( 'Import audience CSV', 'fair-audience' ) }
			onRequestClose={ close }
			isDismissible={ ! isImporting }
			shouldCloseOnEsc={ ! isImporting }
			shouldCloseOnClickOutside={ ! isImporting }
			style={ MODAL_STYLE }
		>
			{ result ? (
				<VStack spacing={ 4 }>
					<div
						ref={ reportRef }
						tabIndex={ -1 }
						className="fair-audience-import__report"
					>
						<ImportResults result={ result } />
					</div>
					<HStack justify="flex-end" wrap>
						<Button variant="primary" onClick={ close }>
							{ __( 'Close', 'fair-audience' ) }
						</Button>
					</HStack>
				</VStack>
			) : (
				<VStack spacing={ 4 }>
					<p>
						{ __(
							'Add audience members from a CSV file exported by another Fair Audience site. Contact details, the mailing choice and the weekly summary opt-out are imported.',
							'fair-audience'
						) }
					</p>
					<ul className="fair-audience-import__rules">
						<li>
							{ __(
								'Members are matched by email. Existing members are never changed: rows that differ from them are reported as conflicts for you to resolve.',
								'fair-audience'
							) }
						</li>
						<li>
							{ __(
								'New members are pending until they confirm their email address on this site. No email is sent by the import.',
								'fair-audience'
							) }
						</li>
						<li>
							{ __(
								'Feed subscriptions are not transferred: new members get weekly feed emails only after choosing feeds on this site.',
								'fair-audience'
							) }
						</li>
						<li>
							{ __(
								'Rows without an email address are skipped. Files are limited to 5 MB and 10,000 rows.',
								'fair-audience'
							) }
						</li>
					</ul>

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }

					<div className="fair-audience-import__file">
						<label htmlFor={ FILE_INPUT_ID }>
							{ __( 'CSV file', 'fair-audience' ) }
						</label>
						<input
							id={ FILE_INPUT_ID }
							type="file"
							accept=".csv,text/csv"
							disabled={ isImporting }
							onChange={ ( event ) => {
								setFile( event.target.files[ 0 ] || null );
								setError( null );
							} }
						/>
						{ ! file && (
							<p className="fair-audience-import__hint">
								{ __(
									'Choose a file to import.',
									'fair-audience'
								) }
							</p>
						) }
					</div>

					<HStack justify="flex-end" wrap>
						<Button
							variant="tertiary"
							onClick={ close }
							disabled={ isImporting }
						>
							{ __( 'Cancel', 'fair-audience' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ submit }
							isBusy={ isImporting }
							disabled={ isImporting || ! file }
							accessibleWhenDisabled
						>
							{ isImporting
								? __( 'Importing…', 'fair-audience' )
								: __( 'Import members', 'fair-audience' ) }
						</Button>
					</HStack>
				</VStack>
			) }
		</Modal>
	);
}
