/**
 * Printable gate sheet builder (#2212).
 *
 * Builds the standalone preview document of the List tab's "Print gate
 * sheet" button: a price reference for the event, then blank landscape pages
 * for writing down people who register and pay at the gate. It takes no
 * attendee data, so it can never print existing registrations.
 *
 * @package FairEvents
 */

import { __, sprintf } from '@wordpress/i18n';
import { formatMoney } from 'fair-events-shared/src/ticket-pricing.js';
import { escapeHtml } from './signup-print.js';

export const GATE_SHEET_PAGES = 2;
export const GATE_SHEET_ROWS_PER_PAGE = 10;

/**
 * Columns of the blank registration table, with relative widths that fit a
 * landscape page without clipping.
 *
 * @return {Array<{key: string, label: string, width: number}>} Columns
 */
export function gateSheetColumns() {
	return [
		{ key: 'name', label: __( 'Name', 'fair-events' ), width: 12 },
		{ key: 'surname', label: __( 'Surname', 'fair-events' ), width: 13 },
		{ key: 'email', label: __( 'Email', 'fair-events' ), width: 20 },
		{
			key: 'mailing',
			label: __( 'Mailing opt-in', 'fair-events' ),
			width: 7,
		},
		{
			key: 'ticket_type',
			label: __( 'Ticket type', 'fair-events' ),
			width: 11,
		},
		{
			key: 'extras',
			label: __( 'Extra options', 'fair-events' ),
			width: 13,
		},
		{ key: 'total', label: __( 'Total', 'fair-events' ), width: 8 },
		{ key: 'comments', label: __( 'Comments', 'fair-events' ), width: 16 },
	];
}

/**
 * Printed price text: an explicit zero stays a price, a missing price is
 * named as such and never shown as free.
 *
 * @param {number|null} price    Price, or null when none is configured.
 * @param {string}      currency Currency code.
 * @return {string} Price text
 */
export function gatePriceText( price, currency ) {
	return price === null
		? __( 'Price not configured', 'fair-events' )
		: formatMoney( price, currency );
}

/**
 * One price reference table.
 *
 * @param {string} caption  Table caption.
 * @param {Array}  headings Column headings.
 * @param {Array}  rows     Rows: arrays of `{ text, className }` cells.
 * @return {string} Table HTML
 */
function referenceTable( caption, headings, rows ) {
	const head = headings
		.map( ( label ) => `<th scope="col">${ escapeHtml( label ) }</th>` )
		.join( '' );
	const body = rows
		.map(
			( cells ) =>
				`<tr>${ cells
					.map(
						( cell ) =>
							`<td${
								cell.className
									? ` class="${ cell.className }"`
									: ''
							}>${ escapeHtml( cell.text ) }</td>`
					)
					.join( '' ) }</tr>`
		)
		.join( '' );
	return `<table class="reference"><caption>${ escapeHtml(
		caption
	) }</caption><thead><tr>${ head }</tr></thead><tbody>${ body }</tbody></table>`;
}

/**
 * Build the preview document of the gate sheet.
 *
 * @param {Object}   args
 * @param {string}   args.title       Event name.
 * @param {string}   args.dateLabel   Event date, already formatted.
 * @param {string}   args.currency    Currency code.
 * @param {Object}   args.pricing     Output of resolveGatePricing().
 * @param {string[]} args.warnings    Pricing warnings to print.
 * @param {string}   args.lang        Language of the document.
 * @param {number}   args.pages       Blank registration pages.
 * @param {number}   args.rowsPerPage Blank rows per page.
 * @return {string} HTML document
 */
