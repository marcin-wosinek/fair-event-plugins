/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	configure,
	fireEvent,
	render,
	screen,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SaleAlertCard, {
	SALE_ALERTS_PATH,
	SALE_ALERTS_TEST_PATH,
	deliveryText,
	draftErrors,
} from '../SaleAlertCard.js';

jest.mock( '@wordpress/api-fetch' );

configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

const STUDIO = '0f5e6a3c-1d2b-4c3d-8e9f-0a1b2c3d4e5f';

function settings( overrides = {} ) {
	return {
		enabled: false,
		chat_id: '',
		frequency: 'immediate',
		time_of_day: '08:00',
		day_of_week: 1,
		...overrides,
	};
}

function payload( studio = {}, overrides = {} ) {
	return {
		organizers: [
			{
				id: 'default',
				name: 'Fair Site',
				sitewide: true,
				settings: settings( {
					enabled: true,
					chat_id: '-1001234567890',
				} ),
				next_digest: null,
				pending: 0,
			},
			{
				id: STUDIO,
				name: 'Studio',
				sitewide: false,
				settings: settings(),
				next_digest: null,
				pending: 0,
				...studio,
			},
		],
		organizer_resolution_available: true,
		credential_problem: '',
		connectors_url: '/wp-admin/options-connectors.php',
		notifications_url:
			'/wp-admin/admin.php?page=fair-events-event-notifications',
		settings_url: '/wp-admin/admin.php?page=fair-events-organizers',
		timezone: 'Europe/Madrid',
		recent: [],
		...overrides,
	};
}

async function renderCard( initial = payload(), organizer = STUDIO ) {
	apiFetch.mockResolvedValueOnce( initial );
	render( <SaleAlertCard organizer={ organizer } /> );
	await screen.findByRole( 'checkbox', {
		name: 'Send this organizer’s sales',
	} );
}

const chatField = () =>
	screen.getByRole( 'textbox', { name: 'Chat or channel' } );
const saveButton = () =>
	screen.getByRole( 'button', { name: 'Save Telegram ticket sales' } );
const testButton = () =>
	screen.getByRole( 'button', { name: 'Send test message' } );

afterEach( () => {
	apiFetch.mockReset();
} );

