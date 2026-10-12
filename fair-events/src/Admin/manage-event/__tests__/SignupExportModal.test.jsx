/**
 * @jest-environment jsdom
 *
 * Component tests for the List tab's configurable export popup (#1568),
 * exporting one row per ticket (#1708).
 *
 * Exercises:
 *   - Column picker (all vs. handpicked) and format switch (markdown / CSV /
 *     one line) change the copied/downloaded output.
 *   - One exported entry per ticket in every format, each with its own
 *     reference, type and extras; the purchase total is given once per
 *     registration.
 *   - "Include Fair Form answers" appears only when at least one loaded
 *     registration carries an answer, and joins the column picker when
 *     enabled.
 *   - Answers stay with the ticket they belong to; answers kept with no
 *     ticket go on the registration's first ticket only, flagged for review.
 *   - Duplicate question labels get a numeric suffix.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SignupExportModal from '../SignupExportModal.js';
import { expandTicketRows } from '../EventSignups.js';

jest.mock( '@wordpress/api-fetch' );

const ticketOptions = [
	{ id: 7, name: 'Dinner buffet', short_name: 'Dinner' },
	{ id: 8, name: 'Afterparty', short_name: '' },
];

function ticket( id, position, overrides = {} ) {
	return {
		id,
		position,
		reference: `REF${ String( id ).padStart( 5, '0' ) }`,
		ticket_type_id: 3,
		ticket_type_name: 'General',
		status: 'confirmed',
		confirmed_activity_ids: [],
		...overrides,
	};
}

const signups = [
	{
		id: 1,
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		ticket_type_name: 'General',
		quantity: 1,
		amount: '20.00',
		status: 'confirmed',
		transaction_id: 501,
		mailing_opt_in: true,
		created_at: '2026-07-20 10:00:00',
		tickets: [ ticket( 101, 1, { confirmed_activity_ids: [ 7 ] } ) ],
	},
	{
		id: 2,
		name: 'Bob Smith',
		email: 'bob@example.com',
		ticket_type_name: 'General',
		quantity: 3,
		amount: '60.00',
		status: 'confirmed',
		transaction_id: 502,
		mailing_opt_in: false,
		created_at: '2026-07-21 10:00:00',
		tickets: [
			ticket( 201, 1, { confirmed_activity_ids: [ 7 ] } ),
			ticket( 202, 2, {
				ticket_type_id: 61,
				ticket_type_name: 'Reduced',
				confirmed_activity_ids: [ 8, 7 ],
			} ),
			ticket( 203, 3 ),
		],
	},
];

const rows = expandTicketRows( signups );

const diet = ( value, key = 'diet', text = 'Dietary needs?' ) => [
	{
		question_key: key,
		question_text: text,
		question_type: 'short_text',
		answer_value: value,
	},
];

/**
 * An include_answers response: the registrations, with answers attached to
 * the given tickets and, optionally, answers kept with no ticket.
 *
 * @param {Object} byTicketId         Ticket answers by ticket ID.
 * @param {Object} unlinkedBySignupId Answers with no ticket by signup ID.
 * @return {Array} Response
 */
function answersResponse( byTicketId = {}, unlinkedBySignupId = {} ) {
	return signups.map( ( signup ) => {
		const tickets = signup.tickets.map( ( t ) => ( {
			...t,
			answers: byTicketId[ t.id ]?.answers || [],
			answers_need_review: !! byTicketId[ t.id ]?.needsReview,
		} ) );
		const firstWith = tickets.find( ( t ) => t.answers.length );
		return {
			...signup,
			tickets,
			answers: firstWith
				? firstWith.answers
				: unlinkedBySignupId[ signup.id ] || [],
			answers_ticket_id: firstWith ? firstWith.id : null,
			answers_need_review: false,
		};
	} );
}

function renderModal( exportRows = rows ) {
	render(
		<SignupExportModal
			eventDateId={ 42 }
			rows={ exportRows }
			ticketOptions={ ticketOptions }
			onClose={ jest.fn() }
		/>
	);
}

function mockClipboard() {
	const writeText = jest.fn().mockResolvedValue();
	Object.assign( navigator, { clipboard: { writeText } } );
	return writeText;
}

