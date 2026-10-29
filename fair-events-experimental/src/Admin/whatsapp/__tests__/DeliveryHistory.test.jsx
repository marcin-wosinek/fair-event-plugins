/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import DeliveryHistory, {
	POLL_INTERVAL,
	POLL_LIMIT,
	outcomeDetails,
	outcomeText,
} from '../DeliveryHistory.js';

jest.mock( '@wordpress/api-fetch' );

const WEBHOOK = { verified_at_local: null, received_at_local: null };

function delivery( overrides ) {
	return {
		id: 1,
		origin: 'admin_test',
		template: { name: 'hello_world', language: 'en_US' },
		recipient: '••••••••123',
		outcome: 'accepted',
		pending: true,
		created_at_local: 'October 29, 2026 9:00 am',
		status_at_local: null,
		failure: null,
		send_error: null,
		...overrides,
	};
}

function answer( items ) {
	return { items, retention_days: 30, webhook: WEBHOOK };
}

/** Let pending promises and the renders they cause settle. */
async function flush() {
	await act( async () => {} );
}

beforeEach( () => {
	apiFetch.mockReset();
	jest.useFakeTimers();
} );

afterEach( () => {
	jest.useRealTimers();
} );

describe( 'outcomeText', () => {
	it( 'never presents acceptance as delivery', () => {
		expect( outcomeText( delivery() ).title ).toBe( 'Accepted' );
		expect( outcomeText( delivery() ).message ).toContain(
			'Waiting for a delivery update'
		);
		expect( outcomeText( delivery( { outcome: 'sent' } ) ).title ).toBe(
			'Sent'
		);
		expect(
			outcomeText( delivery( { outcome: 'delivered' } ) ).title
		).toBe( 'Delivered' );
		expect( outcomeText( delivery( { outcome: 'read' } ) ).title ).toBe(
			'Read'
		);
		expect(
			outcomeText( delivery( { outcome: 'uncertain' } ) ).message
		).toContain( 'It was not retried' );
	} );

	it( 'explains a failure with the translated reason', () => {
		const failed = delivery( {
			outcome: 'failed',
			pending: false,
			failure: {
				code: 131026,
				message: 'WhatsApp could not deliver to this number.',
			},
		} );
		expect( outcomeText( failed ) ).toEqual( {
			title: 'Not delivered',
			message: 'WhatsApp could not deliver to this number.',
		} );
		expect( outcomeDetails( failed ) ).toEqual( [
			'WhatsApp error code: 131026',
		] );
	} );

	it( 'keeps an earlier failure visible after a confirmed delivery', () => {
		const item = delivery( {
			outcome: 'delivered',
			pending: false,
			failure: { code: null, message: 'Not delivered.' },
		} );
		expect( outcomeDetails( item ) ).toEqual( [
			'An earlier update reported a failure: Not delivered.',
		] );
	} );
} );

describe( 'DeliveryHistory', () => {
	it( 'lists sends with the masked recipient and the outcome', async () => {
		const onWebhook = jest.fn();
		apiFetch.mockResolvedValue(
			answer( [
				delivery( {
					id: 2,
					outcome: 'not_accepted',
					pending: false,
					send_error: {
						message: 'The recipient is not allowed.',
						meta_code: 131030,
					},
				} ),
			] )
		);

		render( <DeliveryHistory refreshKey={ 0 } onWebhook={ onWebhook } /> );
		await flush();

		expect( screen.getByText( 'Not accepted' ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'hello_world (en_US) to ••••••••123, sent on October 29, 2026 9:00 am'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( 'WhatsApp error code: 131030' )
		).toBeInTheDocument();
		expect( onWebhook ).toHaveBeenCalledWith( WEBHOOK );
	} );

	it( 'checks again while a message is pending and stops once it is final', async () => {
		apiFetch
			.mockResolvedValueOnce( answer( [ delivery() ] ) )
			.mockResolvedValueOnce(
				answer( [ delivery( { outcome: 'sent' } ) ] )
			)
			.mockResolvedValue(
				answer( [
					delivery( { outcome: 'delivered', pending: false } ),
				] )
			);

		render( <DeliveryHistory refreshKey={ 0 } onWebhook={ () => {} } /> );
		await flush();
		expect( screen.getByText( 'Accepted' ) ).toBeInTheDocument();

		await act( async () => {
			jest.advanceTimersByTime( POLL_INTERVAL );
		} );
		expect( screen.getByText( 'Sent' ) ).toBeInTheDocument();

		await act( async () => {
			jest.advanceTimersByTime( POLL_INTERVAL );
		} );
		expect( screen.getByText( 'Delivered' ) ).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledTimes( 3 );

		await act( async () => {
			jest.advanceTimersByTime( POLL_INTERVAL * 3 );
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'stops polling after the limit and offers a refresh', async () => {
		apiFetch.mockResolvedValue( answer( [ delivery() ] ) );

		render( <DeliveryHistory refreshKey={ 0 } onWebhook={ () => {} } /> );
		await flush();
		for ( let i = 0; i < POLL_LIMIT + 3; i++ ) {
			await act( async () => {
				jest.advanceTimersByTime( POLL_INTERVAL );
			} );
		}

		expect( apiFetch ).toHaveBeenCalledTimes( POLL_LIMIT + 1 );
		expect(
			screen.getByText(
				'Some messages are still waiting for an update. Refresh to check again.'
			)
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Refresh statuses' } )
			);
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( POLL_LIMIT + 2 );
		await act( async () => {
			jest.advanceTimersByTime( POLL_INTERVAL );
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( POLL_LIMIT + 3 );
	} );

	it( 'does not poll while the page is hidden', async () => {
		apiFetch.mockResolvedValue( answer( [ delivery() ] ) );
		const visibility = jest
			.spyOn( document, 'visibilityState', 'get' )
			.mockReturnValue( 'hidden' );

		render( <DeliveryHistory refreshKey={ 0 } onWebhook={ () => {} } /> );
		await flush();
		await act( async () => {
			jest.advanceTimersByTime( POLL_INTERVAL * 3 );
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		visibility.mockReturnValue( 'visible' );
		await act( async () => {
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		visibility.mockRestore();
	} );

	it( 'says when nothing was sent and when loading fails', async () => {
		apiFetch.mockResolvedValueOnce( answer( [] ) );
		const { rerender } = render(
			<DeliveryHistory refreshKey={ 0 } onWebhook={ () => {} } />
		);
		await flush();
		expect(
			screen.getByText( 'No messages sent yet.' )
		).toBeInTheDocument();

		apiFetch.mockRejectedValueOnce( new Error( 'offline' ) );
		rerender( <DeliveryHistory refreshKey={ 1 } onWebhook={ () => {} } /> );
		await flush();
		// Notice repeats its text in the a11y live region.
		expect(
			screen.getAllByText(
				'Failed to load the delivery updates. Refresh to try again.'
			)[ 0 ]
		).toBeInTheDocument();
	} );
} );
