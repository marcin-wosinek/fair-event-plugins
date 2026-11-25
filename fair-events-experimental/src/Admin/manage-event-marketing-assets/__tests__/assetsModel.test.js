/**
 * Tests for the Marketing tab's editor model (#2396).
 */
import {
	emptyForm,
	formFromAsset,
	hasMeaningfulText,
	isFormDirty,
	publicationNeeds,
	saveBlocker,
	toPayload,
} from '../assetsModel.js';

const messages = {
	label: 'label',
	content: 'content',
	image: 'image',
	tooLong: 'long',
};

describe( 'hasMeaningfulText', () => {
	it( 'ignores whitespace, separators and formatting characters', () => {
		expect( hasMeaningfulText( ' \n\t ​ ' ) ).toBe( false );
		expect( hasMeaningfulText( '' ) ).toBe( false );
		expect( hasMeaningfulText( ' 🎉 ' ) ).toBe( true );
		expect( hasMeaningfulText( '\n  ż' ) ).toBe( true );
	} );
} );

describe( 'saveBlocker', () => {
	it( 'requires a label, then text or a usable image', () => {
		const form = emptyForm();
		expect( saveBlocker( form, messages ) ).toBe( 'label' );
		expect( saveBlocker( { ...form, label: 'Post' }, messages ) ).toBe(
			'content'
		);
		expect(
			saveBlocker( { ...form, label: 'Post', text: 'Hi' }, messages )
		).toBe( '' );
		expect(
			saveBlocker(
				{
					...form,
					label: 'Post',
					image: { attachment_id: 1, available: true },
				},
				messages
			)
		).toBe( '' );
		expect(
			saveBlocker(
				{
					...form,
					label: 'Post',
					text: 'Hi',
					image: { attachment_id: 1, available: false },
				},
				messages
			)
		).toBe( 'image' );
	} );

	it( 'counts characters, not UTF-16 units, against the limits', () => {
		const form = { ...emptyForm(), label: 'P', text: '🎉🎉' };
		expect( saveBlocker( form, messages, { maxText: 2 } ) ).toBe( '' );
		expect( saveBlocker( form, messages, { maxText: 1 } ) ).toBe( 'long' );
	} );
} );

describe( 'toPayload', () => {
	const original = {
		label: 'Post',
		text: 'A\r\nB',
		image: { attachment_id: 5 },
		memberIds: [ 2, 3 ],
		scheduleItemId: 31,
	};

	it( 'sends every field on create', () => {
		expect( toPayload( original ) ).toEqual( {
			label: 'Post',
			text: 'A\r\nB',
			attachment_id: 5,
			member_ids: [ 2, 3 ],
			schedule_item_id: 31,
		} );
	} );

	it( 'sends only changed fields on update, null to clear', () => {
		const form = {
			...original,
			memberIds: [ 3, 2 ],
			image: null,
			scheduleItemId: null,
		};
		expect( isFormDirty( form, original ) ).toBe( true );
		expect( toPayload( form, original ) ).toEqual( {
			attachment_id: null,
			schedule_item_id: null,
		} );
		expect(
			isFormDirty( { ...original, memberIds: [ 3, 2 ] }, original )
		).toBe( false );
	} );
} );

describe( 'member name publication (#2430)', () => {
	const stored = formFromAsset( {
		label: 'Post',
		text: 'Hi',
		member_ids: [ 2, 3 ],
		schedule_item_id: null,
	} );
	const linked = [
		{ id: 2, public: true },
		{ id: 3, public: false },
	];

	it( 'tells added members from stored members not yet public', () => {
		const form = { ...stored, memberIds: [ 2, 3, 4 ] };
		expect( publicationNeeds( form, stored, linked ) ).toEqual( {
			added: [ 4 ],
			unpublished: [ 3 ],
		} );
		expect(
			publicationNeeds( { ...emptyForm(), memberIds: [ 5 ] }, null )
		).toEqual( {
			added: [ 5 ],
			unpublished: [],
		} );
	} );

	it( 'blocks a save that adds members until names are confirmed', () => {
		const form = { ...stored, memberIds: [ 2, 4 ] };
		const needs = publicationNeeds( form, stored, linked );
		const withMessage = { ...messages, publication: 'publication' };
		expect( saveBlocker( form, withMessage, {}, needs ) ).toBe(
			'publication'
		);
		expect(
			saveBlocker(
				{ ...form, publishMemberNames: true },
				withMessage,
				{},
				needs
			)
		).toBe( '' );
		// Members not yet public don't block other edits.
		const kept = { ...stored, text: 'Edited' };
		expect(
			saveBlocker(
				kept,
				withMessage,
				{},
				publicationNeeds( kept, stored, linked )
			)
		).toBe( '' );
	} );

	it( 'sends the member list with the confirmation', () => {
		expect(
			toPayload( { ...stored, publishMemberNames: true }, stored )
		).toEqual( { member_ids: [ 2, 3 ], publish_member_names: true } );
		expect( toPayload( { ...stored, text: 'Edited' }, stored ) ).toEqual( {
			text: 'Edited',
		} );
		expect(
			isFormDirty( { ...stored, publishMemberNames: true }, stored )
		).toBe( true );
		expect(
			toPayload( {
				...emptyForm(),
				label: 'L',
				memberIds: [ 2 ],
				publishMemberNames: true,
			} )
		).toMatchObject( { member_ids: [ 2 ], publish_member_names: true } );
	} );
} );