// Column checkboxes start all-checked (mirroring the Questionnaire Responses
// export picker), so "handpicking" a subset means unchecking the rest.
function uncheckAllExcept( keepLabels ) {
	screen.getAllByRole( 'checkbox' ).forEach( ( checkbox ) => {
		const label =
			checkbox.labels && checkbox.labels[ 0 ]
				? checkbox.labels[ 0 ].textContent.trim()
				: '';
		if ( ! keepLabels.includes( label ) ) {
			fireEvent.click( checkbox );
		}
	} );
}

async function copyCsvWithAnswers( keepLabels ) {
	fireEvent.click(
		await screen.findByRole( 'checkbox', {
			name: 'Include Fair Form answers',
		} )
	);
	fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
	fireEvent.click(
		screen.getByRole( 'radio', { name: 'Handpicked columns' } )
	);
	uncheckAllExcept( [ ...keepLabels, 'Include Fair Form answers' ] );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Copy to clipboard' } )
	);
	await screen.findByText( 'Copied to clipboard.' );
}

afterEach( () => {
	jest.clearAllMocks();
	delete navigator.clipboard;
} );

describe( 'SignupExportModal — ticket rows (#1708)', () => {
	it( 'exports one CSV row per ticket with its own reference, type and extras, and the purchase total once', async () => {
		apiFetch.mockResolvedValue( answersResponse() );
		const writeText = mockClipboard();
		renderModal();

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ) ).toEqual( [
			'Email,Name,Ticket,Ticket Type,Extras,Purchase total (once per registration),Purchase reference,Status,Transaction,Mailing,Date',
			'ada@example.com,Ada Lovelace,Ticket 1 (REF00101),General,Dinner buffet,20.00,1,confirmed,501,yes,2026-07-20 10:00:00',
			'bob@example.com,Bob Smith,Ticket 1 (REF00201),General,Dinner buffet,60.00,2,confirmed,502,no,2026-07-21 10:00:00',
			'bob@example.com,Bob Smith,Ticket 2 (REF00202),Reduced,"Dinner buffet, Afterparty",,2,confirmed,502,no,2026-07-21 10:00:00',
			'bob@example.com,Bob Smith,Ticket 3 (REF00203),General,,,2,confirmed,502,no,2026-07-21 10:00:00',
		] );
	} );

	it( 'narrows the export to handpicked columns', async () => {
		apiFetch.mockResolvedValue( answersResponse() );
		const writeText = mockClipboard();
		renderModal();

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);
		uncheckAllExcept( [ 'Email', 'Ticket' ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ) ).toEqual( [
			'Email,Ticket',
			'ada@example.com,Ticket 1 (REF00101)',
			'bob@example.com,Ticket 1 (REF00201)',
			'bob@example.com,Ticket 2 (REF00202)',
			'bob@example.com,Ticket 3 (REF00203)',
		] );
	} );

	it( 'gives one Markdown section and one line per ticket', async () => {
		apiFetch.mockResolvedValue( answersResponse() );
		const writeText = mockClipboard();
		renderModal();

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);
		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		const markdown = writeText.mock.calls[ 0 ][ 0 ];
		expect( markdown.match( /^## /gm ) ).toHaveLength( 4 );
		expect( markdown ).toContain( '## Ada Lovelace — Ticket 1 (REF00101)' );
		expect( markdown ).toContain( '## Bob Smith — Ticket 2 (REF00202)' );
		expect( markdown ).toContain( '## Bob Smith — Ticket 3 (REF00203)' );

		fireEvent.click(
			screen.getByRole( 'radio', { name: 'One line per ticket' } )
		);
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);
		uncheckAllExcept( [ 'Name', 'Ticket' ] );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);
		await waitFor( () => expect( writeText ).toHaveBeenCalledTimes( 2 ) );
		expect( writeText.mock.calls[ 1 ][ 0 ].split( '\r\n' ) ).toEqual( [
			'Ada Lovelace Ticket 1 (REF00101)',
			'Bob Smith Ticket 1 (REF00201)',
			'Bob Smith Ticket 2 (REF00202)',
			'Bob Smith Ticket 3 (REF00203)',
		] );
	} );

	it( 'disables Copy and Download when no column is selected', async () => {
		apiFetch.mockResolvedValue( answersResponse() );
		renderModal();

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);
		uncheckAllExcept( [] );

		expect(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Download CSV' } )
		).toBeDisabled();
	} );
} );

