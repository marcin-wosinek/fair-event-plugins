/**
 * Tests for the Images tab model (#2397).
 */
import {
	addAttachments,
	canMarkFocalRegion,
	circleStyle,
	clampCircle,
	isDirty,
	listFromResponse,
	moveEntry,
	toPayload,
} from '../imagesModel.js';

const image = ( overrides = {} ) => ( {
	id: 1,
	attachmentId: 10,
	available: true,
	unavailableReason: null,
	sourceUrl: 'https://example.test/a.jpg',
	width: 400,
	height: 100,
	sourceRevision: 'rev',
	title: 'A',
	altText: null,
	focalRegion: null,
	focalRegionNeedsReview: false,
	...overrides,
} );

describe( 'imagesModel', () => {
	test( 'a loaded list is clean; edits make it dirty', () => {
		const list = listFromResponse( {
			revision: 'r1',
			images: [ image() ],
		} );
		expect( isDirty( list ) ).toBe( false );
		const edited = {
			...list,
			entries: [
				{
					...list.entries[ 0 ],
					focalRegion: { centerX: 0.5, centerY: 0.5, radius: 0.2 },
				},
			],
		};
		expect( isDirty( edited ) ).toBe( true );
	} );

	test( 'the payload keeps IDs, sends explicit null circles and rounds radii down', () => {
		const list = listFromResponse( {
			revision: 'r1',
			images: [
				image(),
				image( {
					id: 2,
					attachmentId: 11,
					focalRegion: {
						centerX: 0.1234567,
						centerY: 0.5,
						radius: 0.1999999999,
					},
				} ),
			],
		} );
		const added = addAttachments(
			list.entries,
			[ { id: 12, mime: 'image/png', url: 'u', title: 'New' } ],
			[ 'image/png' ]
		).entries;
		expect( toPayload( { ...list, entries: added } ) ).toEqual( {
			revision: 'r1',
			images: [
				{
					id: 1,
					attachmentId: 10,
					focalRegion: null,
					sourceRevision: 'rev',
				},
				{
					id: 2,
					attachmentId: 11,
					focalRegion: {
						centerX: 0.123457,
						centerY: 0.5,
						radius: 0.199999,
					},
					sourceRevision: 'rev',
				},
				{
					attachmentId: 12,
					focalRegion: null,
					sourceRevision: null,
				},
			],
		} );
	} );

	test( 'adding skips duplicates and unsupported files', () => {
		const result = addAttachments(
			[ image() ],
			[
				{ id: 10, mime: 'image/jpeg' },
				{ id: 20, mime: 'application/pdf' },
				{ id: 21, mime: 'image/jpeg' },
				{ id: 21, mime: 'image/jpeg' },
			],
			[ 'image/jpeg' ]
		);
		expect( result.entries.map( ( e ) => e.attachmentId ) ).toEqual( [
			10, 21,
		] );
		expect( result.duplicates ).toHaveLength( 2 );
		expect( result.unsupported ).toHaveLength( 1 );
		// A new image has no circle and cannot get one before it is saved.
		expect( result.entries[ 1 ].focalRegion ).toBeNull();
		expect( canMarkFocalRegion( result.entries[ 1 ] ) ).toBe( false );
	} );

	test( 'moving stays within the list', () => {
		const entries = [ { key: 'a' }, { key: 'b' }, { key: 'c' } ];
		expect( moveEntry( entries, 0, 1 ).map( ( e ) => e.key ) ).toEqual( [
			'b',
			'a',
			'c',
		] );
		expect( moveEntry( entries, 0, -1 ) ).toBe( entries );
		expect( moveEntry( entries, 2, 1 ) ).toBe( entries );
	} );

	test( 'circles are clamped inside the image by the shorter side', () => {
		// 400 × 100: radius 0.5 is 50 px; centre must stay 50 px from edges.
		expect(
			clampCircle( { centerX: 0, centerY: 0, radius: 0.9 }, 400, 100 )
		).toEqual( { centerX: 0.125, centerY: 0.5, radius: 0.5 } );
		expect(
			clampCircle( { centerX: 0.5, centerY: 0.5, radius: 0 }, 400, 100 )
				.radius
		).toBe( 0.02 );
	} );

	test( 'circle style is relative to the displayed box', () => {
		expect(
			circleStyle(
				{ centerX: 0.25, centerY: 0.5, radius: 0.5 },
				400,
				100
			)
		).toEqual( {
			left: '25%',
			top: '50%',
			width: '25%',
			height: '100%',
		} );
	} );

	test( 'only saved, available images of known size take a circle', () => {
		expect( canMarkFocalRegion( image() ) ).toBe( true );
		expect( canMarkFocalRegion( image( { width: null } ) ) ).toBe( false );
		expect( canMarkFocalRegion( image( { available: false } ) ) ).toBe(
			false
		);
		expect( canMarkFocalRegion( image( { id: null } ) ) ).toBe( false );
	} );
} );
