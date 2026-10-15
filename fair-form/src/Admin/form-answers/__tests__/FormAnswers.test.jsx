/**
 * @jest-environment jsdom
 *
 * Form Answers row actions (#1774): deletion goes through the shared dialog
 * instead of window.confirm/alert, and the event-assignment editor identifies
 * the submission, shows failures inline, and keeps the chosen event for retry.
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
import FormAnswers from '../FormAnswers.js';

jest.mock( '@wordpress/api-fetch' );

// Two submissions from the same respondent with an identical timestamp, plus
// an anonymous one already assigned to an event.
const SUBMISSIONS = [
	{
		id: 74,
		title: 'Fair Form',
		form_title: 'Workshop feedback',
		participant_name: 'Alex Demo',
		participant_email: 'alex@example.test',
		event_name: '',
		created_at: '2026-10-14 04:11:53',
		event_date_id: null,
	},
	{
		id: 75,
		title: 'Fair Form',
		form_title: 'Workshop feedback',
		participant_name: 'Alex Demo',
		participant_email: 'alex@example.test',
		event_name: '',
		created_at: '2026-10-14 04:11:53',
		event_date_id: null,
	},
	{
		id: 77,
		title: 'Fair Form',
		form_title: '',
		participant_name: '',
		participant_email: '',
		event_name: 'Summer camp',
		created_at: '2026-10-13 09:00:00',
		event_date_id: 884,
	},
];

const EVENT_GROUPS = [
	{ event_date_id: null, label: 'No event', count: 3 },
	{ event_date_id: 884, label: 'Summer camp', count: 1 },
	{ event_date_id: 876, label: 'Autumn retreat', count: 2 },
];

function mockApi( handlers = {} ) {
	apiFetch.mockImplementation( ( options ) => {
		const { path, method = 'GET' } = options;
		const key = `${ method } ${ path }`;
		if ( handlers[ key ] ) {
			return handlers[ key ]( options );
		}
		if ( path === '/fair-form/v1/questionnaire-responses/all' ) {
			return Promise.resolve( SUBMISSIONS );
		}
		if (
			path.startsWith( '/fair-form/v1/questionnaire-responses/grouped' )
		) {
			return Promise.resolve( EVENT_GROUPS );
		}
		return Promise.resolve( null );
	} );
}

async function openRowAction( index, action ) {
	const rows = await screen.findAllByRole( 'row' );
	// Row 0 is the header.
	fireEvent.click(
		within( rows[ index + 1 ] ).getByRole( 'button', { name: 'Actions' } )
	);
	fireEvent.click( await screen.findByRole( 'menuitem', { name: action } ) );
	return screen.findByRole( 'dialog' );
}

function mutations() {
	return apiFetch.mock.calls.filter(
		( [ options ] ) => options.method && options.method !== 'GET'
	);
}

beforeEach( () => {
	window.confirm = jest.fn( () => true );
	window.alert = jest.fn();
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'FormAnswers — delete', () => {
	it( 'cancelling sends no mutation and never opens a native dialog', async () => {
		mockApi();
		render( <FormAnswers /> );

		const dialog = await openRowAction( 0, 'Delete' );
		expect( within( dialog ).getByText( '#74' ) ).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( mutations() ).toHaveLength( 0 );
		expect( window.confirm ).not.toHaveBeenCalled();
		expect( window.alert ).not.toHaveBeenCalled();
	} );

	it( 'removes only the deleted row from a repeated submission pair', async () => {
		mockApi();
		render( <FormAnswers /> );

		const dialog = await openRowAction( 1, 'Delete' );
		expect( within( dialog ).getByText( '#75' ) ).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete submission',
			} )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( mutations() ).toEqual( [
			[
				{
					path: '/fair-form/v1/questionnaire-responses/75',
					method: 'DELETE',
				},
			],
		] );
		expect(
			screen.getAllByRole( 'link', { name: 'Alex Demo' } )
		).toHaveLength( 1 );
		expect( window.alert ).not.toHaveBeenCalled();
	} );

	it( 'shows a deletion failure inside the dialog', async () => {
		mockApi( {
			'DELETE /fair-form/v1/questionnaire-responses/74': () =>
				Promise.reject( { message: 'Response not found.' } ),
		} );
		render( <FormAnswers /> );

		const dialog = await openRowAction( 0, 'Delete' );
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete submission',
			} )
		);

		await waitFor( () =>
			expect(
				dialog.querySelector( '.components-notice' )
			).toHaveTextContent( 'Response not found.' )
		);
		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		expect( window.alert ).not.toHaveBeenCalled();
	} );
} );

describe( 'FormAnswers — event assignment', () => {
	it( 'identifies the submission above the event selector', async () => {
		mockApi();
		render( <FormAnswers /> );

		const dialog = await openRowAction( 2, 'Edit' );

		expect(
			within( dialog ).getByText( 'Anonymous respondent' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'Untitled form' )
		).toBeInTheDocument();
		expect( within( dialog ).getByText( '#77' ) ).toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Event' ) ).toHaveValue(
			'884'
		);
	} );

	it( 'keeps the chosen event after a failed save and succeeds on retry', async () => {
		let attempts = 0;
		mockApi( {
			'PUT /fair-form/v1/questionnaire-responses/74': () => {
				attempts++;
				return attempts === 1
					? Promise.reject( { message: 'Event date not found.' } )
					: Promise.resolve( {
							event_date_id: 876,
							event_name: 'Autumn retreat',
					  } );
			},
		} );
		render( <FormAnswers /> );

		const dialog = await openRowAction( 0, 'Edit' );
		const select = within( dialog ).getByLabelText( 'Event' );
		await within( dialog ).findByRole( 'option', {
			name: 'Autumn retreat (2)',
		} );
		fireEvent.change( select, { target: { value: '876' } } );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Save' } )
		);

		await waitFor( () =>
			expect(
				dialog.querySelector( '.components-notice' )
			).toHaveTextContent( 'Event date not found.' )
		);
		expect( select ).toHaveValue( '876' );
		expect( window.alert ).not.toHaveBeenCalled();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Save' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( attempts ).toBe( 2 );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-form/v1/questionnaire-responses/74',
			method: 'PUT',
			data: { event_date_id: 876 },
		} );
	} );

	it( 'sends one save while pending', async () => {
		let resolveSave;
		mockApi( {
			'PUT /fair-form/v1/questionnaire-responses/74': () =>
				new Promise( ( resolve ) => {
					resolveSave = resolve;
				} ),
		} );
		render( <FormAnswers /> );

		const dialog = await openRowAction( 0, 'Edit' );
		const save = within( dialog ).getByRole( 'button', { name: 'Save' } );
		fireEvent.click( save );
		fireEvent.click( save );

		expect( mutations() ).toHaveLength( 1 );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();

		resolveSave( { event_date_id: null, event_name: '' } );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'clears a previous save error when another submission is opened', async () => {
		mockApi( {
			'PUT /fair-form/v1/questionnaire-responses/74': () =>
				Promise.reject( { message: 'Event date not found.' } ),
		} );
		render( <FormAnswers /> );

		let dialog = await openRowAction( 0, 'Edit' );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Save' } )
		);
		await waitFor( () =>
			expect(
				dialog.querySelector( '.components-notice' )
			).not.toBeNull()
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);

		dialog = await openRowAction( 1, 'Edit' );
		expect( within( dialog ).getByText( '#75' ) ).toBeInTheDocument();
		expect( dialog.querySelector( '.components-notice' ) ).toBeNull();
	} );

	it( 'shows an event-list failure with retry and keeps the current assignment', async () => {
		let groupedCalls = 0;
		mockApi( {
			'GET /fair-form/v1/questionnaire-responses/grouped?by=event':
				() => {
					groupedCalls++;
					return groupedCalls === 1
						? Promise.reject( { message: 'offline' } )
						: Promise.resolve( EVENT_GROUPS );
				},
		} );
		render( <FormAnswers /> );

		const dialog = await openRowAction( 2, 'Edit' );

		await within( dialog ).findByText(
			/The list of events could not be loaded/
		);
		expect( within( dialog ).getByLabelText( 'Event' ) ).toHaveValue(
			'884'
		);
		expect(
			within( dialog ).getByRole( 'option', { name: 'Summer camp' } )
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Retry' } )
		);

		await within( dialog ).findByRole( 'option', {
			name: 'Autumn retreat (2)',
		} );
		expect( groupedCalls ).toBe( 2 );
		expect(
			within( dialog ).queryByText(
				/The list of events could not be loaded/
			)
		).not.toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Event' ) ).toHaveValue(
			'884'
		);
	} );
} );

describe( 'FormAnswers — Form column (#1324)', () => {
	it( 'shows the source form title, then its identifier, then the legacy placeholder', async () => {
		mockApi( {
			'GET /fair-form/v1/questionnaire-responses/all': () =>
				Promise.resolve( [
					{
						...SUBMISSIONS[ 0 ],
						form_id: 'ff-workshop',
						source_form_title: 'Workshop feedback',
					},
					{
						...SUBMISSIONS[ 1 ],
						form_id: 'ff-3f9a2c1e',
						source_form_title: null,
					},
					{
						...SUBMISSIONS[ 2 ],
						title: 'Form Submission',
						form_id: null,
						source_form_title: null,
					},
				] ),
		} );
		render( <FormAnswers /> );

		expect(
			await screen.findByRole( 'columnheader', { name: /Form/ } )
		).toBeInTheDocument();
		const rows = screen.getAllByRole( 'row' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Workshop feedback' );
		expect( rows[ 2 ] ).toHaveTextContent( 'ff-3f9a2c1e' );
		expect( rows[ 3 ] ).toHaveTextContent( 'Legacy (no form id)' );
		expect( screen.queryByText( 'Fair Form' ) ).not.toBeInTheDocument();
	} );
} );
