/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	render,
	screen,
	waitFor,
	fireEvent,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import GeneralTab from '../GeneralTab.js';
import {
	loadGeneralSettings,
	loadStoredTicketing,
	saveSettings,
	saveTicketing,
} from '../settings-api.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../settings-api.js' );

const baseSettings = {
	slug: 'fair-events',
	enabledPostTypes: [],
	registerPostType: true,
	poweredByBranding: false,
};

function setTicketingMeta( meta = {} ) {
	window.fairEventsSettingsData = {
		eventsApiUrl: 'https://example.com/wp-json/fair-events/v1/events',
		features: {
			ticketing: {
				label: 'Ticketing',
				description: 'Ticket types, sale periods, and pricing.',
				enabled: true,
				forced: false,
				...meta,
			},
		},
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
}

beforeEach( () => {
	setTicketingMeta();
	loadStoredTicketing.mockResolvedValue( true );
	saveTicketing.mockImplementation( ( value ) => Promise.resolve( value ) );
	loadGeneralSettings.mockResolvedValue( { ...baseSettings } );
	saveSettings.mockResolvedValue( {} );
	// Component fetches /wp/v2/types alongside the settings on mount.
	apiFetch.mockResolvedValue( {} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const branding = () =>
	screen.getByRole( 'checkbox', {
		name: /Powered by Fair Event Plugins/i,
	} );

test( 'renders the branding toggle, off by default', async () => {
	render( <GeneralTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( branding() ).toBeInTheDocument() );
	expect( branding() ).not.toBeChecked();
} );

test( 'toggling the branding setting and saving sends the new value', async () => {
	render( <GeneralTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( branding() ).toBeInTheDocument() );

	fireEvent.click( branding() );
	expect( branding() ).toBeChecked();

	fireEvent.click( screen.getByRole( 'button', { name: /Save Settings/i } ) );

	await waitFor( () => expect( saveSettings ).toHaveBeenCalledTimes( 1 ) );
	expect( saveSettings ).toHaveBeenCalledWith(
		expect.objectContaining( { fair_events_powered_by_branding: true } )
	);
} );

// Notice also announces its text in a hidden live region, so match the
// visible notice content.
const findNotice = ( text ) =>
	screen.findByText( text, {
		selector: '.components-notice__content, .components-notice__content *',
	} );

const ticketingToggle = () =>
	screen.getByRole( 'checkbox', { name: 'Enable ticketing' } );
const saveTicketingButton = () =>
	screen.getByRole( 'button', { name: 'Save Ticketing' } );

async function renderWithTicketing() {
	render( <GeneralTab onNotice={ jest.fn() } /> );
	await waitFor( () => expect( ticketingToggle() ).toBeInTheDocument() );
}

describe( 'Ticketing', () => {
	test.each( [
		[ 'saved on', true, true, true ],
		[ 'saved off', false, true, false ],
		[ 'missing, resolved on', null, true, true ],
		[ 'missing, resolved off', null, false, false ],
	] )(
		'shows the value when %s',
		async ( _label, stored, resolved, expected ) => {
			setTicketingMeta( { enabled: resolved } );
			loadStoredTicketing.mockResolvedValue( stored );

			await renderWithTicketing();

			if ( expected ) {
				expect( ticketingToggle() ).toBeChecked();
			} else {
				expect( ticketingToggle() ).not.toBeChecked();
			}
			expect(
				screen.getByText( 'Ticket types, sale periods, and pricing.' )
			).toBeInTheDocument();
		}
	);

	test( 'saves only Ticketing, independently of the General form', async () => {
		await renderWithTicketing();

		fireEvent.click( ticketingToggle() );
		expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( saveTicketingButton() );
		} );

		expect( saveTicketing ).toHaveBeenCalledTimes( 1 );
		expect( saveTicketing ).toHaveBeenCalledWith( false );
		expect( saveSettings ).not.toHaveBeenCalled();
		expect(
			await findNotice( /Ticketing saved\. Reload the page/ )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Unsaved changes' ) ).toBeNull();
		expect( ticketingToggle() ).not.toBeChecked();
	} );

	test( 'the General save does not write Ticketing', async () => {
		await renderWithTicketing();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: /Save Settings/i } )
			);
		} );

		expect( saveSettings ).toHaveBeenCalledTimes( 1 );
		expect( saveSettings.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty(
			'fair_events_features'
		);
		expect( saveTicketing ).not.toHaveBeenCalled();
	} );

	test( 'shows pending feedback and ignores a second click', async () => {
		const pending = deferred();
		saveTicketing.mockReturnValue( pending.promise );
		await renderWithTicketing();

		fireEvent.click( ticketingToggle() );
		fireEvent.click( saveTicketingButton() );

		const busy = screen.getByRole( 'button', { name: 'Saving...' } );
		expect( busy ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( ticketingToggle() ).toBeDisabled();
		fireEvent.click( busy );
		expect( saveTicketing ).toHaveBeenCalledTimes( 1 );

		await act( async () => {
			pending.resolve( false );
		} );
		expect( saveTicketingButton() ).toBeInTheDocument();
	} );

	test( 'keeps the draft and explains a failed save', async () => {
		saveTicketing.mockRejectedValue( new Error( 'nope' ) );
		await renderWithTicketing();

		fireEvent.click( ticketingToggle() );
		await act( async () => {
			fireEvent.click( saveTicketingButton() );
		} );

		expect(
			await findNotice( /Ticketing could not be saved/ )
		).toBeInTheDocument();
		expect( ticketingToggle() ).not.toBeChecked();
		expect( ticketingToggle() ).not.toBeDisabled();
		expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	} );

	test( 'offers no save until the setting loads', async () => {
		loadStoredTicketing.mockRejectedValueOnce( new Error( 'offline' ) );
		render( <GeneralTab onNotice={ jest.fn() } /> );

		expect(
			await findNotice( 'The Ticketing setting could not be loaded.' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save Ticketing' } )
		).toBeNull();
		expect(
			screen.queryByRole( 'checkbox', { name: 'Enable ticketing' } )
		).toBeNull();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );
		expect( ticketingToggle() ).toBeChecked();
	} );

	test( 'warns before leaving with unsaved Ticketing changes', async () => {
		await renderWithTicketing();

		const before = new Event( 'beforeunload', { cancelable: true } );
		window.dispatchEvent( before );
		expect( before.defaultPrevented ).toBe( false );

		fireEvent.click( ticketingToggle() );
		const dirty = new Event( 'beforeunload', { cancelable: true } );
		window.dispatchEvent( dirty );
		expect( dirty.defaultPrevented ).toBe( true );
	} );

	test.each( [
		[ true, false, 'Ticketing is on.' ],
		[ false, true, 'Ticketing is off.' ],
	] )(
		'forced %p with stored %p shows the effective value read-only',
		async ( effective, stored, text ) => {
			setTicketingMeta( { enabled: effective, forced: true } );
			loadStoredTicketing.mockResolvedValue( stored );
			render( <GeneralTab onNotice={ jest.fn() } /> );

			expect( await screen.findByText( text ) ).toBeInTheDocument();
			expect(
				screen.getByText(
					/Your site configuration manages this setting/
				)
			).toBeInTheDocument();
			expect(
				screen.queryByRole( 'checkbox', { name: 'Enable ticketing' } )
			).toBeNull();
			expect(
				screen.queryByRole( 'button', { name: 'Save Ticketing' } )
			).toBeNull();
			expect( loadStoredTicketing ).not.toHaveBeenCalled();
			expect( saveTicketing ).not.toHaveBeenCalled();
		}
	);
} );
