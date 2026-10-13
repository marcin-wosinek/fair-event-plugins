/**
 * How participants are named in confirmations (#1775): by name, with the
 * email or the ID added only where the name alone does not tell people
 * apart.
 */
import {
	identifyParticipants,
	participantLabel,
	personFromEventRow,
	personFromProfile,
} from '../participantIdentity.js';

describe( 'participantLabel', () => {
	it( 'uses the name, then the email, then the ID', () => {
		expect(
			participantLabel( { id: 7, name: 'Jane Doe', email: 'j@x.test' } )
		).toBe( 'Jane Doe' );
		expect(
			participantLabel( { id: 7, name: '', email: 'j@x.test' } )
		).toBe( 'j@x.test' );
		expect( participantLabel( { id: 7, name: '', email: '' } ) ).toBe(
			'Participant #7'
		);
	} );
} );

describe( 'identifyParticipants', () => {
	it( 'shows names alone when they differ', () => {
		expect(
			identifyParticipants( [
				{ id: 1, name: 'Jane Doe', email: 'jane@x.test' },
				{ id: 2, name: 'John Roe', email: 'john@x.test' },
			] )
		).toEqual( [
			{ id: 1, label: 'Jane Doe', detail: '' },
			{ id: 2, label: 'John Roe', detail: '' },
		] );
	} );

	it( 'adds the email to people sharing a name', () => {
		expect(
			identifyParticipants( [
				{ id: 1, name: 'Jane Doe', email: 'jane@x.test' },
				{ id: 2, name: 'jane doe', email: 'other@x.test' },
				{ id: 3, name: 'John Roe', email: 'john@x.test' },
			] )
		).toEqual( [
			{ id: 1, label: 'Jane Doe', detail: 'jane@x.test' },
			{ id: 2, label: 'jane doe', detail: 'other@x.test' },
			{ id: 3, label: 'John Roe', detail: '' },
		] );
	} );

	it( 'falls back to the ID when the email does not tell them apart', () => {
		expect(
			identifyParticipants( [
				{ id: 1, name: 'Jane Doe', email: '' },
				{ id: 2, name: 'Jane Doe', email: 'same@x.test' },
				{ id: 3, name: 'Jane Doe', email: 'same@x.test' },
			] )
		).toEqual( [
			{ id: 1, label: 'Jane Doe', detail: 'ID 1' },
			{ id: 2, label: 'Jane Doe', detail: 'ID 2' },
			{ id: 3, label: 'Jane Doe', detail: 'ID 3' },
		] );
	} );

	it( 'names a person without a name by email or ID', () => {
		expect(
			identifyParticipants( [
				{ id: 1, name: '', email: 'jane@x.test' },
				{ id: 2, name: '', email: '' },
			] )
		).toEqual( [
			{ id: 1, label: 'jane@x.test', detail: '' },
			{ id: 2, label: 'Participant #2', detail: '' },
		] );
	} );
} );

describe( 'person adapters', () => {
	it( 'reads a profile and an event row the same way', () => {
		expect(
			personFromProfile( {
				id: 4,
				name: 'Jane',
				surname: 'Doe',
				email: 'jane@x.test',
			} )
		).toEqual( {
			id: 4,
			name: 'Jane Doe',
			email: 'jane@x.test',
		} );
		expect(
			personFromEventRow( {
				participant_id: 4,
				participant_name: 'Jane Doe ',
				participant_email: null,
			} )
		).toEqual( { id: 4, name: 'Jane Doe', email: '' } );
		expect( personFromProfile( { id: 5, name: 'Solo' } ).name ).toBe(
			'Solo'
		);
	} );
} );
