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
import { render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
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
