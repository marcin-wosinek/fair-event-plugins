/**
 * @jest-environment jsdom
 *
 * Tests for the Images tab of Manage Event (#2397): registration, ordering
 * and unlinking, marking, moving, resizing and removing a focal circle,
 * the payload of a scoped save, a failed save that keeps the edits, the
 * Media Library picker, drafts kept across a tab switch and a series
 * occurrence shown read-only.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	act,
} from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import EventImages from '../EventImages.js';
import '../index.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../images.css', () => ( {} ), { virtual: true } );

// jsdom has no PointerEvent; without it fireEvent drops clientX/clientY.
if ( typeof window.PointerEvent === 'undefined' ) {
	window.PointerEvent = class PointerEvent extends window.MouseEvent {
		constructor( type, init = {} ) {
			super( type, init );
			this.pointerId = init.pointerId ?? 1;
		}
	};
}

const image = ( id, attachmentId, overrides = {} ) => ( {
	id,
	position: 0,
	attachmentId,
	available: true,
	unavailableReason: null,
	sourceUrl: `https://example.test/${ attachmentId }.jpg`,
	width: 400,
	height: 200,
	sourceRevision: `rev-${ attachmentId }`,
	altText: null,
	credit: null,
	title: `Photo ${ attachmentId }`,
	focalRegion: null,
	focalRegionNeedsReview: false,
	...overrides,
} );

const payload = ( overrides = {} ) => ( {
	eventDateId: 7,
	ownerEventDateId: 7,
	readOnly: false,
	ownerEditUrl: null,
	scheduleAvailable: true,
	event: {
		revision: 'r-event',
		images: [ image( 1, 101 ), image( 2, 102 ) ],
	},
	scheduleItems: [
		{
			scheduleItemId: 31,
			title: 'Acro workshop',
			ticketOptionId: 5,
			startDatetime: '2027-05-15 10:00:00',
			endDatetime: '2027-05-15 11:00:00',
			revision: 'r-31',
			images: [],
		},
	],
	maxImagesPerList: 50,
	supportedMimeTypes: [ 'image/jpeg', 'image/png' ],
	...overrides,
} );

const renderTab = ( props = {} ) => {
	const draftStore = {};
	const handlers = {
		setTabDirty: jest.fn(),
		getTabDraft: jest.fn( ( name ) => draftStore[ name ] ),
		setTabDraft: jest.fn( ( name, draft ) => {
			draftStore[ name ] = draft;
		} ),
	};
	const utils = render(
		<EventImages eventDateId={ 7 } { ...handlers } { ...props } />
	);
	return { ...utils, ...handlers, draftStore };
};

const saveButton = () =>
	screen.getByRole( 'button', { name: 'Save event images' } );

describe( 'EventImages', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		delete window.wp;
	} );

	test( 'registers the Images tab', () => {
		const tabs = applyFilters( 'fairEvents.manageEvent.tabs', [], {
			eventDateId: 7,
		} );
		expect( tabs ).toEqual( [
			expect.objectContaining( {
				name: 'images',
				title: 'Images',
				isVisible: true,
			} ),
		] );
	} );

	test( 'reorders and unlinks, then saves only the event list', async () => {
		apiFetch.mockResolvedValueOnce( payload() );
		const { setTabDirty } = renderTab();
		expect(
			await screen.findByRole( 'heading', { name: '1. Photo 101' } )
		).toBeInTheDocument();
		expect( saveButton() ).toHaveAttribute( 'aria-disabled', 'true' );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Photo 102 up' } )
		);
		expect(
			screen.getByRole( 'heading', { name: '1. Photo 102' } )
		).toBeInTheDocument();
		expect( setTabDirty ).toHaveBeenLastCalledWith( 'images', true );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Unlink Photo 101 (it stays in the Media Library)',
			} )
		);
		expect( screen.queryByText( /Photo 101/ ) ).not.toBeInTheDocument();

		apiFetch.mockResolvedValueOnce(
			payload( {
				event: { revision: 'r2', images: [ image( 2, 102 ) ] },
			} )
		);
		await act( async () => {
			fireEvent.click( saveButton() );
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events-experimental/v1/event-dates/7/images/event',
			method: 'PUT',
			data: {
				revision: 'r-event',
				images: [
					{
						id: 2,
						attachmentId: 102,
						focalRegion: null,
						sourceRevision: 'rev-102',
					},
				],
			},
		} );
		expect(
			await screen.findByText( 'Event images saved.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect( setTabDirty ).toHaveBeenLastCalledWith( 'images', false );
	} );

	test( 'marks, edits with the keyboard sliders, drags and removes a focal circle', async () => {
		apiFetch.mockResolvedValueOnce( payload() );
		renderTab();
		await screen.findByRole( 'heading', { name: '1. Photo 101' } );

		expect( screen.getAllByText( 'No focal region.' ) ).toHaveLength( 2 );
		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Mark focal region' } )[ 0 ]
		);
		const circle = screen.getByTestId( 'focal-circle' );
		// 400 × 200: radius 0.25 of the 200 px side is a 100 px diameter.
		expect( circle ).toHaveStyle( {
			left: '50%',
			top: '50%',
			width: '25%',
			height: '50%',
		} );

		fireEvent.change(
			screen.getByRole( 'spinbutton', {
				name: 'Circle centre, from the left (%)',
			} ),
			{ target: { value: '20' } }
		);
		expect( circle ).toHaveStyle( { left: '20%' } );

		// Clamped: 50 px radius keeps the centre 12.5 % from the left.
		fireEvent.change(
			screen.getByRole( 'spinbutton', {
				name: 'Circle centre, from the left (%)',
			} ),
			{ target: { value: '0' } }
		);
		expect( circle ).toHaveStyle( { left: '12.5%' } );

		// Drag the circle 40 px right in a 400 × 200 preview box.
		const box = circle.parentElement;
		box.getBoundingClientRect = () => ( {
			left: 0,
			top: 0,
			width: 400,
			height: 200,
		} );
		fireEvent.pointerDown( circle, { clientX: 50, clientY: 100 } );
		fireEvent.pointerMove( box, { clientX: 90, clientY: 100 } );
		fireEvent.pointerUp( box );
		expect( circle ).toHaveStyle( { left: '22.5%' } );

		// Resize: the handle 80 px from the centre gives radius 0.4.
		fireEvent.pointerDown( screen.getByTestId( 'focal-handle' ), {
			clientX: 140,
			clientY: 100,
		} );
		fireEvent.pointerMove( box, { clientX: 170, clientY: 100 } );
		fireEvent.pointerUp( box );
		expect( circle ).toHaveStyle( { width: '40%', height: '80%' } );

		apiFetch.mockResolvedValueOnce( payload() );
		await act( async () => {
			fireEvent.click( saveButton() );
		} );
		const sent = apiFetch.mock.calls.at( -1 )[ 0 ].data.images[ 0 ];
		expect( sent.focalRegion ).toEqual( {
			centerX: 0.225,
			centerY: 0.5,
			radius: 0.4,
		} );
		expect( sent.sourceRevision ).toBe( 'rev-101' );
	} );

	test( 'a failed save keeps the edits and shows the server message', async () => {
		apiFetch.mockResolvedValueOnce(
			payload( {
				event: {
					revision: 'r-event',
					images: [
						image( 1, 101, {
							focalRegion: {
								centerX: 0.5,
								centerY: 0.5,
								radius: 0.25,
							},
						} ),
					],
				},
			} )
		);
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Remove focal region' } )
		);
		expect(
			screen.queryByTestId( 'focal-circle' )
		).not.toBeInTheDocument();

		apiFetch.mockRejectedValueOnce( {
			code: 'event_images_revision_mismatch',
			message: 'These images were changed elsewhere.',
			data: { status: 409 },
		} );
		await act( async () => {
			fireEvent.click( saveButton() );
		} );
		expect(
			await screen.findByText( 'These images were changed elsewhere.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect(
			screen.queryByTestId( 'focal-circle' )
		).not.toBeInTheDocument();
		expect( saveButton() ).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );

	test( 'adds images from the Media Library and reports skipped files', async () => {
		const frame = {
			handlers: {},
			on: jest.fn( ( name, cb ) => {
				frame.handlers[ name ] = cb;
			} ),
			open: jest.fn(),
			state: () => ( {
				get: () => ( {
					map: ( fn ) =>
						[
							{
								id: 103,
								mime: 'image/png',
								url: 'u',
								title: 'New',
							},
							{ id: 101, mime: 'image/jpeg' },
							{ id: 104, mime: 'application/pdf' },
						].map( ( a ) => fn( { toJSON: () => a } ) ),
				} ),
			} ),
		};
		window.wp = { media: jest.fn( () => frame ) };
		apiFetch.mockResolvedValueOnce( payload() );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add images' } )
		);
		expect( window.wp.media ).toHaveBeenCalledWith(
			expect.objectContaining( {
				multiple: true,
				library: { type: 'image' },
			} )
		);
		act( () => frame.handlers.select() );

		expect(
			screen.getByRole( 'heading', { name: '3. New' } )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Save this list to mark a focal region on this image.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( /1 file was skipped.*1 image is in this list/, {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );

	test( 'reports a Media Library that cannot open', async () => {
		apiFetch.mockResolvedValueOnce( payload() );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add images' } )
		);
		expect(
			screen.getByText(
				'The Media Library could not be opened. Reload the page and try again.',
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
	} );

	test( 'parks unsaved lists and restores them when the tab opens again', async () => {
		apiFetch.mockResolvedValueOnce( payload() );
		const first = renderTab();
		await screen.findByRole( 'heading', { name: '1. Photo 101' } );
		fireEvent.change(
			screen.getByRole( 'combobox', { name: 'Images for' } ),
			{
				target: { value: 'item:31' },
			}
		);
		expect(
			screen.getByText( 'No images for this programme item yet.' )
		).toBeInTheDocument();
		fireEvent.change(
			screen.getByRole( 'combobox', { name: 'Images for' } ),
			{
				target: { value: 'event' },
			}
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Photo 102 up' } )
		);
		await waitFor( () => expect( first.draftStore.images ).toBeDefined() );
		const draft = first.draftStore.images;
		first.unmount();

		apiFetch.mockResolvedValueOnce( payload() );
		render(
			<EventImages
				eventDateId={ 7 }
				setTabDirty={ jest.fn() }
				getTabDraft={ () => draft }
				setTabDraft={ jest.fn() }
			/>
		);
		expect(
			await screen.findByRole( 'heading', { name: '1. Photo 102' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'option', { name: 'Event images (unsaved)' } )
		).toBeInTheDocument();
	} );

	test( 'a series occurrence is read-only and links to the series', async () => {
		apiFetch.mockResolvedValueOnce(
			payload( {
				readOnly: true,
				eventDateId: 8,
				ownerEditUrl: 'https://example.test/manage?event_date_id=7',
				event: {
					revision: 'r',
					images: [
						image( 1, 101, {
							focalRegion: {
								centerX: 0.5,
								centerY: 0.5,
								radius: 0.25,
							},
						} ),
					],
				},
			} )
		);
		renderTab( { eventDateId: 8 } );
		expect(
			await screen.findByRole( 'link', {
				name: 'Edit images on the series',
			} )
		).toHaveAttribute(
			'href',
			'https://example.test/manage?event_date_id=7'
		);
		expect( screen.getByTestId( 'focal-circle' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save event images' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /Unlink/ } )
		).not.toBeInTheDocument();
	} );

	test( 'an image edited after its circle was marked asks for review', async () => {
		apiFetch.mockResolvedValueOnce(
			payload( {
				event: {
					revision: 'r',
					images: [
						image( 1, 101, { focalRegionNeedsReview: true } ),
						image( 2, 102, {
							available: false,
							unavailableReason: 'trashed',
							sourceUrl: null,
						} ),
					],
				},
			} )
		);
		renderTab();
		expect(
			await screen.findByText(
				/edited in the Media Library after its focal region/,
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( /This image is in the Media Library trash/ )
		).toBeInTheDocument();
	} );
} );
