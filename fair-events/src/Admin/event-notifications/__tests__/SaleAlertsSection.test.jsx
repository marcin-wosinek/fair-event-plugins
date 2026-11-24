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
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SaleAlertsSection, {
	SALE_ALERTS_PATH,
	deliveryText,
	draftErrors,
	outcomeLabel,
} from '../SaleAlertsSection.js';

jest.mock( '@wordpress/api-fetch' );

configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

const STUDIO = '0f5e6a3c-1d2b-4c3d-8e9f-0a1b2c3d4e5f';

function payload( overrides = {} ) {
	return {
		enabled: false,
		organizers: [
			{
				id: 'default',
				name: 'Fair Site',
				sitewide: true,
				settings: { enabled: false, chat_id: '' },
			},
			{
				id: STUDIO,
				name: 'Studio',
				sitewide: false,
				settings: { enabled: false, chat_id: '' },
			},
		],
		organizer_resolution_available: true,
		credential_problem: '',
		connectors_url: '/wp-admin/options-connectors.php',
		timezone: 'Europe/Madrid',
		recent: [],
		...overrides,
	};
}

async function renderSection( initial = payload() ) {
	apiFetch.mockResolvedValueOnce( initial );
	render( <SaleAlertsSection /> );
	await screen.findByRole( 'checkbox', {
		name: 'Send ticket sale alerts to Telegram',
	} );
}

function organizer( name ) {
	return within(
		screen.getByRole( 'heading', { level: 3, name } ).parentElement
	);
}

afterEach( () => {
	apiFetch.mockReset();
} );

