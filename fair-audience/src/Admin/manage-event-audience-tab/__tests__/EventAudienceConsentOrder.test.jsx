/**
 * @jest-environment jsdom
 *
 * Component tests for shared participant ordering across the Audience table,
 * the printable list, and the "Record email consent" modal (#1549).
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventAudience from '../EventAudience.js';

jest.mock( '@wordpress/api-fetch' );

// Default sort is by role (collaborator, signed_up, interested), then name.
// Alice (collaborator) < Charlie/Dana (signed_up, tie-broken by name) < Bob
// (interested). Bob and Charlie are "minimal" (consent-eligible); Dana is
// already "marketing"; only Alice/Charlie/Dana appear on the printout
// (collaborator/signed_up), while Bob is interested and stays off it.
const PARTICIPANTS = [
	{
		id: 1,
		participant_id: 10,
		participant_name: 'Charlie Doe',
		name: 'Charlie',
		surname: 'Doe',
		participant_email: 'charlie@example.com',
		email_profile: 'minimal',
		label: 'signed_up',
		ticket_type_name: null,
		ticket_option_ids: [],
		ticket_option_names: [],
		admin_comment: '',
		payment_expires_at: null,
	},
	{
		id: 2,
		participant_id: 11,
		participant_name: 'Alice Smith',
		name: 'Alice',
		surname: 'Smith',
		participant_email: 'alice@example.com',
		email_profile: 'minimal',
		label: 'collaborator',
		ticket_type_name: null,
		ticket_option_ids: [],
		ticket_option_names: [],
		admin_comment: '',
		payment_expires_at: null,
	},
	{
		id: 3,
		participant_id: 12,
		participant_name: 'Bob Jones',
		name: 'Bob',
		surname: 'Jones',
		participant_email: '',
		email_profile: 'minimal',
		label: 'interested',
		ticket_type_name: null,
		ticket_option_ids: [],
		ticket_option_names: [],
		admin_comment: '',
		payment_expires_at: null,
	},
	{
		id: 4,
		participant_id: 13,
		participant_name: 'Dana Lee',
		name: 'Dana',
		surname: 'Lee',
		participant_email: 'dana@example.com',
		email_profile: 'marketing',
		label: 'signed_up',
		ticket_type_name: null,
		ticket_option_ids: [],
		ticket_option_names: [],
		admin_comment: '',
		payment_expires_at: null,
	},
];

function mockApiFetch() {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( PARTICIPANTS );
		}
		if ( path.includes( '/marketing-consent' ) ) {
			return Promise.resolve( {
				upgraded: 1,
				declined: 0,
				skipped: 0,
				email_failed: 0,
			} );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( { options: [], ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
}

function renderAudience() {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Weekly class"
		/>
	);
}

function rowNames() {
	// Modal entries render the participant name inside a <strong>; there is no
	// role for that, so query it directly within the dialog.
	const modal = screen.getByRole( 'dialog' );
	return Array.from( modal.querySelectorAll( 'strong' ) ).map(
		( el ) => el.textContent
	);
}

beforeEach( () => {
	mockApiFetch();
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — shared participant ordering (#1549)', () => {
	it( 'orders consent-eligible printable participants the same as the table', async () => {
		renderAudience();

		await screen.findByText( 'Charlie Doe' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Record email consent' } )
		);

		// Table/print order (role asc): Alice (collaborator), Charlie
		// (signed_up). Both are minimal, so both are consent-eligible and
		// also printable — their relative order must match.
		expect( rowNames() ).toEqual( [
			'Alice Smith',
			'Charlie Doe',
			'Bob Jones',
		] );
	} );

	it( 'keeps consent-eligible participants excluded from the printout, ordered consistently', async () => {
		renderAudience();

		await screen.findByText( 'Charlie Doe' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Record email consent' } )
		);

		// Bob is "interested" (off the printout) but still minimal, so he
		// stays in the consent list, positioned by the same role ordering
		// (interested sorts after collaborator/signed_up).
		expect( rowNames() ).toContain( 'Bob Jones' );
		expect( rowNames() ).toEqual( [
			'Alice Smith',
			'Charlie Doe',
			'Bob Jones',
		] );
	} );

	it( 'updates consent order when the Audience sort column changes', async () => {
		renderAudience();

		await screen.findByText( 'Charlie Doe' );

		// Switch the Audience table to sort by name.
		fireEvent.click( screen.getByRole( 'columnheader', { name: 'Name' } ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Record email consent' } )
		);

		// Name-ascending order across all participants: Alice, Bob, Charlie,
		// Dana. Filtered to minimal: Alice, Bob, Charlie.
		expect( rowNames() ).toEqual( [
			'Alice Smith',
			'Bob Jones',
			'Charlie Doe',
		] );
	} );

	it( 'narrows the consent list on search without reordering matches', async () => {
		renderAudience();

		await screen.findByText( 'Charlie Doe' );
		fireEvent.click( screen.getByRole( 'columnheader', { name: 'Name' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Record email consent' } )
		);

		expect( rowNames() ).toEqual( [
			'Alice Smith',
			'Bob Jones',
			'Charlie Doe',
		] );

		fireEvent.change(
			screen.getByPlaceholderText( 'Search by name or email…' ),
			{ target: { value: 'a' } }
		);

		// "Alice" and "Charlie" both contain "a"; "Bob" does not. Order is
		// preserved from the name-ascending base list.
		expect( rowNames() ).toEqual( [ 'Alice Smith', 'Charlie Doe' ] );
	} );

	it( 'keeps a recorded choice tied to its participant_id while filtering', async () => {
		renderAudience();

		await screen.findByText( 'Charlie Doe' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Record email consent' } )
		);

		const modal = screen.getByRole( 'dialog' );
		const charlieRow = within( modal )
			.getByText( 'Charlie Doe' )
			.closest( 'div[style]' );
		fireEvent.click(
			within( charlieRow ).getByRole( 'button', { name: 'Yes' } )
		);

		fireEvent.change(
			screen.getByPlaceholderText( 'Search by name or email…' ),
			{ target: { value: 'charlie' } }
		);
		expect( rowNames() ).toEqual( [ 'Charlie Doe' ] );

		fireEvent.click(
			within( screen.getByRole( 'dialog' ) ).getByRole( 'button', {
				name: 'Save consent',
			} )
		);

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-audience/v1/event-dates/5/participants/marketing-consent',
				method: 'POST',
				data: { marketing_ids: [ 10 ], declined_ids: [] },
			} )
		);
	} );

	it( 'disables "Yes" but keeps "No" available for a participant without an email', async () => {
		renderAudience();

		await screen.findByText( 'Charlie Doe' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Record email consent' } )
		);

		const modal = screen.getByRole( 'dialog' );
		const bobRow = within( modal )
			.getByText( 'Bob Jones' )
			.closest( 'div[style]' );

		expect(
			within( bobRow ).getByRole( 'button', { name: 'Yes' } )
		).toBeDisabled();
		expect(
			within( bobRow ).getByRole( 'button', { name: 'No' } )
		).not.toBeDisabled();
	} );
} );