describe( 'SignupExportModal — Fair Form answers (#1568, #1708)', () => {
	it( 'hides the "Include Fair Form answers" checkbox when no ticket has an answer', async () => {
		apiFetch.mockResolvedValue( answersResponse() );
		renderModal();

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		expect(
			screen.queryByRole( 'checkbox', {
				name: 'Include Fair Form answers',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'keeps each ticket’s answers on its own row', async () => {
		apiFetch.mockResolvedValue(
			answersResponse( {
				201: { answers: diet( 'Vegan' ) },
				202: { answers: diet( 'Vegetarian' ), needsReview: true },
			} )
		);
		const writeText = mockClipboard();
		renderModal();

		await copyCsvWithAnswers( [
			'Ticket',
			'Answers for',
			'Dietary needs?',
		] );

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ) ).toEqual( [
			'Ticket,Answers for,Dietary needs?',
			'Ticket 1 (REF00101),,',
			'Ticket 1 (REF00201),Ticket 1 (REF00201),Vegan',
			'Ticket 2 (REF00202),Ticket 2 (REF00202) (needs review),Vegetarian',
			'Ticket 3 (REF00203),,',
		] );
	} );

	it( 'puts answers kept with no ticket on the first ticket only, flagged for review', async () => {
		apiFetch.mockResolvedValue(
			answersResponse( {}, { 2: diet( 'Pescatarian' ) } )
		);
		const writeText = mockClipboard();
		renderModal();

		await copyCsvWithAnswers( [
			'Ticket',
			'Answers for',
			'Dietary needs?',
		] );

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ) ).toEqual( [
			'Ticket,Answers for,Dietary needs?',
			'Ticket 1 (REF00101),,',
			'Ticket 1 (REF00201),No ticket (needs review),Pescatarian',
			'Ticket 2 (REF00202),,',
			'Ticket 3 (REF00203),,',
		] );
	} );

	it( 'treats answers from a Fair Form without ticket links as kept with no ticket', async () => {
		apiFetch.mockResolvedValue(
			signups.map( ( signup ) => ( {
				...signup,
				answers: signup.id === 2 ? diet( 'Halal' ) : [],
			} ) )
		);
		const writeText = mockClipboard();
		renderModal();

		await copyCsvWithAnswers( [
			'Ticket',
			'Answers for',
			'Dietary needs?',
		] );

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect(
			writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ).slice( 2 )
		).toEqual( [
			'Ticket 1 (REF00201),No ticket (needs review),Halal',
			'Ticket 2 (REF00202),,',
			'Ticket 3 (REF00203),,',
		] );
	} );

	it( 'disambiguates duplicate question labels with a numeric suffix', async () => {
		apiFetch.mockResolvedValue(
			answersResponse( {
				101: { answers: diet( 'From form A', 'q1', 'Notes' ) },
				202: { answers: diet( 'From form B', 'q2', 'Notes' ) },
			} )
		);
		renderModal();

		fireEvent.click(
			await screen.findByRole( 'checkbox', {
				name: 'Include Fair Form answers',
			} )
		);
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);

		expect(
			screen.getByRole( 'checkbox', { name: 'Notes' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'checkbox', { name: 'Notes (2)' } )
		).toBeInTheDocument();
	} );
} );

describe( 'SignupExportModal — no Fair Form / load failure', () => {
	it( 'stays usable for a ticket-only export when the answers request fails', async () => {
		apiFetch.mockRejectedValue( { message: 'fair-form unavailable' } );
		renderModal();

		await waitFor( () =>
			expect(
				document.querySelector( '.components-notice__content' )
			).toHaveTextContent( 'fair-form unavailable' )
		);
		expect(
			screen.getByRole( 'radio', { name: 'Markdown' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'checkbox', {
				name: 'Include Fair Form answers',
			} )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		).not.toBeDisabled();
	} );

	it( 'requests answers scoped to the event date with include_answers=true', async () => {
		apiFetch.mockResolvedValue( [] );
		renderModal();

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/get-tickets?event_date=42&include_answers=true',
			} )
		);
	} );
} );