describe( 'SaleAlertsSection', () => {
	it( 'starts off with every organizer listed and nothing to save', async () => {
		await renderSection();

		expect(
			screen.getByRole( 'checkbox', {
				name: 'Send ticket sale alerts to Telegram',
			} )
		).not.toBeChecked();
		expect(
			screen.getByRole( 'heading', {
				name: 'Fair Site (sitewide organizer)',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'Studio' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save ticket sale alerts' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( /No ticket sale alert yet/ )
		).toBeInTheDocument();
	} );

	it( 'blocks saving an organizer turned on without a valid chat', async () => {
		await renderSection();
		const studio = organizer( 'Studio' );

		fireEvent.click(
			studio.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		);
		expect(
			studio.getByText(
				'Enter a chat or channel before turning the organizer’s alerts on.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save ticket sale alerts' } )
		).toHaveAttribute( 'aria-disabled', 'true' );

		fireEvent.change(
			studio.getByRole( 'textbox', { name: 'Chat or channel' } ),
			{ target: { value: 'https://t.me/studio' } }
		);
		expect( studio.getByText( /Enter one chat ID/ ) ).toBeInTheDocument();
	} );

	it( 'saves the switches and trimmed chats, then shows the saved state', async () => {
		await renderSection();
		const saved = payload( {
			enabled: true,
			organizers: [
				{
					...payload().organizers[ 0 ],
					settings: { enabled: false, chat_id: '' },
				},
				{
					...payload().organizers[ 1 ],
					settings: { enabled: true, chat_id: '@studio_sales' },
				},
			],
		} );
		apiFetch.mockResolvedValueOnce( saved );

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Send ticket sale alerts to Telegram',
			} )
		);
		const studio = organizer( 'Studio' );
		fireEvent.click(
			studio.getByRole( 'checkbox', {
				name: 'Send this organizer’s sales',
			} )
		);
		fireEvent.change(
			studio.getByRole( 'textbox', { name: 'Chat or channel' } ),
			{ target: { value: ' @studio_sales ' } }
		);
		expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		const save = screen.getByRole( 'button', {
			name: 'Save ticket sale alerts',
		} );
		await act( async () => {
			fireEvent.click( save );
			fireEvent.click( save );
		} );

		const puts = apiFetch.mock.calls.filter(
			( [ options ] ) => 'PUT' === options.method
		);
		expect( puts ).toHaveLength( 1 );
		expect( puts[ 0 ][ 0 ] ).toEqual( {
			path: SALE_ALERTS_PATH,
			method: 'PUT',
			data: {
				enabled: true,
				organizers: {
					default: {
						enabled: false,
						chat_id: '',
						frequency: 'immediate',
						time_of_day: '08:00',
						day_of_week: 1,
					},
					[ STUDIO ]: {
						enabled: true,
						chat_id: '@studio_sales',
						frequency: 'immediate',
						time_of_day: '08:00',
						day_of_week: 1,
					},
				},
			},
		} );
		expect(
			await screen.findByText( 'Ticket sale alerts saved.' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Unsaved changes' ) ).toBeNull();
		// The sitewide organizer has no chat, so its sales are not sent.
		expect(
			screen.getByText(
				'These organizers have no chat or channel, so their sales are not sent: Fair Site.'
			)
		).toBeInTheDocument();
	} );

	it( 'keeps the edits and shows the server’s field message when saving fails', async () => {
		await renderSection();
		apiFetch.mockRejectedValueOnce( {
			message: 'Enter one chat ID.',
			data: {
				params: {
					[ `organizers.${ STUDIO }.chat_id` ]:
						'Chat rejected by the server.',
				},
			},
		} );
		const studio = organizer( 'Studio' );
		fireEvent.change(
			studio.getByRole( 'textbox', { name: 'Chat or channel' } ),
			{ target: { value: '@studio_sales' } }
		);
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Save ticket sale alerts',
				} )
			);
		} );

		expect(
			studio.getByText( 'Chat rejected by the server.' )
		).toBeInTheDocument();
		expect(
			studio.getByRole( 'textbox', { name: 'Chat or channel' } )
		).toHaveValue( '@studio_sales' );
		expect( screen.getByText( 'Enter one chat ID.' ) ).toBeInTheDocument();
	} );

	it( 'warns about the bot token and unavailable organizers', async () => {
		await renderSection(
			payload( {
				enabled: true,
				credential_problem: 'No Telegram bot token is configured.',
				organizer_resolution_available: false,
			} )
		);

		expect(
			screen.getByText( /No Telegram bot token is configured\./ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Open Connectors' } )
		).toHaveAttribute( 'href', '/wp-admin/options-connectors.php' );
		expect(
			screen.getByText( /Organizer management is off/ )
		).toBeInTheDocument();
	} );

	it( 'lists recent outcomes with their meaning', async () => {
		await renderSection(
			payload( {
				recent: [
					{
						id: 2,
						event_id: 5,
						event_title: 'La Mutable',
						organizer_name: 'Studio',
						state: 'failed',
						reason: 'http_400',
						created_at: '2026-05-01T10:00:00+00:00',
						updated_at: '2026-05-01T10:00:01+00:00',
					},
					{
						id: 1,
						event_id: 6,
						event_title: 'Gala',
						organizer_name: '',
						state: 'skipped',
						reason: 'organizer_unavailable',
						created_at: '2026-05-01T09:00:00+00:00',
						updated_at: '2026-05-01T09:00:01+00:00',
					},
				],
			} )
		);

		const table = within(
			screen.getByRole( 'table', { name: 'Recent ticket sale alerts' } )
		);
		// The decoded title keeps its non-breaking space.
		expect( table.getByText( 'La Mutable' ).textContent ).toBe(
			'La\u00A0Mutable'
		);
		expect(
			table.getByText(
				'Failed: Telegram refused the message (error 400)'
			)
		).toBeInTheDocument();
		expect(
			table.getByText(
				'Not sent: the event’s organizer could not be found'
			)
		).toBeInTheDocument();
	} );

	it( 'offers a retry when the settings cannot be loaded', async () => {
		apiFetch.mockRejectedValueOnce( { message: 'Sorry, not allowed.' } );
		apiFetch.mockResolvedValueOnce( payload() );
		render( <SaleAlertsSection /> );

		expect(
			await screen.findByText( 'Sorry, not allowed.' )
		).toBeInTheDocument();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Send ticket sale alerts to Telegram',
			} )
		).toBeInTheDocument();
	} );
} );

describe( 'draftErrors', () => {
	it( 'accepts chat IDs and channel names, and empty chats while off', () => {
		expect(
			draftErrors( {
				enabled: true,
				organizers: {
					a: { enabled: true, chat_id: '-1001234567890' },
					b: { enabled: true, chat_id: '@fair_channel' },
					c: { enabled: false, chat_id: '' },
				},
			} )
		).toEqual( {} );
	} );
} );

