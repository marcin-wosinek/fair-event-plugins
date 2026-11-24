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
	outcomeLabel,
} from '../SaleAlertsSection.js';

jest.mock( '@wordpress/api-fetch' );

configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

const STUDIO = '0f5e6a3c-1d2b-4c3d-8e9f-0a1b2c3d4e5f';

function payload( overrides = {} ) {
	return {
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
		settings_url: '/wp-admin/admin.php?page=fair-events-organizers',
		timezone: 'Europe/Madrid',
		recent: [],
		...overrides,
	};
}

function sending( organizers = [ STUDIO ] ) {
	return payload().organizers.map( ( organizer ) =>
		organizers.includes( organizer.id )
			? {
					...organizer,
					settings: { enabled: true, chat_id: '@studio_sales' },
				}
			: organizer
	);
}

async function renderSection( initial = payload() ) {
	apiFetch.mockResolvedValueOnce( initial );
	render( <SaleAlertsSection /> );
	await screen.findByText( /Recent ticket sale alerts/, {
		selector: 'h3',
	} );
}

afterEach( () => {
	apiFetch.mockReset();
} );

describe( 'SaleAlertsSection', () => {
	it( 'has no editable settings and links to the organizers', async () => {
		await renderSection();

		expect( apiFetch ).toHaveBeenCalledWith( { path: SALE_ALERTS_PATH } );
		expect( screen.queryByRole( 'checkbox' ) ).toBeNull();
		expect( screen.queryByRole( 'textbox' ) ).toBeNull();
		expect( screen.queryByRole( 'button' ) ).toBeNull();
		expect(
			screen.getByText( /No organizer sends its sales to Telegram yet\./ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: 'Set up each organizer’s chat or channel, schedule and switch on the Organizers page',
			} )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-organizers'
		);
		expect(
			screen.getByText( /No ticket sale alert yet/ )
		).toBeInTheDocument();
	} );

	it( 'names the organizers sending and those without a chat', async () => {
		await renderSection( payload( { organizers: sending() } ) );

		expect(
			screen.getByText( /Sending the sales of: Studio\./ )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'These organizers have no chat or channel, so their sales are not sent: Fair Site.'
			)
		).toBeInTheDocument();
	} );

	it( 'links to Settings while organizer management is off', async () => {
		await renderSection(
			payload( {
				organizer_resolution_available: false,
				settings_url:
					'/wp-admin/admin.php?page=fair-events-settings&tab=organizer',
			} )
		);

		expect(
			screen.getByRole( 'link', {
				name: 'Set up the organizer’s chat or channel, schedule and switch in Settings → Organizer',
			} )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-settings&tab=organizer'
		);
		expect(
			screen.getByText( /Organizer management is off/ )
		).toBeInTheDocument();
	} );

	it( 'warns about the bot token while an organizer is sending', async () => {
		await renderSection(
			payload( {
				organizers: sending(),
				credential_problem: 'No Telegram bot token is configured.',
			} )
		);

		expect(
			screen.getByText( /No Telegram bot token is configured\./ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Open Connectors' } )
		).toHaveAttribute( 'href', '/wp-admin/options-connectors.php' );
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

	it( 'offers a retry when the alerts cannot be loaded', async () => {
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
			screen.getByText( /No ticket sale alert yet/ )
		).toBeInTheDocument();
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
