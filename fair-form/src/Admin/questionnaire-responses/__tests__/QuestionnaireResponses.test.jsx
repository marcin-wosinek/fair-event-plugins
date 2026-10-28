/**
 * @jest-environment jsdom
 *
 * Component tests for the per-form Questionnaire Responses table (#1268):
 * the participant columns, the "Add participants to group" button, and the
 * export column picker must all follow whether the loaded responses actually
 * carry a participant link — not the presence of fair-audience itself — so a
 * standalone form's responses aren't shown next to five permanently empty
 * columns and a permanently-disabled button.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import QuestionnaireResponses from '../QuestionnaireResponses.js';

jest.mock( '@wordpress/api-fetch' );

const STANDALONE_RESPONSES = [
	{
		id: 1,
		participant_id: 0,
		participant_name: '',
		participant_email: '',
		participant_status: '',
		participant_mailing: '',
		participant_categories: [],
		created_at: '2026-01-15 10:00:00',
		answers: [
			{
				question_key: 'q1',
				question_text: 'How did you hear about us?',
				question_type: 'short_text',
				answer_value: 'Google',
			},
		],
	},
];

const LINKED_RESPONSES = [
	{
		id: 2,
		participant_id: 7,
		participant_name: 'Jane Doe',
		participant_email: 'jane@example.com',
		participant_status: 'confirmed',
		participant_mailing: 'marketing',
		participant_categories: [],
		created_at: '2026-01-16 11:00:00',
		answers: [
			{
				question_key: 'q1',
				question_text: 'How did you hear about us?',
				question_type: 'short_text',
				answer_value: 'Friend',
			},
		],
	},
];

function mockResponses( responses ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.startsWith( '/fair-form/v1/questionnaire-responses' ) ) {
			return Promise.resolve( responses );
		}
		if ( path.startsWith( '/fair-audience/v1/groups' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( [] );
	} );
}

beforeEach( () => {
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'QuestionnaireResponses — standalone (no participant link)', () => {
	it( 'hides participant columns, hides the group button, and links the date to the detail view', async () => {
		mockResponses( STANDALONE_RESPONSES );

		render( <QuestionnaireResponses /> );

		await screen.findByText( 'Google' );

		expect(
			screen.queryByRole( 'columnheader', { name: 'Email' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'columnheader', { name: 'Status' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'columnheader', { name: 'Mailing' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'columnheader', {
				name: 'Subscribed Categories',
			} )
		).not.toBeInTheDocument();

		expect(
			screen.queryByRole( 'button', {
				name: 'Add participants to group',
			} )
		).not.toBeInTheDocument();

		const dateLink = screen.getByRole( 'link', {
			name: new Date( '2026-01-15 10:00:00Z' ).toLocaleString(),
		} );
		expect( dateLink ).toHaveAttribute(
			'href',
			'admin.php?page=fair-form-submission-detail&submission_id=1'
		);
	} );
} );

describe( 'QuestionnaireResponses — linked to participants', () => {
	it( 'shows participant columns and the group button', async () => {
		mockResponses( LINKED_RESPONSES );

		render( <QuestionnaireResponses /> );

		await screen.findByText( 'Friend' );

		expect(
			screen.getByRole( 'columnheader', { name: 'Email' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'columnheader', { name: 'Status' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'columnheader', { name: 'Mailing' } )
		).toBeInTheDocument();

		expect(
			screen.getByRole( 'button', { name: 'Add participants to group' } )
		).toBeInTheDocument();

		const nameLink = screen.getByRole( 'link', { name: 'Jane Doe' } );
		expect( nameLink ).toHaveAttribute(
			'href',
			'admin.php?page=fair-audience-participant-detail&participant_id=7'
		);
	} );
} );

describe( 'QuestionnaireResponses — add to group (#1935)', () => {
	it( 'snapshots every linked participant once and reports the result next to the button', async () => {
		const groupCalls = [];
		apiFetch.mockImplementation( ( { path, data } ) => {
			if ( path.startsWith( '/fair-form/v1/questionnaire-responses' ) ) {
				return Promise.resolve( [
					...LINKED_RESPONSES,
					{ ...LINKED_RESPONSES[ 0 ], id: 3 },
					...STANDALONE_RESPONSES,
				] );
			}
			if ( path.startsWith( '/fair-audience/v1/groups?' ) ) {
				return Promise.resolve( [
					{ id: 5, name: 'Volunteers', member_count: 0 },
				] );
			}
			groupCalls.push( data.participant_id );
			return Promise.resolve( {} );
		} );

		render( <QuestionnaireResponses /> );
		await screen.findAllByText( 'Friend' );
		const trigger = screen.getByRole( 'button', {
			name: 'Add participants to group',
		} );
		fireEvent.click( trigger );

		const dialog = await screen.findByRole( 'dialog' );
		expect(
			within( dialog ).getByText( '1 participant will be added:' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				'1 response is not linked to a participant and is left out.'
			)
		).toBeInTheDocument();

		const select = within( dialog ).getByRole( 'combobox', {
			name: 'Group',
		} );
		await within( select ).findByRole( 'option', {
			name: 'Volunteers (0)',
		} );
		fireEvent.change( select, { target: { value: '5' } } );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Add to group' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( groupCalls ).toEqual( [ 7 ] );
		expect(
			screen.getByText( 'Group: Volunteers', {
				selector: '.components-notice__content p',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByText( '1 participant was added to the group.', {
				selector: '.components-notice__content p',
			} )
		).toBeInTheDocument();
	} );
} );

describe( 'QuestionnaireResponses — row actions', () => {
	it( 'offers a View action that navigates to the submission detail page', async () => {
		mockResponses( STANDALONE_RESPONSES );

		render( <QuestionnaireResponses /> );
		const row = ( await screen.findByText( 'Google' ) ).closest( 'tr' );

		fireEvent.click(
			within( row ).getByRole( 'button', { name: 'Actions' } )
		);

		expect(
			await screen.findByRole( 'menuitem', { name: 'View' } )
		).toBeInTheDocument();
	} );
} );

describe( 'QuestionnaireResponses — empty state', () => {
	it( 'renders without throwing when there are no responses', async () => {
		mockResponses( [] );

		render( <QuestionnaireResponses /> );

		expect( await screen.findByText( 'No results' ) ).toBeInTheDocument();
	} );
} );

describe( 'QuestionnaireResponses — Markdown export (#1422)', () => {
	it( 'headings link submissions to their participant, dates get the long label/format, and every field is blank-line separated', async () => {
		mockResponses( [ ...LINKED_RESPONSES, ...STANDALONE_RESPONSES ] );
		const writeText = jest.fn( () => Promise.resolve() );
		Object.assign( navigator, { clipboard: { writeText } } );

		render( <QuestionnaireResponses /> );
		await screen.findByText( 'Friend' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Export' } ) );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await screen.findByText( 'Message copied to clipboard.' );

		const message = writeText.mock.calls[ 0 ][ 0 ];

		// (a) participant-linked submission: heading, no duplicate Name line.
		expect( message ).toContain( '## Jane Doe' );
		expect( message ).not.toContain( '**Name:** Jane Doe' );

		// (b) submission without a participant link: no heading.
		expect( message ).not.toContain( '## #1' );

		// (c) date line uses the long label, no seconds.
		expect( message ).toContain( '**Submission date:**' );
		expect( message ).not.toContain( '**Date:**' );
		expect( message ).not.toMatch(
			/\*\*Submission date:\*\*[^\n]*\d{2}:\d{2}:\d{2}/
		);

		// (d) every field is followed by a blank line.
		const linkedBlock = message.split( '\n\n---\n\n' )[ 0 ];
		expect( linkedBlock.split( '\n\n' ).length ).toBeGreaterThan( 1 );
	} );
} );

describe( 'QuestionnaireResponses — table containment', () => {
	it( 'scopes the DataViews table in a scrollable CardBody so a wide table cannot drag the page sideways', async () => {
		mockResponses( STANDALONE_RESPONSES );

		const { container } = render( <QuestionnaireResponses /> );

		await screen.findByText( 'Google' );

		expect(
			container.querySelector(
				'.fair-form-questionnaire-responses__table'
			)
		).toBeInTheDocument();
	} );
} );

describe( 'QuestionnaireResponses — delete (#1774)', () => {
	async function openDelete( answerText ) {
		const row = ( await screen.findByText( answerText ) ).closest( 'tr' );
		fireEvent.click(
			within( row ).getByRole( 'button', { name: 'Actions' } )
		);
		fireEvent.click(
			await screen.findByRole( 'menuitem', { name: 'Delete' } )
		);
		return screen.findByRole( 'dialog' );
	}

	const deleteCalls = () =>
		apiFetch.mock.calls.filter(
			( [ options ] ) => options.method === 'DELETE'
		);

	it( 'identifies an anonymous submission by fallback, form, and ID; cancel sends nothing', async () => {
		mockResponses( [
			{ ...STANDALONE_RESPONSES[ 0 ], form_title: 'Workshop feedback' },
		] );

		render( <QuestionnaireResponses /> );
		const dialog = await openDelete( 'Google' );

		expect(
			within( dialog ).getByText( 'Anonymous respondent' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'Workshop feedback' )
		).toBeInTheDocument();
		expect( within( dialog ).getByText( '#1' ) ).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( deleteCalls() ).toHaveLength( 0 );
	} );

	it( 'deletes only the confirmed response', async () => {
		mockResponses( [ ...LINKED_RESPONSES, ...STANDALONE_RESPONSES ] );

		render( <QuestionnaireResponses /> );
		const dialog = await openDelete( 'Friend' );
		expect( within( dialog ).getByText( 'Jane Doe' ) ).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'Untitled form' )
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete submission',
			} )
		);

		await waitFor( () =>
			expect( screen.queryByText( 'Friend' ) ).not.toBeInTheDocument()
		);
		expect( screen.getByText( 'Google' ) ).toBeInTheDocument();
		expect( deleteCalls() ).toEqual( [
			[
				{
					path: '/fair-form/v1/questionnaire-responses/2',
					method: 'DELETE',
				},
			],
		] );
	} );
} );