describe( 'outcomeLabel', () => {
	it( 'never treats an uncertain outcome as sent', () => {
		expect(
			outcomeLabel( { state: 'uncertain', reason: 'interrupted' } )
		).toEqual( {
			label: 'Outcome unknown: Telegram may have posted it, so it is not resent',
			tone: 'warning',
		} );
		expect(
			outcomeLabel( { state: 'skipped', reason: 'organizer_disabled' } )
				.tone
		).toBe( 'neutral' );
	} );

	it( 'sends existing organizers immediately until a digest is chosen', async () => {
		await renderSection();
		const studio = organizer( 'Studio' );

		expect(
			studio.getByRole( 'combobox', { name: 'How often' } )
		).toHaveValue( 'immediate' );
		expect(
			studio.getByText(
				'Each sale is sent as soon as its payment is confirmed.'
			)
		).toBeInTheDocument();
		expect( studio.queryByLabelText( 'Delivery time' ) ).toBeNull();
		expect( studio.queryByLabelText( 'Weekday' ) ).toBeNull();
	} );

	it( 'saves a weekly digest with its weekday and time, then shows the next digest', async () => {
		await renderSection();
		const saved = payload( {
			organizers: [
				payload().organizers[ 0 ],
				{
					...payload().organizers[ 1 ],
					settings: {
						enabled: false,
						chat_id: '',
						frequency: 'weekly',
						time_of_day: '18:30',
						day_of_week: 5,
					},
					next_digest: '2026-11-27T17:30:00+00:00',
					pending: 2,
				},
			],
		} );
		apiFetch.mockResolvedValueOnce( saved );
		const studio = organizer( 'Studio' );

		fireEvent.change(
			studio.getByRole( 'combobox', { name: 'How often' } ),
			{ target: { value: 'weekly' } }
		);
		fireEvent.change( studio.getByRole( 'combobox', { name: 'Weekday' } ), {
			target: { value: '5' },
		} );
		fireEvent.change( studio.getByLabelText( 'Delivery time' ), {
			target: { value: '18:30' },
		} );
		expect(
			studio.getByText( /Save to see when this organizer’s sales/ )
		).toBeInTheDocument();
		expect(
			studio.getByText( 'In the site’s timezone (Europe/Madrid).' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Save ticket sale alerts',
				} )
			);
		} );

		const put = apiFetch.mock.calls.find(
			( [ options ] ) => 'PUT' === options.method
		)[ 0 ];
		expect( put.data.organizers[ STUDIO ] ).toEqual( {
			enabled: false,
			chat_id: '',
			frequency: 'weekly',
			time_of_day: '18:30',
			day_of_week: 5,
		} );
		expect(
			await studio.findByText(
				/^Next digest: .+ \(Europe\/Madrid\)\. 2 sales are waiting for it\. Days without sales send nothing\.$/
			)
		).toBeInTheDocument();
	} );

	it( 'blocks saving a digest without a delivery time', async () => {
		await renderSection();
		const studio = organizer( 'Studio' );

		fireEvent.change(
			studio.getByRole( 'combobox', { name: 'How often' } ),
			{ target: { value: 'daily' } }
		);
		fireEvent.change( studio.getByLabelText( 'Delivery time' ), {
			target: { value: '' },
		} );

		expect(
			studio.getByText(
				'Enter the delivery time as hours and minutes, for example 08:00.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save ticket sale alerts' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText(
				'Unsaved changes: correct the highlighted fields first.'
			)
		).toBeInTheDocument();
	} );

	it( 'explains a digest that is not scheduled', () => {
		expect(
			deliveryText(
				{
					settings: { frequency: 'daily' },
					next_digest: null,
					pending: 1,
				},
				'Y-m-d H:i',
				'Europe/Madrid'
			)
		).toBe(
			'No digest is scheduled while alerts are off for this organizer or sitewide. Sales already waiting are kept for the next digest. 1 sale is waiting for it.'
		);
	} );

	it( 'labels digest outcomes', () => {
		expect( outcomeLabel( { state: 'pending', reason: '' } ) ).toEqual( {
			label: 'Waiting for the next digest',
			tone: 'info',
		} );
		expect(
			outcomeLabel( { state: 'pending', reason: 'http_403' } )
		).toEqual( {
			label: 'Waiting for the next digest: Telegram refused the last one (error 403)',
			tone: 'warning',
		} );
		expect(
			outcomeLabel( { state: 'sent', reason: '', digest: true } ).label
		).toBe( 'Sent in a digest' );
	} );
} );
