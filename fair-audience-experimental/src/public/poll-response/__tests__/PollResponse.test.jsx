/**
 * @jest-environment jsdom
 *
 * Public poll response (#1936): a missing choice and a failed submission are
 * announced beside the form, which keeps the selected choices, and a retry
 * succeeds without a second request from a double click.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import PollResponse from '../PollResponse.js';

jest.mock( '@wordpress/api-fetch' );

const POLL = {
	status: 'active',
	question: 'Which evening suits you?',
	options: [
		{ id: 1, text: 'Monday' },
		{ id: 2, text: 'Thursday' },
	],
};

const submits = () =>
	apiFetch.mock.calls.filter( ( [ options ] ) => options.method === 'POST' );

function renderPoll( submit ) {
	const root = document.createElement( 'div' );
	root.id = 'fair-audience-poll-root';
	root.dataset.accessKey = 'key-123';
	document.body.appendChild( root );
	apiFetch.mockImplementation( ( { method } ) =>
		method === 'POST'
			? submit()
			: Promise.resolve( {
					valid: true,
					already_responded: false,
					participant_name: 'Ada',
					poll: POLL,
				} )
	);
	return render( <PollResponse />, { container: root } );
}

afterEach( () => {
	document.body.innerHTML = '';
	jest.clearAllMocks();
} );

it( 'asks for a choice inline instead of in a browser popup', async () => {
	renderPoll( () => Promise.resolve( {} ) );

	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Submit Response' } )
	);

	expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
		'Please select at least one option.'
	);
	expect( submits() ).toHaveLength( 0 );

	fireEvent.click( screen.getByText( 'Monday' ) );
	expect( screen.getByRole( 'alert' ) ).toBeEmptyDOMElement();
} );

it( 'keeps the form and the choices after a failed submission, then retries', async () => {
	let resolveFirst;
	let attempts = 0;
	renderPoll( () => {
		attempts++;
		return attempts === 1
			? new Promise( ( resolve, reject ) => ( resolveFirst = reject ) )
			: Promise.resolve( {} );
	} );

	// Clicking the option's text selects it.
	fireEvent.click( await screen.findByText( 'Thursday' ) );
	expect(
		screen.getByRole( 'checkbox', { name: 'Thursday' } )
	).toBeChecked();
	const submit = screen.getByRole( 'button', { name: 'Submit Response' } );
	fireEvent.click( submit );
	fireEvent.click( submit );
	expect( submits() ).toHaveLength( 1 );

	await act( async () =>
		resolveFirst( { message: 'This poll is closed for a moment.' } )
	);

	expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
		'This poll is closed for a moment.'
	);
	expect(
		screen.getByRole( 'heading', { name: 'Which evening suits you?' } )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'checkbox', { name: 'Thursday' } )
	).toBeChecked();

	await act( async () =>
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Submit Response' } )
		)
	);

	expect( submits() ).toHaveLength( 2 );
	expect( submits()[ 1 ][ 0 ].data ).toEqual( {
		access_key: 'key-123',
		selected_option_ids: [ 2 ],
	} );
	expect(
		screen.getByText( 'Your response has been recorded successfully.' )
	).toBeInTheDocument();
} );
