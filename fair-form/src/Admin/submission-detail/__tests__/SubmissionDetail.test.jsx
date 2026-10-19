/**
 * @jest-environment jsdom
 *
 * Component test for the Submission Detail page (#1166): the mobile layout
 * fix relies on the root carrying `wrap fair-form-submission-detail` so the
 * scoped stylesheet actually applies — pin that class contract, plus that
 * both tables render, so a future refactor can't silently break the
 * selector the CSS depends on (as happened in 7331b65b).
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { getSettings, setSettings } from '@wordpress/date';
import SubmissionDetail, {
	ticketLinkDescription,
} from '../SubmissionDetail.js';

jest.mock( '@wordpress/api-fetch' );

const SUBMISSION = {
	id: 117,
	title: 'Form Submission',
	participant_id: 0,
	participant_name: 'Jane Doe',
	participant_email: 'jane@example.com',
	created_at: '2026-01-15 10:00:00',
	event_date_id: 0,
	event_name: '',
	answers: [
		{
			question_key: 'q1',
			question_text: 'How did you hear about us?',
			question_type: 'short_text',
			answer_value: 'Google',
		},
	],
};

beforeEach( () => {
	window.history.pushState(
		{},
		'',
		'/wp-admin/admin.php?page=fair-form-submission-detail&submission_id=117'
	);
	apiFetch.mockResolvedValue( SUBMISSION );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'SubmissionDetail', () => {
	it( 'renders the root with the wrap and page classes, and both tables', async () => {
		const { container } = render( <SubmissionDetail /> );

		await screen.findByText( 'Google' );

		const root = container.querySelector(
			'.wrap.fair-form-submission-detail'
		);
		expect( root ).toBeInTheDocument();

		expect(
			screen.getByRole( 'columnheader', { name: 'Question' } )
		).toBeInTheDocument();
		expect( screen.getByText( 'Submitted by' ) ).toBeInTheDocument();
	} );
} );

describe( 'SubmissionDetail — date answers (#1937)', () => {
	let originalSettings;

	beforeEach( () => {
		originalSettings = getSettings();
		// A non-UTC site offset: stored datetime answers are site-local wall
		// clock values, so the offset must not shift what is displayed.
		setSettings( {
			...originalSettings,
			formats: { ...originalSettings.formats, datetime: 'Y-m-d H:i' },
			timezone: { ...originalSettings.timezone, offset: 9, string: '' },
		} );
	} );

	afterEach( () => {
		setSettings( originalSettings );
	} );

	function answerCell( questionText ) {
		return screen
			.getByText( questionText, { selector: 'strong' } )
			.closest( 'tr' )
			.querySelectorAll( 'td' )[ 1 ];
	}

	it( 'renders populated and empty date and date & time answers alongside other answers', async () => {
		apiFetch.mockResolvedValue( {
			...SUBMISSION,
			answers: [
				{
					question_key: 'birthday',
					question_text: 'Birthday',
					question_type: 'date',
					answer_value: '2026-07-08',
				},
				{
					question_key: 'arrival',
					question_text: 'Arrival',
					question_type: 'datetime',
					answer_value: '2026-07-08 23:30:00',
				},
				{
					question_key: 'empty-date',
					question_text: 'Departure day',
					question_type: 'date',
					answer_value: '',
				},
				{
					question_key: 'empty-datetime',
					question_text: 'Pickup time',
					question_type: 'datetime',
					answer_value: '',
				},
				...SUBMISSION.answers,
			],
		} );
		render( <SubmissionDetail /> );

		await screen.findByText( 'Google' );

		expect( answerCell( 'Birthday' ) ).toHaveTextContent(
			new Date( '2026-07-08T00:00:00' ).toLocaleDateString( undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			} )
		);
		expect( answerCell( 'Arrival' ) ).toHaveTextContent(
			'2026-07-08 23:30'
		);
		expect( answerCell( 'Departure day' ) ).toHaveTextContent( '—' );
		expect( answerCell( 'Pickup time' ) ).toHaveTextContent( '—' );
		expect( answerCell( 'How did you hear about us?' ) ).toHaveTextContent(
			'Google'
		);
	} );
} );

describe( 'ticketLinkDescription (#1609)', () => {
	const ticket = { id: 71, position: 1, reference: 'AE2671B5' };

	it( 'names the ticket of a direct link', () => {
		expect(
			ticketLinkDescription( { ticket, ticket_link: 'direct' } )
		).toBe( 'Ticket 1 (AE2671B5)' );
	} );

	it( 'asks for a check when the link was inferred, unresolved or its ticket removed', () => {
		expect(
			ticketLinkDescription( { ticket, ticket_link: 'inferred' } )
		).toMatch( /^Ticket 1 \(AE2671B5\) — attached automatically/ );
		expect(
			ticketLinkDescription( { ticket: null, ticket_link: 'unresolved' } )
		).toMatch( /no matching ticket was found/ );
		expect(
			ticketLinkDescription( {
				ticket: null,
				ticket_link: 'ticket_removed',
			} )
		).toMatch( /was removed/ );
	} );

	it( 'shows the ticket row on the page for a linked submission', async () => {
		apiFetch.mockResolvedValue( {
			...SUBMISSION,
			ticket_id: 71,
			ticket_link: 'direct',
			ticket,
		} );
		render( <SubmissionDetail /> );

		expect(
			await screen.findByText( 'Ticket 1 (AE2671B5)' )
		).toBeInTheDocument();
	} );
} );

describe( 'SubmissionDetail — source form and page (#1324)', () => {
	function formRow() {
		return screen.getByText( 'Form', { selector: 'th' } ).closest( 'tr' );
	}

	function pageRow() {
		return screen.getByText( 'Page', { selector: 'th' } ).closest( 'tr' );
	}

	it( 'shows the form title in the row and the heading, and links a public page', async () => {
		apiFetch.mockResolvedValue( {
			...SUBMISSION,
			title: 'Fair Form',
			form_id: 'ff-workshop',
			source_form_title: 'Workshop feedback',
			source_page: {
				id: 12,
				label: 'Workshop page',
				url: 'https://example.test/workshop/',
			},
		} );
		render( <SubmissionDetail /> );

		expect(
			await screen.findByRole( 'heading', {
				level: 1,
				name: 'Workshop feedback',
			} )
		).toBeInTheDocument();
		expect( formRow() ).toHaveTextContent( 'Workshop feedback' );
		expect(
			screen.getByRole( 'link', { name: 'Workshop page' } )
		).toHaveAttribute( 'href', 'https://example.test/workshop/' );
	} );

	it( 'falls back to the form identifier and renders a non-public page as plain text', async () => {
		apiFetch.mockResolvedValue( {
			...SUBMISSION,
			title: 'Fair Form',
			form_id: 'ff-3f9a2c1e',
			source_form_title: null,
			source_page: { id: 13, label: 'Draft page', url: null },
		} );
		render( <SubmissionDetail /> );

		expect(
			await screen.findByRole( 'heading', {
				level: 1,
				name: 'Fair Form',
			} )
		).toBeInTheDocument();
		expect( formRow() ).toHaveTextContent( 'ff-3f9a2c1e' );
		expect( pageRow() ).toHaveTextContent( 'Draft page' );
		expect(
			screen.queryByRole( 'link', { name: 'Draft page' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows placeholders for a legacy submission with neither form nor page', async () => {
		apiFetch.mockResolvedValue( {
			...SUBMISSION,
			title: '',
			form_id: null,
			source_form_title: null,
			source_page: null,
		} );
		render( <SubmissionDetail /> );

		expect(
			await screen.findByRole( 'heading', {
				level: 1,
				name: 'Form Submission',
			} )
		).toBeInTheDocument();
		expect( formRow() ).toHaveTextContent( 'Legacy (no form id)' );
		expect( pageRow() ).toHaveTextContent( 'No page' );
	} );
} );

describe( 'SubmissionDetail — changing the event (#1778)', () => {
	const EVENT_DATES = [
		{ event_date_id: 5, label: 'Workshop — May 1', count: 3 },
		{ event_date_id: 6, label: 'Workshop — May 8', count: 1 },
	];

	function mockApi( saveResults ) {
		const results = [ ...saveResults ];
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( method === 'PUT' ) {
				const next = results.shift();
				return next instanceof Error
					? Promise.reject( next )
					: Promise.resolve( next );
			}
			if ( path.includes( '/grouped' ) ) {
				return Promise.resolve( EVENT_DATES );
			}
			return Promise.resolve( SUBMISSION );
		} );
	}

	async function chooseEvent() {
		await screen.findByText( 'Google' );
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );
		} );
		const select = screen.getByRole( 'combobox' );
		await screen.findByRole( 'option', { name: 'Workshop — May 8 (1)' } );
		fireEvent.change( select, { target: { value: '6' } } );
		return select;
	}

	function findNotice( text ) {
		return screen.findByText( text, {
			selector: '.components-notice__content',
		} );
	}

	async function clickSave() {
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		} );
	}

	it( 'shows the server error inline and keeps the chosen event', async () => {
		const alertSpy = jest.spyOn( window, 'alert' ).mockImplementation();
		mockApi( [ new Error( 'Event date not found.' ) ] );
		render( <SubmissionDetail /> );

		const select = await chooseEvent();
		await clickSave();

		expect(
			await findNotice( 'Event date not found.' )
		).toBeInTheDocument();
		// Announced to screen readers, not only shown.
		expect(
			document.getElementById( 'a11y-speak-assertive' )
		).toHaveTextContent( 'Event date not found.' );
		expect( select ).toHaveValue( '6' );
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
		expect( alertSpy ).not.toHaveBeenCalled();
	} );

	it( 'falls back to a translatable message without a server message', async () => {
		mockApi( [ new Error( '' ) ] );
		render( <SubmissionDetail /> );

		await chooseEvent();
		await clickSave();

		expect(
			await findNotice( 'The event could not be changed. Try again.' )
		).toBeInTheDocument();
	} );

	it( 'saves on retry, clearing the error and closing the editor', async () => {
		mockApi( [
			new Error( 'Temporary failure.' ),
			{ ...SUBMISSION, event_date_id: 6, event_name: 'Workshop' },
		] );
		render( <SubmissionDetail /> );

		await chooseEvent();
		await clickSave();
		await findNotice( 'Temporary failure.' );

		await clickSave();

		expect( await screen.findByText( 'Workshop' ) ).toBeInTheDocument();
		expect(
			screen.queryByText( 'Temporary failure.', {
				selector: '.components-notice__content',
			} )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument();
		expect(
			apiFetch.mock.calls
				.filter( ( [ args ] ) => args.method === 'PUT' )
				.map( ( [ args ] ) => args.data )
		).toEqual( [ { event_date_id: 6 }, { event_date_id: 6 } ] );
	} );

	it( 'disables Save and Cancel while the change is pending', async () => {
		let resolveSave;
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( method === 'PUT' ) {
				return new Promise( ( resolve ) => {
					resolveSave = resolve;
				} );
			}
			if ( path.includes( '/grouped' ) ) {
				return Promise.resolve( EVENT_DATES );
			}
			return Promise.resolve( SUBMISSION );
		} );
		render( <SubmissionDetail /> );

		await chooseEvent();
		await clickSave();

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();

		await act( async () => {
			resolveSave( { ...SUBMISSION, event_name: 'Workshop' } );
		} );
		expect( await screen.findByText( 'Workshop' ) ).toBeInTheDocument();
	} );
} );
