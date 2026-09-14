/**
 * @jest-environment jsdom
 *
 * Component tests for the Signups tab's configurable export popup (#1568).
 *
 * Exercises:
 *   - Column picker (all vs. handpicked) and format switch (markdown / CSV /
 *     one line) change the copied/downloaded output.
 *   - "Include Fair Form answers" appears only when at least one loaded
 *     signup carries an answer, and joins the column picker when enabled.
 *   - A signup missing an answer for a selected question exports an empty
 *     value without being dropped.
 *   - Duplicate question labels get a numeric suffix.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SignupExportModal from '../SignupExportModal.js';

jest.mock( '@wordpress/api-fetch' );

const baseRows = [
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
	},
	{
		id: 2,
		name: 'Bob Smith',
		email: 'bob@example.com',
		ticket_type_name: 'General',
		quantity: 1,
		amount: '20.00',
		status: 'confirmed',
		transaction_id: 502,
		mailing_opt_in: false,
		created_at: '2026-07-21 10:00:00',
	},
];

function signupWithAnswers( id, answers ) {
	const row = baseRows.find( ( r ) => r.id === id );
	return { ...row, answers };
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

afterEach( () => {
	jest.clearAllMocks();
	delete navigator.clipboard;
} );

describe( 'SignupExportModal — columns and format', () => {
	it( 'copies all base columns in CSV by default when switched to CSV format', async () => {
		apiFetch.mockResolvedValue(
			baseRows.map( ( r ) => ( { ...r, answers: [] } ) )
		);
		const writeText = mockClipboard();

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		const text = writeText.mock.calls[ 0 ][ 0 ];
		expect( text.split( '\r\n' )[ 0 ] ).toBe(
			'Email,Name,Ticket Type,Quantity,Amount,Status,Transaction,Mailing,Date'
		);
	} );

	it( 'narrows the export to handpicked columns', async () => {
		apiFetch.mockResolvedValue(
			baseRows.map( ( r ) => ( { ...r, answers: [] } ) )
		);
		const writeText = mockClipboard();

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);
		uncheckAllExcept( [ 'Email', 'Name' ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' )[ 0 ] ).toBe(
			'Email,Name'
		);
	} );

	it( 'switches output when the format changes', async () => {
		apiFetch.mockResolvedValue( [ signupWithAnswers( 1, [] ) ] );
		const writeText = mockClipboard();

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ [ baseRows[ 0 ] ] }
				onClose={ jest.fn() }
			/>
		);

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);
		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		expect( writeText.mock.calls[ 0 ][ 0 ] ).toContain( '## Ada Lovelace' );

		fireEvent.click(
			screen.getByRole( 'radio', { name: 'One line per person' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);
		await waitFor( () => expect( writeText ).toHaveBeenCalledTimes( 2 ) );
		expect( writeText.mock.calls[ 1 ][ 0 ] ).not.toContain( '##' );
	} );

	it( 'disables Copy and Download when no column is selected', async () => {
		apiFetch.mockResolvedValue(
			baseRows.map( ( r ) => ( { ...r, answers: [] } ) )
		);

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

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

describe( 'SignupExportModal — Fair Form answers (#1568)', () => {
	it( 'hides the "Include Fair Form answers" checkbox when no signup has an answer', async () => {
		apiFetch.mockResolvedValue(
			baseRows.map( ( r ) => ( { ...r, answers: [] } ) )
		);

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

		await screen.findByRole( 'radio', { name: 'Markdown' } );
		expect(
			screen.queryByRole( 'checkbox', {
				name: 'Include Fair Form answers',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'offers individually selectable answer columns once enabled', async () => {
		apiFetch.mockResolvedValue( [
			signupWithAnswers( 1, [
				{
					question_key: 'diet',
					question_text: 'Dietary needs?',
					question_type: 'short_text',
					answer_value: 'Vegetarian',
				},
			] ),
			signupWithAnswers( 2, [] ),
		] );
		const writeText = mockClipboard();

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

		await screen.findByRole( 'checkbox', {
			name: 'Include Fair Form answers',
		} );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Include Fair Form answers',
			} )
		);
		fireEvent.click(
			screen.getByRole( 'radio', { name: 'Handpicked columns' } )
		);

		expect(
			screen.getByRole( 'checkbox', { name: 'Dietary needs?' } )
		).toBeInTheDocument();

		uncheckAllExcept( [
			'Email',
			'Dietary needs?',
			'Include Fair Form answers',
		] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		const lines = writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' );
		// Ada has the answer, Bob does not — missing answer is empty, row kept.
		expect( lines ).toEqual( [
			'Email,Dietary needs?',
			'ada@example.com,Vegetarian',
			'bob@example.com,',
		] );
	} );

	it( 'disambiguates duplicate question labels with a numeric suffix', async () => {
		apiFetch.mockResolvedValue( [
			signupWithAnswers( 1, [
				{
					question_key: 'q1',
					question_text: 'Notes',
					question_type: 'short_text',
					answer_value: 'From form A',
				},
			] ),
			signupWithAnswers( 2, [
				{
					question_key: 'q2',
					question_text: 'Notes',
					question_type: 'short_text',
					answer_value: 'From form B',
				},
			] ),
		] );

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

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
	it( 'stays usable for signup-only export when the answers request fails', async () => {
		apiFetch.mockRejectedValue( { message: 'fair-form unavailable' } );

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

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

		render(
			<SignupExportModal
				eventDateId={ 42 }
				rows={ baseRows }
				onClose={ jest.fn() }
			/>
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/get-tickets?event_date=42&include_answers=true',
			} )
		);
	} );
} );
