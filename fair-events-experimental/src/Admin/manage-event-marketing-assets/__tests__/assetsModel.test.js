/**
 * Tests for the Marketing tab's editor model (#2396).
 */
import {
	emptyForm,
	hasMeaningfulText,
	isFormDirty,
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
