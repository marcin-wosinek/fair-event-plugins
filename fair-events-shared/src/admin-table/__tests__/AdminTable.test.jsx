/**
 * @jest-environment jsdom
 *
 * Shared admin table shell, identity, status and list messages (#2205).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import {
	AdminTable,
	AdminTableHeaderCell,
	AdminTableCell,
	ItemIdentity,
	StatusLabel,
	TableMessage,
} from '../index.js';

it( 'renders a captioned table with labeled cells', () => {
	render(
		<AdminTable caption="Event feeds">
			<thead>
				<tr>
					<AdminTableHeaderCell variant="identity">
						Name
					</AdminTableHeaderCell>
					<AdminTableHeaderCell variant="amount">
						Total
					</AdminTableHeaderCell>
				</tr>
			</thead>
			<tbody>
				<tr>
					<AdminTableCell label="Name" variant="identity">
						Spring
					</AdminTableCell>
					<AdminTableCell label="Total" variant="amount">
						€12.00
					</AdminTableCell>
				</tr>
			</tbody>
		</AdminTable>
	);
	expect(
		screen.getByRole( 'table', { name: 'Event feeds' } )
	).toBeVisible();
	expect(
		screen.getByRole( 'columnheader', { name: 'Total' } )
	).toHaveAttribute( 'scope', 'col' );
	const amount = screen.getByRole( 'cell', { name: '€12.00' } );
	expect( amount ).toHaveAttribute( 'data-label', 'Total' );
	expect( amount ).toHaveClass( 'fair-admin-table__cell--amount' );
} );

it( 'ignores unknown cell variants', () => {
	render(
		<table>
			<tbody>
				<tr>
					<AdminTableCell label="X" variant="bogus">
						x
					</AdminTableCell>
				</tr>
			</tbody>
		</table>
	);
	expect( screen.getByRole( 'cell' ) ).toHaveAttribute(
		'class',
		'fair-admin-table__cell'
	);
} );

it( 'links the identity and shows supporting text', () => {
	render(
		<ItemIdentity title="Spring feed" href="/feed/1" meta="spring-feed" />
	);
	expect(
		screen.getByRole( 'link', { name: 'Spring feed' } )
	).toHaveAttribute( 'href', '/feed/1' );
	expect( screen.getByText( 'spring-feed' ) ).toBeVisible();
} );

it( 'passes the identity link’s click to its handler', () => {
	const onClick = jest.fn( ( event ) => event.preventDefault() );
	render(
		<ItemIdentity title="Spring feed" href="/feed/1" onClick={ onClick } />
	);
	const link = screen.getByRole( 'link', { name: 'Spring feed' } );
	expect( fireEvent.click( link, { metaKey: true } ) ).toBe( false );
	expect( onClick ).toHaveBeenCalledWith(
		expect.objectContaining( { metaKey: true } )
	);
	expect( link ).toHaveAttribute( 'href', '/feed/1' );
} );

it( 'falls back for an empty identity', () => {
	render( <ItemIdentity title="" fallback="(untitled feed)" /> );
	expect( screen.getByText( '(untitled feed)' ) ).toBeVisible();
	expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();
} );

it( 'renders status text with a tone class, defaulting to neutral', () => {
	const { rerender } = render(
		<StatusLabel tone="success">Paid</StatusLabel>
	);
	expect( screen.getByText( 'Paid' ) ).toHaveClass(
		'fair-admin-table__status--success'
	);
	rerender( <StatusLabel tone="unknown">Draft</StatusLabel> );
	expect( screen.getByText( 'Draft' ) ).toHaveClass(
		'fair-admin-table__status--neutral'
	);
} );

it( 'announces loading', () => {
	render( <TableMessage status="loading">Loading feeds…</TableMessage> );
	expect( screen.getByRole( 'status' ) ).toHaveTextContent(
		'Loading feeds…'
	);
} );

it( 'offers retry on error', async () => {
	const onRetry = jest.fn();
	render(
		<TableMessage status="error" onRetry={ onRetry } retryLabel="Try again">
			The feeds could not be loaded.
		</TableMessage>
	);
	expect( document.querySelector( '.components-notice' ) ).toHaveTextContent(
		'The feeds could not be loaded.'
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
	expect( onRetry ).toHaveBeenCalledTimes( 1 );
} );

it( 'offers clearing filters only for no results', async () => {
	const onClear = jest.fn();
	const { rerender } = render(
		<TableMessage
			status="no-results"
			onClear={ onClear }
			clearLabel="Clear filters"
		>
			No feeds match.
		</TableMessage>
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'Clear filters' } ) );
	expect( onClear ).toHaveBeenCalledTimes( 1 );
	rerender(
		<TableMessage
			status="empty"
			onClear={ onClear }
			clearLabel="Clear filters"
		>
			No feeds yet.
		</TableMessage>
	);
	expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
} );
