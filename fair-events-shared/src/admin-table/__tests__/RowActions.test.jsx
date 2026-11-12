/**
 * @jest-environment jsdom
 *
 * Shared admin table row actions (#2205): primary action, overflow menu,
 * keyboard use, disabled reasons, pending state and focus restoration.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	act,
	fireEvent,
	waitFor,
} from '@testing-library/react';
import RowActions from '../RowActions.js';

const MORE = 'More actions for “Spring feed”';

function renderActions( props = {} ) {
	return render(
		<RowActions
			primary={ { label: 'Edit', onClick: jest.fn() } }
			moreLabel={ MORE }
			{ ...props }
		/>
	);
}

async function openMenu() {
	const toggle = screen.getByRole( 'button', { name: MORE } );
	act( () => toggle.focus() );
	fireEvent.click( toggle );
	const menu = await screen.findByRole( 'menu', { name: MORE } );
	return { toggle, menu };
}

async function waitForMenuToClose() {
	await waitFor( () =>
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument()
	);
}

it( 'omits the overflow trigger without secondary actions', () => {
	renderActions();
	expect( screen.getByRole( 'button', { name: 'Edit' } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'button', { name: MORE } )
	).not.toBeInTheDocument();
} );

it( 'shows an item-specific overflow trigger with secondary actions', () => {
	renderActions( {
		secondary: [ { label: 'Delete', onClick: jest.fn() } ],
	} );
	expect( screen.getByRole( 'button', { name: MORE } ) ).toHaveAttribute(
		'aria-expanded',
		'false'
	);
} );

it( 'renders a link primary action', () => {
	renderActions( { primary: { label: 'View', href: '/view?id=3' } } );
	expect( screen.getByRole( 'link', { name: 'View' } ) ).toHaveAttribute(
		'href',
		'/view?id=3'
	);
} );

it( 'names the primary action after its item when given an accessible label', () => {
	renderActions( {
		primary: {
			label: 'Edit',
			accessibleLabel: 'Edit “Spring feed”',
			onClick: jest.fn(),
		},
	} );
	const edit = screen.getByRole( 'button', { name: 'Edit “Spring feed”' } );
	expect( edit ).toHaveTextContent( 'Edit' );
} );

it( 'runs the primary action with a focus handoff', () => {
	const onClick = jest.fn();
	renderActions( { primary: { label: 'Edit', onClick } } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );
	expect( onClick ).toHaveBeenCalledTimes( 1 );
	expect( onClick.mock.calls[ 0 ][ 0 ].restoreFocus ).toEqual(
		expect.any( Function )
	);
} );

it( 'keeps a disabled primary action focusable and explains why', () => {
	const onClick = jest.fn();
	renderActions( {
		primary: {
			label: 'Send test',
			onClick,
			disabled: true,
			disabledReason: 'Choose a recipient first.',
		},
	} );
	const button = screen.getByRole( 'button', { name: 'Send test' } );
	expect( button ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( button ).not.toBeDisabled();
	expect( button ).toHaveAccessibleDescription( 'Choose a recipient first.' );
	expect( screen.getByText( 'Choose a recipient first.' ) ).toBeVisible();
	fireEvent.click( button );
	expect( onClick ).not.toHaveBeenCalled();
} );

it( 'shows the pending label and ignores clicks while busy', () => {
	const onClick = jest.fn();
	renderActions( {
		primary: {
			label: 'Send test',
			busyLabel: 'Sending…',
			isBusy: true,
			onClick,
		},
	} );
	const button = screen.getByRole( 'button', { name: 'Sending…' } );
	expect( button ).toHaveAttribute( 'aria-disabled', 'true' );
	fireEvent.click( button );
	expect( onClick ).not.toHaveBeenCalled();
} );

// jsdom has no layout, so the Popover cannot focus its first item and the
// menu cannot find its arrow-key targets; e2e/admin-table-example.spec.js
// covers both in a browser.
it( 'runs a menu item, closes the menu and restores focus', async () => {
	const onDuplicate = jest.fn();
	renderActions( {
		secondary: [
			{ label: 'Duplicate', onClick: onDuplicate },
			{ label: 'Delete', onClick: jest.fn(), isDestructive: true },
		],
	} );
	const { toggle } = await openMenu();
	expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
	expect(
		screen.getByRole( 'menuitem', { name: 'Delete' } )
	).toBeInTheDocument();

	const duplicate = screen.getByRole( 'menuitem', { name: 'Duplicate' } );
	act( () => duplicate.focus() );
	fireEvent.click( duplicate );
	expect( onDuplicate ).toHaveBeenCalledTimes( 1 );
	await waitForMenuToClose();
	expect( toggle ).toHaveFocus();
} );

it( 'closes the menu on Escape and returns focus to the trigger', async () => {
	renderActions( {
		secondary: [ { label: 'Delete', onClick: jest.fn() } ],
	} );
	const { toggle } = await openMenu();
	const item = screen.getByRole( 'menuitem', { name: 'Delete' } );
	act( () => item.focus() );
	fireEvent.keyDown( item, { key: 'Escape' } );
	await waitForMenuToClose();
	expect( toggle ).toHaveFocus();
} );

it( 'shows a disabled menu item with its reason and does not run it', async () => {
	const onDuplicate = jest.fn();
	renderActions( {
		secondary: [
			{
				label: 'Duplicate',
				onClick: onDuplicate,
				disabled: true,
				disabledReason: 'Reconnect Telegram to duplicate.',
			},
		],
	} );
	await openMenu();
	const item = screen.getByRole( 'menuitem', { name: /Duplicate/ } );
	expect( item ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( item ).toHaveTextContent( 'Reconnect Telegram to duplicate.' );
	fireEvent.click( item );
	expect( onDuplicate ).not.toHaveBeenCalled();
	expect( screen.getByRole( 'menu' ) ).toBeInTheDocument();
} );

it( 'lets a consumer return focus to the trigger after its own dialog', async () => {
	let handoff;
	renderActions( {
		secondary: [
			{
				label: 'Delete',
				onClick: ( { restoreFocus } ) => {
					handoff = restoreFocus;
				},
			},
		],
	} );
	const { toggle } = await openMenu();
	fireEvent.click( screen.getByRole( 'menuitem', { name: 'Delete' } ) );
	await waitForMenuToClose();
	act( () => screen.getByRole( 'button', { name: 'Edit' } ).focus() );
	act( () => handoff() );
	expect( toggle ).toHaveFocus();
} );

describe( 'link click handlers', () => {
	function inPlace( onNavigate ) {
		return ( event ) => {
			if ( event.metaKey || event.ctrlKey || event.shiftKey ) {
				return;
			}
			event.preventDefault();
			onNavigate();
		};
	}

	it( 'passes a primary link’s click to its handler and keeps the href', () => {
		const onNavigate = jest.fn();
		renderActions( {
			primary: {
				label: 'Edit',
				href: '/edit?id=3',
				onLinkClick: inPlace( onNavigate ),
			},
		} );
		const link = screen.getByRole( 'link', { name: 'Edit' } );
		expect( link ).toHaveAttribute( 'href', '/edit?id=3' );

		// A modified click is left to the browser.
		expect( fireEvent.click( link, { metaKey: true } ) ).toBe( true );
		expect( onNavigate ).not.toHaveBeenCalled();

		expect( fireEvent.click( link ) ).toBe( false );
		expect( onNavigate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'passes a menu link’s click to its handler and closes the menu', async () => {
		const onNavigate = jest.fn();
		renderActions( {
			secondary: [
				{
					label: 'History',
					href: '/history?id=3',
					onLinkClick: inPlace( onNavigate ),
				},
			],
		} );

		const { toggle } = await openMenu();
		const item = screen.getByRole( 'menuitem', { name: 'History' } );
		expect( item ).toHaveAttribute( 'href', '/history?id=3' );
		expect( fireEvent.click( item, { ctrlKey: true } ) ).toBe( true );
		expect( onNavigate ).not.toHaveBeenCalled();
		await waitForMenuToClose();
		expect( toggle ).toHaveFocus();

		await openMenu();
		expect(
			fireEvent.click(
				screen.getByRole( 'menuitem', { name: 'History' } )
			)
		).toBe( false );
		expect( onNavigate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores the handler of a disabled primary link', () => {
		const onLinkClick = jest.fn();
		renderActions( {
			primary: {
				label: 'Edit',
				href: '/edit?id=3',
				onLinkClick,
				disabled: true,
				disabledReason: 'Locked.',
			},
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );
		expect( onLinkClick ).not.toHaveBeenCalled();
	} );
} );
