/**
 * @jest-environment jsdom
 *
 * Tests for the Marketing tab of Manage Event (#2396): registration, the
 * list with its empty, loading-error and image-removed states, creating an
 * asset with exact text, the Media Library picker and its visibility
 * notice, a failed save that keeps the edits, partial updates, deletion
 * named by label, team and schedule links while those features are off,
 * a draft kept across a tab switch, and (#2430) the public page links, the
 * public-content notice and the confirmation that publishes team names.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	act,
	within,
} from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import MarketingAssets from '../MarketingAssets.js';
import '../index.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../marketing-assets.css', () => ( {} ), { virtual: true } );

const BASE = '/fair-events/v1/event-dates/7/marketing-assets';

const options = ( overrides = {} ) => ( {
	event_date_id: 7,
	team: {
		available: true,
		members: [
			{ id: 2, name: 'Ana', surname: 'Ruiz' },
			{ id: 3, name: 'Marek', surname: 'Nowak' },
		],
	},
	schedule: {
		available: true,
		items: [
			{
				id: 31,
				title: 'Acro workshop',
				start_datetime: '2027-05-15 10:00:00',
				end_datetime: '2027-05-15 11:00:00',
			},
		],
	},
	share_url: 'https://example.org/?fair_marketing_assets=7',
	index_url: 'https://example.org/?fair_marketing_assets=all',
	supported_mime_types: [ 'image/jpeg', 'image/png' ],
	max_label_length: 191,
	max_text_length: 10000,
	max_members: 50,
	...overrides,
} );

const asset = ( overrides = {} ) => ( {
	id: 11,
	event_date_id: 7,
	label: 'Instagram post',
	text: 'Line one\n\n  indented 🎉',
	attachment_id: null,
	image: null,
	image_removed: false,
	member_ids: [],
	members: [],
	schedule_item_id: null,
	schedule_item: null,
	created_at: '2026-11-24T10:00:00Z',
	updated_at: '2026-11-24T10:00:00Z',
	...overrides,
} );

const list = ( items ) => ( {
	items,
	total: items.length,
	page: 1,
	per_page: 100,
	total_pages: 1,
} );

/** Answer the tab's two GETs, then whatever `writes` returns. */
const mockApi = ( { opts = options(), items = [], writes } = {} ) => {
	apiFetch.mockImplementation( ( req ) => {
		if ( ! req.method || req.method === 'GET' ) {
			if ( req.path.endsWith( '/options' ) ) {
				return Promise.resolve( opts );
			}
			return Promise.resolve( list( items ) );
		}
		return writes( req );
	} );
};

const renderTab = ( props = {} ) =>
	render(
		<MarketingAssets
			eventDateId={ 7 }
			setTabDirty={ jest.fn() }
			getTabDraft={ () => undefined }
			setTabDraft={ jest.fn() }
			{ ...props }
		/>
	);

const noticeText = ( text ) =>
	screen.findByText( text, { selector: '.components-notice__content' } );

afterEach( () => {
	jest.resetAllMocks();
	delete window.wp;
} );

