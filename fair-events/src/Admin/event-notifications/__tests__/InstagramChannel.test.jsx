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
import InstagramChannel from '../InstagramChannel.js';
import { audienceSummary, integrationProblem } from '../NotificationList.js';
import { reasonLabel } from '../historyFormat.js';
import { isPostLink } from '../ExecutionDetails.js';

jest.mock( '@wordpress/api-fetch' );

configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

const PATH = '/fair-events/v1/event-notifications';

function instagram( overrides ) {
	return {
		id: 'ig-1',
		type: 'instagram',
		name: '',
		state: 'active',
		state_message: '',
		enabled: false,
		source_slug: 'city',
		page_id: 12,
		day_of_week: 5,
		time_of_day: '10:30',
		week_scope: 'next',
		account: {
			usable: true,
			user_id: '1784',
			username: 'fair_demo',
			message: '',
			settings_url:
				'https://example.test/wp-admin/admin.php?page=fair-events-instagram',
		},
		configuration_error: null,
		next_run: null,
		publishing: [],
		runs: [],
		...overrides,
	};
}

const SOURCES = [ { slug: 'city', name: 'City events' } ];
const PAGES = [ { id: 12, title: 'Calendar' } ];

function renderChannel( channel, onSaved = jest.fn() ) {
	return render(
		<InstagramChannel
			channel={ channel }
			sources={ SOURCES }
			pages={ PAGES }
			onSaved={ onSaved }
		/>
	);
}

afterEach( () => {
	apiFetch.mockReset();
} );

describe( 'InstagramChannel', () => {
	it( 'names the account and says that turning it on posts publicly', () => {
		renderChannel( instagram() );

		expect(
			screen.getByText( /Posts are published to @fair_demo\./ )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/lets this site publish a public post to @fair_demo every week/
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: /Manage in Fair Events → Instagram/,
			} )
		).toHaveAttribute(
			'href',
			'https://example.test/wp-admin/admin.php?page=fair-events-instagram'
		);
	} );

	it( 'offers a preview and no test post', () => {
		renderChannel( instagram() );

		expect(
			screen.getByRole( 'button', {
				name: 'Preview next Instagram post',
			} )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /test/i } )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /There is no test post/ )
		).toBeInTheDocument();
	} );

	it( 'shows the previewed image and caption', async () => {
		apiFetch.mockResolvedValueOnce( {
			week_title: '14 – 20 Sep 2026',
			occurrence_count: 2,
			caption: 'Calendar\n• Mon, 18:00, Juggling',
			image: 'data:image/jpeg;base64,AAAA',
			width: 1080,
			height: 1350,
		} );
		renderChannel( instagram() );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Preview next Instagram post',
				} )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: `${ PATH }/configurations/ig-1/preview`,
		} );
		expect(
			screen.getByRole( 'img', {
				name: 'Instagram image listing the events of 14 – 20 Sep 2026',
			} )
		).toHaveAttribute( 'src', 'data:image/jpeg;base64,AAAA' );
		expect(
			screen.getByRole( 'group', { name: 'Instagram caption' } )
		).toHaveTextContent( 'Juggling' );
		expect( screen.getByText( /was not published/ ) ).toBeInTheDocument();
	} );

	it( 'shows why a preview cannot be built', async () => {
		apiFetch.mockRejectedValueOnce( {
			message: 'The week’s 40 events do not fit readably.',
		} );
		renderChannel( instagram() );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Preview next Instagram post',
				} )
			);
		} );

		expect(
			screen.getByText( 'The week’s 40 events do not fit readably.' )
		).toBeInTheDocument();
	} );

	it( 'saves the schedule to its own configuration', async () => {
		const onSaved = jest.fn();
		apiFetch.mockResolvedValueOnce( instagram( { enabled: true } ) );
		renderChannel( instagram(), onSaved );

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Publish the weekly post to Instagram automatically',
			} )
		);
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Save Instagram settings',
				} )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: `${ PATH }/configurations/ig-1`,
				method: 'POST',
				data: expect.objectContaining( {
					enabled: true,
					source_slug: 'city',
					day_of_week: 5,
					time_of_day: '10:30',
					week_scope: 'next',
				} ),
			} )
		);
		expect( onSaved ).toHaveBeenCalledWith(
			'ig-1',
			expect.objectContaining( { enabled: true } )
		);
	} );

	it( 'warns when the connection cannot be used', () => {
		const channel = instagram( {
			account: {
				usable: false,
				user_id: '',
				username: '',
				message:
					'Instagram needs to be reconnected: the access token has expired.',
				settings_url: '/wp-admin/admin.php?page=fair-events-instagram',
			},
		} );
		renderChannel( channel );

		expect(
			screen.getByText( /the access token has expired/ )
		).toBeInTheDocument();
		expect( integrationProblem( channel ) ).toBe(
			'Instagram needs to be reconnected: the access token has expired.'
		);
	} );

	it( 'shows only the reason while Instagram posting is unavailable', () => {
		renderChannel(
			instagram( {
				state: 'instagram_unavailable',
				state_message: 'Instagram posts are paused.',
				account: null,
			} )
		);

		expect(
			screen.getByText( 'Instagram posts are paused.' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Save Instagram settings',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'links the latest published post', () => {
		renderChannel(
			instagram( {
				runs: [
					{
						week_start: '2026-09-14',
						week_title: '14 – 20 Sep 2026',
						status: 'sent',
						message: 'Published on Instagram.',
						permalink: 'https://www.instagram.com/p/ABC/',
					},
				],
			} )
		);

		expect(
			screen.getByRole( 'link', { name: /View the post/ } )
		).toHaveAttribute( 'href', 'https://www.instagram.com/p/ABC/' );
	} );
} );

describe( 'Instagram in the list and history', () => {
	it( 'summarizes the account it posts to', () => {
		expect( audienceSummary( instagram() ) ).toBe( '@fair_demo' );
	} );

	it( 'explains Instagram failures in the history', () => {
		expect( reasonLabel( 'instagram_publish_uncertain' ) ).toMatch(
			/never posted twice/
		);
		expect( reasonLabel( 'instagram_account_changed' ) ).toMatch(
			/Nothing was published/
		);
	} );

	it( 'recognizes only Instagram post links', () => {
		expect( isPostLink( 'https://www.instagram.com/p/ABC/' ) ).toBe( true );
		expect( isPostLink( 'javascript:alert(1)' ) ).toBe( false );
		expect( isPostLink( 'Ada Lovelace' ) ).toBe( false );
	} );
} );