describe( 'SignupExportModal — purchases split over dates (#1791)', () => {
	// A €100 purchase of tickets 101 and 102, bought for 10 June; 102 was
	// moved on its own to 17 June.
	const split = ( overrides = {} ) => ( {
		id: 9,
		name: 'Paula Purchaser',
		email: 'paula@example.com',
		ticket_type_name: 'General',
		quantity: 2,
		amount: '100.00',
		status: 'confirmed',
		transaction_id: 900,
		mailing_opt_in: true,
		created_at: '2026-05-01 10:00:00',
		event_date_id: 10,
		tickets: [
			ticket( 101, 1, { event_date_id: 10 } ),
			ticket( 102, 2, { event_date_id: 17 } ),
		],
		accounting_anchor_ticket_id: 101,
		...overrides,
	} );

	async function exportTotals( signup ) {
		apiFetch.mockResolvedValue( [ { ...signup, answers: [] } ] );
		const writeText = mockClipboard();
		renderModal( expandTicketRows( [ signup ] ) );

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);
		uncheckAllExcept( [
			'Ticket',
			'Purchase total (once per registration)',
			'Purchase reference',
		] );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);
		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		return writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ).slice( 1 );
	}

	it( 'exports the total on the anchor ticket of the original date', async () => {
		expect(
			await exportTotals( split( { listed_ticket_ids: [ 101 ] } ) )
		).toEqual( [ 'Ticket 1 (REF00101),100.00,9' ] );
	} );

	it( 'leaves the total blank for the moved ticket, keeping the purchase reference', async () => {
		expect(
			await exportTotals( split( { listed_ticket_ids: [ 102 ] } ) )
		).toEqual( [ 'Ticket 2 (REF00102),,9' ] );
	} );

	it( 'moves the total with the anchor when it is the first listed ticket of another date', async () => {
		expect(
			await exportTotals(
				split( {
					listed_ticket_ids: [ 101, 102 ],
					tickets: [
						ticket( 101, 1, { event_date_id: 17 } ),
						ticket( 102, 2, { event_date_id: 17 } ),
					],
				} )
			)
		).toEqual( [
			'Ticket 1 (REF00101),100.00,9',
			'Ticket 2 (REF00102),,9',
		] );
	} );

	it( 'gives the total to the remaining ticket once the anchor is cancelled, even when it is not the first listed', async () => {
		expect(
			await exportTotals(
				split( {
					listed_ticket_ids: [ 102 ],
					accounting_anchor_ticket_id: 102,
					tickets: [
						ticket( 101, 1, {
							event_date_id: 10,
							status: 'cancelled',
						} ),
						ticket( 102, 2, { event_date_id: 17 } ),
					],
				} )
			)
		).toEqual( [ 'Ticket 2 (REF00102),100.00,9' ] );
	} );

	it( 'preserves a zero total on the anchor row', async () => {
		expect(
			await exportTotals(
				split( { amount: '0.00', listed_ticket_ids: [ 101 ] } )
			)
		).toEqual( [ 'Ticket 1 (REF00101),0.00,9' ] );
	} );

	it( 'keeps a moved ticket’s own answers and never gives it the purchase’s unlinked answers', async () => {
		const signup = split( { listed_ticket_ids: [ 102 ] } );
		apiFetch.mockResolvedValue( [
			{
				...signup,
				tickets: [
					{ ...signup.tickets[ 0 ], answers: diet( 'Vegan' ) },
					{ ...signup.tickets[ 1 ], answers: diet( 'Halal' ) },
				],
				answers: diet( 'Vegan' ),
				answers_ticket_id: 101,
			},
		] );
		const writeText = mockClipboard();
		renderModal( expandTicketRows( [ signup ] ) );

		await copyCsvWithAnswers( [
			'Ticket',
			'Answers for',
			'Dietary needs?',
		] );

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ) ).toEqual( [
			'Ticket,Answers for,Dietary needs?',
			'Ticket 2 (REF00102),Ticket 2 (REF00102),Halal',
		] );
	} );

	it( 'explains what a date’s totals stand for', async () => {
		apiFetch.mockResolvedValue( answersResponse() );
		renderModal();

		expect(
			await screen.findByText(
				/Each purchase total appears once.*not the revenue from its attendance/
			)
		).toBeInTheDocument();
	} );
} );
