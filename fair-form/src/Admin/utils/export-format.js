import { __ } from '@wordpress/i18n';
import { formatDateLong } from './format-date.js';
import { fileAnswerMarkdown } from './submission-markdown.js';

function escapeCsvField( field ) {
	const str = String( field ?? '' );
	if ( str.includes( ',' ) || str.includes( '"' ) || str.includes( '\n' ) ) {
		return '"' + str.replace( /"/g, '""' ) + '"';
	}
	return str;
}

// Build the bulk export text (CSV / one-line / Markdown) for the
// Questionnaire Responses "Export" panel. `columns` are DataViews fields —
// each needs `getValue({ item })`; a column can also carry `getAnswer({
// item })` so the Markdown branch can embed file answers the same way the
// single-response export does, instead of printing a bare attachment ID.
export function buildBulkExportText( { responses, columns, format } ) {
	if ( format === 'csv' ) {
		const headers = columns.map( ( c ) => c.label );
		const rows = responses.map( ( item ) =>
			columns.map( ( c ) => c.getValue( { item } ) )
		);
		return [
			headers.map( escapeCsvField ).join( ',' ),
			...rows.map( ( row ) => row.map( escapeCsvField ).join( ',' ) ),
		].join( '\n' );
	}

	if ( format === 'oneline' ) {
		return responses
			.map( ( item ) =>
				columns
					.map( ( c ) => c.getValue( { item } ) )
					.filter(
						( v ) => v !== '' && v !== null && v !== undefined
					)
					.join( ' ' )
			)
			.join( '\n' );
	}

	// Markdown.
	return responses
		.map( ( item ) => {
			const hasHeading = Boolean( item.participant_id );
			const lines = [];

			if ( hasHeading ) {
				const respondent =
					item.participant_name ||
					item.participant_email ||
					`#${ item.id }`;
				lines.push( `## ${ respondent }`, '' );
			}

			columns
				.filter( ( c ) => ! hasHeading || c.id !== 'participant_name' )
				.forEach( ( c ) => {
					const label =
						c.id === 'created_at'
							? __( 'Submission date', 'fair-form' )
							: c.label;

					const answer = c.getAnswer?.( { item } );
					const fileMarkdown = fileAnswerMarkdown( answer );

					if ( fileMarkdown ) {
						lines.push( `**${ label }:** ${ fileMarkdown }`, '' );
						return;
					}

					const value =
						c.id === 'created_at'
							? formatDateLong( item.created_at )
							: c.getValue( { item } ) || '';
					lines.push( `**${ label }:** ${ value }`, '' );
				} );

			// Drop the trailing blank line before joining responses.
			lines.pop();
			return lines.join( '\n' );
		} )
		.join( '\n\n---\n\n' );
}
