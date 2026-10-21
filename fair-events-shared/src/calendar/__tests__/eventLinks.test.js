/**
 * Tests for event link classification and destinations.
 */
import {
	getEventLinkType,
	getLinkTypeIcon,
	getEventDateId,
	getEventUrl,
} from '../eventLinks.js';

const MANAGE = '/wp-admin/admin.php?page=fair-events-manage-event';

it( 'classifies events by uid and url', () => {
	expect( getEventLinkType( { uid: 'fair_event_7_2@site' } ) ).toBe( 'post' );
	expect(
		getEventLinkType( {
			uid: 'fair_event_7_3@site',
			occurrence_type: 'generated',
		} )
	).toBe( 'instance' );
	expect(
		getEventLinkType( {
			uid: 'standalone_4@site',
			url: 'https://example.com',
		} )
	).toBe( 'external' );
	expect( getEventLinkType( { uid: 'standalone_5@site' } ) ).toBe(
		'unlinked'
	);
} );

it( 'maps link types to icons', () => {
	expect( getLinkTypeIcon( 'post' ) ).toBe( 'dashicons-admin-post' );
	expect( getLinkTypeIcon( 'instance' ) ).toBe( 'dashicons-update' );
	expect( getLinkTypeIcon( 'external' ) ).toBe( 'dashicons-admin-links' );
	expect( getLinkTypeIcon( 'unlinked' ) ).toBe( 'dashicons-editor-unlink' );
} );

it( 'extracts event date IDs', () => {
	expect( getEventDateId( 'standalone_12@site' ) ).toBe( '12' );
	expect( getEventDateId( 'fair_event_7_2@site' ) ).toBe( '2' );
	expect( getEventDateId( 'fair_event_7@site' ) ).toBeNull();
	expect( getEventDateId( 'external-uid@elsewhere' ) ).toBeNull();
} );

it( 'links local events to management when a manage URL is given', () => {
	expect(
		getEventUrl(
			{ uid: 'fair_event_7_2@site', url: 'https://site/event' },
			MANAGE
		)
	).toBe( `${ MANAGE }&event_date_id=2` );
} );

it( 'links to the event destination without a manage URL', () => {
	expect(
		getEventUrl( { uid: 'fair_event_7_2@site', url: 'https://site/event' } )
	).toBe( 'https://site/event' );
	expect(
		getEventUrl(
			{ uid: 'external@feed', url: 'https://example.com' },
			MANAGE
		)
	).toBe( 'https://example.com' );
	expect( getEventUrl( { uid: 'external@feed', url: '' } ) ).toBeNull();
} );