describe( 'Marketing tab', () => {
	it( 'registers a Marketing tab for every date', () => {
		const tabs = applyFilters( 'fairEvents.manageEvent.tabs', [], {
			eventDateId: 7,
		} );
		const tab = tabs.find( ( t ) => t.name === 'marketing-assets' );
		expect( tab.title ).toBe( 'Marketing' );
		expect( tab.isVisible ).toBe( true );
	} );

	it( 'shows the empty state', async () => {
		mockApi();
		renderTab();
		expect(
			await screen.findByText( /No marketing assets for this date yet/ )
		).toBeInTheDocument();
	} );

	it( 'shows a load error with a retry', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'Boom' ) );
		apiFetch.mockResolvedValueOnce( list( [] ) );
		renderTab();
		expect(
			await screen.findByText( /Boom/, {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();

		mockApi( { items: [ asset() ] } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect(
			await screen.findByRole( 'heading', { name: 'Instagram post' } )
		).toBeInTheDocument();
	} );

	it( 'lists assets with their text exactly as stored and their links', async () => {
		mockApi( {
			items: [
				asset( {
					members: [
						{ id: 2, name: 'Ana', surname: 'Ruiz', public: true },
					],
					member_ids: [ 2 ],
					schedule_item_id: 31,
					schedule_item: { id: 31, title: 'Acro workshop' },
				} ),
			],
		} );
		const { container } = renderTab();
		await screen.findByRole( 'heading', { name: 'Instagram post' } );
		expect(
			container.querySelector( '.fair-events-marketing-text-preview' )
				.textContent
		).toBe( 'Line one\n\n  indented 🎉' );
		expect( screen.getByText( 'Team: Ana Ruiz' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Schedule item: Acro workshop' )
		).toBeInTheDocument();
	} );

	it( 'offers repair for an asset whose only image was deleted', async () => {
		mockApi( {
			items: [ asset( { text: '', image_removed: true } ) ],
		} );
		renderTab();
		expect(
			await screen.findByText( /Image removed: .* has no text/, {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Repair Instagram post' } )
		);
		expect(
			screen.getByText( /was deleted from the Media Library. Add text/ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save asset' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'creates an asset with exact text, members and a schedule item', async () => {
		const writes = jest.fn( ( req ) =>
			Promise.resolve(
				asset( {
					id: 12,
					label: req.data.label,
					text: req.data.text,
				} )
			)
		);
		mockApi( { writes } );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add asset' } )
		);

		const save = screen.getByRole( 'button', { name: 'Create asset' } );
		expect( save ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Enter what the asset is for to save it.' )
		).toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( 'Use case' ), {
			target: { value: 'WhatsApp status' },
		} );
		expect(
			screen.getByText( 'Add text, an image, or both to save the asset.' )
		).toBeInTheDocument();

		// Browsers (and jsdom) normalize a textarea's CRLF to LF, so the
		// editor sends LF; the API itself keeps CRLF (see the API spec).
		const text = '  Hola 👋\n\tsee you\n\n';
		fireEvent.change( screen.getByLabelText( 'Text' ), {
			target: { value: text },
		} );
		fireEvent.click( screen.getByLabelText( 'Marek Nowak' ) );
		fireEvent.change( screen.getByLabelText( 'Schedule item' ), {
			target: { value: '31' },
		} );

		// Linking a member publishes their name: saving needs consent.
		expect( save ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText(
				/names of the team members you added will be public/
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Required to link new team members. Becomes public: Marek Nowak.'
			)
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByLabelText(
				'Show these names on the public marketing assets page'
			)
		);
		fireEvent.click( save );

		await noticeText( 'Created WhatsApp status.' );
		expect( writes ).toHaveBeenCalledWith( {
			path: BASE,
			method: 'POST',
			data: {
				label: 'WhatsApp status',
				text,
				attachment_id: null,
				member_ids: [ 3 ],
				schedule_item_id: 31,
				publish_member_names: true,
			},
		} );
	} );

	it( 'explains image visibility and links a chosen PNG', async () => {
		let onSelect;
		const frame = {
			on: ( event, cb ) => {
				onSelect = cb;
			},
			open: jest.fn(),
			state: () => ( {
				get: () => ( {
					first: () => ( {
						toJSON: () => ( {
							id: 55,
							mime: 'image/png',
							url: 'https://example.test/poster.png',
							title: 'Poster',
						} ),
					} ),
				} ),
			} ),
		};
		window.wp = { media: jest.fn( () => frame ) };
		const writes = jest.fn( () => Promise.resolve( asset( { id: 12 } ) ) );
		mockApi( { writes } );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add asset' } )
		);

		expect(
			screen.getByText(
				/Anyone with an image’s link can open it as soon as it is uploaded/,
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Choose or upload image' } )
		);
		expect( window.wp.media ).toHaveBeenCalledWith(
			expect.objectContaining( {
				library: { type: [ 'image/jpeg', 'image/png' ] },
				multiple: false,
			} )
		);
		act( () => onSelect() );
		expect( screen.getByText( 'Poster' ) ).toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( 'Use case' ), {
			target: { value: 'Instagram post' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create asset' } )
		);
		await noticeText( 'Created Instagram post.' );
		expect( writes.mock.calls[ 0 ][ 0 ].data.attachment_id ).toBe( 55 );
	} );

	it( 'refuses an unsupported image type before saving', async () => {
		mockApi();
		window.wp = {
			media: () => ( {
				on: ( e, cb ) => cb(),
				open: jest.fn(),
				state: () => ( {
					get: () => ( {
						first: () => ( {
							toJSON: () => ( {
								id: 56,
								mime: 'image/gif',
								title: 'Anim',
							} ),
						} ),
					} ),
				} ),
			} ),
		};
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add asset' } )
		);
		fireEvent.change( screen.getByLabelText( 'Use case' ), {
			target: { value: 'Story' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Choose or upload image' } )
		);
		expect(
			screen.getByText( /Only PNG and JPEG images can be used/ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Create asset' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'keeps edits after a failed save and sends only changed fields', async () => {
		const writes = jest
			.fn()
			.mockRejectedValueOnce( {
				message: 'Invalid parameter(s): member_ids',
				data: {
					params: { member_ids: 'Only members of this team.' },
				},
			} )
			.mockImplementationOnce( ( req ) =>
				Promise.resolve( asset( { text: req.data.text } ) )
			);
		mockApi( { items: [ asset( { text: 'Stored\r\ntext' } ) ], writes } );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Edit Instagram post',
			} )
		);
		fireEvent.change( screen.getByLabelText( 'Use case' ), {
			target: { value: 'Instagram post' },
		} );
		// Untouched text is never resent, so stored CRLF stays as it is.
		expect(
			screen.getByRole( 'button', { name: 'Save asset' } )
		).toBeEnabled();
		fireEvent.change( screen.getByLabelText( 'Text' ), {
			target: { value: 'New text' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save asset' } ) );

		expect(
			await screen.findByText( 'Only members of this team.' )
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Text' ) ).toHaveValue( 'New text' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Save asset' } ) );
		await noticeText( 'Saved Instagram post.' );
		expect( writes ).toHaveBeenLastCalledWith( {
			path: `${ BASE }/11`,
			method: 'PATCH',
			data: { text: 'New text' },
		} );
	} );

	it( 'confirms deletion by label and says the image stays', async () => {
		const writes = jest.fn( () => Promise.resolve( { deleted: true } ) );
		mockApi( {
			items: [
				asset( {
					attachment_id: 55,
					image: {
						attachment_id: 55,
						available: true,
						url: 'https://example.test/p.png',
						title: 'Poster',
					},
				} ),
			],
			writes,
		} );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Delete Instagram post',
			} )
		);
		const dialog = screen.getByRole( 'dialog' );
		expect(
			within( dialog ).getByText(
				'Delete marketing asset — Instagram post'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( /The image stays in the Media Library/ )
		).toBeInTheDocument();
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete asset' } )
		);
		await noticeText(
			'Deleted Instagram post. Its image stays in the Media Library.'
		);
		expect( writes ).toHaveBeenCalledWith( {
			path: `${ BASE }/11`,
			method: 'DELETE',
		} );
		expect(
			screen.queryByRole( 'heading', { name: 'Instagram post' } )
		).not.toBeInTheDocument();
	} );

	it( 'only allows removing links while team and schedule are off', async () => {
		mockApi( {
			opts: options( {
				team: { available: false, members: [] },
				schedule: { available: false, items: [] },
			} ),
			items: [
				asset( {
					member_ids: [ 2 ],
					members: [ { id: 2, name: 'Ana', surname: 'Ruiz' } ],
					schedule_item_id: 31,
					schedule_item: { id: 31, title: 'Acro workshop' },
				} ),
			],
		} );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Edit Instagram post',
			} )
		);
		expect(
			screen.getByText( /Team management is turned off/ )
		).toBeInTheDocument();
		const ana = screen.getByLabelText( 'Ana Ruiz' );
		expect( ana ).toBeChecked();
		expect( ana ).toBeEnabled();
		expect( screen.queryByLabelText( 'Marek Nowak' ) ).toBeNull();
		fireEvent.click( ana );
		expect( screen.getByLabelText( 'Ana Ruiz' ) ).toBeDisabled();

		const select = screen.getByLabelText( 'Schedule item' );
		expect(
			within( select )
				.getAllByRole( 'option' )
				.map( ( o ) => o.value )
		).toEqual( [ '', '31' ] );
	} );

	it( 'links the public page and says the assets are public', async () => {
		mockApi();
		renderTab();
		const open = await screen.findByRole( 'link', {
			name: 'Open public page',
		} );
		expect( open ).toHaveAttribute(
			'href',
			'https://example.org/?fair_marketing_assets=7'
		);
		expect(
			screen.getByRole( 'link', { name: 'All events’ public pages' } )
		).toHaveAttribute(
			'href',
			'https://example.org/?fair_marketing_assets=all'
		);
		expect(
			screen.getByRole( 'button', { name: 'Copy public page link' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( /Everything here is public on this date’s/ )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add asset' } ) );
		expect(
			screen.getByText(
				/is shown on this date’s public marketing assets page as soon as it is saved/
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/The name and surname of each linked team member are shown/
			)
		).toBeInTheDocument();
	} );

	it( 'keeps legacy member names private until a save publishes them', async () => {
		const writes = jest.fn( ( req ) =>
			Promise.resolve(
				asset( {
					text: req.data.text ?? 'Line one\n\n  indented 🎉',
					member_ids: [ 2 ],
					members: [
						{
							id: 2,
							name: 'Ana',
							surname: 'Ruiz',
							public: !! req.data.publish_member_names,
						},
					],
				} )
			)
		);
		mockApi( {
			items: [
				asset( {
					member_ids: [ 2 ],
					members: [
						{ id: 2, name: 'Ana', surname: 'Ruiz', public: false },
					],
				} ),
			],
			writes,
		} );
		renderTab();
		expect(
			await screen.findByText( 'Team: Ana Ruiz (name not public)' )
		).toBeInTheDocument();

		const edit = () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Edit Instagram post' } )
			);

		// A content edit leaves the name private and the links untouched.
		edit();
		expect(
			screen.getByLabelText( 'Ana Ruiz (name not public)' )
		).toBeChecked();
		expect(
			screen.getByText(
				'Optional. Becomes public: Ana Ruiz. Leave it unchecked to keep these names private.'
			)
		).toBeInTheDocument();
		fireEvent.change( screen.getByLabelText( 'Text' ), {
			target: { value: 'Edited' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save asset' } ) );
		await noticeText( 'Saved Instagram post.' );
		expect( writes ).toHaveBeenLastCalledWith( {
			path: `${ BASE }/11`,
			method: 'PATCH',
			data: { text: 'Edited' },
		} );
		expect(
			screen.getByText( 'Team: Ana Ruiz (name not public)' )
		).toBeInTheDocument();

		// Publishing sends the member list it applies to.
		edit();
		fireEvent.click(
			screen.getByLabelText(
				'Show these names on the public marketing assets page'
			)
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Save asset' } ) );
		await waitFor( () =>
			expect( writes ).toHaveBeenLastCalledWith( {
				path: `${ BASE }/11`,
				method: 'PATCH',
				data: { member_ids: [ 2 ], publish_member_names: true },
			} )
		);
		expect(
			await screen.findByText( 'Team: Ana Ruiz' )
		).toBeInTheDocument();
	} );

	it( 'does not offer to publish names while team management is off', async () => {
		mockApi( {
			opts: options( { team: { available: false, members: [] } } ),
			items: [
				asset( {
					member_ids: [ 2 ],
					members: [
						{ id: 2, name: 'Ana', surname: 'Ruiz', public: false },
					],
				} ),
			],
		} );
		renderTab();
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Edit Instagram post',
			} )
		);
		expect(
			screen.queryByLabelText(
				'Show these names on the public marketing assets page'
			)
		).toBeNull();
		expect(
			screen.getByText(
				'Names that are not public cannot be published while team management is turned off.'
			)
		).toBeInTheDocument();
	} );

	it( 'parks an unsaved edit and restores it', async () => {
		mockApi( { items: [ asset() ] } );
		const setTabDirty = jest.fn();
		const setTabDraft = jest.fn();
		const { unmount } = renderTab( { setTabDirty, setTabDraft } );
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Edit Instagram post',
			} )
		);
		fireEvent.change( screen.getByLabelText( 'Text' ), {
			target: { value: 'Draft text' },
		} );
		await waitFor( () =>
			expect( setTabDirty ).toHaveBeenLastCalledWith(
				'marketing-assets',
				true
			)
		);
		const draft = setTabDraft.mock.calls.at( -1 )[ 1 ];
		expect( draft.editing.form.text ).toBe( 'Draft text' );
		unmount();

		renderTab( { getTabDraft: () => draft } );
		expect( await screen.findByLabelText( 'Text' ) ).toHaveValue(
			'Draft text'
		);
	} );
} );
