/**
 * Printable List builder.
 *
 * Builds the standalone preview document for the List tab's "Print list"
 * button and opens it in its own window, the way the Audience tab prints its
 * roster. The caller hands over the List's own columns and cell values, so
 * the printout can only show what the List shows.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';

// Relative column widths. A landscape page holds about PAGE_WEIGHT of them
// at a readable size; wider tables are split into consecutive sections.
const COLUMN_WEIGHTS = {
	number: 1.5,
	name: 6,
	ticket: 4,
	ticket_type: 4.5,
	status: 4.5,
	mailing: 3.5,
};
const EXTRA_WEIGHT = 3;
const PAGE_WEIGHT = 48;

// Columns repeated at the start of every further section, so a row can be
// followed across sections.
const IDENTIFIER_KEYS = [ 'number', 'ticket' ];

/**
 * Escape a value for use in HTML text or a double-quoted attribute.
 *
 * @param {*} value Value to print.
 * @return {string} Escaped text
 */
export function escapeHtml( value ) {
	return String( value ?? '' ).replace(
		/[&<>"']/g,
		( c ) =>
			( {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			} )[ c ]
	);
}

/**
 * Relative width of a column.
 *
 * @param {Object} column Column descriptor.
 * @return {number} Weight
 */
function columnWeight( column ) {
	return column.isExtra
		? EXTRA_WEIGHT
		: COLUMN_WEIGHTS[ column.key ] || EXTRA_WEIGHT;
}

/**
 * Split columns into sections that each fit the width of a landscape page.
 * Order is kept and every column lands in exactly one section; sections after
 * the first start with the row number and ticket again.
 *
 * @param {Array}  columns    Column descriptors, in List order.
 * @param {number} pageWeight Total weight one page holds.
 * @return {Array<Array>} Sections of column descriptors
 */
export function splitColumnSections( columns, pageWeight = PAGE_WEIGHT ) {
	const sections = [];
	const placed = [];
	let current = [];
	let weight = 0;
	let ownColumns = 0;
	columns.forEach( ( column ) => {
		const own = columnWeight( column );
		if ( ownColumns > 0 && weight + own > pageWeight ) {
			sections.push( current );
			current = placed.filter( ( earlier ) =>
				IDENTIFIER_KEYS.includes( earlier.key )
			);
			weight = current.reduce(
				( sum, repeated ) => sum + columnWeight( repeated ),
				0
			);
			ownColumns = 0;
		}
		current.push( column );
		placed.push( column );
		weight += own;
		ownColumns++;
	} );
	sections.push( current );
	return sections;
}

/**
 * One table of the printout.
 *
 * @param {Array} columns Column descriptors of this section.
 * @param {Array} rows    Printed rows: `{ cells, isGroupStart }`.
 * @return {string} Table HTML
 */
function sectionTable( columns, rows ) {
	const total = columns.reduce(
		( sum, column ) => sum + columnWeight( column ),
		0
	);
	const cols = columns
		.map(
			( column ) =>
				`<col style="width:${ (
					( columnWeight( column ) / total ) *
					100
				).toFixed( 2 ) }%" />`
		)
		.join( '' );
	const columnClass = ( column ) =>
		column.isExtra ? 'extra' : `col-${ escapeHtml( column.key ) }`;
	const head = columns
		.map(
			( column ) =>
				`<th scope="col" class="${ columnClass(
					column
				) }">${ escapeHtml( column.label ) }</th>`
		)
		.join( '' );
	const body = rows
		.map( ( row ) => {
			const cells = columns
				.map( ( column ) => {
					const cell = row.cells[ column.key ] || {};
					const note = cell.note
						? `<div class="note">${ escapeHtml( cell.note ) }</div>`
						: '';
					return `<td class="${ columnClass(
						column
					) }">${ escapeHtml( cell.text ) }${ note }</td>`;
				} )
				.join( '' );
			return `<tr${
				row.isGroupStart ? ' class="group-start"' : ''
			}>${ cells }</tr>`;
		} )
		.join( '' );
	return `<table><colgroup>${ cols }</colgroup><thead><tr>${ head }</tr></thead><tbody>${ body }</tbody></table>`;
}

/**
 * Build the preview document of the printable List.
 *
 * @param {Object}  args
 * @param {string}  args.title      Event name.
 * @param {string}  args.dateLabel  Event date, already formatted.
 * @param {Array}   args.columns    Column descriptors: `{ key, label, isExtra }`.
 * @param {Array}   args.rows       Rows: `{ cells: { [key]: { text, note } }, isGroupStart }`.
 * @param {Array}   args.legend     Extra-state legend entries: `{ symbol, label }`.
 * @param {string}  args.warning    Notice printed above the table, if any.
 * @param {string}  args.lang       Language of the document.
 * @param {number}  args.pageWeight Total column weight one page holds.
 * @return {string} HTML document
 */
export function buildSignupPrintHtml( {
	title,
	dateLabel,
	columns,
	rows,
	legend = [],
	warning = '',
	lang = 'en',
	pageWeight = PAGE_WEIGHT,
} ) {
	const sections = splitColumnSections( columns, pageWeight );
	const listLabel = __( 'List', 'fair-events' );
	const countLabel = sprintf(
		/* translators: %d: number of tickets on the printed list */
		_n( '%d ticket', '%d tickets', rows.length, 'fair-events' ),
		rows.length
	);
	const meta = [ dateLabel, listLabel, countLabel ]
		.filter( Boolean )
		.map( ( part ) => `<span>${ escapeHtml( part ) }</span>` )
		.join( ' · ' );

	const tables = sections
		.map( ( sectionColumns, index ) => {
			const caption =
				sections.length > 1
					? `<h2>${ escapeHtml(
							sprintf(
								/* translators: 1: number of this part of the printed table, 2: number of parts */
								__(
									'Columns — part %1$d of %2$d',
									'fair-events'
								),
								index + 1,
								sections.length
							)
					  ) }</h2>`
					: '';
			return `<section class="part">${ caption }${ sectionTable(
				sectionColumns,
				rows
			) }</section>`;
		} )
		.join( '' );

	const legendHtml = legend.length
		? `<p class="legend">${ legend
				.map(
					( entry ) =>
						`<span class="legend-entry"><span class="legend-symbol">${
							escapeHtml( entry.symbol ) || '&nbsp;'
						}</span> ${ escapeHtml( entry.label ) }</span>`
				)
				.join( '' ) }</p>`
		: '';

	return `<!DOCTYPE html>
<html lang="${ escapeHtml( lang ) }">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${ escapeHtml( title ) } — ${ escapeHtml( listLabel ) }</title>
	<style>
		@page { size: landscape; margin: 12mm; }
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
			margin: 24px;
			color: #111;
		}
		header { margin-bottom: 12px; }
		header h1 { margin: 0 0 4px; font-size: 18pt; overflow-wrap: anywhere; }
		header .meta { color: #555; font-size: 10pt; }
		h2 { margin: 0 0 6px; font-size: 11pt; }
		.warning { margin: 0 0 12px; padding: 6px 8px; border: 1px solid #555; font-size: 10pt; }
		.legend { margin: 0 0 12px; font-size: 10pt; color: #333; }
		.legend-entry { display: inline-block; margin-right: 16px; }
		.legend-symbol {
			display: inline-block;
			min-width: 1.6em;
			padding: 0 4px;
			border: 1px solid #555;
			text-align: center;
			font-weight: 600;
		}
		.part { margin-bottom: 20px; }
		.part + .part { break-before: page; page-break-before: always; }
		table {
			width: calc(100% - 2px);
			margin: 0 1px;
			border-collapse: collapse;
			table-layout: fixed;
			font-size: 10pt;
		}
		thead { display: table-header-group; }
		th, td {
			border: 1px solid #555;
			padding: 5px 6px;
			vertical-align: top;
			text-align: left;
			overflow-wrap: anywhere;
			word-break: normal;
		}
		th { background: #eee; }
		tr { break-inside: avoid; page-break-inside: avoid; }
		tr.group-start td { border-top-width: 2px; }
		.col-number { text-align: right; color: #555; }
		.col-name { font-weight: 600; }
		.extra, .col-mailing { text-align: center; }
		th.extra { font-size: 8.5pt; hyphens: auto; }
		td.extra, td.col-mailing { font-size: 12pt; font-weight: 600; }
		.note { color: #555; font-size: 8.5pt; font-weight: 400; }
		.toolbar { margin-bottom: 12px; }
		.toolbar button { padding: 6px 12px; font-size: 11pt; cursor: pointer; }
		@media print {
			.toolbar { display: none; }
			body { margin: 0; }
			th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<button type="button" onclick="window.print()">${ escapeHtml(
			__( 'Print', 'fair-events' )
		) }</button>
	</div>
	<header>
		<h1>${ escapeHtml( title ) }</h1>
		<div class="meta">${ meta }</div>
	</header>
	${ warning ? `<p class="warning">${ escapeHtml( warning ) }</p>` : '' }
	${ legendHtml }
	${ tables }
</body>
</html>`;
}

/**
 * Open the print preview in its own window. Must be called synchronously
 * from the click, or browsers block the window.
 *
 * @param {string} html Preview document.
 * @return {boolean} Whether the window opened
 */
export function openPrintWindow( html ) {
	const printWindow = window.open( '', '_blank' );
	if ( ! printWindow ) {
		return false;
	}
	printWindow.document.open();
	printWindow.document.write( html );
	printWindow.document.close();
	return true;
}