describe( 'SaleAlertCard', () => {
	it( 'shows only its own organizer, off, with nothing to save', async () => {
		await renderCard();

		expect(
			screen.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		).not.toBeChecked();
		expect( chatField() ).toHaveValue( '' );
		expect( saveButton() ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText(
				'Off: this organizer’s sales are not sent to Telegram.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByDisplayValue( '-1001234567890' )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: 'See recent ticket sale alerts in Event notifications',
			} )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-event-notifications'
		);
	} );

	it( 'edits the sitewide organizer', async () => {
		await renderCard( payload(), 'default' );

		expect( chatField() ).toHaveValue( '-1001234567890' );
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		).toBeChecked();
	} );

	it( 'blocks saving an organizer turned on without a valid chat', async () => {
		await renderCard();

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		);
		expect(
			screen.getByText(
				'Enter a chat or channel before turning the organizer’s alerts on.'
			)
		).toBeInTheDocument();
		expect( saveButton() ).toHaveAttribute( 'aria-disabled', 'true' );

		fireEvent.change( chatField(), {
			target: { value: 'https://t.me/studio' },
		} );
		expect( screen.getByText( /Enter one chat ID/ ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'Unsaved changes: correct the highlighted fields first.'
			)
		).toBeInTheDocument();
	} );

	it( 'saves only this organizer, once, with a trimmed chat', async () => {
		await renderCard();
		apiFetch.mockResolvedValueOnce(
			payload( {
				settings: settings( {
					enabled: true,
					chat_id: '@studio_sales',
				} ),
			} )
		);

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		);
		fireEvent.change( chatField(), {
			target: { value: ' @studio_sales ' },
		} );
		expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( saveButton() );
			fireEvent.click( saveButton() );
		} );

		const puts = apiFetch.mock.calls.filter(
			( [ options ] ) => 'PUT' === options.method
		);
		expect( puts ).toHaveLength( 1 );
		expect( puts[ 0 ][ 0 ] ).toEqual( {
			path: SALE_ALERTS_PATH,
			method: 'PUT',
			data: {
				organizers: {
					[ STUDIO ]: settings( {
						enabled: true,
						chat_id: '@studio_sales',
					} ),
				},
			},
		} );
		expect(
			await screen.findByText( 'Telegram ticket sales saved.' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Unsaved changes' ) ).toBeNull();
		expect(
			screen.getByText(
				'Each sale is sent as soon as its payment is confirmed.'
			)
		).toBeInTheDocument();
	} );

	it( 'keeps the edits and shows the server’s field message when saving fails', async () => {
		await renderCard();
		apiFetch.mockRejectedValueOnce( {
			message: 'Enter one chat ID.',
			data: {
				params: {
					[ `organizers.${ STUDIO }.chat_id` ]:
						'Chat rejected by the server.',
				},
			},
		} );
		fireEvent.change( chatField(), {
			target: { value: '@studio_sales' },
		} );
		await act( async () => {
			fireEvent.click( saveButton() );
		} );

		expect(
			screen.getByText( 'Chat rejected by the server.' )
		).toBeInTheDocument();
		expect( chatField() ).toHaveValue( '@studio_sales' );
		expect( screen.getByText( 'Enter one chat ID.' ) ).toBeInTheDocument();
	} );

	it( 'tests the unsaved chat while alerts are off, without saving', async () => {
		await renderCard();
		let answer;
		apiFetch.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				answer = resolve;
			} )
		);

		expect( testButton() ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Enter a valid chat or channel to test it.' )
		).toBeInTheDocument();

		fireEvent.change( chatField(), {
			target: { value: ' @studio_sales ' },
		} );
		await act( async () => {
			fireEvent.click( testButton() );
		} );

		const pending = screen.getByRole( 'button', {
			name: 'Sending test…',
		} );
		expect( pending ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( pending );

		await act( async () => {
			answer( { sent: true } );
		} );

		const calls = apiFetch.mock.calls.slice( 1 );
		expect( calls ).toEqual( [
			[
				{
					path: SALE_ALERTS_TEST_PATH,
					method: 'POST',
					data: { chat_id: '@studio_sales' },
				},
			],
		] );
		expect(
			screen.getByText(
				'Test message sent to @studio_sales. Check that it arrived. Nothing was saved.'
			)
		).toBeInTheDocument();
		// The settings stay as edited and unsaved.
		expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		).not.toBeChecked();

		// A result describes the chat it was sent to only.
		fireEvent.change( chatField(), {
			target: { value: '@other_chat' },
		} );
		expect(
			screen.queryByText( /Test message sent to/ )
		).not.toBeInTheDocument();
	} );

	it( 'shows Telegram’s refusal beside the field', async () => {
		await renderCard();
		apiFetch.mockRejectedValueOnce( {
			code: 'fair_events_telegram_refused',
			message:
				'Telegram refused the test message (Bad Request: chat not found).',
		} );

		fireEvent.change( chatField(), {
			target: { value: '@missing_chat' },
		} );
		await act( async () => {
			fireEvent.click( testButton() );
		} );

		expect(
			screen.getByText(
				'Telegram refused the test message (Bad Request: chat not found).'
			)
		).toBeInTheDocument();
		expect( chatField() ).toHaveValue( '@missing_chat' );
		expect( testButton() ).not.toHaveAttribute( 'aria-disabled' );
	} );

	it( 'links a missing bot token to Connectors', async () => {
		await renderCard(
			payload(
				{},
				{
					credential_problem: 'No Telegram bot token is configured.',
				}
			)
		);
		apiFetch.mockRejectedValueOnce( {
			code: 'fair_events_telegram_credential',
			message: 'No Telegram bot token is configured.',
			data: { connectors_url: '/wp-admin/options-connectors.php' },
		} );

		fireEvent.change( chatField(), {
			target: { value: '-1001' },
		} );
		await act( async () => {
			fireEvent.click( testButton() );
		} );

		expect(
			screen.getAllByRole( 'link', { name: 'Open Connectors' } )
		).toHaveLength( 2 );
		expect(
			screen.getAllByText( /No Telegram bot token is configured\./ )
		).toHaveLength( 2 );
	} );

	it( 'saves a weekly digest with its weekday and time, then shows the next digest', async () => {
		await renderCard();
		apiFetch.mockResolvedValueOnce(
			payload( {
				settings: settings( {
					enabled: true,
					chat_id: '@studio_sales',
					frequency: 'weekly',
					time_of_day: '18:30',
					day_of_week: 5,
				} ),
				next_digest: '2026-11-27T17:30:00+00:00',
				pending: 2,
			} )
		);

		expect( screen.queryByLabelText( 'Delivery time' ) ).toBeNull();
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		);
		fireEvent.change( chatField(), {
			target: { value: '@studio_sales' },
		} );
		fireEvent.change(
			screen.getByRole( 'combobox', { name: 'How often' } ),
			{ target: { value: 'weekly' } }
		);
		fireEvent.change( screen.getByRole( 'combobox', { name: 'Weekday' } ), {
			target: { value: '5' },
		} );
		fireEvent.change( screen.getByLabelText( 'Delivery time' ), {
			target: { value: '18:30' },
		} );
		expect(
			screen.getByText( /Save to see when this organizer’s sales/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'In the site’s timezone (Europe/Madrid).' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( saveButton() );
		} );

		const put = apiFetch.mock.calls.find(
			( [ options ] ) => 'PUT' === options.method
		)[ 0 ];
		expect( put.data.organizers[ STUDIO ] ).toEqual(
			settings( {
				enabled: true,
				chat_id: '@studio_sales',
				frequency: 'weekly',
				time_of_day: '18:30',
				day_of_week: 5,
			} )
		);
		expect(
			await screen.findByText(
				/^Next digest: .+ \(Europe\/Madrid\)\. 2 sales are waiting for it\. Days without sales send nothing\.$/
			)
		).toBeInTheDocument();
	} );

	it( 'blocks saving a digest without a delivery time', async () => {
		await renderCard();

		fireEvent.change(
			screen.getByRole( 'combobox', { name: 'How often' } ),
			{ target: { value: 'daily' } }
		);
		fireEvent.change( screen.getByLabelText( 'Delivery time' ), {
			target: { value: '' },
		} );

		expect(
			screen.getByText(
				'Enter the delivery time as hours and minutes, for example 08:00.'
			)
		).toBeInTheDocument();
		expect( saveButton() ).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'explains an organizer that is not listed', async () => {
		apiFetch.mockResolvedValueOnce( payload() );
		render( <SaleAlertCard organizer="missing" /> );

		expect(
			await screen.findByText( /can be set up once organizer management/ )
		).toBeInTheDocument();
	} );

	it( 'offers a retry when the settings cannot be loaded', async () => {
		apiFetch.mockRejectedValueOnce( { message: 'Sorry, not allowed.' } );
		apiFetch.mockResolvedValueOnce( payload() );
		render( <SaleAlertCard organizer={ STUDIO } /> );

		expect(
			await screen.findByText( 'Sorry, not allowed.' )
		).toBeInTheDocument();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );
		expect( chatField() ).toBeInTheDocument();
	} );
} );

describe( 'draftErrors', () => {
	it( 'accepts chat IDs and channel names, and an empty chat while off', () => {
		expect(
			draftErrors( settings( { enabled: true, chat_id: '-100123' } ) )
		).toEqual( {} );
		expect(
			draftErrors( settings( { enabled: true, chat_id: '@fair_chan' } ) )
		).toEqual( {} );
		expect( draftErrors( settings() ) ).toEqual( {} );
	} );
} );

describe( 'deliveryText', () => {
	it( 'explains a digest that is not scheduled', () => {
		expect(
			deliveryText(
				{
					settings: { enabled: true, frequency: 'daily' },
					next_digest: null,
					pending: 1,
				},
				'Y-m-d H:i',
				'Europe/Madrid'
			)
		).toBe(
			'No digest is scheduled yet. Sales already waiting are kept for the next digest. 1 sale is waiting for it.'
		);
	} );
} );
