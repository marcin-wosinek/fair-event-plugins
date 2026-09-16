/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import CategorySelector from '../CategorySelector.js';

jest.mock( '@wordpress/api-fetch' );

const renderSelector = ( selectedCategories, onChange = jest.fn() ) =>
	render(
		<CategorySelector
			selectedCategories={ selectedCategories }
			onChange={ onChange }
		/>
	);

describe( 'CategorySelector', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'requests every configured language', async () => {
		apiFetch.mockResolvedValue( [] );

		renderSelector( [] );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/sources/categories?all_languages=true',
			} )
		);
	} );

	it( 'distinguishes identically named categories by their language', async () => {
		apiFetch.mockResolvedValue( [
			{ id: 1, name: 'Bart', slug: 'bart-es', language: 'Español' },
			{ id: 2, name: 'Bart', slug: 'bart-en', language: 'English' },
		] );

		renderSelector( [] );

		expect(
			await screen.findByLabelText( 'Bart — Español' )
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Bart — English' ) ).toBeInTheDocument();
	} );

	it( 'falls back to the plain name when no language metadata is present', async () => {
		apiFetch.mockResolvedValue( [
			{ id: 3, name: 'Music', slug: 'music' },
		] );

		renderSelector( [] );

		expect( await screen.findByLabelText( 'Music' ) ).toBeInTheDocument();
	} );

	it( 'selects and deselects independent term IDs', async () => {
		apiFetch.mockResolvedValue( [
			{ id: 1, name: 'Bart', slug: 'bart-es', language: 'Español' },
			{ id: 2, name: 'Bart', slug: 'bart-en', language: 'English' },
		] );
		const onChange = jest.fn();

		renderSelector( [ 1 ], onChange );

		const englishCheckbox =
			await screen.findByLabelText( 'Bart — English' );
		expect( englishCheckbox ).not.toBeChecked();
		expect( screen.getByLabelText( 'Bart — Español' ) ).toBeChecked();

		fireEvent.click( englishCheckbox );
		expect( onChange ).toHaveBeenCalledWith( [ 1, 2 ] );

		fireEvent.click( screen.getByLabelText( 'Bart — Español' ) );
		expect( onChange ).toHaveBeenCalledWith( [] );
	} );

	it( 'preserves already selected IDs while categories load', async () => {
		apiFetch.mockResolvedValue( [
			{ id: 5, name: 'Music', slug: 'music' },
		] );

		renderSelector( [ 5 ] );

		expect( await screen.findByLabelText( 'Music' ) ).toBeChecked();
	} );

	it( 'shows the empty-category guidance when no categories exist', async () => {
		apiFetch.mockResolvedValue( [] );

		renderSelector( [] );

		expect(
			await screen.findByText(
				'Define more categories if you want to use category filtering'
			)
		).toBeInTheDocument();
	} );

	it( 'shows an error notice when the request fails', async () => {
		apiFetch.mockRejectedValue( new Error( 'network down' ) );

		renderSelector( [] );

		await waitFor( () =>
			expect(
				screen.getAllByText( 'network down' ).length
			).toBeGreaterThan( 0 )
		);
	} );
} );
