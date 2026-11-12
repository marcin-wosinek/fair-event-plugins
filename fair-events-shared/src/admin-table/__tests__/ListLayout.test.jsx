/**
 * @jest-environment jsdom
 *
 * Header, toolbar, applied filters, selection summary and pagination
 * around the shared admin table (#2210).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef, useState } from '@wordpress/element';
import {
	ListHeader,
	ListToolbar,
	ListToolbarField,
	MoreFiltersToggle,
	MoreFiltersPanel,
	ResultCount,
	AppliedFilters,
	SelectionSummary,
	ListPagination,
	pageRange,
	TableMessage,
} from '../index.js';

it( 'puts the page actions beside a focusable title', () => {
	const ref = createRef();
	render(
		<ListHeader
			ref={ ref }
			title="Event Feeds"
			actions={ <button type="button">Add Event Feed</button> }
		/>
	);
	const heading = screen.getByRole( 'heading', { level: 1 } );
	expect( heading ).toHaveTextContent( 'Event Feeds' );
	expect( ref.current ).toBe( heading );
	ref.current.focus();
	expect( heading ).toHaveFocus();
	expect(
		screen.getByRole( 'button', { name: 'Add Event Feed' } )
	).toBeInTheDocument();
} );

it( 'orders selection, filters, actions and count in one row', () => {
	const { container } = render(
		<ListToolbar
			selection={
				<SelectionSummary label="2 selected">
					<button type="button">Export</button>
				</SelectionSummary>
			}
			actions={ <button type="button">Clear filters</button> }
			count={ <ResultCount>1–50 of 120 items</ResultCount> }
		>
			<ListToolbarField wide>
				<label>
					Search
					<input />
				</label>
			</ListToolbarField>
		</ListToolbar>
	);
	const row = container.querySelector( '.fair-admin-list-toolbar__row' );
	expect(
		[ ...row.children ].map(
			( child ) => child.className.split( ' ' )[ 0 ]
		)
	).toEqual( [
		'fair-admin-list-toolbar__selection',
		'fair-admin-list-toolbar__field',
		'fair-admin-list-toolbar__actions',
		'fair-admin-list-toolbar__count',
	] );
	expect(
		screen.getByRole( 'group', { name: '2 selected' } )
	).toContainElement( screen.getByRole( 'button', { name: 'Export' } ) );
	expect( screen.getByRole( 'status' ) ).toHaveTextContent(
		'1–50 of 120 items'
	);
} );

function Disclosure() {
	const [ open, setOpen ] = useState( false );
	return (
		<ListToolbar
			actions={
				<MoreFiltersToggle
					panelId="more"
					isOpen={ open }
					onToggle={ () => setOpen( ! open ) }
					label="More filters"
				/>
			}
			panel={
				<MoreFiltersPanel
					id="more"
					isOpen={ open }
					label="More filters"
				>
					<label>
						Tag
						<input defaultValue="" />
					</label>
				</MoreFiltersPanel>
			}
		/>
	);
}

it( 'shows and hides the less-used filters, keeping their values', () => {
	render( <Disclosure /> );
	const toggle = screen.getByRole( 'button', { name: 'More filters' } );
	expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
	expect( toggle ).toHaveAttribute( 'aria-controls', 'more' );
	expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();

	toggle.focus();
	fireEvent.click( toggle );
	expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
	expect(
		screen.getByRole( 'group', { name: 'More filters' } )
	).toBeVisible();
	fireEvent.change( screen.getByRole( 'textbox', { name: 'Tag' } ), {
		target: { value: 'Catering' },
	} );

	fireEvent.click( toggle );
	expect( toggle ).toHaveFocus();
	fireEvent.click( toggle );
	expect( screen.getByRole( 'textbox', { name: 'Tag' } ) ).toHaveValue(
		'Catering'
	);
} );

it( 'summarizes applied criteria, and nothing without any', () => {
	const { rerender, container } = render(
		<AppliedFilters label="Applied filters:" items={ [] } />
	);
	expect( container ).toBeEmptyDOMElement();

	rerender(
		<AppliedFilters
			label="Applied filters:"
			items={ [ 'Status: Paid', 'Mode: Live' ] }
		/>
	);
	expect( screen.getByText( 'Applied filters:' ) ).toBeInTheDocument();
	expect(
		screen.getAllByRole( 'listitem' ).map( ( item ) => item.textContent )
	).toEqual( [ 'Status: Paid', 'Mode: Live' ] );
} );

describe( 'ListPagination', () => {
	const labels = {
		label: 'Item pages',
		previousLabel: 'Previous page',
		nextLabel: 'Next page',
	};

	it( 'is hidden for a single page', () => {
		const { container } = render(
			<ListPagination
				{ ...labels }
				page={ 1 }
				totalPages={ 1 }
				positionLabel="Page 1 of 1"
				onChange={ jest.fn() }
			/>
		);
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'keeps an unavailable boundary focusable and ignores it', () => {
		const onChange = jest.fn();
		render(
			<ListPagination
				{ ...labels }
				page={ 3 }
				totalPages={ 3 }
				positionLabel="Page 3 of 3"
				onChange={ onChange }
			/>
		);
		const nav = screen.getByRole( 'navigation', { name: 'Item pages' } );
		expect( nav ).toHaveTextContent( 'Page 3 of 3' );
		const next = screen.getByRole( 'button', { name: 'Next page' } );
		expect( next ).toHaveAttribute( 'aria-disabled', 'true' );
		next.focus();
		expect( next ).toHaveFocus();
		fireEvent.click( next );
		expect( onChange ).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Previous page' } )
		);
		expect( onChange ).toHaveBeenCalledWith( 2 );
	} );

	it( 'renders page links when given link props', () => {
		render(
			<ListPagination
				{ ...labels }
				page={ 1 }
				totalPages={ 2 }
				positionLabel="Page 1 of 2"
				pageProps={ ( number ) => ( { href: `?p=${ number }` } ) }
			/>
		);
		expect(
			screen.getByRole( 'link', { name: 'Next page' } )
		).toHaveAttribute( 'href', '?p=2' );
	} );
} );

it( 'computes the shown range, clamped to the total', () => {
	expect( pageRange( 1, 50, 120 ) ).toEqual( { first: 1, last: 50 } );
	expect( pageRange( 3, 50, 120 ) ).toEqual( { first: 101, last: 120 } );
	expect( pageRange( 1, 50, 0 ) ).toEqual( { first: 0, last: 0 } );
} );

it( 'offers next steps for an empty dataset only', () => {
	const { rerender } = render(
		<TableMessage
			status="empty"
			actions={ <button type="button">Add your first item</button> }
		>
			Nothing yet.
		</TableMessage>
	);
	expect(
		screen.getByRole( 'button', { name: 'Add your first item' } )
	).toBeInTheDocument();

	rerender(
		<TableMessage
			status="no-results"
			actions={ <button type="button">Add your first item</button> }
			onClear={ jest.fn() }
			clearLabel="Clear filters"
		>
			Nothing matches.
		</TableMessage>
	);
	expect(
		screen.queryByRole( 'button', { name: 'Add your first item' } )
	).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Clear filters' } )
	).toBeInTheDocument();
} );