export function buildGateSheetHtml( {
	title,
	dateLabel,
	currency,
	pricing,
	warnings = [],
	lang = 'en',
	pages = GATE_SHEET_PAGES,
	rowsPerPage = GATE_SHEET_ROWS_PER_PAGE,
} ) {
	const sheetLabel = __( 'Gate sheet', 'fair-events' );
	const meta = [ dateLabel, sheetLabel ]
		.filter( Boolean )
		.map( ( part ) => `<span>${ escapeHtml( part ) }</span>` )
		.join( ' · ' );

	let periodText;
	if ( ! pricing.period ) {
		periodText = __( 'Pricing period: none', 'fair-events' );
	} else if ( pricing.isManualPeriod ) {
		periodText = sprintf(
			/* translators: %s: name of the pricing period the organizer chose */
			__( 'Pricing period: %s (chosen manually)', 'fair-events' ),
			pricing.period.name
		);
	} else {
		periodText = sprintf(
			/* translators: %s: name of the pricing period that applies at the event start */
			__(
				'Pricing period: %s (applies at the event start)',
				'fair-events'
			),
			pricing.period.name
		);
	}
	const currencyText = sprintf(
		/* translators: %s: currency code, e.g. EUR */
		__( 'Currency: %s', 'fair-events' ),
		currency
	);

	const available = __( 'Available', 'fair-events' );
	const unavailable = __( 'Not available at the event', 'fair-events' );
	const ticketTable = pricing.tickets.length
		? referenceTable(
				__( 'Ticket types', 'fair-events' ),
				[
					__( 'Ticket type', 'fair-events' ),
					__( 'Price', 'fair-events' ),
					__( 'Availability', 'fair-events' ),
				],
				pricing.tickets.map( ( ticket ) => [
					{ text: ticket.name },
					{
						text: gatePriceText( ticket.price, currency ),
						className:
							ticket.price === null ? 'missing price' : 'price',
					},
					{
						text: ticket.isAvailable ? available : unavailable,
						className: ticket.isAvailable ? '' : 'missing',
					},
				] )
			)
		: `<p>${ escapeHtml(
				__( 'No ticket types are configured.', 'fair-events' )
			) }</p>`;
	const extrasTable = pricing.extras.length
		? referenceTable(
				__( 'Extra options', 'fair-events' ),
				[
					__( 'Extra option', 'fair-events' ),
					__( 'Price', 'fair-events' ),
				],
				pricing.extras.map( ( extra ) => [
					{ text: extra.name },
					{
						text: gatePriceText( extra.price, currency ),
						className:
							extra.price === null ? 'missing price' : 'price',
					},
				] )
			)
		: '';

	const warningsHtml = warnings
		.map(
			( warning ) => `<p class="warning">${ escapeHtml( warning ) }</p>`
		)
		.join( '' );

	const columns = gateSheetColumns();
	const cols = columns
		.map( ( column ) => `<col style="width:${ column.width }%" />` )
		.join( '' );
	const head = columns
		.map(
			( column ) =>
				`<th scope="col" class="col-${ column.key }">${ escapeHtml(
					column.label
				) }</th>`
		)
		.join( '' );
	const checkboxLabel = __( 'Mailing opt-in', 'fair-events' );
	const blankRow = `<tr>${ columns
		.map( ( column ) =>
			column.key === 'mailing'
				? `<td class="col-mailing"><span class="box" role="img" aria-label="${ escapeHtml(
						checkboxLabel
					) }"></span></td>`
				: `<td class="col-${ column.key }"></td>`
		)
		.join( '' ) }</tr>`;
	const consentNote = __(
		'Tick the mailing opt-in box only when the person explicitly agrees to receive mailings. An empty box means no consent.',
		'fair-events'
	);
	const registrationPages = Array.from( { length: pages }, ( _, index ) => {
		const heading = sprintf(
			/* translators: 1: number of this registration page, 2: number of registration pages */
			__( 'Gate registrations — page %1$d of %2$d', 'fair-events' ),
			index + 1,
			pages
		);
		return `<section class="registrations">
		<h2>${ escapeHtml( heading ) }</h2>
		<p class="note">${ escapeHtml( title ) } · ${ escapeHtml( dateLabel ) }</p>
		<table class="sheet"><colgroup>${ cols }</colgroup><thead><tr>${ head }</tr></thead><tbody>${ blankRow.repeat(
			rowsPerPage
		) }</tbody></table>
		<p class="note">${ escapeHtml( consentNote ) }</p>
	</section>`;
	} ).join( '' );

	return `<!DOCTYPE html>
<html lang="${ escapeHtml( lang ) }">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${ escapeHtml( title ) } — ${ escapeHtml( sheetLabel ) }</title>
	<style>
		@page { size: landscape; margin: 10mm; }
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
			margin: 24px;
			color: #111;
		}
		header { margin-bottom: 12px; }
		header h1 { margin: 0 0 4px; font-size: 18pt; overflow-wrap: anywhere; }
		header .meta, .period { color: #444; font-size: 10pt; }
		.period { margin: 0 0 8px; }
		h2 { margin: 0 0 4px; font-size: 13pt; }
		.warning {
			margin: 0 0 8px;
			padding: 6px 8px;
			border: 2px solid #111;
			font-size: 10pt;
			font-weight: 600;
		}
		.note { margin: 4px 0; color: #444; font-size: 9pt; overflow-wrap: anywhere; }
		table {
			width: calc(100% - 2px);
			margin: 0 1px 12px;
			border-collapse: collapse;
			table-layout: fixed;
			font-size: 10pt;
		}
		caption { text-align: left; font-weight: 700; font-size: 11pt; padding-bottom: 4px; }
		thead { display: table-header-group; }
		th, td {
			border: 1px solid #555;
			padding: 4px 6px;
			vertical-align: top;
			text-align: left;
			overflow-wrap: anywhere;
		}
		th { background: #eee; }
		tr { break-inside: avoid; page-break-inside: avoid; }
		table.reference { max-width: 180mm; }
		td.price { white-space: nowrap; }
		td.missing { font-weight: 700; }
		.registrations { break-before: page; page-break-before: always; }
		table.sheet th { font-size: 9pt; vertical-align: bottom; hyphens: auto; }
		table.sheet td { height: 14mm; }
		.col-mailing { text-align: center; }
		td.col-mailing { vertical-align: middle; }
		.box {
			display: inline-block;
			width: 6mm;
			height: 6mm;
			border: 1.5px solid #111;
			background: #fff;
		}
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
	<section class="prices">
		<h2>${ escapeHtml( __( 'Prices at the gate', 'fair-events' ) ) }</h2>
		<p class="period">${ escapeHtml( periodText ) } · ${ escapeHtml(
			currencyText
		) }</p>
		${ warningsHtml }
		${ ticketTable }
		${ extrasTable }
	</section>
	${ registrationPages }
</body>
</html>`;
}

/**
 * Pricing warnings printed above the price reference, so a missing or
 * uncertain price is never mistaken for a free one.
 *
 * @param {Object} pricing Output of resolveGatePricing().
 * @return {string[]} Warnings
 */
export function gatePricingWarnings( pricing ) {
	const warnings = [];
	if ( ! pricing.period ) {
		warnings.push(
			__(
				'No pricing period applies, so ticket prices cannot be shown. Set the prices on the Prices tab before charging anyone.',
				'fair-events'
			)
		);
	} else if ( pricing.isManualPeriod ) {
		warnings.push(
			__(
				'The event start is not within exactly one pricing period. These prices come from the period chosen when printing.',
				'fair-events'
			)
		);
	}
	if ( pricing.period && pricing.hasMissingPrice ) {
		warnings.push(
			__(
				'Some prices are not configured. Do not treat them as free; check the Prices tab.',
				'fair-events'
			)
		);
	}
	return warnings;
}
